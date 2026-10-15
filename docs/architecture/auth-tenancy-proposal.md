# Modulus — proposta de autenticação e isolamento por empresa

> Revisão: 14/10/2026. **Proposta para aprovação humana, não implementação validada.**  
> Os exemplos e contratos abaixo são ilustrativos. Não foram executados SQL, migrations, testes de isolamento ou acessos ao banco remoto nesta avaliação.

## 1. Base, evidências e limites da avaliação

Foram lidos `AGENTS.md`, `CLAUDE.md`, a proposta anterior e a fundação localizada em `docs/architectur/saas-foundation.md` (grafia existente, preservada). A fundação não foi alterada. Vitest, CI e uma infraestrutura completa de testes continuam adiados; verificar isolamento antes de abrir cadastro público continua obrigatório.

Evidências locais da inspeção anterior, não confirmação do estado implantado:

| Arquivo | Evidência e impacto |
|---|---|
| `middleware.ts`, `lib/supabase/middleware.ts` | Refresh de cookies, `auth.getUser()` e proteção de `/admin`; redirecionamento não protege Data API nem substitui autorização por operação. |
| `lib/supabase/server.ts` | Clientes de sessão e administrativo. O comentário de uso exclusivo no servidor não equivale a uma barreira técnica de importação. |
| `lib/auth/actions.ts` | Login por senha e logout; ainda sem resolução de usuário interno/empresa. |
| `lib/products/actions.ts`, `lib/catalogs/actions.ts`, `lib/filters/actions.ts`, `lib/sales/actions.ts` | Há verificações de autenticação em mutações, mas não contexto de empresa. Nem todas as consultas de leitura fazem essa verificação explicitamente. |
| `supabase/migrations/20260818000000_create_catalogs_and_products.sql` | Tabelas sem tenancy; políticas autenticadas `USING (true)`/`WITH CHECK (true)`; buckets públicos e escrita restrita apenas por bucket. |
| `20260826000000_create_closed_sales.sql`, `20260901000000_create_product_images.sql`, `20261001000000_create_catalog_filters.sql` | Mesmo padrão amplo de acesso autenticado; filtros têm validação de pertencimento ao catálogo, não isolamento entre empresas. |
| `lib/catalogs/getCatalogBySlug.ts` | Leitura para vitrine que precisará consumir superfície pública limitada. |

Há sete arquivos de migration no repositório; **não foi comprovado quais foram aplicados**. Não se pode inferir grants efetivos, configuração de Auth ou conteúdo de produção somente desses arquivos. A exposição automática desativada em dev é informação fornecida pelo responsável, não verificação remota. Os schemas expostos e grants existentes deverão ser conferidos na implementação autorizada.

Não foram lidos valores de `.env`. A versão local consultada de `@supabase/auth-js` é 2.112.3; a documentação atual suporta `updateUser({ password, current_password })`, mas a configuração efetiva do serviço Auth não foi testada.

## 2. Modelo mínimo proposto

Todos os IDs de domínio são `uuid default gen_random_uuid()`, independentes de `auth.users.id`. Timestamps são `timestamptz not null default now()`; `updated_at` recebe atualização por trigger em toda mudança. Não confiar em timestamp enviado pelo cliente. Validar nomes não vazios e limites de tamanho no servidor e no banco.

| Tabela | Campos e restrições |
|---|---|
| `public.users` | `id` PK; `full_name text not null`; `email text not null`; `email_normalized` derivado de `lower(btrim(email))`, UNIQUE; `status text not null check in ('active','inactive')`; `must_change_password boolean not null`; `password_change_version bigint not null default 0`; `password_changed_at timestamptz null`; timestamps. |
| `public.auth_identities` | `id` PK; `user_id uuid not null references users(id) on delete restrict`; `provider text not null`; `issuer text not null`; `subject text not null`; `status` active/inactive; timestamps; UNIQUE `(issuer, subject)` e, inicialmente, UNIQUE `(user_id, issuer)`. |
| `public.enterprises` | `id` PK; `name text not null`; `status` active/inactive; timestamps. Sem CNPJ obrigatório. Slug de empresa não é necessário agora: preservar o slug global dos catálogos existentes. |
| `public.enterprise_members` | `id` PK; `enterprise_id uuid not null references enterprises(id) on delete restrict`; `user_id uuid not null references users(id) on delete restrict`; `role` owner/admin/operator; `status` active/inactive; timestamps; UNIQUE `(enterprise_id,user_id)`. |

O emissor identifica o projeto/provedor concreto, não apenas a string `supabase`. `subject` representa o UUID textual do usuário Supabase; não é o ID de uma identidade OAuth interna ao Supabase. E-mail não resolve identidade nem autoriza associação automática. Alterações de endereço dependem do fluxo verificado de Auth e sincronização pelo backend; não liberar PATCH direto de e-mail no domínio.

Normalizar e-mail igualmente nos dois cadastros e consultas, sem remover pontos ou sufixos `+`. Confirmar compatibilidade dessa regra com Auth; conflitos exigem reconciliação, nunca mesclagem silenciosa de usuários. A unicidade é uma regra inicial do produto, não um identificador imutável.

Índices: os UNIQUE/PK já criam índices, portanto não duplicar índices de e-mail ou `(enterprise_id,user_id)`. Acrescentar `auth_identities(user_id)` se a ordem dos índices existentes não atender à consulta, `enterprise_members(user_id,status)` e índices iniciando por `enterprise_id` nas tabelas operacionais e suas consultas frequentes. Validar planos antes de adicionar outros.

Preferir inativação a exclusão de usuários, identidades, empresas e membros. RESTRICT preserva vínculos e histórico; remoção definitiva exige procedimento separado de retenção/privacidade. Não usar cascatas de usuários/empresas para apagar vendas. Autoria futura referencia UUID interno, com integridade da empresa.

`status` é independente de `must_change_password`: não criar status redundante `pending_password_change`. A versão da obrigação permite compare-and-set na liberação e impede que uma resposta antiga remova uma obrigação mais recente. Alterar obrigação, status ou papel não é edição de perfil.

Modelo permite vários membros e futuros vínculos multiempresa. Nesta versão não haverá troca de empresa nem associação de contas existentes: provisionamento impede segundo vínculo, inclusive sob concorrência, bloqueando o usuário durante a transação. Resolver exatamente um vínculo; zero ou ambiguidade resulta em negação, não escolher arbitrariamente o primeiro. Não é necessário cookie de empresa ativa agora.

Assinaturas e permissões pertencem ao Modulus. Não inventar planos comerciais, limites ou tabelas de cobrança nesta etapa.

## 3. Integração central e estados de acesso

Propor módulos pequenos, exclusivos do servidor:

- Adaptador Supabase em `lib/auth`: validar sessão por `getUser()` junto ao Auth; não confiar apenas em `getSession()` vindo de cookies. Resolver identidade pelo provedor/emissor configurado e subject autenticado, nunca por campos de formulário.
- `resolveMinimalIdentity`: retorna somente identidade própria e estado necessário para onboarding, recuperação, troca e logout. Não retorna lista de colegas ou dados de negócio. Pode atender pessoa bloqueada, sem exigir senha já trocada ou empresa ativa.
- `requireBusinessContext(permission)`: exige identidade ativa, usuário ativo, membro ativo, empresa ativa, obrigação de senha concluída e papel autorizado. Retorna `{ userId, enterpriseId, membershipId, role }` interno.
- Adaptador administrativo separado, marcado server-only, sem cookies de usuário. Credencial privilegiada apenas para Auth administrativo e comandos estreitos de provisionamento/liberação; não usada nos CRUDs comuns.

Server Actions, Route Handlers, leituras administrativas e demais entradas verificam autorização individualmente. Middleware é auxílio de navegação, não fronteira de segurança. Cache de contexto no máximo por requisição; não compartilhar autorização entre usuários. Dados autenticados não devem entrar em cache público.

Data API não executa o helper TypeScript: **a mesma regra deve existir em funções/políticas SQL**. RLS consulta estado atual, não papéis/empresa/obrigação copiados em claims desatualizados. `user_metadata` não é fonte de segurança.

Um usuário inativo pode ainda autenticar no Supabase: isso não concede acesso ao Modulus. Inativação de usuário bloqueia todos os módulos; de membro bloqueia a empresa; de empresa bloqueia todos os membros. Troca/recuperação não reativa nenhum desses estados. Negação deve ocorrer com JWT já emitido, não somente após refresh.

Não emitir segundo JWT. Permanecem dependências de sessões/cookies, tokens e refresh, APIs de senha, confirmação, recuperação e emissão do Supabase. RLS continua integrada a `auth.uid()` e ao emissor validado do projeto. Troca futura de provedor exige adaptar essa ponte e validar tokens na Data API/Storage, não apenas trocar uma classe TypeScript.

## 4. Papéis e operações — proposta para aprovação

Todas as permissões abaixo pressupõem o contexto de negócio liberado.

| Operação | Owner | Admin | Operator |
|---|---|---|---|
| Dados da empresa e futura assinatura | Sim | Não | Não |
| Cadastrar/editar/inativar operadores | Sim | Sim | Não |
| Cadastrar/editar/inativar admins | Sim | Não | Não |
| Promover a admin | Sim | Não | Não |
| Conceder/retirar owner | Somente fluxo específico entre owners, preservando último owner | Não | Não |
| Alterar próprio papel | Não pelo CRUD genérico | Não | Não |
| Ler/criar/editar produtos, catálogos, filtros e vendas | Sim | Sim | Sim |
| Excluir registros operacionais | Sim | Sim | Não, recomendação conservadora |
| Usar calculadoras e módulos liberados | Sim | Sim | Sim |

Admin somente administra operadores; não modifica outro admin ou owner nem a si mesmo para obter privilégios. Owner pode criar admins. Cadastro interno nunca recebe `owner` como papel permitido. Promoção/transferência de proprietário pode ficar sem interface inicialmente, com procedimento controlado e auditado.

Mudanças de membro passam por comando transacional no banco, com validação de ator e alvo, e não por UPDATE aberto. Lock da linha da empresa (`SELECT ... FOR UPDATE`) **antes** de ler/contar owners e modificar vínculos; todas as rotas de mutação usam a mesma ordem de locks. Recontar dentro da transação. Somente `COUNT(*)` ou uma função SECURITY DEFINER não serializa operações.

Proteger inativação, exclusão e rebaixamento do último owner ativo; revogar DELETE direto e preferir inativação. Inativação global de usuário/identidade que elimine o último proprietário também passa por esse controle ou por suspensão administrativa explícita da empresa. Operações que atingem várias empresas bloqueiam em ordem determinística. Rejeitar a segunda operação concorrente que deixaria a empresa sem owner. Não apresentar CHECK de linha como solução para essa invariável entre registros.

## 5. RLS, GRANTs e integridade

### 5.1 Remover permissões antigas, não apenas acrescentar regras

Em novas migrations, inventariar e remover explicitamente todas as políticas autenticadas amplas das sete tabelas operacionais e políticas Storage antigas. Os nomes constam nas migrations, por exemplo `Authenticated users can do all on products` e equivalentes. Revisar também políticas de leitura `TO public` e quaisquer políticas adicionais efetivamente implantadas.

Políticas permissivas se combinam por OR: adicionar uma política restrita comum **não neutraliza** `USING (true)`. Revogar grants anteriores de `anon`, `authenticated` e PUBLIC quando existirem; conceder apenas operações/colunas necessárias. RLS, GRANTs, exposição de schemas, views e EXECUTE devem ser revisados juntos. Não conceder TRUNCATE ou alterações de estrutura aos clientes.

### 5.2 Ponte SQL sem recursão

Propor `private.current_internal_user_id()` e `private.can_access_enterprise(enterprise_id, permission)`:

1. Exigir `auth.uid()` não nulo, emissor esperado do projeto e identidade com `provider='supabase'`, issuer exato e subject igual a `auth.uid()::text`.
2. Para acesso de negócio, juntar usuário, membro e empresa e exigir todos ativos, `must_change_password=false` e papel permitido para a operação.
3. Retornar false quando faltar vínculo ou algum estado; não aceitar `user_id` do cliente para definir o ator.

São funções SQL SECURITY DEFINER somente para leitura, em schema `private` não exposto. Propor dono NOLOGIN dedicado, sem BYPASSRLS global, proprietário das tabelas centrais de autorização; ele pode ignorar RLS dessas tabelas enquanto não houver FORCE RLS. Sem privilégios nas tabelas operacionais além dos necessários. Se o ambiente exigir outro proprietário, revisar explicitamente o alcance; não assumir superuser como padrão seguro.

`SET search_path = ''`, referências totalmente qualificadas, sem SQL dinâmico, revogar EXECUTE de PUBLIC/anon; conceder somente a authenticated os helpers de política e USAGE necessário no schema, nunca CREATE. Dono e FORCE RLS precisam ser testados: um owner sujeito à própria RLS pode reintroduzir recursão. Helpers retornam apenas informação do chamador, não estado de senha de um UUID arbitrário. Não fazer política de identidades consultar recursivamente a própria tabela sob o papel do cliente.

RPCs de gestão expostas devem ser wrappers estreitos SECURITY INVOKER para comandos privados com permissões delimitadas e checagem interna do ator. Não abrir uma RPC genérica de SQL, troca de identidade ou alteração de flags. Para operações administrativas de backend, EXECUTE restrito ao papel servidor e parâmetros derivados da sessão validada; repetir validação transacional de permissões antes de efetivar o comando.

### 5.3 Tabelas centrais

| Tabela | Leitura autenticada | Escrita direta do cliente |
|---|---|---|
| users | Próprio perfil mínimo via helper não recursivo; colegas somente DTO de equipe autorizado | Nenhuma inicialmente; edição de nome por comando que não aceita status/flag |
| auth_identities | Sem SELECT direto necessário; resolução privada entrega mínimo | Nenhuma; identidade não pode ser relincada pelo usuário |
| enterprises | Membros liberados da empresa; contexto mínimo não expõe dados empresariais | Nenhuma; comando owner-only para campos permitidos, status por procedimento controlado |
| enterprise_members | Próprio contexto mínimo; equipe para owner/admin liberados da mesma empresa | Nenhuma; comando de gestão valida matriz, alvo e último owner |

Habilitar RLS em todas. Revogar SELECT/INSERT/UPDATE/DELETE nas identidades para anon/authenticated. Para outras tabelas conceder apenas SELECT das colunas necessárias quando houver política; comandos controlam mutações. Estado mínimo de senha pode ser retornado por função de contexto próprio sem abrir perfil completo para usuário bloqueado. Não conceder UPDATE de tabela inteiro e tentar proteger somente algumas colunas com UI.

### 5.4 Tabelas operacionais

Políticas separadas de SELECT, INSERT, UPDATE e DELETE aplicam a matriz. INSERT usa WITH CHECK; UPDATE usa USING e WITH CHECK; DELETE exige owner/admin. GRANTs de coluna excluem identidade e enterprise_id das atualizações; criação recebe empresa resolvida pelo servidor, e RLS rejeita empresa não autorizada também pela Data API. IDs/empresa são imutáveis após criação.

Exemplo **ilustrativo parcial, não migration validada**; pressupõe grants compatíveis de SELECT/INSERT/UPDATE/DELETE, inclusive SELECT necessário a UPDATE/DELETE e RETURNING, sem conceder UPDATE nas colunas de identidade/empresa. Os grants efetivos devem ser auditados por operação, coluna e papel:

```sql
-- Pressupõe remoção das políticas antigas e helper implementado/revisado.
create policy products_read on public.products for select to authenticated
using (private.can_access_enterprise(enterprise_id, 'products.read'));

create policy products_insert on public.products for insert to authenticated
with check (private.can_access_enterprise(enterprise_id, 'products.write'));

create policy products_update on public.products for update to authenticated
using (private.can_access_enterprise(enterprise_id, 'products.write'))
with check (private.can_access_enterprise(enterprise_id, 'products.write'));

create policy products_delete on public.products for delete to authenticated
using (private.can_access_enterprise(enterprise_id, 'products.delete'));
```

Não existe exceção de leitura pública sobre a tabela operacional completa; a vitrine tem superfície separada (§8). Todas as RPCs de negócio e operações protegidas do Storage usam o mesmo predicado de acesso liberado, inclusive leituras privadas.

### 5.5 Relações entre empresas

Adicionar enterprise_id às tabelas operacionais e associações. Além de FK para empresa, usar UNIQUE `(enterprise_id,id)` nos pais e FKs compostas `(enterprise_id,parent_id)` nos filhos. Ex.: catalog_products referencia catálogo e produto da mesma empresa; product_images referencia seu produto; catalog_filters seu catálogo. Para catalog_filter_products preservar também o requisito de produto pertencer ao catálogo do filtro, com FKs compostas adicionais/catalog_id ou trigger transacional revisado. A FK simples por UUID ou o trigger atual não comprovam igualdade de empresa.

Validar joins, reordenações, ações em lote, uploads e exclusões por empresa. Autoria também não pode apontar para membro de outra empresa. `service_role` não substitui essas restrições nem a autorização normal.

## 6. Cadastros, senha temporária e recuperação

### 6.1 Cadastro público confirmado

Cadastro público usa `signUp` com confirmação de e-mail habilitada; nunca `email_confirm:true`. PKCE protege a troca de código/sessão, **não substitui prova por confirmação de e-mail**.

Antes de iniciar Auth, registrar intenção durável sem senha. Após callback oficial de confirmação (`verifyOtp` com token_hash, ou exchange de código conforme fluxo SSR escolhido), validar usuário no servidor e sua confirmação. Somente então criar, numa transação de domínio, usuário interno, identidade, empresa ativa e owner ativo. Até completar a transação, identidade Auth sem domínio não acessa módulos.

Callbacks/reenvios repetem a finalização idempotente, não criam nova empresa. Nome e nome da empresa podem ser recolhidos novamente após confirmação, sem confiar em metadados como permissões. Redirecionamentos devem ser locais e allowlisted. Login também deve permitir retomar onboarding confirmado incompleto. Conta já vinculada não ganha segunda empresa por repetir callback ou enviar outro nome.

### 6.2 Cadastro interno sem convite

Validar sessão, obrigação concluída, empresa ativa e permissão do ator. Owner pode cadastrar admin/operator; admin apenas operator. A empresa vem do contexto, não de campo confiável do formulário.

Normalizar e-mail. Recusar qualquer conta preexistente que não seja exatamente a criação comprovada da mesma operação em retomada; não associar nem sobrescrever senha de conta existente. Consultas internas de domínio ajudam, mas a unicidade/rejeição do Auth é a barreira final para corridas. A API `listUsers` é paginada, não oferece aqui garantia de busca indexada por e-mail: eventual reconciliação administrativa pode percorrer páginas com acesso restrito, não expor listagem ao cliente.

Resposta pública/genérica para conflito, sem revelar empresa, perfil ou ID. Não oferecer endpoint público de existência. Exigir autorização e rate limiting também no cadastro interno; só informar membro já existente da própria empresa quando essa informação já estiver autorizada. Erros não devem repassar detalhes do Auth.

Usar `auth.admin.createUser` no servidor com senha temporária e `email_confirm:true` **apenas se o trade-off for aprovado**. Isso permite acesso imediato, sem convite, mas não comprova posse do endereço. O responsável deve conferir o endereço por outro meio; erro de digitação pode dar recuperação ao dono real da caixa. Não alegar que trocar a senha comprova e-mail.

Criar domínio com `must_change_password=true` antes de permitir qualquer negócio; Auth sem domínio é negado. Senha só transita na requisição HTTPS ao Auth; não gravar senha, hash próprio, payload integral ou segredo em logs, traces, operação durável ou documento. Entrega externa pelo administrador. Revalidar permissão do ator no commit de domínio caso tenha sido revogada durante a chamada ao Auth.

### 6.3 Troca obrigatória — comprovação limitada e honesta

Permitir somente contexto mínimo, troca, logout e recuperação de acesso enquanto bloqueado. Isso vale no servidor, Data API, RPC e Storage privado/escrita. Assets/vitrine deliberadamente públicos permanecem públicos inclusive para alguém que saia da conta.

Fluxo recomendado:

1. Resolver identidade mínima a partir da sessão validada. Capturar versão atual da obrigação.
2. Receber senha atual e nova senha apenas em memória; validar confirmação, força e `nova != atual` sem normalizar o conteúdo da senha.
3. No cliente de sessão do próprio usuário, chamar `auth.updateUser({ password: nova, current_password: atual })`. A documentação atual prevê `current_password`; verificar comportamento/configuração no projeto. Não usar Admin API para fingir uma troca realizada pelo funcionário.
4. **Somente após resposta de sucesso recebida pelo backend**, executar comando servidor restrito que limpa a obrigação por compare-and-set da identidade/versão, grava timestamp e auditoria sem segredo. Não confiar em evento de browser `USER_UPDATED`, timestamp genérico `updated_at`, login bem-sucedido ou flag enviada pelo cliente.
5. Não expor RPC `liberar(userId, trocou=true)` a authenticated. O comando de liberação só pode ser executado pela integração servidor e não é acessível diretamente ao cliente; ele não comprova Auth sozinho, o servidor é a fronteira de confiança que observou o sucesso.

Não se afirma que mudança de senha revogue imediatamente todos os JWTs ou que um callback de recuperação já tenha mudado a senha. Revogação de refresh tokens e validade de access tokens precisam ser verificadas separadamente. RLS consulta o bloqueio no banco, não depende dessa revogação.

**Falha ou resposta desconhecida:** se Auth mudou e a liberação falhou, manter bloqueado. Se o backend persistiu um recibo de sucesso em operação durável, pode retomar a finalização da mesma versão sem pedir nova troca. Se não há esse recibo (queda/timeout antes de persistir), não há prova suficiente: pedir outra mudança efetiva, usando a senha agora atual e uma nova diferente. Login com a senha atual não prova mudança anterior. Não oferecer botão “já troquei, sincronizar” que libere apenas com autenticação.

**Reutilização:** comparação atual/nova e validação de current_password impedem uma troca sem mudança no caminho controlado. Não foi comprovado suporte do Supabase a histórico de senhas que proíba para sempre a senha temporária, inclusive após mudança direta pela API Auth. Não armazenar a senha temporária ou hash em tabelas Modulus para simular esse recurso. Uma mudança direta no Auth não limpa a obrigação; o fluxo controlado exige outra mudança comprovada. Se a exigência for proibir qualquer reutilização histórica, inclusive voltar à temporária após outras trocas, isso é decisão/bloqueio técnico a validar no provedor antes de prometer cumprimento.

### 6.4 Recuperação durante o bloqueio

`resetPasswordForEmail` envia link; retorno genérico não revela existência. Callback de recuperação valida token e cria sessão limitada: **não libera a flag**. A página autenticada coleta nova senha; o backend chama updateUser e só libera após sucesso observado, pelo mesmo comando de finalização/versão.

Recuperação existe justamente quando a senha atual é desconhecida. Validar em dev a interação com a configuração “require current password” e reautenticação do Supabase; não inventar bypass ou usar atualização administrativa silenciosa. Se o fluxo suportado de recovery não atender à configuração selecionada, manter bloqueado e resolver a configuração/fluxo antes da ativação. Não usar claim editável para distinguir recuperação.

O Supabase pode rejeitar senha igual à atual; testar esse comportamento no fluxo de recovery. Sem senha temporária armazenada não há prova de não reutilização histórica. Recovery concluído com sucesso pode satisfazer a obrigação, mas não reativa usuário/membro/empresa inativos. Não usar callback ou mera posse de sessão como prova de alteração de senha.

## 7. Consistência e retomada

Auth e chamadas de domínio não formam uma transação única. A criação dos quatro registros de domínio e o estado de conclusão são uma única transação PostgreSQL, por comando estreito. Não executar quatro inserts independentes e presumir atomicidade.

Propor tabela de apoio `private.provisioning_operations`, não exposta: UUID aleatório de operação, tipo public_signup/internal_create/password_change, ator/empresa quando aplicável, subject confirmado quando conhecido, IDs de destino reservados, estado, versão, timestamps e código de erro sanitizado. Campos de negócio explicitamente permitidos; nunca payload JSON indiscriminado, senha ou token. RLS/grants vedam acesso cliente; contexto da operação deve estar vinculado ao ator/sessão, não basta conhecer UUID.

Persistir operação **antes** da chamada externa. Chave de reenvio estável por operação, não hash de e-mail com janela temporal. UNIQUE de identidade e vínculo permanece como última defesa, mas não substitui máquina de estados e autorização de retomada.

| Resultado | Tratamento |
|---|---|
| Auth ainda não chamado | Retomar mesma operação autorizada. |
| Auth respondeu sucesso | Registrar subject e avançar ao commit de domínio. |
| Auth timeout/resultado desconhecido | Estado de reconciliação; não recriar nem excluir automaticamente. Confirmar resultado no provedor. |
| Commit domínio timeout | Consultar operação e registros por IDs/identidade; pode já ter confirmado. Retornar resultado existente ou retomar transação idempotente. |
| Conta Auth sem domínio | Nenhum acesso de negócio. Onboarding público autenticado/confirmado pode retomar; cadastro interno exige operador autorizado ou reconciliação administrativa. |
| Ator perdeu permissão | Não concluir criação de membro; manter pendência restrita para revisão. |

No cadastro administrativo pode-se correlacionar UUID de operação em `app_metadata` gravado apenas pelo servidor; ele auxilia reconciliação, não concede permissão nem é única prova por comparação de e-mail. Se Auth criou a conta mas a resposta se perdeu, verificar correlação e identidade administrativa antes de retomar. Sem prova inequívoca, parar para revisão, não tomar posse de conta preexistente.

Compensação só após confirmar estado terminal, ausência de commit/vínculos e autoria daquela conta pela operação. Preferir completar cadastro a apagar Auth. Nunca apagar conta preexistente; timeout sozinho não justifica delete. Reconciliação pode ser manual e acionada por reenvio neste início, sem exigir fila/cron. Registrar auditoria mínima de ator, operação e resultado, sem segredos.

## 8. Vitrine e Storage

### 8.1 Superfície pública

`active=true` não torna todas as colunas públicas. Revogar acesso anon às tabelas operacionais. Propor projeções públicas separadas e deliberadas, contendo apenas campos aprovados de vitrine: título, descrição pública, preço público, slug, imagens publicadas e filtros públicos. Custos, estoque interno, contato privado, autoria e dados de gestão não entram. Alguns desses campos internos são futuros, não fatos do schema atual.

Abordagem recomendada: tabelas de projeção pública pequenas, atualizadas transacionalmente no ato de publicar/despublicar, com SELECT anon/authenticated somente dos registros publicados e sem grants de escrita cliente. Escolha implica ajustar o leitor de catálogo. Não afirmar que omitir colunas numa query ou criar uma view restringe o acesso à tabela base. Alternativa de view/RPC exige revisão específica de grants e privilégios; view security_invoker por si só não resolve exposição da base.

Empresa inativa deixa de publicar; despublicação deve valer também pela Data API e não apenas pela UI. Informações já obtidas por terceiros ou cache não podem ser recuperadas. Autenticado bloqueado não acessa módulos, mas não é possível impedir leitura do que qualquer visitante anônimo já pode ver.

### 8.2 Arquivos

Buckets públicos ignoram controle de acesso na entrega por URL pública. Uma política SELECT ou escrita **não torna privada uma imagem já servida por bucket público**. Políticas ainda controlam upload, alteração, remoção, cópia e movimentação; restringir por empresa, papel e senha concluída, com USING/WITH CHECK conforme operação.

Manter imagens e URLs legadas deliberadamente públicas; inventariar objetos e mapear propriedade validada por empresa (registro privado de ownership para paths antigos). Novos paths prefixados por enterprise_id e IDs validados; path sozinho não comprova propriedade. Não mover/renomear tudo nem quebrar URLs automaticamente. Para objetos legados sem prefixo, política consulta ownership revisado; objetos sem dono ficam sem escrita cliente.

Novos arquivos privados, quando necessários, usam bucket privado, leitura autenticada e RLS com o mesmo gate; URLs assinadas de duração curta continuam utilizáveis até expiração. Não criar módulo de documentos agora. Caso algum objeto legado público seja confidencial, sua migração e revogação de URLs/cache exigem plano específico aprovado; preservar URL pública e torná-la secreta simultaneamente não é uma promessa possível.

## 9. E-mail

Provedor externo será utilizado; fornecedor ainda pendente.

- **Auth:** SMTP customizado configurado no Supabase para confirmação e recuperação, com templates, domínio/remetente e redirects revisados. Usar fluxo oficialmente suportado; PKCE e tokens continuam gerenciados pelo Supabase.
- **Negócio:** interface central server-only no Modulus para notificações transacionais, usando API ou SMTP do mesmo fornecedor se conveniente. Não expor credenciais nem retornar envio como sucesso quando não ocorreu.

Não exigir filas, workers, nova biblioteca ou fornecedor específico nesta proposta. Inicialmente tratar falhas de envio explicitamente e oferecer reenvio com rate limit/idempotência onde aplicável. Configurar e testar confirmação/recuperação **antes** de ativar cadastro público, não depois. Notificações de módulos futuros não precisam ser implementadas agora. Sem convites nesta versão.

## 10. Migração e ordem de implementação

Não editar migrations já aplicadas. Planejar novas incrementais e testar tanto banco dev vazio quanto cópia sanitizada de dados legados.

1. Aprovar contratos de segurança, matriz e trade-offs. Primeira tarefa implementável: núcleo de quatro tabelas, estado de operação mínimo, helpers e grants fechados, com cadastro público desabilitado; revisão de migration antes de aplicar em dev.
2. Implementar resolução mínima/negócio e comandos transacionais de membros; verificar gate e último owner com chamadas reais, sem exigir Vitest/CI/pgTAP agora.
3. Adicionar enterprise_id **nullable** nas tabelas existentes, compatível com dados legados; preparar código que sempre o preenche para novos registros.
4. Inventariar dados e obter aprovação do mapeamento da operação Modulus. As tabelas antigas não fornecem autoria suficiente para inferir donos: não escolher “primeira conta” nem “usuários que têm produtos”. Usar lista explícita de IDs Auth autorizados, confirmada pelo responsável, para criar identidades/membros e owner legado. Contas não listadas permanecem sem acesso.
5. Backfill dos registros validados para empresa inicial; preservar IDs, vendas, associações, imagens e URLs. Dados ambíguos/quebrados exigem revisão, não atribuição cega à empresa padrão.
6. Validar nulos, órfãos, relações cruzadas e ownership Storage; só então NOT NULL, FKs compostas, índices e políticas finais. Remover políticas antigas e grants amplos no mesmo corte de segurança.
7. Ajustar todas as entradas existentes para contexto/permissões, leitor público e Storage. Para evitar janela ampla na transição, manter cadastro fechado no Auth também; planejar manutenção com revogação de acessos amplos enquanto backfill/código são trocados. Downtime curto é preferível a liberar usuários novos com políticas antigas. Rollback não restaura acesso amplo com cadastro aberto.
8. Desenvolver cadastro interno e troca obrigatória, mantendo indisponível até RLS/gates completos. Configurar SMTP; desenvolver cadastro público confirmado e recovery atrás de ativação controlada.
9. Executar roteiro abaixo em dev, corrigir negações/permitidos e registrar evidência. Revisar migração e janela de implantação de produção separadamente.
10. Só habilitar cadastro público após isolamento das tabelas existentes, revisão de Storage, confirmação/recuperação funcionais e aceite humano.

Depois: multiempresa/seleção, convites, planos/cobrança, MFA, filas, automação Vitest/CI. Não adiar os testes manuais de isolamento necessários à abertura pública.

## 11. Roteiro de verificação obrigatório antes da abertura

Não executado nesta avaliação. Usar dev separado, usuários reais de teste, chave pública e **JWT de cada usuário via Data API/Storage**; não usar service_role para provar RLS. SQL Editor administrativo não reproduz essas permissões. Registrar requisição sanitizada, papel, resultado e estado final; nunca salvar JWT/senhas em relatório.

1. Criar A e B com owners, admins e operators. Validar permitido na própria empresa. Repetir SELECT/POST/PATCH/DELETE cruzados em todas as tabelas operacionais, associações, imagens e vendas. SELECT/UPDATE/DELETE negados podem retornar zero linhas, não necessariamente 401/403; conferir que nada foi alterado na empresa alvo.
2. Tentar criar associação catálogo A/produto B, filtro A/produto B, imagem com produto B, trocar enterprise_id e autoria. Deve falhar no banco, não só no formulário.
3. Testar operator excluindo registros e gerindo equipe; admin modificando outro admin/owner, promovendo a owner ou alterando o próprio papel; owner criando admin. Verificar Data API, RPC e Server Actions diretamente, sem depender da UI.
4. Funcionário com senha temporária: tentar leituras/escritas privadas pela Data API, RPCs, Server Actions e Storage. Somente contexto mínimo, troca, logout e recovery são permitidos. Tentar PATCH de must_change_password/status, alteração de user_metadata e chamada direta à finalização; tudo deve negar liberação indevida.
5. Repetir senha atual como nova; senha atual errada; mudança diretamente no Auth sem passar pelo backend; resposta perdida após Auth; commit perdido após liberação; nova obrigação concorrente. Não liberar por login/callback/afirmação do cliente. Confirmar reenvio seguro ou segunda troca quando não houver recibo.
6. Inativar separadamente usuário, identidade, membro e empresa com JWTs ainda válidos. Negar módulos imediatamente no próximo acesso. Recovery/troca não reativa. Verificar que Auth pode autenticar mesmo quando Modulus nega negócio.
7. Dois owners: requisições simultâneas tentando inativar/rebaixar ambos. Apenas uma pode concluir; a empresa mantém owner ativo. Testar também exclusão direta e inativação global do último proprietário.
8. Cadastro público: confirmação ausente/expirada/repetida, callback forjado, empresa ainda não criada, reenvio após timeout, submit duplicado. No máximo um domínio/empresa/vínculo por operação/identidade; não confirmar automaticamente e-mail público.
9. Cadastro interno: e-mail com variação de caixa, conta da outra empresa, conta Auth órfã, concorrência pelo mesmo e-mail e perda de permissão do ator. Não associar, redefinir senha ou excluir contas preexistentes; testar reconciliação da operação de resultado desconhecido.
10. E-mail: entrega real de confirmação/recuperação, links expirados/reutilizados, redirects externos rejeitados, erro SMTP e reenvio. Recovery de bloqueado somente libera após updateUser bem-sucedido observado; verificar configuração current_password/reauthentication.
11. Anon e autenticado de outra empresa: somente projeção pública publicada. Tentar tabela operacional e campos internos diretamente. Despublicar/inativar empresa e verificar vitrine. URLs de mídia pública continuam públicas; testar ownership para escrita, leitura privada negada e prazo de URL assinada.
12. Reaplicar/retomar migrations planejadas em dev vazio e ensaio de legado; comparar contagens, vínculos, URLs e vendas. Verificar grants efetivos e todas as RPCs/views expostas, não apenas novas tabelas.

## 12. Decisões pendentes e limites

| Decisão | Recomendação e razão |
|---|---|
| Cadastro interno auto-confirmado | Aprovar explicitamente acesso imediato sem prova da caixa; conferência externa do endereço é necessária. |
| Reutilização histórica da senha temporária | Garantir mudança efetiva no fluxo controlado; proibição histórica absoluta não foi comprovada no Supabase e exige validação específica. |
| Recuperação e current_password | Usar APIs oficiais; ensaiar configuração no dev antes de fechar UX/ativação. |
| Papéis | Aprovar matriz: só owner gerencia admins, admin só operadores, exclusão operacional limitada a owner/admin. |
| Último proprietário | Aprovar comando transacional com lock por empresa e inativação em vez de exclusão. |
| Superfície pública | Aprovar projeção pública e lista exata de campos; separar de tabelas de gestão. |
| Legado | Aprovar explicitamente dados, owner e lista de IDs Auth autorizados; sem inferência automática. |
| E-mail | Escolher fornecedor/remetente; SMTP Supabase para Auth e integração central para negócio, sem filas obrigatórias. |
| Retomadas | Aprovar estado durável mínimo e reconciliação manual quando resposta externa for desconhecida. |

Não estão comprovados o estado remoto de policies/grants, configurações de Auth/SMTP, comportamento de revogação de sessões ou os exemplos SQL. Não há mecanismo documentado nesta proposta que transforme um login em prova de mudança passada de senha. A segurança depende da execução controlada no backend, gates SQL equivalentes e teste de acessos diretos. Proposta não é autorização para implantação nem declaração de isolamento já obtido.

## 13. Referências oficiais

Consultadas nesta revisão ou na avaliação anterior; capacidades e configuração devem ser confirmadas no ambiente de implementação:

- [Supabase — Password security](https://supabase.com/docs/guides/auth/password-security): current_password, reautenticação e políticas de força.
- [Supabase — Password-based Auth](https://supabase.com/docs/guides/auth/passwords): confirmação, PKCE e recuperação.
- [Supabase — updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser): mudança autenticada de senha.
- [Supabase — Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser): criação administrativa e email_confirm.
- [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grants, políticas, funções privadas, recursão e metadados.
- [Supabase — Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals): entrega pública ignora controle de leitura; buckets privados e URLs assinadas.
- [Supabase — Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): referência para configuração a validar na implementação.
- [PostgreSQL — Row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): referência para composição e comportamento das políticas.

Nenhum código de aplicação, dependência, configuração ou migration faz parte desta entrega documental.

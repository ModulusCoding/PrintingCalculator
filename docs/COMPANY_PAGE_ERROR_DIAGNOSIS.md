# Dados Empresa — diagnóstico e correção funcional

Data: 29/10/2026. Escopo: investigação local e correção funcional, sem refatoração visual.

## 1. Sintoma e limite da conclusão

Na investigação inicial foi relatado erro ao acessar ou utilizar Dados Empresa, sem evento técnico. Na revisão de autorização, o usuário forneceu o evento `enterprise:getCompany stage=rpc rpc=get_my_enterprise_config code=42501 unauthorized` e informou que a função instalada exige apenas `printers.read`. Isso identifica a etapa de falha e é consistente com a incompatibilidade confirmada para owner Aprendiz: `enterprise.manage` permitido, `printers.read` negado pelo plano. O código `42501` isolado também pode decorrer de identidade/vínculo inválido; não comprova por si só qual condição interna negou aquela sessão.

Não houve acesso ao Supabase remoto, execução de SQL ou sessão autenticada no navegador. A definição instalada é informação fornecida pelo usuário, não consultada nesta tarefa. Foram confirmados defeitos na cadeia de fontes local e reproduzidos os contratos TypeScript com mocks; as correções SQL continuam propostas locais ainda não aplicadas. A migration corretiva de leitura já preparada é mantida, sem criar substituição redundante nem modificar migrations históricas.

## 2. Fluxo rastreado

- `components/layout/navigation.ts`: Dados empresa aponta para `/empresa`, visível por `enterprise.manage`.
- `app/(authenticated)/layout.tsx`: resolve identidade; sem sessão redireciona para `/admin/login`, estados diferentes de `business_ready` para `/conta`, seleção de plano pendente para `/planos`; Free não-owner é bloqueado. Esses controles não foram alterados.
- `app/(authenticated)/empresa/page.tsx`: owner requer `enterprise.manage`; somente negação dessa permissão permite tentar o ramo legado admin com `enterprise.pricing_loss.write`.
- Owner chama `getCompany`: `get_my_enterprise_config` → `get_my_enterprise`. Admin autorizado chama o leitor compartilhado `getConfig` e recebe apenas o formulário de perdas.
- `CompanyForm.tsx` mantém os formulários existentes de nome, tarifa e perda. Actions encaminham a versão esperada às RPCs `update_my_enterprise_name`, overload de dois argumentos `update_my_enterprise_config`, e `update_my_pricing_loss`.
- Cliente Supabase é o cliente da sessão, não cliente administrativo. Nenhuma chamada recebe empresa ou usuário fornecido pelo formulário; as RPCs resolvem a identidade e empresa internamente.

## 3. Defeitos confirmados nas fontes e evidências

### Leitura da empresa depende indevidamente de impressoras

A migration original `20261015190000_enterprise_electricity_rate.sql` documentava leitura para todos os papéis `business_ready`, enquanto a escrita era exclusiva de `enterprise.manage`. O retorno original tinha tarifa/versão; `20261023000000_fdm_pricing_spools_materials_v2.sql` adicionou perda ao contrato de leitura. As redefinições posteriores em `20261023010000_pricing_loss_config.sql` condicionaram o leitor compartilhado a `printers.read`, criando o acoplamento com um módulo operacional pago. Não se propõe restaurar indiscriminadamente o acesso amplo original: conserva-se o predicado operacional atual e acrescenta-se apenas a autoridade empresarial já aprovada.

A última definição histórica do leitor em `20261023010000_pricing_loss_config.sql` exige `printers.read`. Porém a página autoriza `enterprise.manage`. O predicado de plano em `20261026060000_plan_business_regularization.sql` preserva gestão para owner em recuperação/Free/excesso de equipe, mas não preserva `printers.read`. O avaliador atual em `20261026150000_pricing_actor_authorization.sql` mantém essa distinção. Logo, um owner Free passa pelo layout e pela permissão da página, mas sua primeira RPC falha com `42501` e antes virava “Erro técnico”.

A nova migration de leitura aceita a autoridade **já existente** `enterprise.manage` como alternativa a `printers.read`. Não concede acesso ao módulo de impressoras, não altera a matriz central nem libera escritas. Conserva `business_ready`, empresa ativa, resultado, `STABLE`, `SECURITY DEFINER`, `search_path` vazio e grants explícitos. A condição usa `IS DISTINCT FROM TRUE` para negar inclusive NULL. Os leitores operacionais já autorizados continuam funcionando.

A exceção SQL para seleção pendente não significa que `/empresa` seja acessível nesse estado: o layout continua redirecionando para `/planos`.

### Tarifa com vírgula

O formulário preenche e anuncia valores como `0,854321`, mas `updateCompanyRate` usava coerção numérica direta, rejeitando a própria representação apresentada. A correção aceita vírgula ou ponto decimal, até seis casas, intervalo inclusivo 0–100; não aceita expoentes, agrupamento, valores não finitos ou conversões silenciosas. Branco continua significando NULL.

### Remoção da tarifa quebrada pelo overload

Em `20261023000000_fdm_pricing_spools_materials_v2.sql`, o overload de dois argumentos passou a encaminhar `(p_rate, NULL, version)` para o de três argumentos. Tarifa vazia gera ambos NULL, rejeitados com `22023`; o `COALESCE` do overload completo também não permite limpar a tarifa.

A segunda migration substitui **somente o overload de dois argumentos**, mantendo o protocolo de locks/identidade/autorização/versão, atribuindo a tarifa explicitamente, inclusive NULL, sem tocar na perda. O overload de três argumentos e seus consumidores permanecem inalterados. A verificação de versão precede a resposta idempotente; ausência de mudança retorna `updated` com a versão atual, compatível com o contrato rate-only original.

### Resultado inalterado e classificação de falhas

O backend histórico pode retornar `no_change`, antes convertido em `unknown` pela atualização da tarifa. Agora é sucesso somente com a mesma versão esperada. Respostas não-singleton, status desconhecidos, valores malformados e versões inseguras não são considerados sucesso.

Antes a página tentava o ramo admin após qualquer exceção e as actions tratavam todo `AuthContextError` como sessão expirada. Agora:

- sessão ausente → `session_expired` nas actions;
- negação ou identidade bloqueada → `permission_denied`, sem executar mutação;
- contexto inválido/falha técnica → `technical`, sem fallback de papel;
- negação de leitura da RPC → acesso indisponível, não erro técnico;
- falha técnica de RPC/validação → mensagem amigável e diagnóstico seguro;
- `unstable_rethrow` preserva o controle interno do Next.js.

### Inventário de referências à RPC

Busca textual em todo o projeto por `get_my_enterprise_config` (incluindo definição sem parênteses de chamadas do SDK) e busca de imports dos leitores:

| Consumidor direto | Consumidores indiretos e finalidade |
| --- | --- |
| `lib/enterprise/management.ts` → `getCompany` | `app/(authenticated)/empresa/page.tsx`: ramo owner, combina configuração e dados cadastrais |
| `lib/enterprise/config.ts` → `getConfig` | Mesma página, ramo admin legado de perda. `updateConfig` nesse módulo é escritor separado; não foi encontrado consumidor ativo de seu export |
| `lib/pricing/actions.ts` → `fetchElectricityConfigAction` | `app/(authenticated)/precificadora/page.tsx`: parâmetros iniciais da precificação integrada |
| `lib/pricing/persistence-actions.ts` → `saveFdmPricingAction` | `components/pricing/PricingSimulator.tsx`, carregado pela Precificadora: fluxo integrado de precificação; recarrega configuração e fontes atuais para cálculo/persistência. Leitura usa o cliente da sessão; a infraestrutura administrativa de recibos já existente nesse módulo não foi introduzida nem usada como solução para `/empresa` |

Impressoras (`app/(authenticated)/impressoras`, componentes e `lib/printers`) não é consumidor direto nem indireto encontrado desta RPC. Compartilha a permissão `printers.read`, o que explica o acoplamento, mas suas consultas próprias e permissões não precisam mudar.

Referências SQL encontradas: `20261015190000_enterprise_electricity_rate.sql` (origem), `20261023000000_fdm_pricing_spools_materials_v2.sql` (novo retorno), duas definições sucessivas em `20261023010000_pricing_loss_config.sql` (a última é a efetiva antes da correção), e a proposta `20261029100000_enterprise_config_company_read.sql`. Referências de teste: `tests/sql/20261023000000_fdm_pricing_v2_assertions.sql`, `tests/company-management.test.cjs`, `tests/company-sql.test.cjs` e a nova suíte de consumidores `tests/company-authorization-consumers.test.cjs`. O próprio relatório também referencia o símbolo. Nenhum desses testes SQL foi executado no banco.

### Revisão de autorização após o evento 42501: decisão mínima

A RPC não é exclusivamente de Impressoras ou da Precificadora: retorna três parâmetros da empresa e atende também Dados Empresa. Trocar `printers.read` por `enterprise.manage` bloquearia leitores operacionais admin/operator que continuam legítimos. Trocar por `pricing.read` ampliaria leitura em cenários de recuperação de precificação sem necessidade demonstrada. Remover a checagem de plano ou aceitar todo `business_ready` restauraria um contrato mais amplo que o atual, desnecessariamente.

A decisão mantida é **`printers.read OR enterprise.manage`**, com ambas as permissões avaliadas pelo helper vigente e negação fail-closed. O primeiro ramo preserva os consumidores operacionais; o segundo permite ao owner ler os mesmos parâmetros empresariais que já pode administrar. Não se usa `enterprise.pricing_loss.write` como licença genérica de leitura nem se concede essa permissão ao owner Aprendiz. Criar uma RPC paralela só para os mesmos três campos duplicaria contrato e autorização sem estreitar o acesso aos dados: o owner já é a autoridade de gestão dessa empresa. Nenhum consumidor necessita ser redirecionado para outro domínio nesta correção.

| Operação | Regra preservada |
| --- | --- |
| Ler nome/data/versão (`get_my_enterprise`) e abrir ramo completo `/empresa` | `enterprise.manage`: owner, com identidade/vínculo/empresa válidos |
| Ler configuração compartilhada (RPC corrigida) | `printers.read` operacional existente **ou** `enterprise.manage`; apenas empresa da sessão |
| Editar nome e tarifa | `enterprise.manage`; somente owner; versão esperada e validações SQL |
| Editar perda dedicada (formulário/action atual) | `enterprise.pricing_loss.write`: owner/admin elegíveis; continua condicionada ao plano no SQL |
| Patch completo de configuração (overload de três argumentos) | `enterprise.manage`: owner, inclusive Aprendiz; contrato preexistente diferente da RPC dedicada, não alterado |
| Buscar configuração na Precificadora integrada | Plano pago + `printers.read` na action; a exceção empresarial da RPC não elimina esses gates |
| Salvar nova precificação integrada | Plano pago + `pricing.write` + owner explícito + fontes/tenant/versões; não alterado |
| Impressoras: ler / editar / arquivar | `printers.read` / `printers.write` / `printers.archive`, com plano pago; não alterado |

Owner Aprendiz pode ler Dados Empresa e editar nome/tarifa, mas não ganha Impressoras nem escrita de perda operacional. Owner Visionário mantém os fluxos completos quando elegível. Admin legado pago mantém leitura operacional e o ramo direto de perda; não recebe gestão de nome/tarifa. Operator pago mantém leitura operacional da configuração, não acesso à página de gestão nem escrita empresarial. Admin/operator Aprendiz continuam bloqueados pelo layout/plano. Empresa/membro inativo, identidade inválida e tenant diferente permanecem negados: a alternativa de permissão não substitui estado de contexto, identidade interna nem vínculo ativo único.

## 4. Arquivos desta correção

- `app/(authenticated)/empresa/page.tsx`: classificação, fallback restrito e diagnóstico; apresentação existente preservada.
- `lib/enterprise/actions.ts`: guards existentes de empresa e classificação correta para as três ações; ação de membros preservada.
- `lib/enterprise/management.ts`: leitura com o mesmo cliente, cardinalidade e números/versões validados; tarifa decimal; interpretação e falhas amigáveis das mutações de empresa. Funções de membros preservadas.
- `lib/enterprise/diagnostics.ts`: wrapper server-only da infraestrutura existente.
- `supabase/migrations/20261029100000_enterprise_config_company_read.sql`.
- `supabase/migrations/20261029110000_enterprise_config_nullable_rate.sql`.
- `tests/company-page.test.cjs`, `tests/company-management.test.cjs`, `tests/company-sql.test.cjs`.
- `tests/company-authorization-consumers.test.cjs`: acrescentada na revisão específica de autorização para os consumidores compartilhados; os demais arquivos funcionais/migrations já preparados foram revisados e preservados nesta rodada.
- Este relatório.

O workspace contém alterações anteriores de outros trabalhos. Este inventário não atribui essas outras alterações a esta tarefa. Não foram alterados formulário visual, sidebar, header, onboarding, autenticação, RLS, permissões centrais, estoque ou precificação.

## 5. Diagnóstico seguro

Usa `createLogger` existente e `safeErrorDiagnostic`. Inclui operação, etapa (`context`, `rpc`, `interpretation`), nome da RPC quando disponível, código técnico, detalhe sanitizado e caminhos/códigos Zod; o logger gera referência de correlação. Não são passados argumentos RPC, rows, valores de formulário, IDs de empresa/usuário, cookies, JWTs ou credenciais. Mensagens técnicas não são mostradas no frontend. A referência aparece no log; não foi introduzido novo elemento visual para exibi-la.

O leitor compartilhado `lib/enterprise/config.ts` não foi reestruturado: no ramo admin o erro é registrado na fronteira da página. Portanto o detalhe SQL original desse leitor pode não estar disponível no log desse ramo; não há promessa de diagnóstico PostgreSQL completo quando a camada anterior já o descartou.

## 6. Testes e verificações locais

As suítes executam os módulos reais TypeScript/TSX por VM com dependências controladas. Cobrem owner, admin legado, operator negado, vínculo ausente, empresa/membro inativo, sessão expirada, contexto inválido, leitura ausente/múltipla/malformada, erro RPC/transport, nomes/tarifas/perdas, versões/conflitos, recuperação por nova tentativa e controle interno do Next. Verificam argumentos sem IDs externos e uso do cliente selecionado; **não comprovam isolamento real PostgreSQL**.

A suíte SQL verifica apenas o texto e a precedência das migrations, o protocolo de locks, permissões, grants e semântica da atribuição NULL. Não executa PostgreSQL, triggers, RLS ou concorrência.

Resultados finais, após os ajustes da segunda revisão:

| Verificação | Resultado |
| --- | --- |
| `node --test tests/*.test.cjs` | 457 aprovados, 0 falhas |
| Suítes `company-management`, `company-page`, `company-sql` | 84 aprovados, 0 falhas (também executadas isoladamente na segunda revisão) |
| `npx tsc --noEmit` | Aprovado |
| ESLint direcionado à página, actions, management, diagnostics e três suítes company | Aprovado, sem avisos |
| `npm run build` | Aprovado; `/empresa` compilada como rota dinâmica |
| `git diff --check` | Aprovado; somente avisos de normalização LF/CRLF no workspace |

O build mantém o aviso preexistente de depreciação da convenção `middleware` em favor de `proxy`; não houve alteração fora do escopo para tratá-lo. O primeiro lint identificou nome local `module` nos harnesses, corrigido para `loadedModule`; a repetição passou. A segunda revisão identificou a negação de leitura ainda apresentada como falha técnica; foi corrigida e ganhou dois testes. Também foi acrescentado teste explícito para tarifa `no_change`. A revisão independente final confirmou 84/84 e não identificou bloqueadores restantes no escopo analisado.

Não foi feita homologação autenticada em navegador: sem sessão/fixtures locais autorizadas, navegar contra o backend configurado contrariaria a restrição de não acessar Supabase remoto. Não foram instaladas dependências, usados Docker/WSL, feitos commits, push ou deploy.

### Reexecução na revisão específica de autorização

Após o evento `42501` informado, a auditoria adicional confirmou exatamente quatro chamadores produtivos e manteve a migration de leitura existente como menor correção. Nenhuma mudança adicional na aplicação, autenticação, plano, permissão central ou SQL histórico foi necessária.

- `node --test tests/*.test.cjs`: 457/457 aprovados, incluindo regressões de Impressoras, Precificadora, empresa e autorização já existentes.
- Após adicionar a suíte de consumidores: `node --test tests/company-authorization-consumers.test.cjs`: 8/8 aprovados. São 465 testes aprovados somando as duas execuções, não uma alegação de execução única de 465 casos.
- `npx tsc --noEmit`: aprovado novamente.
- ESLint direcionado à página, módulos empresariais, testes anteriores e, separadamente, nova suíte de consumidores: aprovado.
- `npm run build`: aprovado novamente; mantém somente o aviso preexistente de `middleware`.
- `git diff --check`: aprovado, com avisos de normalização LF/CRLF no workspace.

A nova suíte distingue explicitamente a matriz de referência TypeScript, execução dos leitores/actions reais com mocks e assertions estáticas do SQL/consumidores. Nenhuma dessas modalidades substitui a verificação real de identidade inválida, vínculo inativo, tenant diferente ou plano no PostgreSQL. A auditoria de consumidores também identificou a divergência preexistente de política dos dois escritores de perda, registrada nos riscos residuais.

## 7. Migrations: revisão e aplicação manual necessárias

**Nenhuma migration foi executada nesta tarefa.** Revisar o estado efetivamente implantado e o histórico antes de aplicar manualmente, em ordem:

1. `20261029100000_enterprise_config_company_read.sql`;
2. `20261029110000_enterprise_config_nullable_rate.sql`.

Não editar migrations anteriores. Para o erro de autorização aqui informado, a proposta necessária é a primeira migration (`20261029100000`); a segunda trata o defeito independente de remoção de tarifa já diagnosticado, não é condição para corrigir o `42501`. Não foi criada uma terceira migration redundante nesta revisão. A alteração TypeScript isolada não resolve a leitura SQL negada nem a remoção de tarifa no banco ainda antigo. Não há restauração comprovada do ambiente implantado antes dessa aplicação e homologação.

A revisão SQL deve comparar assinaturas, owner `postgres`, grants apenas para authenticated, `search_path`, resolução de identidade e locks com as funções implantadas. O overload rate-only conserva locks: gestão global → actor → identidade → usuário → vínculo → empresa; mantém contagem de vínculo ativo único, estado empresarial e autorização `enterprise.manage`. O trigger existente continua responsável pelo incremento de versão.

## 8. Homologação real pendente — roteiro específico

Em ambiente autorizado e controlado, após revisão/aplicação manual:

1. Registrar horário, papel, plano/estado, caminho e se o erro ocorre na abertura ou em qual salvamento. Correlacionar logs server-only de operação/etapa/código, sem exportar cookies, JWTs ou payloads empresariais.
2. Owner pago e owner Free de empresa A: abrir `/empresa`, conferir nome, tarifa NULL/não-NULL, perda e versão pertencentes a A. Repetir com excesso de equipe respeitando o layout. Seleção pendente deve continuar redirecionando a `/planos`.
3. Salvar nome; salvar tarifa `0,854321`; repetir sem mudança; limpar tarifa; confirmar NULL ao recarregar e ausência de alteração na perda. Verificar versões antes/depois e no-op. Testar limites 0/100 e rejeição de formato/precisão inválidos.
4. Owner/admin pago autorizado: salvar perda com duas casas; confirmar persistência e tarifa inalterada. Owner Free não recebe permissão adicional de escrita de perda: a negação existente permanece.
5. Admin legado elegível: acessar `/empresa` diretamente, somente perda editável; nome/tarifa devem permanecer negados também por chamada direta às ações/RPCs. A sidebar admin não oferece o item atualmente; sua alteração estava proibida e não foi feita.
6. Operator: acesso direto à página e ações de gestão negado; leitura operacional de configuração já permitida pelo plano continua autorizada sem liberar gestão. Admin/operator Free continuam bloqueados conforme as regras atuais.
7. Sem vínculo, vínculo/empresa inativos, identidade bloqueada e sessão expirada: confirmar redirecionamentos/bloqueios existentes e nenhuma leitura/escrita indevida.
8. Sessões de empresas A/B: conferir que cada RPC resolve apenas a própria empresa; tentativa de IDs adicionais não deve selecionar outro tenant. Comparar somente os dados de fixtures autorizadas. Revalidar a matriz em PostgreSQL, não apenas nos mocks.
9. Duas abas com mesma versão: primeira alteração válida persiste; a segunda retorna conflito, sem sobrescrita. Recarregar e tentar novamente. Validar trigger e ordem de locks sob concorrência.
10. Em ambiente de teste controlado, simular indisponibilidade RPC/retorno incompatível: não renderizar formulário com dados fictícios nem expor SQL; restaurar o serviço e confirmar recuperação. Não modificar dados reais para provocar falha.

## 9. Riscos residuais e revisão final

- Não foi encontrado defeito vigente de `search_path` nem `pg_catalog.coalesce` na cadeia de RPCs de empresa analisada.
- As duas RPCs de leitura não formam snapshot atômico: podem combinar configuração anterior e versão posterior sob concorrência. É risco de fonte, não incidente reproduzido. Resolver isso exigiria decisão de contrato/RPC; não foi introduzida arquitetura nova nesta correção.
- Os três formulários compartilham versão e permitem submissões independentes; conflitos devem ser preservados no banco, não contornados no cliente.
- Leitor compartilhado e permissões de perda permanecem com suas regras existentes; nenhuma tentativa de liberar operação paga apenas para fazer o formulário salvar. A negação de perda no Aprendiz refere-se ao caminho dedicado `update_my_pricing_loss` usado pelo formulário: o overload completo de três argumentos continua autorizado por `enterprise.manage` e permite ao owner alterar perda, inclusive Aprendiz. Essa divergência preexistente entre escritores exige decisão de política separada, não foi encoberta nem alterada pela correção de leitura.
- A opção de salvar no simulador integrado pode ser apresentada a admin/operator via `products.write`, embora a action de novo salvamento exija owner. É divergência de apresentação preexistente, não autorização concedida pela RPC de configuração; fora do escopo desta correção.
- Homologação autenticada de navegador e PostgreSQL continua pendente, deliberadamente sem acesso remoto nesta tarefa.

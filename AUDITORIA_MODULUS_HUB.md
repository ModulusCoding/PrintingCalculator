# Auditoria técnica — Modulus Hub

**Data:** 2026-10-19  
**Método:** revisão estática do repositório local, incluindo rotas, Server Actions, migrations, clientes Supabase e verificações locais. Nenhum código de produção foi alterado nesta rodada; nenhum serviço remoto ou banco foi acessado.

## Resumo executivo revisado

A revisão reduziu os achados confirmados: **há 1 bug confirmado de severidade média** e **3 hipóteses de severidade média/alta que exigem reprodução ou inspeção do banco efetivamente aplicado**. Não há evidência suficiente para chamar `AUTH-001`, `IMG-001` ou `IMG-002` de defeitos reproduzidos.

O risco concreto mais relevante é o fluxo de aplicação de histórico FDM: o detalhe envia ao botão a versão de produto registrada no snapshot, não a versão atual. A RPC corretamente exige a versão atual, portanto o usuário **não consegue concluir pela interface** a aplicação do mesmo histórico depois de uma edição legítima do produto.

## Tabela resumida

| ID | Severidade | Confiança | Módulo | Classificação |
|---|---:|---|---|---|
| PRC-001 | média | confirmado | Precificação / aplicação | Bug funcional |
| AUTH-001 | alta | hipótese | RLS legado e isolamento | Código histórico; depende das policies efetivas no banco |
| IMG-001 | média | hipótese | Imagens | Construção SQL frágil; não há reprodução de defeito |
| IMG-002 | média | hipótese | Imagens / concorrência | Cenário concorrente pendente de teste SQL |
| DB-002 | média | hipótese | Locks SQL | Ordem de locks não foi testada em transação concorrente |

> `PRC-002` foi removido: excluir `configVersion` do hash é uma decisão aprovada. A revisão confirmou que `tariff.original` e `tariff.effective` permanecem no objeto `input`, que integra o conteúdo estável usado para formar `requestHash`.

---

# A. Bugs confirmados

## PRC-001 — A interface não permite aplicar o mesmo histórico após edição do produto

- **Severidade:** média
- **Confiança:** confirmado por rastreamento completo do fluxo
- **Módulo:** precificação FDM / aplicação de preço
- **Arquivos e linhas:**
  - `app/(authenticated)/precificadora/historico/[id]/page.tsx:9-13`
  - `components/pricing/ApplyPricingButton.tsx:4-7`
  - `lib/pricing/persistence-actions.ts:107-131`
  - `supabase/migrations/20261016000000_backend_pricing_persistence.sql:124-143`

### Evidência e caminho completo

1. A página de detalhe obtém somente o histórico por `fetchPricingDetailAction`.
2. Ela lê `snapshot.product_snapshot.version` e o passa ao componente:

```tsx
<ApplyPricingButton
  pricingId={result.data.id}
  productVersion={snapshot.product_snapshot.version}
/>
```

3. `ApplyPricingButton` não consulta o produto atual nem solicita confirmação com nome/preço/versão atuais. Ele chama diretamente:

```ts
applyFdmPricingPriceAction(pricingId, productVersion)
```

4. A Server Action valida permissões `products.write` e `pricing.read` e encaminha esse mesmo valor para a RPC `apply_pricing_price`.
5. A RPC lê o produto atual sob `FOR UPDATE` e retorna `product_version_conflict` quando `p.version <> p_expected_product_version`.

### Cenário que dispara

1. Salvar um histórico quando o produto está na versão 4.
2. Editar o produto; ele passa para versão 5.
3. Abrir o mesmo histórico e clicar em aplicar.
4. A UI envia 4; a RPC compara com 5 e retorna conflito.

### Esperado x observado

- **Esperado:** o mesmo histórico permanece aplicável após o usuário revisar e confirmar a versão atual do produto; não deve exigir recálculo.
- **Observado:** a UI não busca a versão atual nem oferece retomada com ela. O usuário fica preso no conflito, salvo intervenção externa/manipulação da chamada.

### Impacto

Fluxo aprovado “histórico → confirmar produto/preço → aplicar” fica indisponível após uma edição comum do produto, embora o banco tenha sido projetado para aceitar o mesmo histórico com a versão atual.

### Correção mínima sugerida

Na tela de detalhe, carregar o produto atual em contexto autenticado/RLS, mostrar nome, preço atual e versão atual, exigir confirmação explícita e enviar essa versão atual à action. Manter o preço a aplicar vindo exclusivamente do histórico no banco.

### Teste que comprova

Salvar histórico, editar apenas o nome ou outro dado do produto, abrir o mesmo histórico, confirmar o produto atual e aplicar usando sua versão atual. Confirmar que não é criado histórico novo e que o preço armazenado no histórico é aplicado.

---

# B. Hipóteses que exigem reprodução ou verificação do banco

## AUTH-001 — Policies antigas amplas podem coexistir com a política interna

- **Severidade:** alta se presente no banco
- **Confiança:** hipótese; código histórico detectado, sem verificação do conjunto efetivo de policies
- **Módulo:** isolamento/RLS de produtos e catálogo
- **Arquivos:**
  - `supabase/migrations/20260818000000_create_catalogs_and_products.sql:91-129`
  - `supabase/migrations/20261015150000_internal_products_multitenancy.sql:136-151,360-385`

### Evidência disponível

A migration antiga contém policies permissivas, incluindo `Authenticated users can do all on products` e policies semelhantes de catálogo. A migration de multitenancy posterior adiciona RLS para produtos internos e revoga grants de tabela, mas a auditoria estática não pode provar quais migrations foram aplicadas, removidas ou substituídas no banco real.

### Por que não é bug confirmado

- O arquivo antigo é código histórico; sua presença no repositório não prova existência da policy em produção/dev.
- Grants revogados podem bloquear acesso mesmo se a policy existir.
- Não foi executada consulta a `pg_policies`, `information_schema.role_table_grants` ou `pg_proc` no banco.

### Cenário concreto a testar

Com usuário authenticated da empresa A e ID conhecido de produto da empresa B:

1. `SELECT` via Data API em `products` por ID B.
2. tentativa de `INSERT`, `UPDATE` e `DELETE` onde aplicável.
3. repetir para `catalogs`, `catalog_products`, filtros e Storage.

**Resultado exigido:** zero linhas ou negação para empresa B; somente operações autorizadas pela empresa A.

### Correção, se confirmado

Criar migration incremental que remova/substitua policies permissivas antigas para objetos internos e manter catálogo público em tabelas/policies claramente separadas.

---

## IMG-001 — Checagem de `FOUND` em expressão composta é frágil, mas não há defeito demonstrado

- **Severidade:** média
- **Confiança:** hipótese
- **Módulo:** imagens internas
- **Arquivo/linhas:** `supabase/migrations/20261015170000_internal_product_images.sql:157-164`

### Evidência disponível

A RPC `link_internal_product_image` executa:

```sql
SELECT path.* INTO v_path
FROM private.internal_product_image_path(p_storage_path) AS path;

IF p_product_id IS NULL
   OR p_expected_version IS NULL
   OR p_expected_version < 0
   OR p_display_order IS NULL
   OR p_display_order NOT BETWEEN 1 AND 3
   OR NOT FOUND THEN
  RETURN QUERY SELECT 'invalid_input', NULL::bigint;
  RETURN;
END IF;
```

### Reclassificação

Isto **não é defeito reproduzido**. O próprio código só usa `v_path` depois do `IF`; portanto, se `FOUND` for falso, o caminho esperado é `invalid_input`. A construção é menos clara e mais difícil de manter/testar, mas não há evidência estática de bypass, exceção ou acesso indevido.

### Cenário concreto de reprodução

Executar em PostgreSQL isolado a RPC com:

1. `p_storage_path = NULL`;
2. caminho com segmentos insuficientes;
3. UUID inválido no segmento da empresa/produto/imagem;
4. caminho sintaticamente válido sem linha retornada pelo parser;
5. caminho válido de outro produto/empresa.

Verificar que os quatro primeiros retornam `invalid_input`, o último não permite associação e não gera erro 500.

### Ação sugerida

Somente se os testes mostrarem retorno técnico/erro: separar imediatamente após o `SELECT`:

```sql
IF NOT FOUND THEN ... END IF;
```

Não é recomendada correção preventiva sem teste de contrato se a política do projeto for limitar mudanças.

---

## IMG-002 — Limite e associação concorrentes precisam de teste transacional

- **Severidade:** média
- **Confiança:** hipótese
- **Módulo:** imagens internas / Storage
- **Arquivo/linhas:** `supabase/migrations/20261015170000_internal_product_images.sql:115-190`

### Evidência disponível

`link_internal_product_image` chama `private.lock_internal_product_image_context`, que faz advisory locks de gestão/membro e bloqueia o produto com `FOR UPDATE`. Depois, a função conta imagens, valida ordem, consome a reserva de upload, insere a associação e atualiza a versão do produto.

Há proteções relevantes: lock no produto, unique constraint de ordem e tratamento de `unique_violation`. A ausência de um teste concorrente **não prova** duplicação, perda ou deadlock.

### Cenário concreto a testar

Preparar quatro objetos/reservas válidos para o mesmo produto com duas ordens:

- **Transação T1:** chamar `link_internal_product_image(produto, versão V, path1, ordem 3)` e pausar após adquirir o lock do produto.
- **Transação T2:** chamar `link_internal_product_image(produto, versão V, path2, ordem 3)`; deve aguardar T1.
- Confirmar T1; T2 deve retornar `version_conflict` (produto agora V+1) ou conflito explícito, nunca criar quarta imagem/nem duplicar ordem.
- Repetir com produto já contendo duas imagens e dois requests para atingir quatro associações.
- Repetir remoção de imagem em T1 e associação em T2.

### Impacto se confirmado

Reserva de upload pode ficar não consumida até expirar, objetos podem ficar órfãos para limpeza, ou o usuário pode receber `image_conflict`. Esses resultados não equivalem automaticamente a perda de dados; a política de limpeza deve ser testada/documentada.

---

## DB-002 — Compatibilidade de ordens de locks entre módulos não foi demonstrada

- **Severidade:** média
- **Confiança:** hipótese
- **Módulo:** concorrência de SQL
- **Arquivos:**
  - produtos: `20261015150000_internal_products_multitenancy.sql:178-234`
  - imagens: `20261015170000_internal_product_images.sql:122-133`
  - pricing: `20261016000000_backend_pricing_persistence.sql:79-143`
  - gestão/provisionamento: migrations `20261015100000` a `20261015140000`

### Cenário concreto a testar

1. **T1:** atualização de produto/imagem: advisory lock global de membros → lock de ator → identidade/usuário/membro/empresa → produto.
2. **T2:** alteração de membro/empresa para o mesmo ator/empresa, seguindo a ordem definida no RPC correspondente.
3. Executar em sessões PostgreSQL separadas com `lock_timeout` e `deadlock_timeout` baixos; inspecionar `pg_locks` e o resultado das duas chamadas.
4. Repetir com `save_pricing_attempt`, que trava produto, empresa, materiais ordenados e impressora após resolver o ator.

### Observação

Nenhuma ausência de teste foi convertida em alegação de deadlock. A hipótese existe porque vários comandos adquirem locks de tipos/tabelas diferentes; somente a execução concorrente pode demonstrar a compatibilidade integral.

---

# C. Melhorias opcionais

1. Centralizar schemas de respostas RPC para reduzir risco de divergência entre Action e migration.
2. Adicionar testes de contrato para `RETURNS TABLE`: exigir array com uma linha, rejeitar campos extras/ausentes e cobrir todos os status.
3. Remover logs locais gerados por build da área de trabalho antes da entrega, quando apropriado; isto não é mudança de produção.
4. Converter o lint de módulos atuais para estado limpo antes de tornar o lint global gate obrigatório. Os erros atualmente detectados pertencem ao legado/público, conforme seção de verificações.

---

# D. Limitações de verificação e decisões aprovadas

## Estado de banco e migrations

O estado de aplicação da migration **não foi classificado como achado**. Arquivos Git, arquivos não rastreados ou removidos não provam o estado de banco. Não houve acesso a banco local/remoto.

Permanecem pendentes, em ambiente autorizado e somente leitura:

- existência de tabelas e funções;
- assinaturas e overloads de RPC;
- ownership `postgres`;
- `prosecdef`/`search_path`;
- RLS e conjunto efetivo de policies;
- grants de tabelas/funções/Storage;
- comportamento transacional e concorrente.

## Decisões aprovadas preservadas

- `configVersion` fora do hash é decisão aprovada.
- `tariff.original` e `tariff.effective` continuam no payload estável, pois pertencem a `r.input` usado por `intent` em `lib/pricing/persistence-actions.ts:69-71`.
- Não foi proposta reintrodução de HMAC; a precificação usa RPC administrativa exclusiva do backend.
- Ausência de estoque, carretéis, pedidos, CRM e financeiro não é defeito.
- A confirmação administrativa de e-mail no provisionamento foi analisada no fluxo atual e não foi isoladamente classificada como bug.

---

# E. Cobertura da auditoria

## Mapa de fluxos revisados

| Fluxo | Interface/rota | Action | Autorização | Consulta/RPC | Retorno/UI | Cobertura |
|---|---|---|---|---|---|---|
| Login | `/admin/login` | `loginAction` | `auth.getUser` + `resolveMinimalIdentity` | `get_my_access_context` | estado encaminhado à rota de conta | revisado |
| Sessão/redirect | middleware | `updateSession` | `auth.getUser` | refresh de cookies | `/admin/login` ou `/conta` | revisado |
| Recuperação | rotas auth recovery | `requestPasswordResetAction`, `updatePasswordAction` | marcador + sessão recovery | Supabase Auth | sucesso só após update confirmado | revisado |
| Troca obrigatória | rota conta | `changeRequiredPasswordAction` | contexto `password_change_required` | RPC administrativa + Auth update + release | parcial não vira sucesso | revisado |
| Provisionamento | equipe/novo | `provisionEmployeeAction`, `resumeProvisioningAction` | permissão por papel | RPC start/finish/resume + Admin Auth | resultado incerto/partial retomável | revisado |
| Impressoras | `/impressoras` | `lib/printers/actions.ts` | `printers.read/write/archive` | Data API + RPCs | schemas estritos e revalidate | revisado |
| Materiais | `/materiais` | `lib/materials/actions.ts` | `materials.read/write/archive` | Data API + RPCs | schemas estritos e revalidate | revisado |
| Pricing save | simulador | `saveFdmPricingAction` | `pricing.write`, `products.read` | lookup + save RPC administrativo | created/idempotent/unknown | revisado |
| Pricing history/detail | histórico/detalhe | list/fetch actions | `pricing.read` | Data API com enterprise explícita | read-only | revisado |
| Pricing apply | detalhe/botão | `applyFdmPricingPriceAction` | `pricing.read`, `products.write` | RPC apply | conflito atual sem retomada UI | revisado; achado PRC-001 |
| Produto/imagens | rotas produto | actions/migrations principais | products.* | RPC + Storage | parcialmente revisado | SQL transacional pendente |

## Fluxos de autenticação: conclusão estática

- A identidade e empresa são derivadas de `auth.getUser()` e de `get_my_access_context`; não foi encontrado uso de `user_metadata` como autorização em `lib/auth/context.ts`.
- `resolveMinimalIdentity` valida que a RPC retorna exatamente uma linha e aplica invariantes por estado.
- Middleware só protege `/admin`; ele não decide contexto de negócio, evitando redirecionar estados bloqueados como se fossem contas prontas.
- Recuperação exige sessão validada e marcador vinculado ao `uid`/session ID; após `updateUser` confirmado, falhas de limpeza/logout retornam sucesso confirmado com `logoutFailed`, não falha da alteração.
- Troca obrigatória verifica segredo antigo com cliente descartável, atualiza a sessão do navegador e só libera obrigação por RPC posterior; falha nessa liberação retorna estado parcial, não sucesso.
- Provisionamento usa `service_role` apenas no servidor, sem persistência/refresh, usa start → criação Auth → finish e apresenta retomada para estados incertos/parciais. A criação usa `email_confirm: true`, consistente com a decisão administrativa atual.

**Limite:** os comportamentos dependentes do Auth e de cookies não foram reproduzidos contra Supabase.

## Impressoras e materiais: conclusão estática

- Listagem e leitura aplicam `enterprise_id` explicitamente e exigem `printers.read`/`materials.read`.
- Mutações verificam permissões, ID, versão segura não negativa, números pt-BR e limites antes de chamar RPC.
- Ambos validam array de resposta com exatamente uma linha e tratam resposta inválida como desconhecida.
- Arquivamento/restauração exigem permissões `*.archive`; atualizações exigem `*.write`.
- Paginação das listagens é determinística por `created_at DESC, id DESC`.

**Limite:** signatures e estados foram comparados estaticamente com migrations disponíveis, mas não executados em banco.

---

# Verificações executadas

## Estado do repositório

No início, `git status --short` indicou alterações pré-existentes em arquivos de pricing, uma migration antiga de pricing removida, uma migration backend não rastreada e logs locais. Elas foram preservadas.

## TypeScript

```text
npx tsc --noEmit
```

**Resultado:** passou sem erros.

## Build autorizado

```text
npm run build
```

**Resultado:** passou; a saída confirmou `Finished TypeScript in 18.1s` e o processo terminou com código 0.

Build não valida RLS, grants, SQL, Storage ou comportamento remoto.

## ESLint global

```text
npx eslint .
```

**Resultado:** falhou com **16 erros e 17 warnings**.

### Impacto por grupo

- **Legado/calculadoras públicas e catálogo público:** erros `react-hooks/set-state-in-effect` em `app/calculator/page.tsx`, `app/marketplaceCalculator/page.tsx`, `components/catalog/CatalogoModulus.tsx`, `context/CartContext.tsx` e `context/LanguageContext.tsx`. Há também avisos de `<img>` e variáveis não usadas. Esses arquivos estão fora do MVP interno atual, mas impedem o lint global de ser um gate verde.
- **Componentes administrativos legados:** `components/admin/AddProductsModal.tsx` tem o mesmo erro de effect/setState.
- **Módulos atuais auditados:** o lint direcionado anterior para `lib/pricing/persistence-actions.ts` passou; a execução global exibida não reportou erro em `lib/auth/*`, `lib/printers/*`, `lib/materials/*`, `lib/supabase/*` ou nas páginas internas FDM.

Lint descreve problemas de regra React/performance e qualidade; ele não comprova falha de autorização ou de SQL.

## SQL e serviços

Não foram executados SQL, migrations, `db push`, `db reset`, criação de contas, e-mails ou chamadas remotas. Não foi encontrado PostgreSQL local isolado confirmado; validação de banco permanece estática e testes transacionais permanecem pendentes.

---

# Sequência recomendada antes de implementar

1. Corrigir `PRC-001`: permitir consulta/confirmação da versão atual e aplicação do mesmo histórico.
2. Executar consultas somente leitura e a matriz de isolamento por empresa para decidir `AUTH-001` com evidência real.
3. Executar testes SQL isolados para os cenários concretos de imagens e locks; somente então corrigir `IMG-001`, `IMG-002` ou `DB-002` se reproduzidos.
4. Criar testes de contrato de pricing e dos RPCs administrativos em ambiente isolado.
5. Tratar lint global como dívida separada: não bloquear correções internas por erros do legado, mas planejar sua limpeza antes de adotar gate global obrigatório.

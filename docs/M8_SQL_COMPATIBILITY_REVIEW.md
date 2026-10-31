# M8 — auditoria SQL/financeira de compatibilidade (27/10/2026)

## 1. Resumo e classificação

**Apta à revisão após correções de fonte; BLOQUEADA para aplicação/produção até ensaio PostgreSQL isolado autorizado.** Migration candidata não aplicada. Não executamos preflight, parser SQL, PostgreSQL, Supabase, Asaas ou credenciais. Fonte e mocks não homologam execução, concorrência ou RLS.

## 2. Dependências reais, ordem e assinaturas

A ordem local termina em `supabase/migrations/20261027120000_orders_stage72flex_delivery_cycles.sql`, seguida da candidata `20261027130000_m8_saas_billing_foundation.sql`. Não se alteraram migrations históricas.

- `20261014193600_create_auth_tenancy_access_context.sql`: `public.get_my_access_context()` retorna, nesta ordem, `(state text,user_id uuid,user_status text,must_change_password boolean,enterprise_id uuid,membership_id uuid,role text)`. Usa identidade interna/issuer, status de usuário, troca de senha, membros/empresa ativos e rejeita empresa ambígua. Não recebe IDs do navegador. Não foi localizada redefinição posterior.
- `20261025000000_stage6_plans_entitlements.sql`: `public.enterprise_plan_access` tem PK enterprise, FK enterprises/users, enums `modulus_plan_code` (free/intermediate/advanced), `modulus_access_state` (selection_required/free/paid/expired/cancelled), checks de estados e finitude, índice unique parcial authorization_id, versão bigint >=0.
- Mesmo arquivo: `private.enterprise_authorization_receipts(authorization_id text PK,payload jsonb,authorization_version bigint,enterprise_id uuid,created_at timestamptz)`. Payload histórico é `{plan,paid_until_epoch}` preservando microssegundos; receipt version >=1.
- Última definição pré-M8 de `private.resolve_enterprise_plan(uuid)` no mesmo arquivo: retorna `(selected_plan modulus_plan_code,effective_plan modulus_plan_code,access_state modulus_access_state,paid_until timestamptz,cancelled_at timestamptz,authorization_version bigint,selection_required boolean)`. M8 conserva nome, parâmetros e ordem/tipos de retorno. `20261026070000_pricing_read_access_fix.sql` revoga execução direta do helper.
- Últimas definições de `public.confirm_enterprise_paid_access(uuid,modulus_plan_code,timestamptz,text,bigint)` e `public.cancel_enterprise_paid_access(uuid,bigint)` no mesmo arquivo: ambas retornam `(status text,authorization_version bigint)`. Confirm adquire advisory global, enterprise, receipt e access; verifica versão; recibo repetido retorna `idempotent` **sem atualizar acesso**. Cancel é imediato, preserva paid_until/ID e incrementa versão; cancel repetido é idempotente. Ambas continuam inalteradas.
- `20261026050000_initial_free_plan.sql`, `20261026060000_plan_business_regularization.sql`, `20261026120000_team_capacity_enforcement.sql`: seleção free, regularização e capacidade continuam dependentes do resolver; não se modifica política de equipe/downgrade. Pedidos posteriores consomem o mesmo resolver.
- `lib/plans.ts`: schemas estritos dependem do retorno histórico (paid exige intermediate efetivo; expired/cancelled exige free). M8 mantém esse contrato; não foi alterado.

Candidata agora exige baseline/owner postgres antes do DDL. Assume instalação íntegra dos arquivos anteriores e roles Supabase existentes. Catálogos do preflight devem confirmar essas hipóteses; inspeção local não prova estado remoto.

## 3. Defeitos, evidência, impacto e correções

Todos os itens SQL abaixo referem-se a `supabase/migrations/20261027130000_m8_saas_billing_foundation.sql`.

| Local | Causa/evidência original | Impacto/gravidade | Correção |
|---|---|---|---|
| `m8_grant_verified_payment` | UPDATE paid_from=NULL antes de chamar confirmer; resultado ignorado | Alta: replay histórico poderia criar ciclo/proveniência sem novo grant; mutação pré-validação sem necessidade | Removeu UPDATE antecipado; exige status `confirmed`, caso contrário aborta transação; preserva checks históricos |
| Mesmo grant / resolver | Nova autorização substitui anterior no access | Alta se resolver filtrar ciclo pelo authorization_id atual: renovação antecipada perderia ciclo vigente | Mantido teste de TODOS os ciclos não revertidos da geração; vínculo conta/access exige ID atual, não ID de cada ciclo |
| Mesmo grant | Pagamento poderia sobrepor grant manual independente ainda vigente | Alta: sobrescrita de autorização fora desta integração | Rejeita `independent_authorization_conflict`; exige resolução operacional, não inventa conversão |
| Cancelamento subscription | Tentativa sem generation; confirmação sem validar geração/unknown | Alta: recibo antigo poderia operar contrato posterior | Reserva generation; valida vínculo, geração e estado na confirmação/replay |
| Checkout/progress/cancel checkout | Ordem account→attempt versus attempt→account; contexto antes de lock global | Alta: deadlock/race de autorização | Todas essas mutações adquirem mesmo advisory global antes do contexto/locks; histórico confirm/cancel usa mesma chave |
| `m8_invalidate_cancel_lease` | Só invalida ao cancelar | Alta: snapshot antigo poderia sobreviver à recontratação | Invalida também por mudança de generation; coluna generation declarada antes do trigger |
| Payments/proveniência/cycles | FKs individuais não garantiam enterprise/generation iguais; generation payment não preenchida | Alta: associação financeira incoerente | Persiste generation NOT NULL; valida identidade imutável; adiciona FKs compostas receipt/origin/payment/cycle e trigger imutável da origem; insere origem antes de ciclo |
| `m8_apply_payment_snapshot` | SELECT FOR UPDATE da autorização apenas para bloco NULL | Baixa: lock desnecessário e falsa aparência de revogação | Removido; reversal é persistido pelo trigger na mesma transação |
| Scan commit/claim | NULL em comparações poderia resultar UNKNOWN; array length sem validação separada | Média: entradas inválidas/fence incompleto | Rejeita NULL explicitamente, valida array antes de comprimento, exige página cheia se hasMore e campos regex IS NOT TRUE |
| Preflight | SELECTs diretos saas_* ausentes antes de M8 | Média: diagnóstico falhava justamente no baseline | Catálogos e agregados dinâmicos SELECT guardados por to_regclass, sem IDs/payloads/PII |

Os testes novos são asserções de fonte e modelos explícitos, não uma prova de SQL executável.

## 4. Financeiro: primeiro, renovação, expiração, refund, cancel e recontratação

Primeira confirmação observada usa relógio SQL, não dueDate/paymentDate nem callback. CONFIRMED→RECEIVED encontra payment cycle existente e não concede novamente. Grant, receipt, provenance, ledger e observação estão na mesma transação fenced; qualquer erro/unique/FK aborta tudo.

Exemplo prioritário: primeira cobertura 31/jan 18h→28/fev 18h. Observação em 25/fev produz ciclo **28/fev→31/mar** usando âncora 31 original. Confirmer aumenta paid_until para 31/mar, substitui authorization_id e preserva paid_from anterior. O CHECK continua válido: começo anterior < fim antigo < fim novo. Não é necessário limpar paid_from. O resolver considera o primeiro ciclo em 25/fev mesmo com receipt atual do segundo; no fim exato troca para o segundo. Refund do primeiro em 25/fev retira acesso até 28/fev; não remove o segundo. Refund antigo após 28/fev não revoga cobertura posterior. Reversal vista antes de confirmação bloqueia o pagamento para sempre, mesmo se provider voltar RECEIVED.

Sem renovação, `[from,until)` termina no instante exato sem cron. Renovação nesse instante é contínua; atraso inicia nova âncora na observação, sem preencher gap. SQL usa timestamp fracionário e diferença do início do dia; JS Date testa somente milissegundos. Casos 30/jan, 31/jan→28/fev→31/mar, 29/fev bissexto e dezembro/janeiro constam da projeção; microssegundos reais ainda exigem PostgreSQL.

Cancelamento confirmado chama cancel histórico apenas para ID bound atual, downgrade imediato sem apagar equipe/dados. Unknown mantém cobertura anterior até prova autoritativa; bloqueia novos grants. Recontratação troca geração, invalida lease e não associa recursos antigos. Refund de recurso antigo desvinculado pode permanecer revisão; nunca reautoriza geração atual.

## 5. Segurança e concorrência

Todas as tabelas novas privadas têm RLS e REVOKE explícito para PUBLIC/anon/authenticated/service_role; nenhuma policy browser ou grant direto novo. Funções/trigger helpers têm REVOKE explícito; RPCs de observação/commit service-only; owner browser só consulta/reserva usando contexto próprio. Service role é credencial privilegiada, não proteção contra servidor comprometido. Confirmer histórico continua privilégio operacional existente, não recebe grant browser novo. SECURITY DEFINER usa search_path vazio; owner postgres é precondição explícita. Nenhum bypass pago foi acrescentado à auth central.

Advisory global serializa mutações financeiras/gestão de equipe, antes dos row locks. Claims financeiros/scan e commit scan só travam account e não adquirem depois advisory global: não criam ciclo de locks com os fluxos acima. Account fence exige token/versão/lease não expirada sob FOR UPDATE, e cancel/generation invalidam token. Scan usa SKIP LOCKED, ticket justo e checkpoint+events atômicos; valida geração/subscription/token/versão/offset e prazo. Tentativa unresolved unique por enterprise impede duas operações remotas abertas. PKs e ciclos uniques abortam duplicidade transacionalmente.

Inbox SKIP LOCKED é apenas seleção transacional, não lease de processamento longo: dois workers podem pegar mesmo evento após commit. Isso pode repetir GET/tentativas; o fence por conta e ledger idempotente impedem concessão duplicada. Paginação offset não é snapshot remoto; passagens repetidas são necessárias. Não se promete exactly-once de transporte nem ausência de deadlock provada sem banco real. Retornos tabulares do worker usam aliases e RETURNING qualificado; registros e FOUND inspecionados, retorno do confirmer agora explicitamente validado.

## 6. Arquivos alterados nesta auditoria

- Candidata M8 (somente a não aplicada).
- `docs/M8_PREFLIGHT_READ_ONLY.sql`.
- `docs/M8_ASAAS_SUBSCRIPTIONS_IMPLEMENTATION.md` e este relatório.
- `tests/m8-billing.test.cjs`, `tests/m8-calendar.test.cjs`, novo `tests/m8-sql-compatibility.test.cjs`.

Arquivos de UI/routes/billing já existentes no status inicial preservados; nenhuma migration histórica, auth central, Pedidos, env, infraestrutura ou dependência alterada. Ferramenta de subagents não estava disponível no catálogo.

## 7. Comandos reais e resultados

- `git status --short`: registrou alterações preexistentes da página e arquivos M8 untracked.
- `node --test tests/m8-*.test.cjs tests/paid-module-gate.test.cjs tests/pricing-access.test.cjs`: **95/95**, exit 0.
- `node --test tests/plan-capacity.test.cjs tests/pricing-actor-authorization.test.cjs`: **9/9**, exit 0.
- `npx tsc --noEmit`: exit 0, sem saída.
- `npx eslint lib/billing tests/m8-*.test.cjs`: exit 0, sem saída.
- `npm run build`: exit 0; saída fornecida pela ferramenta: `Finished TypeScript in 8.1s ...`. Não inferimos E2E/DB desse output.
- Um comando auxiliar PowerShell Get-ChildItem com dois padrões falhou (exit 1); substituído por glob, sem efeito nos arquivos.
- Reexecução final `node --test --test-reporter=dot tests/m8-*.test.cjs tests/paid-module-gate.test.cjs tests/pricing-access.test.cjs tests/plan-capacity.test.cjs tests/pricing-actor-authorization.test.cjs`: exit 0, **104 testes** (104 pontos).
- ESLint direcionado repetido após correções finais: exit 0.
- `git diff --check`: exit 0; apenas aviso LF→CRLF na página preexistente. Atenção: Git não inclui arquivos untracked nessa verificação; não representa validação SQL da candidata.

Nenhum comando instalou dependências. Nenhum SQL ou parser SQL executado. Sem chamadas financeiras, Docker/WSL, remoto, commits, push ou deploy.

## 8. Preflight preparado: resultados esperados

Executar somente sob autorização separada. Antes de M8, funções históricas devem ter assinaturas/retornos acima, owners confiáveis, SECURITY DEFINER/search_path vazio, enums exatos, grants sem EXECUTE browser de confirm/cancel/helper. Catálogos devem mostrar índices/constraints e histórico ordenado; saas_* ausentes deve retornar conjuntos vazios/NULL nos agregados, não erro. `expired_persisted_paid` pode ser legítimo (resolver usa relógio); inconsistent_receipts e invalid_versions exigem investigação, não limpeza automática. Após aplicação isolada: RLS nas tabelas novas, nenhum acesso direto das três roles, FKs compostas/triggers/uniques presentes; invalid_intervals deve ser zero. Agregados não expõem IDs, documentos ou payloads. Diferenças de schema/owner/ACL/baseline bloqueiam aplicação.

## 9. Residuais e ensaio PostgreSQL/sandbox obrigatório

Bloqueadores de homologação: compilar/aplicar candidata em PostgreSQL compatível com Supabase sob transação; validar DDL e resolução PL/pgSQL lazy (incluindo funções criadas antes de colunas posteriormente adicionadas), ownership/ACLs herdadas, roles, RLS e rollback. Testar duas sessões reais para duplicate events, CONFIRMED/RECEIVED, grant/cancel simultâneos, recontract/stale fence, scan leases/offset/token NULL, replay receipt, constraints compostas, refund antigo/novo, microssegundos e timezone de sessão distinto. Injetar falha entre confirmer/origin/cycle para provar rollback integral. Não foi executado e não se declara comprovado.

Asaas sandbox separado deve validar contratos de GET/POST, vínculo checkout/subscription, cancelamento correndo com pagamento, recuperação de timeout e paginação mutável. Checkout cujo ID se perdeu continua unknown/revisão operacional; não existe recuperação automática inventada. Grant manual independente vigente causa conflito deliberado, não migração silenciosa. Procedimento operacional auditado para conflitos/unknown, monitoramento/rate limits e retenção continuam necessários antes de produção.

## 10. Parecer exato e bloqueante

**Correções de fonte concluídas; apta somente para revisão e ensaio isolado autorizado. NÃO APLICAR EM PRODUÇÃO.** Não foi identificado outro defeito de fonte de alto impacto que exija arquitetura nova nesta revisão; permanecem bloqueantes a validação PostgreSQL real (DDL/PLpgSQL, constraints, ACL/RLS, transações/locks e microssegundos), homologação Asaas sandbox e procedimento auditado de unknown/conflitos. Testes locais verdes não removem esses bloqueios.

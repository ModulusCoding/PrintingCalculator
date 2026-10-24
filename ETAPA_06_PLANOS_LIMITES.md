# Etapa 6 — Planos e precificação

## Revisão corretiva do 6C

A migration incremental `20261026030000_stage6bc_manual_contract_fix.sql` substitui somente a RPC manual, sem editar migrations anteriores. O contrato V3 agora é validado em etapas antes de casts JSON, incluindo entrada, impressora, carretéis manuais, embalagem, acabamento, unidades, limites/escala/divisores e consistência do resultado. A persistência manual permanece classificada como `source=manual`, sem IDs de fontes integradas.

O salvamento manual é permitido exclusivamente ao owner no plano efetivo gratuito, incluindo o estado `selection_required` usado antes da seleção na UI; o plano intermediário continua destinado à precificadora integrada. A autorização atual ocorre antes do replay no RPC. Um replay exige actor, request hash e snapshot hash iguais; divergência do payload persistido é conflito. A action deixou de exigir acesso pago e mantém seleção de produto, autorização owner e janela gratuita. O script `tests/sql/20261026030000_stage6bc_manual_contract_fix_assertions.sql` cria fixtures e cobre contrato e idempotência. Não houve execução SQL local ou remota confirmada neste ambiente.

## Incremento 6A — Fundação de Planos e Limites Transacionais

## Resumo das mudanças executadas

1. **Restauração pontual da migration aplicada**:
   - `supabase/migrations/20261015150000_internal_products_multitenancy.sql` foi restaurada exatamente para seu conteúdo original, removendo a edição direta introduzida na tentativa anterior.
   - Apenas a alteração preexistente de 3 linhas em `supabase/migrations/20261024000000_stage5_deletion_counts.sql` foi preservada no working tree.

2. **Correção e consolidação da fundação SQL (Migration 20261025000000)**:
   - `modulus_plan_limits`: corrigidos aliases e parâmetros, retornando colunas explícitas para limites numéricos e flags booleanas de ilimitado/disponibilidade.
   - `private.resolve_enterprise_plan`: criado helper temporal autoritativo que usa o relógio do banco (`statement_timestamp()`) e resolve automaticamente expiração, cancelamento e ausência de seleção (`selection_required`).
   - `get_my_plan_access`: consulta `private.resolve_enterprise_plan` após validar o contexto `business_ready` da empresa do usuário logado.
   - `confirm_enterprise_paid_access`: validação estrita de parâmetros (`intermediate` único ativável, data futura e finita), verificação de reuso de autorização em outra empresa, atualização de versão e gravação de auditoria imutável na mesma transação. Idempotente quando chamada com a mesma autorização e data.
   - `cancel_enterprise_paid_access`: transição imediata para plano efetivo gratuito e estado `cancelled`, preservando `paid_until` e `authorization_id` originais para auditoria. Idempotente ao repetir cancelamento.
   - `private.lock_plan_quota`: adquire o lock transacional de cota por empresa (`modulus:plan-quota:<enterprise_id>`) e bloqueia a criação se o estado for `selection_required` ou se o recurso estiver desabilitado no plano.

3. **Integração transacional de cotas nas criações reais**:
   - **Produtos (`create_internal_product`)**:
     - Atualizada a assinatura para receber `p_attempt_id` (com tabela interna `private.product_create_receipts` para idempotência) e criada overload com a assinatura antiga de 4 parâmetros.
     - Aplica o lock de cota. No plano `free`, limita a no máximo 3 cadastros não excluídos (`deleted_at IS NULL`), incluindo ativos e arquivados.
     - Lança erro `plan_limit_reached` ao atingir o limite. Retentativas com o mesmo `p_attempt_id` são idempotentes.
   - **Carretéis (`create_filament_spool`)**:
     - Integra a trava de cota compartilhada `shared_materials.create`. No plano `free`, bloqueia a criação com `plan_feature_unavailable`. No plano `intermediate`, valida o limite somado (`filament_spools + general_materials < 15`) considerando não excluídos (`deleted_at IS NULL`).
   - **Materiais Gerais (`create_general_material`)**:
     - Mesma regra de cota compartilhada transacional. Não conta materiais de referência FDM (`public.materials`).

4. **Tratamento TypeScript e Actions**:
   - `lib/plans.ts`: centralizados os códigos de erro semânticos (`selection_required`, `plan_feature_unavailable`, `plan_limit_reached`, `authorization_conflict`, `idempotency_conflict`), parsing numérico e regras de bloqueio de módulos.
   - `lib/products/actions.ts`, `lib/spools/actions.ts` e `lib/general-materials/actions.ts`: atualizados para reconhecer e propagar os novos códigos de erro lançados pelas RPCs.

5. **Testes SQL e Verificações**:
   - `tests/sql/20261025000000_stage6_assertions.sql`: atualizado com assertions abrangentes para validar os limites do plano gratuito e intermediário, a imutabilidade da auditoria, as travas de idempotência e os privilégios de acesso.

## Arquivos criados e modificados

### Criados
- `lib/plans.ts`
- `supabase/migrations/20261025000000_stage6_plans_entitlements.sql`
- `tests/sql/20261025000000_stage6_assertions.sql`
- `ETAPA_06_PLANOS_LIMITES.md`

### Modificados
- `supabase/migrations/20261015150000_internal_products_multitenancy.sql` (restaurado)
- `lib/products/actions.ts`
- `lib/spools/actions.ts`
- `lib/general-materials/actions.ts`

## Estado da migration e verificação local

- A migration `20261025000000_stage6_plans_entitlements.sql` foi desenvolvida para ser aplicada em banco local isolado.
- Nenhuma migration foi executada em banco remoto ou compartilhado.
- Verificações de tipo e sintaxe executadas:
  - `npx tsc --noEmit`: executado com **sucesso** (0 erros).
  - `npx eslint`: executado nos arquivos alterados (`lib/plans.ts`, `lib/products/actions.ts`, `lib/spools/actions.ts`, `lib/general-materials/actions.ts`) com **sucesso** (0 erros).
  - `git diff --check`: executado sem erros de formatação ou whitespace.

## Correções específicas finais do 6A

- O replay de `confirm_enterprise_paid_access` monta `v_payload` com `plan` e `paid_until_epoch`, compara empresa e payload com `IS DISTINCT FROM`, e grava exatamente esse payload no recibo.
- A exigência de `paid_until > statement_timestamp()` aparece somente depois da busca do recibo; replay histórico vencido ou cancelado não altera o acesso atual.
- A expressão final de `selection_required` para linha existente é `(a.selected_plan IS NULL AND a.access_state='selection_required')`; ausência de linha continua retornando `true`.
- A versão esperada não é usada para bloquear replay equivalente de recibo já concluído.

## Roteiro curto de validação no desenvolvimento

1. Aplicar a migration `20261025000000_stage6_plans_entitlements.sql` em banco PostgreSQL local isolado.
2. Executar o script de teste `tests/sql/20261025000000_stage6_assertions.sql`.
3. Testar a criação de produtos no plano gratuito:
   - Tentar cadastrar 3 produtos (sucesso).
   - Tentar cadastrar o 4º produto (deve retornar erro `plan_limit_reached`).
4. Testar a criação de carretéis/materiais gerais no plano gratuito:
   - Deve rejeitar com `plan_feature_unavailable`.
5. Confirmar o plano intermediário via `confirm_enterprise_paid_access`:
   - Cadastrar até 15 itens somados entre carretéis e materiais gerais.
   - O 16º item deve ser rejeitado com `plan_limit_reached`.
6. Simular retentativa com o mesmo `attempt_id`: deve retornar o resultado salvo de forma idempotente sem consumir novas vagas.

## Incremento 6B — estado da implementação

O 6B foi separado da fundação 6A e adiciona uma migration nova:
`supabase/migrations/20261026000000_stage6b_access_restrictions.sql`.

### Matriz aplicada

- `free`/Aprendiz: owner operacional; membros não-owner podem autenticar e acessar conta, mas ficam bloqueados dos dados empresariais; produtos obedecem à janela dos três últimos; módulos pagos permanecem preservados e inacessíveis.
- `intermediate`/Visionário: owner e até um operador; todos os produtos autorizados; módulos operacionais pagos disponíveis, mantendo os limites transacionais do 6A.
- `advanced`/Magnata: continua não ativável.

A janela é calculada no banco antes de filtros e paginação por `created_at DESC, id DESC`, somente entre produtos internos não excluídos. Policies restritivas protegem produtos, imagens, estoque e tabelas de módulos pagos/Data API. O owner não perde a capacidade de entrar na gestão quando existem vínculos legados excedentes; esses vínculos exigem regularização explícita.

A migration não substitui os RPCs legados de provisionamento. O limite de operadores é revalidado por triggers transacionais na operação e na inserção de membership, com advisory lock por empresa. O contrato público `get_my_plan_business_access()` distingue `allowed`, `selection_required`, `member_plan_blocked` e `team_regularization_required`.

Ações e layouts de módulos pagos também consultam a autoridade do banco antes de carregar dados. A precificadora integrada é bloqueada no servidor para o plano não elegível; históricos continuam sendo lidos por snapshots, sem reabrir catálogos operacionais.

### Limitações explícitas

Os RPCs privilegiados históricos de pricing (`lookup_pricing_attempt`, `save_pricing_attempt` e `apply_pricing_price`) mantêm seus corpos originais nesta migration 6B porque a cópia parcial alteraria contratos de idempotência e PRC-001. As Server Actions e a RLS foram protegidas, mas a autorização de entitlement dentro desses RPCs requer uma migration corretiva incremental baseada nos corpos completos, antes de considerar pricing protegido contra chamadas backend privilegiadas. Isso é uma limitação comprovada, não um teste aprovado.

Migrations 6A/6B e assertions SQL não foram aplicadas nem executadas em PostgreSQL local/ remoto neste ambiente. `tsc` passou; os testes de acesso, RLS e concorrência permanecem preparados/pendentes.

## Pendências para as próximas etapas

- **Incremento 6B**: Bloqueios completos de navegação e busca por URL para módulos pagos no plano gratuito, implementação da janela dos 3 últimos produtos/pedidos acessíveis para leitura no gratuito e restrições de equipe (máximo 1 operador no intermediário).
- **Incremento 6C**: Precificadora manual no plano gratuito, persistência manual sem IDs fictícios de insumos/impressoras e interface funcional de checkout/planos.

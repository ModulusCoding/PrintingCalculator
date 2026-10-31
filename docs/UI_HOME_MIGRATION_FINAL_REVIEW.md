# Revisão final da migration Home — 28/10/2026

## Estado e limites

Revisada `supabase/migrations/20261028140000_home_dashboard_reads.sql`. **NÃO aplicada.** Não houve execução SQL, conexão Supabase, Docker/WSL, instalação, alteração de migration histórica, commit/push/deploy. Esta revisão trata do código local, não do estado instalado do PostgreSQL.

## Problemas confirmados e correções

1. Inventário usava `NOT can_access_enterprise(...)`: em lógica ternária, NULL não força a rejeição pelo IF. Substituído por `IS DISTINCT FROM TRUE`, rejeitando FALSE e NULL explicitamente. A identidade/contexto e o gate central de plano permanecem.
2. Recebimentos mensais incluíam movimentos futuros dentro do mês. Adicionado `p.effective_at <= anchor`, para receipt e refund, mantendo o mesmo `statement_timestamp()` retornado em `as_of`. Igual ao anchor entra; posterior não. As janelas mensais continuam `[início, próximo mês)` em São Paulo. Ajustadas as descrições no card, gráfico e relatório original.
3. Não havia índice declarado por empresa/data efetiva de pagamentos. Adicionado somente `order_payments_enterprise_effective_idx (enterprise_id,effective_at)`. Histórico por pedido/recorded_at não substitui esse acesso por intervalo efetivo. O índice é uma alteração de schema local, não escrita de dados de negócio pela RPC.

## Integridade financeira: hipótese de ocultação descartada no contrato atual

Fonte: `20261026184000_orders_stage72c4_payments.sql:37–69`.

- `orders_c4_financial` procura um pedido pela PK e empresa, faz LEFT JOIN com ledger e agrupamento pela identidade/atributos do pedido. Para pedido existente, mesmo sem pagamentos, produz um único grupo.
- Ausência de pedido causa `order_unavailable` (`P0002`), não retorno bem-sucedido vazio.
- Refund inválido/duplicado, líquido negativo ou acima do total causam `payment_balance_inconsistent` (`23514`).
- Há um único `RETURN QUERY SELECT`, sem FROM/filtro, emitindo exatamente uma linha. Não há caminho bem-sucedido de zero linhas no helper atual.
- Assim, `CROSS JOIN LATERAL` não oculta pedido silenciosamente sob esse contrato: retorna uma linha ou aborta a leitura. Uma exclusão concorrente visível ao helper pode causar erro, não total fictício.
- Cancelados continuam no input `WHERE o.enterprise_id=eid`; a exclusão está apenas no FILTER da soma de pendente. A função VOLATILE é avaliada para os pedidos da entrada, inclusive cancelados. Não foi movida a exclusão para WHERE nem recriada a fórmula de saldo.
- O helper **não** recebe corte temporal. O pendente continua baseado no ledger completo, incluindo movimentos futuros já registrados; somente a série de recebimentos efetivados usa o novo corte. Portanto, pendente e fluxo efetivo até o anchor não precisam reconciliar entre si como se fossem a mesma métrica.

## Locks e concorrência

`orders_c4_reader` (C4:333–348) e inventário Home usam a mesma chave `hashtextextended('modulus:enterprise-management:all-members',0)` e `pg_advisory_xact_lock`, antes de contexto/identidade/permissão. `orders_c4_financial` não adquire advisory lock nem row lock. Os wrappers de `can_access_enterprise`/predicado de plano examinados não adquirem advisory lock adicional.

Comandos financeiros C4 adquirem global → tentativa `orders:<command>:<eid>:<actor>:<attempt>` → receipt/linhas. Home só adquire global; não entra na sequência inversa tentativa → global. **Nenhuma inversão introduzida ou encontrada nesse caminho**; isso não é prova universal de ausência de deadlock em todo o sistema. Nenhum lock foi removido.

O global é exclusivo, constante e transacional: serializa inclusive empresas distintas. Percorrer ledgers completos sob esse lock pode aumentar latência/bloqueio. O anchor representa o início da instrução, inclusive se aguardar lock; não é recalculado após a espera. Funções VOLATILE e múltiplos statements não prometem snapshot universal único; escritores que não participem do protocolo não são protegidos apenas por esse advisory lock.

## Índices reaproveitados

- Orders schema `20261026160000...:90–95`: `(enterprise_id,created_at DESC,id DESC)` e `(enterprise_id,operational_status,created_at DESC,id DESC)` já cobrem prefixos solicitados, datas/lista recente/status. Nenhum índice adicional de Orders.
- Payments: UNIQUE por empresa/pedido/id, histórico por empresa/pedido/recorded_at e reversão parcial não fornecem o mesmo intervalo empresa/effective_at. Somente esse novo índice foi acrescentado.
- Product inventory `20261020000000...:17–20`: UNIQUE `(enterprise_id,product_id)` e índice de listagem com esse prefixo já permitem restringir empresa. Nenhum índice adicional. A redundância histórica entre UNIQUE e índice de listagem não foi alterada.

O planner pode escolher scan em agregações amplas e predicados de status negativos. Necessidade/utilização/benefício reais exigem EXPLAIN em PostgreSQL. O CREATE INDEX transacional comum pode bloquear escritas durante instalação: planejar janela conforme volume; não foi trocado por CONCURRENTLY dentro de BEGIN.

## Permissões e dependências verificadas nas fontes

- Dashboard delega a `private.orders_c4_reader()`: contexto business_ready, identidade interna, `sales.read` e empresa derivada da sessão, sem tenant fornecido pelo caller.
- Inventário exige `inventory.read` pelo helper central, agora fail-closed também para NULL.
- `20261026150000_pricing_actor_authorization.sql`: matriz owner/admin/operator para leitura, vínculo/usuário/empresa ativos, identidade e `plan_permission_allowed`.
- `20261026060000_plan_business_regularization.sql`: Free permite sales para owner, não inventory; plano selecionado necessário; somente intermediate atualmente paid permite operação paga, com restrição de equipe (`operators<=1`). Expiração/cancelamento não concede inventário. A Home não cria autorização paralela nem altera esses contratos.
- RPCs: `VOLATILE SECURITY DEFINER SET search_path=''`, owner postgres, funções/tabelas qualificadas; tabelas explicitamente filtradas por empresa. ACL revogada de PUBLIC/anon/authenticated/service_role e execute concedido somente a authenticated. Compatível com padrão C4/D1. O definer proprietário não depende de RLS para isolar empresa: filtros e autorização explícitos são necessários e preservados.
- Dependências: C4 (helpers), schema Orders/ledger, reservas (`reserved_balance`) e migrações de identidade/planos anteriores. A inspeção não demonstra presença/aplicação dessas dependências no banco.

## Significados preservados

- `stocked_products` conta posições com `balance>0`, uma posição por empresa/produto pelo UNIQUE. UI: “produtos com saldo físico”, não total de unidades ou “disponíveis”. Inclui totalmente reservado.
- Disponível = soma de `balance - reserved_balance`; reservado = soma de `reserved_balance`. Não confunde físico total com saldo livre; inclui posições de catálogo arquivado/excluído que conservem saldo.
- Vendas continuam valor negociado por criação, não entrega/status Pago. Recebimento não usa Asaas. Nenhum indicador de lucro foi adicionado.

## Validações locais executadas

- `node --test tests/home-dashboard.test.cjs`: **15 passaram**, incluindo novo corte antes/igual/depois do anchor, receipt/refund futuros, virada de mês, pendente sem corte, contratos fonte do singleton/erro C4, lock, autorização, índice e runtime com stubs.
- `npx tsc --noEmit`: passou.
- `npx eslint "components/dashboard/*.tsx" "tests/home-dashboard.test.cjs"`: passou.
- `npm run build`: passou, exit 0.
- `git diff --check`: passou (avisos LF/CRLF do checkout).

Testes de referência e regex de SQL **não executam SQL**; não comprovam sintaxe instalada, plano de execução, ACL efetiva, RLS, snapshot, nulidade real de helper, chamada lateral ou concorrência no PostgreSQL. Após instalação manual autorizada, testar diretamente credenciais/papéis/planos e tenants, ledger inválido em cancelado, zeros legítimos, movimentos efetivos futuros e no limite, índice/locks sob carga e rollback da instalação. Nenhuma homologação PostgreSQL ou visual é declarada.

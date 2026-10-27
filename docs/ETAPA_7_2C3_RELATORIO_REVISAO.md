# M7.2-C.3 — relatório para revisão manual

## Escopo e resolução do bloqueio

O responsável aprovou M1–M5 e, depois do bloqueio UUID/bigint, autorizou a coluna adicional `order_events.event_uuid`. A PK bigint identity não é convertida. A alternativa de UUID apenas em metadata foi descartada. Os cinco arquivos incrementais são candidatos à aplicação manual, não aplicados pelo agente. Nenhum SQL remoto foi executado.

## Arquivos e sequência

1. `supabase/migrations/20261026175500_orders_stage72c3_event_uuid.sql`: coluna UUID default gerado, NOT NULL, UNIQUE; backfill por ADD COLUMN, sem UPDATE/triggers desativados. Timestamp 175500 livre e anterior a 180000.
2. `supabase/migrations/20261026180000_orders_stage72c3a_transitions.sql`: matriz exata aprovada, sales.write, motivos, versão, evento/recibo; sem inventário.
3. `supabase/migrations/20261026181000_orders_stage72c3b_cancellation.sql`: sales.delete, liberação literal release, cancelamento atômico; sem movimento/settlement físico.
4. `supabase/migrations/20261026182000_orders_stage72c3c_reopening.sql`: sales.write, reabertura estrita, physical intermediate paid, disponibilidade agrupada integral e novos ciclos.
5. `supabase/migrations/20261026183000_orders_stage72c3d_delivery.sql`: sales.write, atendimento integral, consume, saída/settlement por reserva, identificação comum no UUID persistido do evento.

Contrato: `docs/ETAPA_7_2C3_CONTRATO_RPC_PEDIDOS.md`. Planejamento histórico recebeu nota de aprovação/resolução. Não foram redefinidas RPCs anteriores nem alteradas migrations históricas. Alterações históricas já existentes no workspace permanecem trabalho preexistente, não foram revertidas.

## Revisão estática

- Compatibilidade conferida contra A: trigger BEFORE UPDATE OR DELETE não intercepta rewrite de ADD COLUMN. Uma geração volátil por registro, NOT NULL e UNIQUE validados atomicamente; custo operacional de ACCESS EXCLUSIVE/rewrite/index/WAL documentado.
- RPCs retornam UUID real de evento via INSERT RETURNING; replay usa event_uuid, tenant, pedido, ator, tipo, versão e conteúdo, nunca compara UUID à PK bigint.
- B define delivery_operation_id uuid; unicidade por reserva/movimento/operação-item impede agregação indevida. Cada consumo usa seu retorno de saldo/versão sem segunda baixa, com tentativa interna própria.
- Contexto/autorização atuais precedem recibo. Replay precede estado/versão novos e entitlement físico da reabertura; pedido atual pode ter versão maior/status diferente. Entrega valida cadeia de reserva consumida/movimento/settlement e contagens.
- Locks físicos: conjunto completo de produtos → posições → reservas, ordenados, após pedido; reconciliação contra todas as reservas active por produto/empresa. Headroom de inventário por quantidade de chamadas.
- Global mutex preservado; resolve dados concorrentes de contexto/plano mas serializa throughput. Não se afirmou ausência provada de deadlocks.
- Revisão cruzada independente de compatibilidade/C3a e de C3b/C3c/C3d não encontrou novos defeitos concretos de fonte (tipos/colunas/ambiguidades de nomes/replay/ordem de locks); não foi execução PostgreSQL.
- Segurança: SECURITY DEFINER, postgres, search_path vazio, nomes qualificados e EXECUTE só authenticated. Sem grants DML, helpers novos, pagamentos, frontend ou alterações globais de auth/plano/permissão.

Preflights verificam dependências locais relevantes, mas não substituem comparação completa de definições instaladas. Nomes/tipos de constraints não provam seu conteúdo integral; coleta pg_get_functiondef e definições de constraints/triggers/ACL deve preceder aplicação pelo responsável.

## Testes e limites de evidência

Preparados:

- `supabase/tests/orders_stage72c3_source_checks.cjs`: assertions textuais de compatibilidade/identidade, matriz, motivos, segurança, replay, barreiras e ausência de segundo writer físico. Não é parser SQL.
- `supabase/tests/orders_stage72c3_structure_manual.sql`: catálogo/ACL/identidade/imutabilidade, read-only, **não executado**.
- `supabase/tests/orders_stage72c3_scenarios_manual.md`: backfill, navegador após integração, replay histórico/corrupção, autorização/tenant/downgrade, duas sessões, reconciliação, headroom e injeção de rollback, **não executados**.

Disponibilidade local: `Get-Command psql,pg_config,pg_format` não encontrou ferramentas no PATH nesta execução. Nenhum parser PostgreSQL/dependência foi instalado. Syntax/install, papéis reais, backfill em fixtures, funções, concorrência e rollback continuam **pendentes**; aplicação manual de A..C2 informada pelo responsável não é homologação.

Resultados finais executados nesta continuação:

- `node supabase/tests/orders_stage72c3_source_checks.cjs`: **PASS**, compatibilidade e quatro RPCs (assertions textuais somente).
- `node supabase/tests/orders_stage72c2_source_checks.cjs`: **PASS**, regressão de fonte C2/C1.

A execução anterior falhou intencionalmente por guard de bloqueio; isso não é resultado da versão final resolvida. Nenhum PASS acima significa sintaxe SQL, homologação funcional, segurança concorrente ou rollback aprovados. Inconsistência de agregado C3 usa 23514 alinhado ao finalizador B; histórico incompatível na reabertura usa order_item_stock_mismatch/P0001, ambos documentados no contrato.

## Antes da aplicação

Revisar em ordem; confirmar corpos efetivos A/B/B1/C1/C2, identity/ACL e helpers. Agendar lock/rewrite da tabela de eventos. Aplicar apenas por decisão do responsável. Executar testes PostgreSQL em desenvolvimento antes de homologar, preservar fixtures e evidências e só depois integrar frontend. Não remover constraints/triggers para contornar divergência; eventual nova incompatibilidade precisa decisão própria.

Nenhum commit, push, reset, deploy, aplicação de migration ou SQL remoto foi realizado pelo agente.

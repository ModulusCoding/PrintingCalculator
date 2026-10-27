# M7.2-C.2 — relatório de entrega para revisão manual

## Estado

A/B/B.1/C.1 foram informadas pelo responsável como aplicadas manualmente em desenvolvimento. Nenhum SQL remoto foi executado nesta sessão. C.2a/C.2b foram somente escritas em arquivos e não aplicadas. Testes funcionais e concorrentes adiados pelo responsável **não são testes aprovados**.

A divisão foi apresentada e aprovada antes da implementação:

- `supabase/migrations/20261026173000_orders_stage72c2a_stock_creation.sql`: redefine somente create_order, preservando assinatura, retorno e recibos C.1. Itens normalizados em array tipado local; snapshots após locks dos produtos; posições bloqueadas antes das reservas. Stock agrupado por produto: reserva integral de todas as linhas do grupo ou converte todas em demanda. make_to_order explícito permanece demanda.
- `supabase/migrations/20261026174000_orders_stage72c2b_stock_allocation.sql`: operação estreita de alocação integral de um item, com modo stock, versão de pedido, evento e recibo na mesma transação. Replay vincula resultado ao item, reserva e evento persistidos antes de avaliar nova versão/produto/estoque.

Não foram criadas tabelas, permissões globais, ledger de reserva alternativo ou helpers redundantes. O helper B mantém a quantidade integral e incrementa a versão do inventário por reserva. Não há baixa física, movimento, settlement, entrega, cancelamento, pagamento ou UI. Nenhuma migration histórica foi modificada nesta execução; alterações preexistentes nesses arquivos foram preservadas.

## Revisão final e C.2c

Criada `supabase/migrations/20261026175000_orders_stage72c2c_physical_edit_guard.sql`, redefinindo exclusivamente update_order. Mantém replay C1 antes das novas guardas e o bloco comercial restante. Valida versão antes de estado operacional; consulta histórico antes de modo físico; histórico rejeitado sem adquirir row locks de reserva prematuros. A consulta de itens existentes é tenant/order-scoped sob o lock do pedido. C.1 histórica não foi editada.

Defeito concreto corrigido na candidata C.2a: o alias de tabela `c` nas três operações de contador colidia com a variável record `c` do contexto (`enterprise_id` em ambos). Renomeado para `counter_entry`, evitando ambiguidade PL/pgSQL sob variable_conflict=error. Não mudou algoritmo de numeração. C.2b foi revisada e permaneceu sem alteração nesta execução; não foi identificado outro defeito concreto por revisão estática.

O teste de fonte agora compara literalmente o replay e todo o trecho comercial de C.2c com C.1, verifica a ordem das guardas e a ausência da colisão de alias C.2a. São verificações textuais, não homologação SQL. Cenários E01–E11 foram acrescentados ao roteiro funcional; catálogo estrutural verifica presença da guarda e retorno de update_order.

## Revisão estática realizada

- Leitura dos quatro contratos exigidos, migrations A/B/B.1/C.1, funções de auth/plano e fontes de RPCs de inventário/produtos.
- Conferência de assinatura do helper, pré-condições de item persistido, modos, incremento de reservado/versão e ausência de baixa física.
- Conferência dos comandos de recibo e evento existentes: allocate_stock / stock_allocated (from_status e to_status nulos).
- Revisão dos arrays tipados, FOREACH, FOUND, JSON/UUID/bigint do replay de alocação e tratamento transacional das falhas.
- Revisão da ordem produto → posição antes de reserva. Na criação, o pedido novo tem UUID privado da transação, sem lock tardio de pedido previamente compartilhado. Alocação bloqueia o pedido existente antes de produto/posição. Counter conserva a posição posterior aos produtos da C.1.
- `node supabase/tests/orders_stage72c2_source_checks.cjs`: passou. São assertions textuais limitadas, **não** parse ou execução PostgreSQL.
- `git diff --check`: sem erros de whitespace no diff rastreado; não valida SQL e não cobre por si só arquivos novos não rastreados.

## Pendências / limites conhecidos

1. Não há psql/pg_config/pg_format detectados no PATH. `docker info` falhou porque o pipe dockerDesktopLinuxEngine não existe. Não foram executados parse/install PostgreSQL, testes de roles/JWT, funcionais, de rollback ou concorrentes.
2. Catálogo remoto não consultado. A inspeção anterior foi informada pelo responsável; divergências entre arquivo local e funções efetivamente aplicadas continuam possíveis. Usar `orders_stage72c2_preflight_readonly.sql` manualmente, sem confundir isso com teste de escrita.
3. A segurança concorrente depende de todos os writers cooperarem com a barreira produto → posição e da ausência de DML direto privilegiado fora do protocolo. O mutex global limita throughput; não foi removido. Não há trigger de INSERT que sozinho mantenha a soma de reservas. Operações novas detectam inconsistência de agregado, não reparam histórico.
4. Limitação corrigida pela candidata C.2c: `update_order` passa a rejeitar qualquer item persistido stock/make_to_order, mesmo sem reservas, com physical_order_edit_unsupported/P0001. Histórico continua usando os erros anteriores. Não existe edição física preservando identidade nesta entrega, nem edição apenas de cabeçalho físico; futura operação separada depende de contrato próprio.
5. O validador histórico de recibo create é preservado. Valida identidade, estrutura, faixa e aritmética, mas não prova autenticidade de um snapshot financeiro histórico coerente adulterado por writer privilegiado. Compará-lo aos totais atuais quebraria replay após edição; esse endurecimento não foi inventado na C.2.
6. make_to_order sem reserva não protege produto de arquivamento. Alocação exige produto ainda válido; demanda não é reserva fictícia.
7. A view de reconciliação e as tabelas devem ser verificadas, inclusive ACLs efetivas de service_role. Nenhum novo DML ou inventory.write foi concedido.
8. Documento geral “Modulus — Documento de Projeto | 2026” não localizado. Políticas específicas foram aprovadas nesta conversa; nenhuma regra de estoque parcial foi introduzida silenciosamente.

## Gate de revisão

Revisar C.2a, C.2b e C.2c juntas e em ordem de timestamp. Executar preflight e testes estruturais manualmente; testar criação/alocação, erros, replay, reconciliação e disputa real de estoque em PostgreSQL descartável ou ambiente de desenvolvimento autorizado. Roteiro funcional em `supabase/tests/orders_stage72c2_functional_manual.md`.

**Entrega preparada para revisão de código, não homologação de integridade ou aprovação para produção.** Nenhum commit, push, reset, deploy, SQL remoto ou aplicação de migration foi realizado.

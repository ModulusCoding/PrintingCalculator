# M7.2-C.1 — Roteiro de concorrência manual

**Estado: preparado, não executado.** Usar banco descartável com migrations aprovadas, dois processos/sessões PostgreSQL e JWTs de duas sessões internas autorizadas. Não executar contra produção. Cada RPC é transacional; mantenha ambas as sessões sincronizadas com barreira de teste para disparar ao mesmo tempo.

## Limite histórico Free (Aprendiz)

1. Preparar empresa Free com exatamente dois pedidos existentes e contexto owner elegível.
2. Disparar `create_order` simultaneamente em sessões A/B com attempt IDs distintos e payloads válidos.
3. Resultado aceitável: uma criação confirma; a outra falha `plan_limit_reached`; total histórico permanece exatamente três.
4. Repetir com três pedidos já existentes: ambas falham e nenhuma linha auxiliar é persistida.

## Tentativa idempotente concorrente

1. Usar mesmo ator/empresa/attempt ID e exatamente o mesmo payload nas duas sessões.
2. Ambas devem retornar os mesmos IDs/número/valores; deve existir um pedido, um evento e um recibo.
3. Repetir simultaneamente com payloads diferentes: uma tentativa pode vencer; a outra deve receber `idempotency_conflict`; somente um conjunto de efeitos deve existir.

## Numeração

1. Em tenant Visionário, disparar pelo menos duas criações distintas em paralelo.
2. Verificar números distintos, incremento serializado pelo registro `order_number_counters`, nenhuma duplicação e nenhuma dependência de `MAX()+1`.

## Edição e histórico de reservas

1. Em pedidos descartáveis com reservation states `active`, `released`, e `consumed`, chamar update.
2. `active` deve retornar `active_reservation_edit_unsupported`; released/consumed devem retornar
   `reservation_history_edit_unsupported`. Em todos os casos IDs de itens e reservas/FKs ficam iguais.
3. Pedido sem qualquer histórico de reserva pode prosseguir pela edição comercial.

## Edição otimista

1. Ler a mesma versão de um pedido não terminal em duas sessões.
2. Disparar dois `update_order` com `expected_version` idêntica.
3. Exatamente um pode confirmar; o outro deve falhar `version_conflict`. Itens/totais/evento/recibo precisam corresponder somente ao vencedor.

## Falha atômica

Com fixture/trigger temporário restrito ao banco descartável, induzir falha depois da atualização do cabeçalho ou inserção de itens. Confirmar rollback de contador (create), header, itens antigos/novos, versão, evento e recibo.

## Escopo de estoque

C.1 deliberadamente rejeita `stock` e `make_to_order` com `stock_integration_unavailable`; não existe teste de reserva concorrente nesta migration. A integração só pode ser reintroduzida após verificar catálogo B/B.1 e demonstrar product → positions locks contra movimento manual, reserva e archive/delete sob sessões simultâneas.

# Etapa 7.2 — Implementação estrutural M7.2-A

**Projeto:** Modulus Hub  
**Data:** 26/10/2026  
**Status:** implementação estrutural preparada para revisão; não aplicada ao banco.

## 1. Escopo e decisão

Esta nota registra a entrega M7.2-A. As decisões comerciais D1–D14 consolidadas na especificação original permanecem vigentes; esta implementação não altera tais decisões nem desenvolve RPCs, Server Actions, UI ou integração operacional com estoque.

A migration `supabase/migrations/20261026160000_orders_stage72a_schema.sql` é aditiva e contém:

- `public.orders`: número por empresa, status canônico, versão, snapshot do comprador, dados comerciais/financeiros BRL e timestamps de ciclo de vida. Referência composta ao membro criador.
- `public.order_number_counters`: uma linha por empresa para futura serialização de numeração sob lock. Ainda não há RPC de inicialização/incremento; `MAX(number)+1` não deve ser usado.
- `public.order_items`: linhas e snapshots, preço negociado, origem e modo de atendimento; FKs compostas ao pedido e ao produto, preservando isolamento empresarial.
- `public.order_events`: histórico append-only com ator, estados, versão, timestamp, motivo e metadados limitados.
- `public.order_payments`: ledger append-only; estorno referencia um recebimento do mesmo pedido e empresa.
- `public.order_stock_reservations`: ciclos históricos de reserva, FK composta assegurando que pedido, item e produto correspondam, além de índice único parcial para apenas uma reserva ativa por item.
- `private.order_operation_receipts`: chave `(enterprise_id, actor_id, command_name, attempt_id)`, hash do payload, pedido opcional, resultado mínimo limitado e timestamp.

## 2. Tipos, constraints e segurança

Valores monetários usam `numeric` exato, com checks explícitos de faixa, finitude e escala de duas casas, evitando arredondamento binário. O desconto congela tipo/entrada/base/valor aplicado; o check exige base igual ao subtotal, impede desconto acima do subtotal e calcula percentual com `round(numeric, 2)`. `order_items` não exige produto para item personalizado; produto catalogado é tenant-safe. O schema permite item custom associado a produto e modo físico quando aplicável, conforme D5/D12.

Todas as tabelas públicas novas habilitam RLS sem policies permissivas (default-deny). Privilégios de tabela são revogados de `PUBLIC`, `anon` e `authenticated`; recibos privados não têm acesso direto para roles de API, inclusive `service_role`. Eventos e pagamentos têm triggers de imutabilidade; pedidos têm proteção contra hard delete. Reservas não podem ser apagadas e o trigger restringe atualização a `active → released|consumed`, protegendo identidade/quantidade. Futuras RPCs precisarão ser estreitas, com autorização central, owner/search_path/grants explícitos e não podem conceder DML direto às roles clientes.

## 3. Limite de inventário e dependências

Não foi adicionada FK a `product_inventory` ou `product_inventory_movements`, nem alterado estoque. A migration local de inventário `20261020000000_finished_product_inventory.sql` se declara “NEW / UNAPPLIED”; sem acesso remoto de catálogo, sua existência no banco-alvo não está confirmada. Não presumir estado remoto a partir do repositório. A M7.2-B deverá inspecionar o catálogo efetivo e então introduzir `reserved_balance`, guards no writer de estoque e vínculo tenant-safe de liquidação (`order_stock_settlements`) às movimentações verificadas.

- **M7.2-B:** confirmar inventário remoto, locks/grants/triggers; adicionar reserva agregada, prevenção de oversell, allocation/release/consume e vínculo de baixa sem alterar legado indevidamente.
- **M7.2-C:** implementar RPCs autorizadas, cálculo monetário agregado, cota histórica Aprendiz, bloqueio do counter, idempotência e operações de pedido; respeitar integralmente D1–D14, inclusive reabertura cancelada atômica sob Visionário quando há estoque controlado.
- **M7.2-D:** consultas e integração UI/Actions com `sales.read/write`, sem DML direto.

Nenhuma alteração foi feita em `closed_sales`, inventário, produtos, preços, auth, planos, matriz de permissões ou migrations históricas.

## 4. Validação e pendências

Foi preparado `supabase/tests/orders_stage72a_structure_manual.sql`, somente leitura, para verificar catálogos após uma aplicação controlada em banco descartável/desenvolvimento. Ele verifica tabelas, RLS, ausência de policies, grants de tabela a `anon`/`authenticated`, FKs compostas, checks, índice parcial e triggers. Não foi executado. Não comprova isolamento efetivo por role; testes com `authenticated` e `anon` seguem pendentes.

A migration não foi executada por PostgreSQL nem verificada contra o catálogo remoto. Compatibilidade de objetos/alvos, owners e grants remotos permanece pendente de inspeção autorizada em modo leitura. A migration e o teste estrutural estão preparados para revisão, não declarados aprovados.

# Etapa 7.2 — Contrato técnico e implementação estrutural do domínio Pedidos

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

## 4. Implementação preparada M7.2-B (26/10/2026)

Foi criada a migration `supabase/migrations/20261026170000_orders_stage72b_inventory_reservations.sql`, ainda não aplicada. Ela pressupõe a estrutura M7.2-A e os objetos de inventário/produto inspecionados localmente; preflight confere `product_inventory.balance bigint`, `products.active/deleted_at`, chave/constraints de movimentações e assinaturas RPC antes de continuar. Não substitui nem reaplica A. A execução informada pelo responsável no Supabase de desenvolvimento é contexto fornecido; não foi verificada por consulta nesta sessão.

A migration adiciona `reserved_balance bigint NOT NULL DEFAULT 0` (backfill lógico em zero sem modificar saldo físico) e check `0 <= reserved_balance <= balance`; disponibilidade é expressão derivada em view sem grants diretos. A view privada `order_stock_reservation_reconciliation` compara agregado e soma ativa, inclusive divergências sem inventário correspondente não são auto-corrigidas (ver consulta/relatório e limitações operacionais). Movimentações preservam a assinatura e o shape da RPC atual, versionamento, retry idempotente e códigos existentes; saídas/ajustes validam saldo disponível sob produto → posição. Novos helpers `private.reserve_order_item_stock` e `private.finalize_order_item_reservation` são definer, `search_path=''`, ownership postgres e sem EXECUTE para roles API. A chamada exige que RPC autorizada de Pedidos resolva contexto, entitlement/plan mutex e pedido antes de produto/posição; os helpers não são autoridade de acesso empresarial.

Bloqueios por reserva ativa são adicionados ao archive e soft-delete, além de triggers defensivos de produto e item. As guardas de produto verificam apenas alterações de `active/deleted_at`; edição de nome, descrição, preço e imagem não é bloqueada. Trigger de item impede alterar produto/quantidade/modo enquanto a reserva estiver ativa; M7.2-C deve liberar/finalizar e atualizar/recriar atomicamente conforme a operação autorizada. Settlement `public.order_stock_settlements` liga pedido/item/reserva/movimento/produto/quantidade por FKs compostas e uniques para liquidação por reserva/movimento; redundantes UNIQUEs tornam explícitos os alvos requeridos pela FK. A tabela é RLS default-deny, sem DML de API e append-only.

**Pendências e riscos:** não houve catálogo remoto read-only disponível. Funções de inventário em migrations locais aparecem em arquivos com comentários “NEW / UNAPPLIED”; assinatura, corpo, ACL, owner e triggers implantados não foram confirmados, mesmo com o contexto de que A/B foram executadas. O preflight detecta algumas divergências, mas não comprova igualdade semântica completa. A definição redefinida de archive/delete exige que o schema efetivo tenha `stage6b_product_visible`, receipts/tabelas auxiliares e colunas esperadas; revisar seus ACLs atuais antes de aplicação. Um DELETE incompatível com action atual é exceção `product_has_active_reservations`; a action hoje não traduz esse código, então a interface pode reportar erro genérico até mudança client-side aprovada. M7.2-C deve fornecer protocolo transacional/receipt/atores e testes de downgrade; a etapa atual não cria RPC pública de Pedido, não realiza baixa e não implementa reabertura.

A ordem pretendida é contexto → plano sob mutex quando aplicável → pedido → produtos ordenados → posições ordenadas → reservations → ledger/event/receipt. Movimento manual mantém contexto existente → produto → posição. Archive/delete usa contexto → produto; trigger examina reservas sem bloquear pedidos, evitando inversão. O guard de produto bloqueia no produto/posição sob o mesmo protocolo necessário ao reserve helper. Não foram executados testes concorrentes; ausência de deadlocks/oversell não está comprovada.

## 5. Revisão corretiva M7.2-B

A revisão corretiva encontrou uma divergência de aridade no helper de reserva e corrigiu `ALTER`, `REVOKE` e assertion para cinco argumentos `(uuid,uuid,uuid,uuid,bigint)`. O rascunho foi reduzido para não redefinir RPCs públicas com corpos inferidos sem catálogo remoto. Isso evita apagar silenciosamente feature gates, janela de plano, receipt/idempotência, ACL e semânticas efetivas. Como consequência, o rascunho ainda NÃO protege movimentação/arquivamento/exclusão por reservas; não é candidato a aplicação até esses corpos serem comparados e estendidos com segurança.

A reserva exige chamador M7.2-C que resolva ator/empresa/permissão e entitlement, mantenha mutex de plano, bloqueie pedido e adquira produtos/posições em ordem. O helper revalida o item persistido com produto/quantidade/modo e não inventa posição se ela não existe. Cancelamento/liberação e reabertura podem manter ciclos históricos via índice parcial; o trigger M7.2-B impede alterar identidade física de item enquanto reserva está ativa. Entrega requer transação M7.2-C envolvendo consumo, movimento/ledger e settlement; o helper sozinho não realiza baixa nem vínculo.

Arquivos de validação: `supabase/tests/orders_stage72b_structure_manual.sql` (assertions de catálogo pós-aplicação), `supabase/tests/orders_stage72b_functional_manual.sql` (cenários não executados, incluindo concorrência real), `supabase/tests/orders_stage72b_remote_preflight_readonly.sql` (consultas de catálogo read-only a executar manualmente) e `docs/ETAPA_7_2B_COMPATIBILIDADE_RPCS.md` (matriz antes/depois). Não houve execução PostgreSQL nem acesso remoto nesta sessão. O rascunho segue **não aprovado**.

## 6. Estado informado de aplicação e compatibilização M7.2-B.1

O responsável informou que M7.2-A e M7.2-B foram aplicadas manualmente no Supabase de desenvolvimento. Esse estado não foi verificado por conexão nesta execução. A migration B.1 abaixo continua candidata, não aplicada, e aguarda aprovação manual.

Foi criada a migration `supabase/migrations/20261026171000_orders_stage72b1_reservation_guards.sql`, ainda não aplicada, com base nos corpos JSON `pg_get_functiondef` das três RPCs efetivas fornecidos pelo responsável nesta conversa (o arquivo .txt foi desconsiderado conforme solicitado). Ela preserva assinaturas e response shapes e adiciona guardas de reserva: saída/ajuste para baixo mantém `balance >= reserved_balance` e retorna `insufficient_stock`; archive efetivo e delete consultam reservas ativas após os locks produto → posição. A função de movimento mantém contexto, recuperação idempotente, checagens de versão/no_change e gravação de ledger. Delete mantém receipt recovery antes de visibilidade, checks de janela/versão/saldo/upload e receipt final; o bloqueio por saldo físico continua precedendo o novo erro de reserva. ACL não recebe novos grants; `CREATE OR REPLACE` conserva ACL, e owner/search_path são reafirmados como postgres/vazio segundo a evidência fornecida.

A matriz detalhada está em `docs/ETAPA_7_2B_COMPATIBILIDADE_RPCS.md`; testes de regressão em `supabase/tests/orders_stage72b1_regression_manual.sql`. As migrations M7.2-A e M7.2-B foram preservadas. Erro de archive/delete `product_has_active_reservations` ainda não é mapeado pela Server Action de Produtos, e nenhuma alteração de frontend foi feita.

**Locks pendentes de comprovação:** reserve, manual movement e archive/delete precisam serializar primeiro no produto; movimento/archive/delete depois usam posição. Comandos de Pedidos devem ainda obter contexto/plano/pedido antes de produtos ordenados e posições ordenadas. A B.1 não cria trigger que tome locks adicionais, para não inverter a hierarquia. O helper privado de reserva existente em B não adquire por si só o lock de produto; a implementação M7.2-C deve impor esse protocolo nos chamadores e impedir DML direto por roles API. Até isso ocorrer, a segurança concorrente não está comprovada.

Os corpos foram fornecidos pelo usuário, mas não consultados diretamente no banco nesta execução. Não houve parse/execução SQL nem testes sequenciais ou concorrentes. A migration aguarda revisão e não deve ser aplicada até confirmar catálogo efetivo de A/B, owners/grants e executar validação PostgreSQL isolada.

## 7. M7.2-C.1 — núcleo de criação/edição preparado

Foi preparada `supabase/migrations/20261026172000_orders_stage72c1_create_edit.sql`, não aplicada. Contrato e limites estão em `docs/ETAPA_7_2C1_CONTRATO_RPC_PEDIDOS.md`; asserts estruturais em `supabase/tests/orders_stage72c1_structure_manual.sql`; cenários funcionais em `supabase/tests/orders_stage72c1_functional_manual.sql` e `supabase/tests/orders_stage72c1_regression.sql`; roteiro concorrente em `supabase/tests/orders_stage72c1_concurrency_manual.md`.

Por confirmação do responsável nesta conversa, cota Aprendiz histórica de três, cálculos fixos/percentuais e dados de C.1 foram tratados como decisões específicas desta etapa. O Documento geral de Projeto 2026 não foi encontrado localmente. Para falhar fechado enquanto catálogo B/B.1 e concorrência não estão comprovados, C.1 rejeita `stock` e `make_to_order` (`stock_integration_unavailable`) e aceita somente `untracked`; não escreve inventário/reservas. Edição com reserva ativa falha (`active_reservation_edit_unsupported`) e com qualquer reserva histórica falha (`reservation_history_edit_unsupported`), sem liberar/apagar reservas. Edição sem histórico substitui itens integralmente e permite todo status não terminal; a documentação de RPC explica a ambiguidade de congelamento de fases e a ausência de diffs históricos de item.

Nenhum teste PostgreSQL/funcional/concorrente foi executado. A migration continua aguardando revisão manual e verificação de dependências/grants no catálogo efetivo. Não modificar A/B/B.1 aplicada conforme informado.

## 8. Atualização M7.2-C.2 — estado informado e escopo incremental

O responsável informou, na solicitação C.2, que A/B/B.1/C.1 foram aplicadas manualmente no Supabase de desenvolvimento e tiveram permissões, constraints e triggers inspecionados. As indicações de “não aplicada” nas seções anteriores são registros históricos das respectivas entregas, não o estado informado atual. Esta execução não consultou o banco remoto. Testes funcionais e concorrentes foram adiados por decisão do responsável; **não foram aprovados**.

A divisão em C.2a (criação física) e C.2b (alocação posterior) foi apresentada e aprovada antes da implementação. Os novos arquivos `20261026173000_orders_stage72c2a_stock_creation.sql` e `20261026174000_orders_stage72c2b_stock_allocation.sql` são candidatos para revisão conjunta, não aplicados pelo agente. Contrato e riscos: `docs/ETAPA_7_2C2_CONTRATO_RPC_PEDIDOS.md`. Não modificam migrations históricas, frontend, matriz de permissões ou ledger físico.

Correção de precisão documental: as referências anteriores a triggers defensivos de produto/item não são comprovadas pelas migrations locais B/B.1. A proteção de produto/saída está nos corpos das RPCs B.1; reserva e agregado dependem do helper privado e do protocolo dos chamadores, não de um trigger de INSERT de reserva. Conferir triggers efetivos manualmente com o preflight C.2; não assumir proteção inexistente.

### Revisão final C.2c

A candidata incremental `20261026175000_orders_stage72c2c_physical_edit_guard.sql` redefine somente `update_order`: replay histórico preservado, versão antes de estado, histórico de reservas antes de guarda dos modos físicos existentes. Item `stock` ou `make_to_order` impede substituição integral (`physical_order_edit_unsupported`/P0001), mesmo sem reservas e com payload novo `untracked`. A consulta de histórico sob lock do pedido é de rejeição e não toma row locks de reserva antes de produtos/posições. Edição inteiramente untracked continua pelo contrato comercial C1. A revisão corrigiu apenas o alias SQL do contador na candidata C.2a (colisão com record de contexto `c`); C.2b não precisou mudar. As três candidatas seguem não aplicadas; SQL/roles/rollback/concorrência continuam pendentes de PostgreSQL real.

## 9. Validação e pendências históricas

Foi preparado `supabase/tests/orders_stage72a_structure_manual.sql`, somente leitura, para verificar catálogos após uma aplicação controlada em banco descartável/desenvolvimento. Ele verifica tabelas, RLS, ausência de policies, grants de tabela a `anon`/`authenticated`, FKs compostas, checks, índice parcial e triggers. Não foi executado. Não comprova isolamento efetivo por role; testes com `authenticated` e `anon` seguem pendentes.

A migration não foi executada por PostgreSQL nem verificada contra o catálogo remoto. Compatibilidade de objetos/alvos, owners e grants remotos permanece pendente de inspeção autorizada em modo leitura. A migration e o teste estrutural estão preparados para revisão, não declarados aprovados.

# M7.3 — Análise de integração de Pedidos com Kanban FLEX

Data: 27/10/2026. **Modo: análise e planejamento. Nenhuma implementação aprovada ou realizada.**

## A. Resumo executivo

**O Kanban já existe.** Há lista, sete colunas com drag-and-drop, paginação por coluna, drawer de detalhes, seletor acessível de status, modal de motivo, criação e edição comercial. M7.3 é uma adaptação dos contratos C.3 para FLEX, seguida da integração dos comandos especiais e da leitura física; não exige substituir todo o módulo.

Prontidão: **parcial, com bloqueio de rastreabilidade para implementar contra o backend aplicado**. O responsável informa que aplicou FLEX manualmente, dividida em partes e com correções. Essa informação é aceita como relato de instalação, não como homologação funcional. Não houve consulta ao Supabase. Não foram encontrados arquivos de partes, manifesto de execução, hashes correspondentes ou export de definições instaladas que permitam confrontar o conteúdo executado com o arquivo local.

Fonte candidata de contratos: `supabase/migrations/20261027120000_orders_stage72flex_delivery_cycles.sql` e últimas definições históricas locais. Hash SHA-256 dos bytes locais analisados:

```text
de7ae8f8f2af032897cab82c77bdfac90ec76dde61d451f26b149db42a5bcb2f
126827 bytes
```

Esse hash identifica apenas o arquivo local desta análise. Não certifica o banco nem as partes aplicadas. As referências de linhas abaixo são desse snapshot.

### Bloqueio T0 — evidência do SQL efetivamente aplicado

Antes de implementar mutações FLEX, o responsável deve fornecer as partes **exatas**, na ordem executada, com correções, delimitadores e fronteiras de transação, além de evidência de término/commit. Comparar os corpos finais das sete RPCs, helpers de cobertura/validação, tabelas, constraints, ACLs e triggers com o arquivo local. Se houver export de catálogo produzido pelo responsável, analisá-lo offline. Não basta a última parte não ter erro: execução fragmentada pode ter fronteiras de transação distintas do arquivo transacional único.

Não afirmamos divergência comprovada entre SQL remoto e local: **essa equivalência não é verificável com os artefatos presentes**. Existe, porém, divergência local comprovada entre documentação e arquivo: a FLEX atual contém **três transações independentes** (`BEGIN` em 3/464/1162 e `COMMIT` em 461/1159/1799), além do aviso de instalação multipartes nas linhas 1–2. Uma falha no terceiro bloco não desfaz os dois anteriores; entre commits pode existir schema/RPCs híbridos. Mesmo executar o arquivo inteiro não torna esses três blocos atomicamente reversíveis. Não reexecutar o arquivo para “confirmar”: CREATEs não são genericamente idempotentes. O planejamento abaixo é condicional ao contrato local. Não corrigir ou reaplicar migration nesta etapa.

O teste estático com título “transactional” verifica começo/fim, mas não rejeita COMMIT intermediário; seu PASS não demonstra atomicidade integral. `docs/ETAPA_7_2FLEX_BACKEND.md` e o README manual ainda descrevem instalação integral/atomicidade de forma incompatível com esse snapshot. O README manual conserva também `<!-- MIGRATION_CHAIN -->` no lugar da lista prometida; a cadeia fictícia detalhada no relatório anterior da conversa não deve ser usada como inventário real. Esses artefatos precisam de revisão específica autorizada, sem modificá-los nesta análise.

A documentação `docs/ETAPA_7_2FLEX_BACKEND.md:3–67` ainda registra candidato não aplicado e procedimentos anteriores; está desatualizada em relação ao relato atual de instalação. Este relatório registra a diferença sem sobrescrever aquele histórico. O relatório anterior da conversa também não substitui a inspeção: por exemplo, a guarda por `previous_product` já evita comparar produtos diferentes; a afirmação antiga de que isso ocorria automaticamente não é evidência técnica. Continuidade histórica e múltiplos produtos precisam ser homologados com o SQL realmente instalado, não inferidos da narrativa anterior.

### Achados prioritários

1. `lib/orders/transitions.ts:5–11` ainda limita transições à matriz C.3; FLEX permite todos os pares distintos dos cinco estados comuns e exige motivo apenas ao retroceder na ordem.
2. Só criação, edição e transição têm Server Actions de Pedidos. Entrega, undo, alocação, cancelamento, reabertura e leitura física não estão integrados.
3. A UI já separa status operacional e financeiro, mas ainda não mostra obrigações físicas, confirmação vigente ou elegibilidade D4.
4. O controller conserva o attempt/payload em memória e não move cartões otimisticamente: boa base, mas perde tentativas no reload.
5. `sales.delete` precisa ser tratado separadamente de `sales.write`. Operator pode escrever, mas não cancelar nem estornar recebimentos.
6. Integração física não deve exigir `inventory.write` na action de Pedidos: usar a permissão `sales.*` correspondente e deixar o contrato SQL avaliar plano e exceções históricas.
7. Não há histórico operacional público de Pedidos localizado; não prometer timeline completa usando SELECT direto em tabelas protegidas.

## B. Inventário do frontend

Estado “existente” abaixo significa código encontrado, não homologação de produção. Caminhos previstos de arquivos novos na seção J são propostas, não arquivos existentes.

| Arquivo real | Responsabilidade / contrato consumido | Estado atual | Reutilização e alteração necessária |
|---|---|---|---|
| `app/(authenticated)/admin/orders/page.tsx` | `requireBusinessContext(sales.read)`, `listOrders`, `getOrderDetails`; lista padrão e Kanban por `view=kanban` | Parcial para FLEX | Manter Server Component dinâmico; acrescentar capacidade delete e leitura física do selecionado. Corrigir tratamento de erro Auth; evitar gate pago para leitura de pedidos. |
| `components/admin/orders/OrdersView.tsx` | Busca, filtros, tabela, drawer por `?orderId=`, labels de sete estados, resumo financeiro | Existente; sem comandos especiais | Preservar lista/drawer/URL. Acrescentar área física, ações específicas e avisos. Separar futuras responsabilidades sem reescrever tudo. |
| `components/admin/orders/KanbanBoard.tsx` | `@dnd-kit/react`; `Order`, `OrdersResult`, callbacks `onMove` e seleção | Existente, regras C.3 | Reutilizar colunas/cartões/contagens/paginação. Substituir roteamento de drop; estados finais não são mais “imutáveis para sempre”: saída deve abrir fluxo específico, não transição genérica. |
| `components/admin/orders/OrderStatusSelector.tsx` | `destinations`, controller; aviso Pago ≠ recebimento; `TransitionFeedback` com modal de motivo | Parcial | Manter alternativa ao arraste; incluir ações especiais separadas. Aprimorar foco, Escape global, restauração de foco e feedback. |
| `components/admin/orders/useOrderTransitions.ts` | `transitionOrderAction`; UUID, bloqueio por pedido, retry exato e `router.refresh()` | Parcial | Reutilizar conceito de comando pendente; ampliar coordenador por pedido, classificação de falhas e persistência aprovada. Evitar controllers independentes que aceitem dois comandos simultâneos no mesmo pedido. |
| `lib/orders/transitions.ts` | Matriz C.3, `destinations`, `canTransition`, `needsReason`, `dropDestination`, Zod de input | Incompatível com FLEX | Substituir apenas matriz e cálculo de retrocesso; separar destinos comuns do dispatcher de ações especiais. |
| `lib/orders/actions.ts` | Leitores server-only `list_orders`, `get_order_details`, `get_order_items`; tipos inferidos | Parcial | Acrescentar leitor físico com schema runtime e estado de erro explícito; validar respostas completas, versão e enums sem defaults falsos. Não é módulo de Server Actions: não possui `use server`. |
| `lib/orders/write-actions.ts` | Actions de criação/edição e transição, schemas Zod, mapa privado de erros, revalidação | Parcial | Padrão reaproveitável para cinco mutações ausentes, com permissão e resultado específicos; sem segundo autorizador. |
| `lib/orders/write-schema.ts` | Payload comercial, decimais canônicos, estimativa com bigint/centavos | Existente | Preservar cálculo apenas estimativo e proibições de edição física. Não usar para derivar saldo físico. |
| `app/(authenticated)/admin/orders/new/page.tsx` | Plano + `OrderForm`; Aprendiz até três pedidos históricos | Existente | Preservar `intermediate/paid` para seleção de atendimento físico novo, sem aplicar esse bloqueio à conclusão histórica. |
| `app/(authenticated)/admin/orders/[orderId]/edit/page.tsx` | UUID, leitura, bloqueio terminal/modo físico; key pedido:versão | Existente com limites C.2c | Não ampliar edição física como efeito colateral de FLEX; backend ainda restringe histórico de reservas. |
| `components/admin/orders/OrderForm.tsx` | Cria/edita, catálogo via `searchProductsAction`, itens custom, stock/make_to_order/untracked | Existente | Reutilizar busca, validação, freeze de payload/retry. A criação é uma operação distinta do Kanban. Não reusar formulário para compensar estoque. |
| `lib/pricing/persistence-actions.ts:73–91` | `searchProductsAction`, pesquisa de produtos ativos da empresa | Existente | Reutilizar seleção de produto, não como prova de disponibilidade/reserva ou janela de plano. |
| `lib/auth/context.ts` | `auth.getUser()`, RPC `get_my_access_context`, permissões e `requireBusinessContext` | Existente | Reusar sem novo sistema de roles. `AuthContextError.code`, não string de mensagem inventada, deve orientar erro da página. |
| `lib/plans/permission-capabilities.ts` e `lib/plans` | Gating central de acesso/plano; `sales.*` não exige Visionário automaticamente | Existente | Preservar distinção leitura/conclusão histórica versus nova integração física. |
| `lib/supabase/server.ts` | Cliente SSR com sessão/cookies | Existente | Reusar cliente de usuário; nunca service_role nem enterprise_id confiável vindo do cartão. |
| `components/inventory/MovementForm.tsx` | Confirmação, preview e retry de movimentação manual | Existente | Reusar padrões de UX/erro, **não** chamar sua action para entregar/desfazer pedido. |
| `components/inventory/ProductInventoryFilters.tsx`, `ProductInventoryTable.tsx` | Lista e filtros de inventário | Existente | Links e apresentação podem orientar consulta; saldo mostrado não representa necessariamente disponível após reservas. |
| `lib/inventory/actions.ts`, `schemas.ts`, `validation.ts` | Leituras e `move_product_inventory`; `inventory.read/write` | Existente | Reusar parsing/estilo, não permissão/endpoint nas operações de Pedidos; revisar invalidação cruzada. |
| `app/(authenticated)/estoque/produtos/page.tsx`, `[id]/page.tsx` | Estoque pronto, movimentos/histórico por produto | Existente | Destino de consulta condicionado a plano/permissão; o fluxo de pedidos não deve depender de abrir módulo pago para concluir cobertura histórica. |
| `app/(authenticated)/AuthenticatedShell.tsx`, `app/globals.css` | Navegação responsiva, Pedidos, skip link, tokens e Space Grotesk | Existente | Reusar shell e identidade. Tokens oficiais primary `#2b00ff`, dark `#152336`, light `#a6b4ff`, accent `#ff4e26`; Pedidos usa também `#5852ff/#3d32e6`. Evitar redesign geral. |
| `app/(authenticated)/home/page.tsx`, `admin/page.tsx`, `lib/catalogs/actions.ts` | Boas-vindas e contagens de catálogos/produtos | Sem dashboard de Pedidos | Não há KPI de pedidos a invalidar hoje. Não criar métricas novas nem somar só páginas visíveis. |
| `lib/orders/write.test.cjs` | VM/mocks: schemas, actions, controller e matriz C.3 | Existente | Atualizar testes de matriz; ampliar contratos e resultado incerto. Não é teste PostgreSQL nem navegador. |

### Ausências e limites importantes

- Não existe rota dedicada `/admin/orders/[orderId]` de detalhes: drawer usa a query `orderId` em `/admin/orders`.
- Não foram localizados hooks externos de Pedidos além do hook co-localizado acima, nem uma biblioteca central de `Dialog/Button/Badge` pronta para supor reutilização automática.
- Não foram localizados UI/actions de `record_order_payment`, `reverse_order_payment`, histórico financeiro ou eventos operacionais no novo módulo. Resumo financeiro existe; movimentação financeira não.
- `app/(authenticated)/admin/sales/page.tsx` e `lib/sales/actions.ts` são legado `closed_sales`, condicionado por `lib/legacy-gate.ts`. Não reutilizar inserts/updates legados como pagamentos ou comandos do novo módulo.
- Kanban carrega sete chamadas paginadas independentes (10 por coluna), não um snapshot transacional único. Detalhe/itens também são lidos em chamadas independentes. Movimento concorrente pode causar exibição temporariamente desigual entre consultas; comando usa versão e é autoritativo.
- Busca/filtros/páginas já vivem na URL; preservar `view`, `search`, `status`, `page_<status>` e `orderId`. Confirmar destino móvel após mudança de coluna sem perder contexto.

## C. Matriz de contratos

### C.1 Convenções e fonte

A seguir, nomes SQL são exatos; apelidos de tuplas servem apenas para evitar repetição. Não são novos tipos no banco.

- `A = p_attempt_id uuid`, `O = p_order_id uuid`, `V = p_expected_version bigint`.
- `R = (status text, order_id uuid, operational_status text, version bigint, event_id uuid)`.
- `W = (status text, order_id uuid, display_number bigint, version bigint, subtotal numeric, discount_amount numeric, shipping_amount numeric, total_amount numeric)`.
- Todos os parâmetros sem `DEFAULT` são obrigatórios no payload PostgREST, mesmo quando um campo aceita SQL NULL.
- Commands usam contexto `business_ready`, empresa/ator derivados, avaliador central e cliente autenticado. Roles UI não substituem verificação SQL. `sales.delete` não é sinônimo de `sales.write`.
- Mesma tentativa é escopada por empresa, ator, comando e UUID; payload bruto/hash divergente produz conflito. Mudança de ator não é retry idempotente do mesmo recibo.
- Replay autorizado precede os gates de estado/versão de uma operação nova, mas não elimina autenticação, identidade empresarial ou validação da evidência. Retorna snapshot histórico, não estado atual; não atualizar cartão diretamente usando snapshot de replay antigo.
- Novas mutações de pedido incrementam sua versão uma vez; alocação/financeiro também a alteram. Inteiros seguros e limites precisam ser validados na fronteira TS; movimentos usam versão própria de inventário, que não deve ser enviada no lugar da versão do pedido.
- Nenhuma das sete RPCs FLEX cria recebimento/estorno. Pago operacional não altera C.4.

### C.2 RPCs FLEX — assinatura, retorno e regras

| RPC e assinatura exata | Retorno | Permissão / plano / estado novo | Efeito e integração |
|---|---|---|---|
| `transition_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_target_status text,p_reason text DEFAULT NULL)` — FLEX:469 | R, status `transitioned` | `sales.write`; cinco estados comuns, origem ≠ destino; sem entitlement físico novo | Só status/versão/evento/recibo. Motivo obrigatório ao retroceder; opcional válido no avanço. Nunca usar para terminais. Action existente. |
| `allocate_order_stock(p_attempt_id uuid,p_order_id uuid,p_order_item_id uuid,p_expected_version bigint)` — :584 | `(status text,order_id uuid,order_item_id uuid,reservation_id uuid,version bigint)`, status `allocated` | `sales.write`; plano `intermediate/paid` para alocação nova; não entregue/cancelado; item físico alocável sem cobertura nem reserva ativa | Reserva integral de um item, altera reservado e pedido; não debita físico e não cria pagamento. UI/action ausentes. Cada item é comando independente, não há batch atômico público. |
| `deliver_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint)` — :1165 | R, status `delivered`, operacional `entregue` | `sales.write`; origem comum; sem gate físico pago genérico que negue conclusão de histórico válido; sem item `make_to_order` descoberto | Consome reserva integral e baixa quando elegível; herda cobertura real sem baixa; untracked sem movimento. Manifesto/settlement/evento/recibo pelo backend. Não exige financeiro quitado. Ausente na UI/action. |
| `undo_order_delivery(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_delivery_event_id uuid,p_target_status text,p_reason text,p_classification text)` — :1450 | R + `source_delivery_event_id uuid, physical_effect text`; status `delivery_undone` | `sales.write`; entregue com confirmação vigente e sem undo prévio; destino comum; motivo obrigatório; classificação exata | incorrect_record: crédito compensatório elegível; actual_delivery: preserva baixa. Herança + incorrect_record bloqueada (D4). Sem nova reserva automática. Correção histórica não concede acesso geral ao inventário após downgrade. Ausente. |
| `cancel_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text)` — :755 | R, status `cancelled`, operacional `cancelado` | **`sales.delete`**; não cancelado nem entregue; motivo obrigatório; acesso central/seleção de plano, sem quota de criação | Libera reservas ativas, preserva consumidas/settlements/baixas; nunca compensa físico ou estorna. Sair de entregue primeiro por undo, se permitido. Ausente. |
| `reopen_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text)` — :947 | R, status `reopened`, operacional **`em_conversao`** | `sales.write`; somente cancelado; motivo obrigatório; cobertura válida preservada, obrigações físicas descobertas requerem `intermediate/paid` e elegibilidade/saldo | Não permite escolher destino; pode criar novas reservas integrais para obrigações stock descobertas; não reativa reservas finalizadas e não duplica cobertura. Make-to-order segue seu modo, não prometer que todo item será automaticamente reservado. Ausente. |
| `get_order_physical_state(p_order_id uuid)` — :1664 | Tupla detalhada em C.4, uma linha por item atual | `sales.read`; acesso histórico não depende de abrir inventário pago; empresa derivada | Leitura sem attempt, não muta estoque. Versão do snapshot vinculada ao pedido; pode informar reconciliação em vez de lançar certas inconsistências. Ausente. |

FLEX mantém assinaturas públicas prévias das cinco RPCs substituídas. Não usar `create/update` ou movimentação manual de inventário como alternativa a esses comandos. Cancelar um entregue via duas chamadas undo/cancel não seria transação única: a primeira pode confirmar e a segunda falhar. Preferir fluxos explícitos distintos e recarga entre eles.

### C.3 Erros e regras de validação

| Código de domínio | SQLSTATE local | Resposta planejada |
|---|---|---|
| `invalid_input` | `22023` | Campo/motivo inválido, sem afirmar que houve efeito. Validar enum, UUID e versão antes de dispatch. |
| `unauthorized`, `selection_required`, `plan_feature_unavailable` | `42501` | Sessão/permissão/regularização/entitlement conforme domínio. Não converter tudo em saldo insuficiente. |
| `order_unavailable`, `order_item_unavailable`, `receipt_result_unavailable` | `P0002` | Não revelar outra empresa; recibo não recuperável exige conferir evidência, não gerar nova tentativa automaticamente. |
| `version_conflict` | `40001` | Recarregar pedido/físico/financeiro e pedir nova confirmação. Não alterar V no mesmo attempt. |
| `idempotency_conflict` | `23505` | Bloquear retry com payload alterado; identificar comando original; não trocar UUID silenciosamente. |
| `version_limit_exceeded` | `22003` | Parar e orientar suporte, sem incremento local. |
| `invalid_order_transition`, `order_already_delivered`, `order_already_cancelled`, `order_not_cancelled`, `order_not_editable`, `order_item_not_allocatable`, `order_item_already_allocated`, `order_item_stock_mismatch`, `product_unavailable`, `order_fulfillment_incomplete` | `P0001` | Recarregar e explicar estado/obrigação; não retry cego. |
| `insufficient_stock` | `P0003` | Nova alocação/reabertura negada integralmente; não executar reserva parcial no React. |
| `delivery_reconciliation_required` | **`P0001` no bloqueio D4 (:1578), `23514` em outros ramos (:1591/1600/1605)** | Suspender fluxo correspondente; mensagem segura de reconciliação, sem reparo por client. D4 não é falta de saldo. |
| Validações `delivery_*_inconsistent` / `delivery_coverage_*` | `23514` | Evidência física inválida; não executar reparo pelo client. |
| `order_not_delivered`, `delivery_confirmation_unavailable` | `P0001` | Undo não elegível no estado/confirmação atual; atualizar dados. |
| `inventory_balance_limit_exceeded`, `settlement_already_compensated` | `22003`, `23505`, respectivamente | Não compensar novamente nem forçar crédito acima do teto; revisão do resultado/histórico. |
| `reservation_balance_inconsistent` | Aparece com `P0001` e `23514` em caminhos distintos | Mapear por combinação domínio/código sem pressupor um único SQLSTATE global. |
| Erro desconhecido, timeout ou resposta inválida após dispatch | Não há resultado confiável | `uncertain=true`, payload congelado; oferecer retry exato e consulta. Nunca declarar rollback só pelo transporte. |

Motivo FLEX usa `btrim`, 1–1.000 caracteres quando obrigatório; avanço rejeita string não nula vazia/branca ou >1.000. Normalizar antes de congelar a tentativa e repetir os mesmos bytes/valores. JS `trim()` e contagem UTF-16 não são idênticos a `btrim/length` PostgreSQL em todo Unicode; alinhar política e testar espaços, quebras, acentos/emoji sem mudar contrato SQL. Não re-normalizar um payload já enviado durante retry.

### C.4 Leitura física e representação

Assinatura completa do retorno local:

```text
(order_id uuid, order_version bigint, order_item_id uuid, product_id uuid,
 quantity bigint, fulfillment_mode text, physical_state text,
 requires_allocation boolean, active_reservation_id uuid, settlement_id uuid,
 source_delivery_event_id uuid, current_delivery_event_id uuid,
 can_undo_as_incorrect boolean)
```

| `physical_state` | Texto sugerido | Comportamento |
|---|---|---|
| `untracked` | Sem controle físico | Sem promessa de baixa/reserva. Entrega é confirmação operacional. |
| `allocated` | Estoque reservado | `active_reservation_id` identifica reserva atual; entrega revalida integralidade. |
| `valid_debit` | Saída física já registrada | Mostrar origem e que reconfirmação não debita novamente; sem alocação duplicada. |
| `compensated` | Baixa compensada · nova alocação necessária | Obrigação descoberta, não “entrega encerrada”; usar `requires_allocation`. |
| `allocation_required` | Aguardando alocação | Ação explícita por item quando autorizada/elegível; não ajustar físico manualmente. |
| `reconciliation_required` | Estado físico exige revisão | Não inventar solução ou RPC de reconciliação inexistente. Desabilitar ações físicas no fluxo e orientar responsável; leitura/comercial/financeiro não devem ser bloqueados globalmente sem contrato. |

`settlement_id` e `source_delivery_event_id` vinculam cobertura original, não necessariamente confirmação atual. `current_delivery_event_id` é confirmação vigente apenas em Entregue e é o identificador a enviar no undo. `can_undo_as_incorrect` representa elegibilidade física da confirmação inteira, não permissão final nem flag de edição por linha. Se qualquer linha estiver inconsistente/herdada ou as versões/eventos não concordarem, não construir uma autorização com `some(true)`. Exigir snapshot completo coerente; falha de leitura não equivale a `untracked`.

`requires_allocation` só é true para compensated/allocation_required; não autoriza alocar durante cancelado, após downgrade ou sem saldo. Vincular todos os itens à mesma `order_version`; comparar com detalhe antes de confirmar. Chamadas separadas não são um snapshot atômico. Em divergência recarregar, não mesclar dados para fabricar estado válido. O endpoint mostra itens atuais, não o extrato integral de ciclos ou reservas consumidas.

### C.5 Criação, edição, leituras, eventos e financeiro

**Criação efetiva:** `supabase/migrations/20261026173000_orders_stage72c2a_stock_creation.sql:15`:

```text
create_order(p_attempt_id uuid,p_buyer_name text,p_buyer_phone text,
 p_buyer_email text,p_buyer_address text,p_notes text,p_items jsonb,
 p_discount_type text,p_discount_input text,p_shipping_amount text) → W
```

Todos argumentos obrigatórios; telefone/email/endereço/notas podem ser null conforme validações. `sales.write`; quota Aprendiz de três pedidos históricos incluindo cancelados, não três ativos. Novo físico requer plano elegível. `p_items` inclui origin, product_id, name, description, quantity, unit_price, fulfillment_mode; dinheiro em texto decimal canônico. Criação pode reservar stock, não receber pagamento. Replay por attempt; versão inicial conforme retorno, não inventar versão no cliente.

**Edição efetiva:** `20261026175000_orders_stage72c2c_physical_edit_guard.sql:14`:

```text
update_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
 p_buyer_name text,p_buyer_phone text,p_buyer_email text,p_buyer_address text,p_notes text,
 p_items jsonb,p_discount_type text,p_discount_input text,p_shipping_amount text) → W
```

Sem defaults; `sales.write`, versão esperada; substitui coleção comercial, não editar físico/histórico. Erros adicionais: `active_reservation_edit_unsupported`, `reservation_history_edit_unsupported`, `physical_order_edit_unsupported`, `total_below_net_received`. Trigger C.4 impede total menor que líquido recebido; não cria pagamento. Guards históricas continuam: FLEX não concede edição comercial de reservas consumidas.

**Leituras efetivas:** `20261026190000_orders_stage72d1_reads.sql:28,153,253`.

```text
list_orders(p_search text DEFAULT NULL,p_operational_status text DEFAULT NULL,
 p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
get_order_details(p_order_id uuid)
get_order_items(p_order_id uuid)
```

Todas exigem `sales.read`, contexto/tenant; sem attempt/versão de escrita. Sem entitlement físico/limite histórico para impedir consulta. Listagem retorna:

```text
id uuid,display_number bigint,operational_status text,buyer_name text,
 buyer_phone text,buyer_email text,currency text,subtotal numeric,discount_amount numeric,
 shipping_amount numeric,total_amount numeric,items_count bigint,created_at timestamptz,
 updated_at timestamptz,archived_at timestamptz,version bigint,
 total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
 financial_status text,cancelled_unreversed_amount numeric,total_count bigint
```

Detalhes retornam esses campos, exceto items_count/total_count, e acrescentam `enterprise_id uuid,buyer_address text,discount_type text,discount_input numeric,discount_base numeric,notes text,created_by uuid,delivered_at timestamptz,cancelled_at timestamptz`. Itens retornam `(id uuid,order_id uuid,product_id uuid,origin text,name text,description text,quantity bigint,unit_price numeric,line_subtotal numeric,fulfillment_mode text,line_number smallint)`.

Erros de leitura incluem unauthorized, invalid_input e order_unavailable; não transformar erro financeiro em zero. A lista usa contagem na linha; página vazia não contém count (há fallback na action existente). Não estimar total global usando só dez cartões de cada coluna.

**Eventos e reservas:** `order_events`, `order_stock_reservations`, `order_stock_settlements`, manifestos e compensações são estruturas protegidas, não endpoints para browser. Não foi localizado leitor público genérico de eventos ou reservas de Pedidos. A leitura física cobre reserva ativa/cobertura, não timeline completa. Se timeline for requisito aprovado, isso requer análise de contrato próprio posterior; está fora da integração sem mudança de backend. Helpers privados `reserve_order_item_stock`, `finalize_order_item_reservation` e `orders_flex_*` não são RPCs de cliente.

**Financeiro C.4**, `20261026184000_orders_stage72c4_payments.sql:325–361`:

```text
record_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
 p_amount text,p_method text,p_effective_at timestamptz,p_note text DEFAULT NULL)
reverse_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
 p_payment_id uuid,p_effective_at timestamptz,p_reason text)
get_order_financial_summary(p_order_id uuid)
get_order_payment_history(p_order_id uuid,p_limit integer DEFAULT 50,
 p_before_recorded_at timestamptz DEFAULT NULL,p_before_payment_id uuid DEFAULT NULL)
```

Receber exige `sales.write`, estornar **sales.delete**, ler sales.read; sem gate físico Visionário para impedir acerto histórico. Receber em não cancelado (inclusive entregue), até saldo; estornar integralmente um receipt uma vez, em qualquer estado, motivo obrigatório. Método `pix/card/cash/bank_transfer/other`; data efetiva explícita; nota opcional. Não são comandos operacionais.

Mutações retornam `(status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,total_amount numeric,total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,financial_status text,cancelled_unreversed_amount numeric)`; status payment_received/payment_refunded. Resumo retorna `(order_id uuid,version bigint,operational_status text,total_amount numeric,total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,financial_status text,cancelled_unreversed_amount numeric)`. Histórico retorna `(payment_id uuid,order_id uuid,actor_id uuid,entry_type text,amount numeric,method text,effective_at timestamptz,recorded_at timestamptz,reverses_payment_id uuid,note text)`; cursor timestamp+UUID juntos, limite 1–100.

Mutações têm recibo/versionamento e nenhuma baixa/reserva; leituras não têm attempt. Erros específicos: `order_cancelled/P0001`, `payment_unavailable/P0002`, `payment_already_reversed/23505`, `payment_exceeds_pending`, `total_below_net_received`, `payment_balance_inconsistent`, `payment_ledger_unavailable`, `payment_event_unavailable` com 23514, além dos comuns. UI financeira de lançamento pode ser etapa separada; M7.3 precisa no mínimo ler o resumo e não confundir Pago operacional.

### C.6 Inventário e reservas — fronteira de integração

Fontes `20261020000000_finished_product_inventory.sql` e definição final de movimentação em `20261026171000_orders_stage72b1_reservation_guards.sql:44`:

```text
move_product_inventory(p_attempt_id uuid,p_product_id uuid,p_expected_version bigint,
 p_movement_type text,p_quantity numeric DEFAULT NULL,
 p_counted_balance numeric DEFAULT NULL,p_reason text DEFAULT NULL)
 → (status text,movement_id uuid,product_id uuid,balance bigint,version bigint)
get_product_inventory_detail(p_product_id uuid)
 → (product_id uuid,product_name text,product_active boolean,balance bigint,inventory_version bigint)
list_product_inventory_movements(p_product_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
 → (movement_id uuid,movement_at timestamptz,movement_type text,quantity bigint,
 balance_before bigint,balance_after bigint,reason text,actor_id uuid,result_version bigint)
list_product_inventory(p_search text DEFAULT '',p_balance_filter text DEFAULT 'all',
 p_product_status text DEFAULT 'active',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
 → (product_id uuid,product_name text,balance bigint,inventory_version bigint,product_active boolean)
count_product_inventory_movements(p_product_id uuid) → bigint
count_product_inventory(p_search text DEFAULT '',p_balance_filter text DEFAULT 'all',
 p_product_status text DEFAULT 'active') → bigint
```

Leituras com inventory.read; mutação inventory.write, gates pagos centrais. Move usa attempt e versão **do inventário**, entry/exit/adjustment, guarda saldo reservado; sucesso created/idempotent/no_change. Leitores não usam attempt e não alteram nada. Erros incluem unauthorized, product_unavailable, invalid_input, version_conflict, insufficient_stock, balance_limit_exceeded, version_limit_exceeded, idempotency_conflict. Não existem estados operacionais de pedido nesses endpoints.

Não oferecem no contrato atual o saldo reservado/disponível na tupla visual. `product_inventory_availability` e `private.order_stock_reservation_reconciliation` são views protegidas, não API autorizada do frontend. Não consultar diretamente para contornar essa limitação. O comando `allocate_order_stock` decide disponibilidade sob lock. O Kanban não pode fazer move_product_inventory e depois deliver/undo: isso duplicaria baixa/crédito e quebraria vínculos do ledger.

## D. Lacunas identificadas

### Bloqueantes de consistência

- T0: SQL aplicado em partes sem artefatos locais comparáveis; contrato remoto efetivo não comprovado. Não contornar com ações “compatíveis com ambos”.
- Matriz antiga rejeita saltos válidos e exige motivo em avanço orcado → modelando, incompatível com FLEX.
- Ausência de estado físico/evento vigente/D4: não é seguro oferecer undo apenas com `operationalStatus`.
- Não há actions nem schemas dos cinco comandos ausentes; retorno de alocação difere de R e undo acrescenta campos. Não usar um schema genérico que aceite sucesso incompleto.
- Tentativa em memória desaparece no reload. Criar nova após resultado incerto pode repetir intenção. Controller bloqueia inclusive falhas conhecidas até reload: precisa estado explícito de reconfirmação, não unlock automático.

### Limites demonstráveis da validação histórica local

Não são provas de exploração por usuário comum e não serão corrigidos nesta análise:

- `orders_flex_validate_delivery` valida segmentos da própria entrega/undo, não reconcilia todo o ledger até o saldo corrente. Continuidade entre linhas selecionadas não deve ser descrita como auditoria global do estoque.
- No helper, metadata/recibo de undo são comparados entre si (:266–280), sem reconstruir o hash completo do payload do undo como ocorre no hash da entrega. O endpoint de replay de undo compara o hash recebido; essas são garantias distintas.
- A flag `can_undo_as_incorrect` depende também de `invalid_chain` por item (:1706–1750). Em drift de um item pode haver flags diferentes por linha; por isso a UI precisa exigir conjunto completo coerente, nunca apenas uma linha true. A RPC faz validação da confirmação inteira.
- Replay de alocação ainda valida item vivo/produto/quantidade (:655–666); não prometer a mesma independência de itens atuais dos manifestos de entrega. Writers suportados bloqueiam edição com histórico de reservas, mas isso não transforma replay allocate em manifest-only.
- Não exigir que ator da reserva seja o ator da entrega: operadores distintos podem alocar e entregar. Vínculo empresarial e evidência de cada comando são os controles apropriados.

Esses limites e os três commits devem ser considerados na revisão/homologação do backend efetivo antes de liberar mutações físicas na interface.

### Lacunas de experiência e qualidade

- Colunas Entregue/Cancelado dizem “pedidos não podem ser movidos daqui”; FLEX exige sair via undo/reopen, não libera transição genérica.
- A página só passa canWrite, sem capacidade sales.delete. Não deduzir delete do canWrite.
- Drawer não contém histórico operacional nem pagamento/estorno. Não simular timeline com apenas status atual.
- `lib/orders/actions.ts` valida parcialmente financeiro e usa casts/Number nas demais respostas; precisa validação de UUID, bigint seguro, enum e nullability física.
- Moeda é retornada, mas UI formata sempre BRL. Preservar escopo BRL atual e validar contrato; não introduzir multicurrency silenciosamente.
- Erro Auth da página compara `err.message === 'UNAUTHENTICATED'` e aponta `/auth/login`, mas contexto usa AuthContextError.code e layout aponta `/admin/login`. Tratar no escopo aprovado, sem alterar autenticação central.
- Overlays próprios precisam foco contido/restaurado, Escape e anúncio de carregamento. Semântica atual do modal não comprova acessibilidade do DnD no browser.
- Erro no histórico de inventário pode virar array vazio/error null em `lib/inventory/actions.ts:213–232`; não reutilizar esse comportamento para leitura física.
- Revalidação de escrita de Pedidos cobre `/admin/orders` e edição, não estoque, mesmo com criação stock. Planejar invalidação cruzada para ações físicas. Não acrescentar dashboard fictício.
- Não há realtime/polling em Pedidos. Não assumir que revalidate atualiza outra aba/operador instantaneamente.

## E. Proposta de arquitetura

**Recomendação, sujeita a aprovação:** manter página Server Component + componentes client existentes + actions tipadas por operação + RPCs autoritativas. Não criar endpoint público alternativo, autorização paralela, optimistic stock ou sistema novo de permissões.

Fluxo:

1. Usuário seleciona destino/ação via menu ou drop.
2. Dispatcher resolve intenção: comum → transition; destino entregue → diálogo de entrega; destino cancelado → cancel; origem entregue → diálogo de undo; origem cancelado → reopen para Em conversão. Nunca roteamento apenas por coluna sem considerar origem.
3. Ler detalhe/resumo físico ao abrir confirmação especial. Revalidar coerência de versões; informar efeitos esperados sem prometer saldo futuro. Não debitar/reservar no preview.
4. Validar justificativa/classificação/confirmação. Gerar e congelar envelope com attempt, ator/empresa da sessão como escopo local, pedido, operação, versão e argumentos normalizados.
5. Action: `requireBusinessContext` com permissão correta → Zod estrito → cliente SSR de usuário → uma RPC → validar cardinalidade, IDs, status/versão/evento e campos próprios → revalidate das rotas atingidas → resultado discriminado. Não usar estado atual para rejeitar replay antigo antes de a RPC examinar recibo.
6. Cliente mantém cartão na coluna confirmada, bloqueia operações daquele pedido até resultado conhecido e sincronização; atualiza RSC/leitura física. Replay histórico não deve rebaixar a versão visual.

### Padrão de Actions

Reaproveitar `SaveOrderResult/TransitionResult`: sucesso tipado; erro com code/message/uncertain. Extrair mapa de erros de Pedidos para módulo server compartilhável somente se aprovado; mapa atual é privado em write-actions. `planErrorCode/planRpcErrorCode` existentes cobrem plano, não todos os erros físicos. `lib/inventory/actions.ts` tem seu próprio failure/known; não existe mapeador universal pronto.

Classificar por SQLSTATE + mensagem estável, sem expor detalhes internos/IDs de outra empresa. Erro conhecido de domínio é falha confirmada, transporte/resposta inválida após dispatch é incerto. Logging mínimo com código/correlação, sem JWT, dados pessoais ou motivo integral.

Não exigir inventário pago no pré-gate de deliver/undo/read: sales.* usa `requireBusinessContext` existente e RPC decide exceções. Nova alocação é paga no backend. A UI pode orientar upgrade para alocação nova, mas não bloquear leitura ou compensação histórica elegível de owner após downgrade. Magnata não ativável: não mapear plano futuro como Visionário por aproximação.

### Atualização e cache

Começar com invalidar Pedidos/edição e, em comandos que afetam reservas/movimentos, `/estoque/produtos` com escopo adequado ao padrão existente. Recarregar detalhe, físico, financeiro e colunas afetadas sem somar/subtrair contadores localmente. Não invalida métricas de Pedidos inexistentes.

O guia instalado `node_modules/next/dist/docs/01-app/02-guides/server-actions.md:26–47` documenta dispatch sequencial no cliente e resposta com UI revalidada. Não usar Promise.all no browser para alegar concorrência de Server Actions ou projetar alocação batch atômica. O padrão atual combina revalidatePath + router.refresh; medir/validar na versão instalada se o refresh adicional é redundante antes de mantê-lo em todas as operações. Não introduzir cache compartilhado entre tenants sem necessidade; a página atual é force-dynamic. Outro operador ainda exige refresh manual inicialmente; realtime é decisão posterior.

## F. Proposta de interface

- Preservar sete colunas na ordem Em conversão, Orçado, Pago, Modelando, Imprimindo, Entregue, Cancelado; cinco comuns movimentáveis livremente. Destinos especiais são convites a confirmação, não execução imediata.
- Manter lista como padrão inicialmente e toggle já existente. Mudar padrão para Kanban depende de aprovação e testes móveis.
- Manter `@dnd-kit/react` já presente (`^0.5.1`) em vez de acrescentar outra lib. Avaliar API instalada, sensores e acessibilidade nos testes; não pressupor compatibilidade com exemplos de @dnd-kit/core. Sem pesquisa externa de manutenção nesta análise.
- Alternativa sempre disponível por seletor/menu, teclado e leitor de tela; não exigir arraste para nenhuma ação. No mobile, lista/detalhe deve continuar totalmente funcional; Kanban com scroll horizontal e alvos claros, sem sacrificar rolagem ao handle.
- Cartão: número, comprador, total, número de itens, badge financeiro textual e pendência resumida. Status Pago com rótulo operacional, badge Quitado separado. No drawer: total, recebido bruto, estornado, líquido e pendente. Não denominar bruto “liquidado”.
- Indicadores físicos detalhados sob demanda no drawer. A lista atual não traz resumo físico; não disparar uma leitura física por cartão como padrão (N+1 + validação histórica custosa). Caso badges físicos em todos os cartões sejam obrigatórios, aprovar estratégia/contrato antes de prometer essa UI.
- Busca e paginação existentes permanecem. Filtros novos por físico/financeiro não existem na RPC de lista: filtrar só cartões carregados daria resultado incompleto; adiar ou aprovar contrato próprio.

### Confirmações

| Intenção | Conteúdo obrigatório / observação |
|---|---|
| Retrocesso comum | Destino e motivo 1–1.000; reset do campo por operação; avanço aceita motivo opcional. |
| Entregar | Resumo de itens e atendimento; reserva a consumir versus cobertura preservada versus untracked; confirmação explícita. Se pendente/parcial, aviso **não bloqueante** “há saldo pendente de R$ X”; não checkbox que invente requisito financeiro. |
| Desfazer entrega | Destino comum + motivo + classificação sem default perigoso. “Registro incorreto: devolver baixa elegível por compensação” versus “Entrega realmente realizada: manter saída”. Mostrar efeito agregado/itens, inclusive possibilidade sem movimento físico. |
| D4 | Com cobertura herdada, opção incorrect_record indisponível com explicação. Actual_delivery continua sujeito às validações do backend; não oferecer crédito fictício por toggle. |
| Alocar | Item, quantidade integral, indicação de plano e reserva; backend decide saldo no momento. Sucesso atualiza versão antes do próximo item. Em múltiplos itens, progresso/resultado por item, não promessa de tudo-ou-nada. |
| Cancelar | Motivo; libera reservas ativas, não devolve baixa real nem estorna pagamentos. Se saldo líquido recebido, aviso sobre acerto financeiro independente. Só sales.delete. |
| Reabrir | Motivo; destino fixo Em conversão; preservar cobertura válida e explicar que obrigações descobertas podem exigir plano/saldo ou alocação posterior conforme modo. Não abrir seletor arbitrário de destino. |
| Reconciliação | Estado de revisão, contexto/identificadores de suporte sem reparo direto. Oferecer atualizar/consultar; não botão “forçar”, movimento manual automático ou alteração local de modo físico. |

Carregamento: bloquear submit repetido e handle/menu por pedido, manter cancelar diálogo disponível antes do dispatch, não tratar fechar diálogo após dispatch como cancelamento no banco. Anunciar pendente/confirmado/incerto com aria-live; foco retorna ao cartão/menu. Modal acessível é trabalho explícito, não só adicionar aria-modal.

## G. Segurança e consistência

### Idempotência e concorrência

| Evento | Regra planejada |
|---|---|
| Clique duplo / drop enquanto pending | Guarda síncrona compartilhada por pedido antes de dispatch; uma intenção, um UUID. |
| Falha de rede ou resposta perdida | Manter envelope completo e UUID; retry exato com mesma identidade, não gerar nova tentativa. |
| Conflito de versão | Recarregar todas leituras relevantes, mostrar mudança e pedir confirmação; nova intenção após decisão usa outro UUID. Não editar V do envelope antigo. |
| Idempotency conflict | Interromper e investigar payload original; não retry com UUID novo automático. |
| Refresh/reabertura de aba | Recuperar pendência persistida de forma aprovada ou declarar limitação. Estado atual sozinho não prova se aquela tentativa concluiu. |
| Mudança de empresa/login | Não retransmitir pendência em outra identidade; chave de armazenamento por usuário/empresa/pedido/operação e expurgo/revisão ao trocar contexto. |
| Resultado confirmado, UI ainda antiga | Manter bloqueio até snapshot alcançar versão confirmada; não sobrescrever versão mais nova com replay histórico. |
| Duas abas / operadores | SQL decide serialização; client não é lock distribuído. Refresh/reconfirmação em conflito. |

**Persistência recomendada para discussão:** sessionStorage versionado, por aba e identidade/empresa, contendo somente mínimo necessário do comando pendente, sem tokens, com política de descarte/expiração e retomada explícita. Motivo/payload podem conter dados pessoais: aprovar retenção e proteção contra mistura de contexto. Guardar apenas attempt sem payload é insuficiente para retry. Expiração não é prova de rollback: comando incerto expirado exige revisão antes de nova intenção. Não implementar retry automático em mount; primeiro validar sessão e pedir retomada. Alternativas na seção I.

### Planos e histórico

- Aprendiz (`free`): quota histórica de criação, sem nova integração física; leitura e conclusão/acerto histórico conforme SQL e acesso central. Não usar contagem da página para deduzir quota.
- Visionário (`intermediate/paid`): novas reservas/integração física; limites de equipe existentes, não criar papel novo.
- Magnata: não ativável, não recomendar migração para ele como solução de erro.
- Downgrade: não apagar cartões ou esconder histórico; distinguir obrigação coberta (sem nova reserva) de descoberta (entitlement necessário). Não assumir que operator bloqueado pelo plano tem exceção idêntica à de owner.
- Estado físico, elegibilidade D4, saldo disponível, efeito financeiro e permissões nunca são fatos confiáveis apenas porque estão no React. Comando revalida tudo.
- Ledger, manifesto, settlement, reserva consumida, compensação e recibo permanecem append-only/autoritativos. Nenhum UPDATE/DELETE direto nem “restaurar estoque anterior” no frontend.

## H. Matriz de testes e critérios de aceite

Camadas: **U** = unitário/interface com mocks; **I** = integração web autenticada (Server Action/PostgREST); **P** = PostgreSQL real, transação/ledger/locks. Cenário preparado não é cenário executado. Para interações, incluir teclado, touch, foco, erro por coluna, drawer e URL/paginação.

| Cenário | U / interface e contrato | I / P necessários e aceite |
|---|---|---|
| Transições livres | Todos 20 pares distintos comuns aceitos; sem terminais na action comum | I/P: versão+1, evento/recibo, sem delta físico/financeiro |
| Retrocesso/motivo | 10 pares regressivos exigem motivo; branco, null, >1000, Unicode; avanço opcional | P: SQL normaliza/valida; erro conhecido sem evento/versão nova |
| Entrega untracked | Diálogo sem promessa de saída, sem optimistic move | P: manifesto untracked, nenhum movimento/reserva inventado |
| Entrega reservada | Preview reservado e versão atual | P: consome integralmente, baixa única, settlement/manifesto/evento/recibo |
| Dois produtos / dois itens mesmo produto | Agrupamento correto sem comparar saldos de posições distintas | P: versões e saldos de cada posição, reserva integral e replay com evidência válida |
| Histórico intercalado | UI não reconstrói cadeia selecionando só linhas visíveis | P: histórico legítimo antes/depois, validação de cadeias e rejeição de inconsistência real |
| Pagamento pendente/parcial | Aviso visível não bloqueia entrega; Pago operacional separado | P: entrega permite saldo e não cria receipt financeiro |
| Undo incorrect_record | Classificação explícita, motivo/destino/evento atuais | P: crédito exato ao saldo corrente, reservado inalterado, compensação única |
| Undo actual_delivery | Texto inequívoco de preservação | P: zero crédito/nova reserva; reconfirmação herda cobertura |
| D4 | Opção incorrect indisponível quando flag inelegível; snapshot inválido não habilita | I/P: tentativa forjada rejeitada; zero crédito fictício |
| Nova alocação / segunda entrega | UUID por item, V atualizado sequencialmente; sem batch fictício | P: novas reservas, nova baixa só no descoberto, histórico antigo preservado |
| Retry e replay histórico | Mesmo UUID/payload após rede/reload; resultado histórico não retrocede UI | P: seis operações, mesmo resultado sem novo débito/crédito mesmo após novos ciclos |
| Versão/conflito idempotente | Mensagens distintas, sem alteração silenciosa V/UUID | P: 40001/23505; duas sessões e commit perdido sem efeito duplicado |
| Cancelamento | Só delete, motivo; não chama estorno/move manual | P: libera ativos, preserva consumidos/cobertura/pagamentos |
| Reabertura | Destino fixo em_conversao, informa plano/saldo | P: coberto sem duplicar; descoberto sem saldo/plano falha sem parcial |
| Owner/operator | Visibilidade correta, mutation direta contra action negada se sem permissão | I/P: operator write permitido, cancel/refund negados, backend autoriza independentemente da UI |
| Aprendiz / Visionário | Criação/quota/físico separados de leitura | P: quota histórica e gates reais; histórico legível e conclusão conforme contrato |
| Downgrade | Sem bloqueio global do módulo por plano físico | P: correção histórica elegível, cobertura preservada, nova alocação negada e exceções por ator |
| Multiempresa / sessão | Nunca reaproveitar comando persistido em outro contexto | I/P: cookies reais, RPC de ID externo, sessão expirada, RLS/ACL sem vazamento |
| Reconciliação / leitura parcial | Falha física não vira untracked; nenhuma ação forçada | P: evidence inválida rejeitada/estado reconciliation, sem alteração de saldo |
| Financeiro concorrente | Resumo atual, não inferir liquidação pelo status Pago | P: pagamento altera versão compartilhada; deliver/undo/cancel/reopen sem payment/refund indevido |
| Acessibilidade / responsivo | Menu completo sem DnD, modal/foco/Escape, touch/scroll e contraste | I browser: fluxos reais; mocks não provam sensores/teclado |
| Cache / múltiplas abas | Cartão somente após confirmação, erro por coluna distinguido de vazio | I: refresh de lista/colunas/detalhe/físico/inventário; outra aba exige nova leitura |

### Verificações efetivamente executadas nesta análise

- `node --test lib/orders/write.test.cjs`: **5/5 passaram**. VM/transpile/mocks; teste da matriz ainda aprova **C.3**, não FLEX. Seu sucesso evidencia cobertura desatualizada, não compatibilidade nova.
- `node --test supabase/tests/orders_stage72flex_static.mjs`: **11/11 passaram**. Análise textual/bytes; não compila PL/pgSQL, não prova instalação/ACL runtime, cadeia, atomicidade ou locks.
- Hash local obtido via Node crypto (SHA-256 acima). Tentativa de `Get-FileHash` não disponível no shell, sem qualquer efeito nos arquivos.
- `git diff --check`: sem erro de whitespace; apenas avisos LF/CRLF em arquivos preexistentes de outras alterações. O relatório novo foi produzido como único arquivo desta etapa.
- Nenhum teste SQL, build de aplicação, Auth remoto ou infraestrutura executado. Nenhuma biblioteca instalada.

Os roteiros em `supabase/tests/manual_flex/` e `orders_stage72flex_scenarios_manual.md` são insumos de homologação pendente. Revisar especialmente fixtures multi-produto e histórico antes de afirmar cobertura; existência de script não equivale a execução bem-sucedida.

## I. Decisões pendentes de aprovação

| Decisão | Alternativas, vantagens/desvantagens | Recomendação e impacto |
|---|---|---|
| Visualização principal | Lista atual: simples/mobile, menor densidade operacional. Kanban padrão: produção visual, mais leituras/scroll | Manter toggle e lista padrão no primeiro incremento; mudança de default separada, baixo retrabalho. |
| Interação | Só menu: acessível/simples, menos visual. DnD+menu: já existe, mas exige sensores e testes | Preservar ambos com mesmo dispatcher. Não adicionar lib. Impacta KanbanBoard, selector e controller. |
| Biblioteca | Manter @dnd-kit/react instalado versus trocar lib/native DnD | Manter por menor custo/migração; validar API e acessibilidade atuais. Nova biblioteca só com justificativa/testes após aprovação. |
| Motivo | Inline versus modal único contextual | Reusar modal com foco correto e motivo opcional em avanço quando solicitado; sem submeter no drop de retrocesso. |
| Entregar | Ação explícita apenas versus drop abrir confirmação | Ação explícita primeiro; depois drop usa mesmo diálogo. Nunca execução imediata. Alinha risco físico e aviso de pendência. |
| Cancelar | Menu apenas versus drop para Cancelado | Começar menu com sales.delete e motivo; se drop aprovado, apenas abre o mesmo modal. Não cadeia automática undo+cancel. |
| Saída de Entregue | Desabilitar drag versus drag abrir undo | Menu “Desfazer entrega” explícito na primeira fase, classificação sem default; DnD posterior não pode confundir com simples retrocesso. |
| Saída de Cancelado | Escolher coluna versus reabrir fixo | Reabrir para Em conversão, como contrato; nova movimentação comum é outra intenção. |
| Reconciliação | Bloquear módulo inteiro versus só fluxo físico afetado e orientar suporte | Bloqueio contextual, leitura mantida; definir responsável/processo de revisão (não há RPC genérica). |
| Atualização | Revalidação/RSC versus otimista versus realtime | Confirmada por servidor, sem otimista de entrega/estoque; medir refresh duplicado e leituras por coluna. Realtime fora do primeiro incremento. |
| Persistência de attempt | Só memória: simples, perde reload. sessionStorage: por aba, dados sensíveis/retomada. Armazenamento servidor: robusto, novo backend | Recomendar sessionStorage mínimo com aprovação de retenção/escopo e retomada explícita; se memória for escolhida, documentar reload incerto e não prometer G sem restrição. |
| Indicador físico em cartão | Sob demanda no detalhe versus N+1 versus novo resumo de lista | Detalhe primeiro, sem backend novo. Badges globais exigem decisão de performance/contrato. |
| Alocação multi-item | Por item sequencial versus batch | Sequencial com progresso e falha parcial explícita; batch não existe e seria mudança backend fora do escopo. |
| Financeiro M7.3 | Apenas resumo/aviso versus recebimentos/estornos completos | Resumo obrigatório para entrega; lançamentos e histórico em incremento separado aprovado. Não reutilizar closed_sales. |
| Histórico operacional | Sem timeline completa versus novo endpoint autorizado | Não prometer timeline nesta fase; abrir escopo separado se necessário. |

Todas são recomendações, **não decisões implementadas**. Questões comerciais/operacionais a responder: quem recebe casos de reconciliação, se há obrigatoriedade de revisar pendência (sem impedir entrega), política de retenção de comandos pendentes e se DnD deve abrir ações terminais já no primeiro release.

## J. Plano de implementação proposto

Executar apenas após aprovação. Caminhos existentes são alvos previstos, não arquivos modificados nesta análise. Arquivos marcados “novo proposto” não existem ainda.

| Etapa | Objetivo e arquivos previstos | Dependências | Critérios de aceite | Riscos |
|---|---|---|---|---|
| **0. Fechar rastreabilidade e decisões** | Comparar partes fornecidas com migration local e documentar evidência; consolidar decisões I neste relatório | Partes exatas, correções, fronteiras de commit e aprovação do responsável | Contrato efetivo identificado ou divergência explicitamente resolvida por processo separado; nenhuma aplicação automática | Projetar contra SQL diferente; instalação parcial não detectada por última mensagem |
| **1. Alinhar transições comuns FLEX** | `lib/orders/transitions.ts`, `OrderStatusSelector.tsx`, `useOrderTransitions.ts`, `lib/orders/write.test.cjs` | 0; política de motivos | 20 pares distintos, 10 retrocessos, motivo correto, nenhuma chamada genérica para terminal, testes atualizados | Manter matriz antiga por engano; alterar hash no retry com normalização diferente |
| **2. Tipar leitura física e comandos** | `lib/orders/actions.ts`, `write-actions.ts`; `lib/orders/physical-schema.ts` e `operation-schema.ts` (novos propostos, divisão a aprovar) | Contratos confirmados | Schemas de input/output separados, version safe, erros físicos conhecidos, sales.delete distinto; leitura não falha aberta | Coerção null/zero ou enum desconhecido permitir ação; gate pago indevido |
| **3. Coordenar comandos e retomada** | Evoluir `useOrderTransitions.ts` ou extrair `useOrderOperations.ts` (novo proposto), testes existentes/novos no mesmo padrão | Decisão de persistência/privacidade | UUID por intenção; retry mesmo envelope; bloqueio comum por pedido; refresh não perde pendência aprovada; troca de contexto não reenvia | Duplicação após reload, payload sensível armazenado, snapshot histórico regressivo |
| **4. Estado físico no detalhe e alocação** | `page.tsx`, `OrdersView.tsx`; `OrderPhysicalState.tsx` (novo proposto), actions e schemas | 2–3 | Snapshot coerente, falha explícita, alocação integral por item com V renovada e sem DML manual; Aprendiz lê histórico | N+1/custo de validação histórica; multi-item parcialmente alocado sem feedback |
| **5. Entrega confirmada e aviso financeiro** | `write-actions.ts`, `OrdersView.tsx`; `OrderDeliveryDialog.tsx` (novo proposto), Kanban dispatcher se aprovado | Estado físico, controller, UI/modal aprovada | Entrega não otimista; pendência informa sem bloquear; stock/untracked/cobertura herdada corretos; invalidação estoque | Duplo débito se alguém reutilizar move manual; inventar obrigação financeira |
| **6. Undo com classificação e D4** | Action/schema próprios; `UndoOrderDeliveryDialog.tsx` (novo proposto), detalhe/controller | 5 e homologação física de múltiplos produtos/ciclos | Confirmação vigente+V; classificação explícita, motivos; compensar/preservar distintos; D4 e reconciliação sem bypass | Crédito fictício por flag stale; preservar/devolver confundidos |
| **7. Cancelar e reabrir** | Actions, `OrderStatusSelector.tsx`, `OrdersView.tsx`; diálogos específicos (novos propostos) | sales.delete, regras de cobertura/plano e controller comum | Motivo, destino fixo de reopen, owner/operator, downgrade/saldo, nenhuma compensação/refund automático | Cancelar entregue via cadeia parcialmente confirmada; gates de plano amplos demais |
| **8. Refinar Kanban e acessibilidade** | `KanbanBoard.tsx`, `OrdersView.tsx`, `OrderStatusSelector.tsx`; modal comum apenas se aprovado | Fluxos especiais estabilizados | DnD e menu equivalentes, teclado/touch/foco, loading/erro, paginação independente e contadores por servidor | Troca de coluna antes do backend, ação terminal disparada inadvertidamente |
| **9. Validar integração e release gate** | Testes U/I aprovados; roteiros PostgreSQL existentes e evidência externa do responsável | Ambiente descartável autorizado, SQL rastreável, todos cenários críticos | U/I/P separados, Auth real, duas sessões, replay após ciclos, financeiro e tenant comprovados; nenhum PASS de fonte tratado como homologação | Scripts preparados confundidos com resultado; concorrência não exercitada |
| **10. Financeiro/histórico opcional** | Somente se aprovado: actions/diálogos C.4 e histórico financeiro; timeline operacional depende de novo contrato separado | Decisão de escopo | Receber sales.write, estornar sales.delete, sem mudar status/estoque; leitura paginada | Expandir M7.3 sem controle, usar legado ou misturar líquido e bruto |

**Ponto de parada:** o trabalho desta sessão termina no relatório. Nenhuma alteração em frontend, Server Actions, migrations, ambiente ou autenticação; nenhum SQL, Supabase remoto, Docker, WSL, commit, push ou deploy. Aguardar revisão e aprovação antes de qualquer etapa de implementação.

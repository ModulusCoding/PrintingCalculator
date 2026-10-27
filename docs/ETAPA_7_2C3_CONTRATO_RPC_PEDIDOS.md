# M7.2-C.3 — contrato de RPCs do ciclo operacional

## Estado e aplicação manual

M1–M5 e extensão aditiva de identidade UUID de eventos aprovadas pelo responsável. Arquivos preparados para revisão/aplicação manual, **não aplicados pelo agente**. A/B/B1/C1/C2 foram informadas como aplicadas em desenvolvimento; catálogo instalado não foi consultado independentemente. Assertions de fonte não comprovam sintaxe PostgreSQL, autorização efetiva, rollback ou concorrência. Não houve integração de frontend ou pagamentos.

Ordem de revisão/aplicação:

1. `20261026175500_orders_stage72c3_event_uuid.sql`
2. `20261026180000_orders_stage72c3a_transitions.sql`
3. `20261026181000_orders_stage72c3b_cancellation.sql`
4. `20261026182000_orders_stage72c3c_reopening.sql`
5. `20261026183000_orders_stage72c3d_delivery.sql`

Não aplicar somente parte física sem suas dependências A/B/B1/C1/C2 e a identidade UUID. Conferir antes os corpos instalados e os ACLs, funções de contexto/autorização, helpers, ledger, settlements e triggers contra as fontes locais. O documento geral “Modulus — Documento de Projeto | 2026” não foi localizado nas análises anteriores.

## Identidade de eventos e backfill

`order_events.id` continua **bigint GENERATED ALWAYS AS IDENTITY**, PK original; FKs, permissões e trigger de imutabilidade não são alterados. A compatibilidade adiciona `event_uuid uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL UNIQUE`. O default volátil gera um UUID por registro existente durante o rewrite de ADD COLUMN, sem UPDATE de linha e sem disparar/desativar o trigger BEFORE UPDATE OR DELETE. NOT NULL e UNIQUE validam o resultado na mesma transação. A operação demanda ACCESS EXCLUSIVE e pode reescrever a tabela; prever janela e espaço/WAL para tabelas grandes. Não rodar backfill manual por UPDATE.

O retorno `event_id` das RPCs é **sempre `order_events.event_uuid` efetivamente persistido**, obtido por INSERT RETURNING. Não é PK bigint nem UUID apenas em metadata. Eventos antigos também recebem UUID, mas não adquirem recibos C3 retroativos. Replay busca a coluna UUID com empresa/pedido/ator/tipo/versão e sem exigir estado atual igual ao histórico.

B define `order_stock_settlements.delivery_operation_id uuid NOT NULL` sem FK ao bigint do evento, e unicidade por empresa/operação/item; portanto aceita o UUID persistido do evento de entrega como correlação comum. Não altera constraints B. Uma reserva → um movimento → um settlement; não agregar várias linhas num único movimento.

## Assinaturas e retorno

```sql
transition_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
                 p_target_status text,p_reason text DEFAULT NULL)
cancel_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text)
reopen_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text)
deliver_order(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint)
-- Todas no schema public:
RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
```

| RPC | Autorização | Comando de recibo | status de retorno | Evento |
| --- | --- | --- | --- | --- |
| transition_order | sales.write | transition | transitioned | status_changed |
| cancel_order | sales.delete | cancel | cancelled | cancelled |
| reopen_order | sales.write | reopen | reopened | reopened |
| deliver_order | sales.write | deliver | delivered | delivered |

Contexto autenticado business_ready, empresa/ator da sessão, autorização central (não role isolada), SECURITY DEFINER, owner postgres, search_path vazio e EXECUTE somente authenticated; nenhuma concessão DML ou exposição de helper privado. inventory.write não é requisito destas operações. Versão válida 0..9007199254740991; sucesso cria versão expected+1 exatamente uma vez no pedido.

## Matriz e motivos

| Origem | Destinos de transition_order |
| --- | --- |
| em_conversao | orcado |
| orcado | em_conversao, pago, modelando |
| pago | orcado, modelando |
| modelando | pago, orcado, imprimindo |
| imprimindo | modelando |
| cancelado / entregue | nenhum |

Motivo obrigatório: orcado→em_conversao, pago→orcado, modelando→pago, modelando→orcado, imprimindo→modelando, orcado→modelando. Nas demais arestas é opcional; quando presente deve ser não vazio após btrim, com até 1000 caracteres. Cancelamento e reabertura sempre exigem motivo. Texto persistido é aparado; hash considera o argumento bruto, portanto mudar espaços numa tentativa já usada não é o mesmo payload.

Mesmo estado/destino proibido: invalid_order_transition/P0001. Motivo inválido: invalid_input/22023. Transição comum só altera estado/version (e updated_at pelo trigger), evento e recibo. `pago` não comprova recebimento e não escreve financeiro, snapshots ou estoque.

## Cancelamento

Qualquer não terminal → cancelado. Nova tentativa já cancelada falha order_already_cancelled; entregue falha order_already_delivered. Versão divergente é rejeitada antes de estado terminal. Reserva active válida é integralmente finalizada com literal release e motivo. Reservas/itens/histórico preservados; cancelled_at preenchido; sem movimento/settlement/baixa física. Inventário reduz reserved_balance e incrementa versão uma vez por reserva. Inconsistência prévia bloqueia sem reparo silencioso.

## Reabertura estrita

Somente cancelado → em_conversao; limpa cancelled_at, preserva identidade, preços, itens e histórico. Manual totalmente untracked não cria quota/número/pedido novo. Qualquer stock/make_to_order exige intermediate efetivo e access_state paid, além de sales.write. Advanced/trial/expirado não concede essa capacidade.

Todos os stock são agrupados por produto; disponibilidade integral de **todos** os grupos é validada antes da primeira reserva nova. Qualquer falta aborta tudo mantendo cancelado. Cria novo registro por item stock; nunca reativa released/consumed e nunca converte stock em demanda por falta de saldo. Make_to_order explícito sem histórico permanece demanda sem reserva automática. Active/consumed ou histórico incompatível no cancelado é erro semântico. Proteção C2b contra realocação de item histórico e C2c contra substituição física permanecem intactas.

## Entrega integral e escrituração

De qualquer não terminal, sem gate financeiro ou obrigação de passar por pago/produção. Cada stock precisa de uma reserva active exata de produto/quantidade; make_to_order pendente bloqueia; untracked não tem reserva. Extras/consumidos prévios/inconsistências são rejeitados. Saldo reservado é reconciliado contra todas as reservas active da empresa/produto, não somente do pedido. Headroom de versão cobre todas as finalizações por produto.

Finalizador B recebe literal consume e NULL motivo. Seu retorno determina movimento exit: quantity=-q, request_quantity=q, counted_balance NULL, balance_before=after+q, balance_after=after, request_expected_version=v-1, result_version=v. Uma tentativa UUID interna distinta por movimento. Não chama move_product_inventory nem incrementa inventário novamente. Settlement usa vínculos exatos e UUID persistido do evento como delivery_operation_id. Status entregue, delivered_at, versão, evento, movimentos, settlements e recibo compartilham a transação: qualquer exceção desfaz tudo. Pedido manual pode entregar sem movimentos.

## Downgrade, locks e replay

Liberação/consumo de reservas legítimas anteriores não exige paid físico, inventory.write ou janela Free de produtos. Autorização central atual continua obrigatória: owner Free pode recuperar; admin/operator Free e cenários de seleção/regularização bloqueados não recebem bypass. Nova reserva na reabertura exige entitlement e produto ativo/não excluído/visível. Estado incompatível/corrupção de inventário não é corrigido automaticamente.

Ordem: mutex global de gestão → contexto/autorização/plano → mutex attempt/recibo → pedido FOR UPDATE → todos produtos UUID ordenados → todas posições por produto ordenado → reservas UUID ordenadas → efeitos/evento/recibo. Transição não precisa locks físicos. Toda a barreira de produtos precede posições e reservas; locks até commit. Mutex global preservado pode limitar throughput, não prova ausência de deadlock.

Recibo privado na chave empresa/ator/comando/attempt; hash canônico dos argumentos, incluindo expected_version e motivo/destino quando aplicáveis. Hash divergente → idempotency_conflict/23505. JSON exige tipos, UUIDs/versão válidos, status correto, pedido, versão histórica expected+1 e evento UUID persistido com tenant/ator/tipo/from/to/motivo/metadados attempt/hash corretos. Pedido atual deve existir com versão >= histórica. Inconsistência → receipt_result_unavailable/P0002. Entrega também verifica vínculos consumed/settlement/movimento, quantidades, sinais, ator, versões/balanços e contagens integrais. Replay não repete efeitos nem reaplica gates novos de estado/versão/produto/plano físico; não exige reservas de reabertura ainda active.

## Erros e validação

| Erro | SQLSTATE |
| --- | --- |
| invalid_input | 22023 |
| unauthorized, plan_feature_unavailable, selection_required | 42501 |
| invalid_order_transition, order_already_cancelled, order_not_cancelled, order_already_delivered, order_fulfillment_incomplete, order_item_stock_mismatch | P0001 |
| reservation_balance_inconsistent, delivery_event_unavailable | 23514 |
| order_unavailable, receipt_result_unavailable | P0002 |
| insufficient_stock | P0003 |
| version_conflict | 40001 |
| version_limit_exceeded | 22003 |
| idempotency_conflict | 23505 |

A inconsistência de agregado usa 23514, alinhado ao finalizador B (C2b tinha verificação própria com P0001); não altera erros das RPCs históricas. Histórico de item incompatível na reabertura usa order_item_stock_mismatch/P0001. Dependências podem produzir erros específicos de preflight ou dos helpers existentes. Falhas de integridade nunca viram sucesso. Assertions de fonte: `node supabase/tests/orders_stage72c3_source_checks.cjs`. Inspeção manual read-only: `supabase/tests/orders_stage72c3_structure_manual.sql`. Roteiros pendentes: `supabase/tests/orders_stage72c3_scenarios_manual.md`. Estado efetivamente executado no relatório de revisão; nenhuma aprovação funcional decorre destes documentos.

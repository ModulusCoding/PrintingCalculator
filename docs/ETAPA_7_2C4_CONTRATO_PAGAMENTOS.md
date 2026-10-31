# M7.2-C.4 — contrato técnico de pagamentos manuais

## Aprovação, escopo e dependências

F1–F4 e convenções técnicas foram explicitamente aprovadas pelo responsável. O planejamento preliminar não é mais uma solicitação de aprovação comercial; as políticas abaixo são o contrato desta implementação. Implementação candidata à revisão/aplicação manual em **uma única migration transacional**, `supabase/migrations/20261026184000_orders_stage72c4_payments.sql`. Timestamp verificado livre e posterior à C3d 183000 antes da criação. Não aplicar automaticamente. Nenhuma migration histórica é alterada.

A..C3 foram informadas como instaladas em desenvolvimento; aplicação não significa homologação. Catálogo instalado não foi consultado nem comparado independentemente nesta sessão. Fontes: schema A, C1 decimal/hash/recibos, C2a/b/c (edição efetiva), B/B1, C3 com event_uuid, auth/permission evaluator e predicado de planos, contratos técnicos C1/C2/C3 e planejamento C4. Documento geral de Projeto 2026 não localizado nas análises anteriores.

Escopo exclusivamente manual, sem gateways, cobranças recorrentes, webhook, conciliação bancária, checkout, frontend ou reembolso externo.

## Fonte financeira e políticas aprovadas

`public.order_payments` permanece a única fonte de fatos financeiros. Ledger append-only A com entrada positiva `receipt` ou `refund`, `numeric` exato, 0.01..999999999999.99 e escala <=2; métodos existentes pix/card/cash/bank_transfer/other. `effective_at` explícito finito, `recorded_at` servidor, ator/empresa/pedido derivados e nota limitada. Não guardar dados sensíveis.

- **F1:** registrar em sales.write; estornar em sales.delete; consultar em sales.read. Sem permissões novas ou bypass do avaliador central. Operator autorizado pode receber, não estornar.
- **F2:** receber em todo não cancelado, inclusive entregue, até o saldo atual; cancelado bloqueia recebimento novo. Estornar em qualquer estado. Financeiro não muda operacional nem estoque.
- **F3:** estorno integral e único por recebimento, preservando amount/method do original e seu UUID. Motivo obrigatório aparado de 1–1000 caracteres. Não é confirmação de reembolso por provedor. Correção é estorno integral seguido de novo recebimento válido, não UPDATE/DELETE do histórico.
- **F4:** novo total comercial não pode ficar abaixo de líquido recebido. Total zero é financeiro pago sem linha fictícia. Cancelar preserva valores e lançamentos, nunca cria refund automático.

Default de evento C3: `order_events.event_uuid` UUID persistido e único; `id` bigint identity permanece PK. Comandos record_payment/reverse_payment e tipos de evento payment_received/payment_refunded já são permitidos por A; a migration não precisa ampliar essas constraints.

## Estado financeiro derivado

- `total_received`: soma bruta de receipts, incluindo originais já estornados.
- `total_refunded`: soma de refunds.
- `net_received = total_received - total_refunded`.
- `pending_amount = total_amount - net_received`.
- `financial_status`: pago se líquido=total (inclusive 0=0); pendente se líquido=0 e total>0; parcial se 0<líquido<total.
- `cancelled_unreversed_amount`: líquido ainda não estornado quando operacional cancelado, zero nos demais.

As somas acumuladas não têm o limite unitário de um lançamento: ciclos de estorno/novo recebimento podem aumentar bruto/estornado, mas o líquido deve estar em 0..total. Não truncar somas nem usar float. Pedido cancelado mantém seu total e saldo comercial histórico; não interpretar pendente como cobrança ativa automática. `cancelled_unreversed_amount` identifica separadamente valor recebido ainda a devolver/acertar manualmente, sem estorno automático.

Não há campo persistido de saldo/status financeiro. O estado operacional pago é independente e nunca prova recebimento. Datas efetivas passadas/futuras finitas são aceitas por convenção aprovada, sem regra silenciosa de janela; ordenação do histórico usa recorded_at,id.

## API

Assinaturas públicas (tipos e nomes de argumentos):

```text
record_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
                     p_amount text,p_method text,p_effective_at timestamptz,p_note text DEFAULT NULL)
reverse_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
                      p_payment_id uuid,p_effective_at timestamptz,p_reason text)
get_order_financial_summary(p_order_id uuid)
get_order_payment_history(p_order_id uuid,p_limit integer DEFAULT 50,
                          p_before_recorded_at timestamptz DEFAULT NULL,
                          p_before_payment_id uuid DEFAULT NULL)
```

Valor de recebimento em texto decimal canônico via parser C1: sem sinal negativo, expoentes, vírgula, espaços, NaN/Infinity ou mais de duas casas. Não arredondar silenciosamente. Nota/referência opcional existente no schema; motivo de estorno obrigatório. Nenhum parâmetro confiável de empresa/ator/plano ou valor de refund escolhido pelo cliente.

Mutações retornam snapshot histórico:

```text
(status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,
 total_amount numeric,total_received numeric,total_refunded numeric,
 net_received numeric,pending_amount numeric,financial_status text,
 cancelled_unreversed_amount numeric)
```

Status de mutação: `payment_received` e `payment_refunded`. Resumo retorna `(order_id,version,operational_status,total_amount,total_received,total_refunded,net_received,pending_amount,financial_status,cancelled_unreversed_amount)`. Histórico retorna `(payment_id,order_id,actor_id,entry_type,amount,method,effective_at,recorded_at,reverses_payment_id,note)`. Campos financeiros são numeric; versão bigint; IDs UUID. As consultas são autorizadas e tenant-safe; resumo e histórico têm snapshots independentes. Limite de histórico 1–100, cursor completo (timestamp finito e UUID) ou ambos NULL. Paginação por recorded_at,id não promete ordem de commit: now() é início da transação e timestamps podem empatar; use ambos os componentes, sem ordenação por UUID do evento. Recarga após mutação é recomendada. Não carregar histórico ilimitado no browser.

## Integridade e interação com edição/C3

A unicidade parcial do estorno protege enterprise/reverses_payment_id para refund, além da validação do alvo receipt e igualdade de amount/method. Histórico prévio incompatível deve abortar preflight, sem reparo/deleção. Não criar tabela paralela ou reinterpretar refund antigo como reembolso externo.

Trigger de integridade **BEFORE UPDATE OF total_amount** verifica o líquido sob a barreira da linha do pedido e rejeita novo total inferior. Não redefine update_order nem relaxa suas guardas de terminal/reserva/modo físico; mudanças já feitas em itens por C2c são revertidas na mesma transação se o trigger falhar. Atualizações de status/timestamps/version C3 que não atribuem total_amount não disparam essa guarda. Não cria gate financeiro para cancelar/entregar ou altera comandos C3.

Recebimento/estorno bloqueiam pedido e incrementam versão uma única vez, mantendo operacional, totais comerciais, itens e inventário iguais. Evento financeiro usa from/to NULL conforme A, versão nova e UUID persistido. O lançamento, incremento, evento e recibo pertencem à mesma transação; qualquer falha reverte tudo.

## Segurança, concorrência e replay

Global mutex de gestão → business_ready e identidade/empresa atuais → autorização central → mutex de tentativa/recibo → pedido FOR UPDATE → recebimento original quando necessário → escritas/evento/recibo. Nenhum lock físico é necessário. Todos os writers comerciais/operacionais suportados compartilham a linha do pedido. Duas parcelas não podem ultrapassar saldo sob esse protocolo e UNIQUE protege duplo estorno. Mutex global preservado pode limitar throughput e não comprova ausência de deadlock.

SECURITY DEFINER, owner postgres, search_path vazio, objetos qualificados. EXECUTE público somente authenticated. Helpers/trigger privados sem EXECUTE aos papéis API; nenhuma permissão DML financeiro concedida. A migration revoga explicitamente INSERT/UPDATE/DELETE/TRUNCATE de orders/order_payments/order_events/recibos para PUBLIC/anon/authenticated/service_role e verifica privilégios efetivos; defaults do ambiente hospedado não são presumidos. Se grants herdados ainda permitirem escrita direta, a migration falha para revisão, sem ampliar matriz central. Free/downgrade aplica exatamente autorização central atual: owner pode resolver financeiro sem paid físico/quota/janela de produto; outros atores bloqueados pelo plano não recebem exceção. Seleção/regularização e identidade continuam barreiras.

Recibo em chave empresa/ator/comando/attempt, hash canônico de argumentos brutos relevantes. Hash divergente → idempotency_conflict. Tipos/UUIDs/versão/arithmetic/snapshot/evento e ledger precisam concordar para replay; não basta JSON bem formado. Evento imutável vincula snapshot histórico e attempt/hash. Pedido atual existe com versão >= histórica; original e contrapartida são preservados. Replay precede estado/versão/saldo de operação nova, não repete efeitos e não exige que o líquido/status atuais igualem snapshot antigo. Mesmo recebimento já estornado pode retornar sucesso histórico original.

## Erros estáveis

| Erro | SQLSTATE |
| --- | --- |
| invalid_input | 22023 |
| unauthorized | 42501 |
| order_unavailable, payment_unavailable, receipt_result_unavailable | P0002 |
| order_cancelled | P0001 |
| version_conflict | 40001 |
| version_limit_exceeded | 22003 |
| idempotency_conflict, payment_already_reversed | 23505 |
| payment_exceeds_pending, total_below_net_received, payment_balance_inconsistent, payment_ledger_unavailable, payment_event_unavailable | 23514 |

Sem recibo válido, versão divergente precede novos checks de estado/saldo. Preflight pode falhar com orders_c4_dependency_missing/schema_mismatch/prior_receipts_require_review e assertions de segurança; histórico incompatível é bloqueado sem conserto automático. O helper agregado recusa refund inválido/duplicado ou líquido fora de 0..total. Recebimentos/estornos pré-C4 com recibos financeiros de protocolo desconhecido exigem revisão em vez de serem tratados como replay C4.

## Verificação e limitações

`supabase/tests/orders_stage72c4_source_checks.cjs`: assertions textuais sem parser SQL. `supabase/tests/orders_stage72c4_scenarios_manual.md`: roteiros de navegador, ACL, concorrência, rollback e reconciliação, tudo pendente de execução real. Resultados efetivamente executados e detalhes finais no `ETAPA_7_2C4_RELATORIO_REVISAO.md`.

Nenhum PASS textual comprova aplicação PostgreSQL, grants efetivos, isolamento concorrente ou rollback. Preflight não substitui confronto dos corpos/constraints/triggers instalados com o repositório. Aplicação/homologação permanecem responsabilidade do revisor em ambiente autorizado.

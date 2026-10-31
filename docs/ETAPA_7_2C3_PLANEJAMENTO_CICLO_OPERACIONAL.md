# M7.2-C.3 — planejamento histórico (M1–M5 aprovadas)

> Atualização de implementação: o responsável aprovou M1–M5 e posteriormente a identidade adicional `order_events.event_uuid uuid` (default, NOT NULL, UNIQUE), preservando PK bigint e imutabilidade. O texto abaixo conserva o planejamento original; menções a aprovação pendente descrevem seu estado histórico, não uma pendência atual. Contrato vigente e validação em `ETAPA_7_2C3_CONTRATO_RPC_PEDIDOS.md` e `ETAPA_7_2C3_RELATORIO_REVISAO.md`.

## 1. Estado, escopo e evidência

Esta entrega é **somente análise e planejamento**. Nenhuma migration C.3 foi criada. Nenhum SQL remoto, instalação, mudança de C.1/C.2, frontend, auth, planos ou pagamentos foi executado.

O responsável informou A/B/B.1/C.1/C.2a/C.2b/C.2c aplicadas manualmente em desenvolvimento. Aplicação não é homologação. Arquivos locais não foram comparados com o catálogo instalado nesta sessão. Testes funcionais, de permissões efetivas, rollback e concorrência continuam pendentes; a futura interface não substitui todos os testes de banco/duas sessões.

Fontes consultadas:

- `docs/ETAPA_7_ANALISE_PEDIDOS.md`, especialmente §§8, 10 e decisões D6–D8: propostas históricas, não matriz aprovada para os sete estados atuais.
- `docs/ETAPA_7_2_CONTRATO_TECNICO_PEDIDOS.md`, especialmente §3: reabertura cancelada atômica sob Visionário quando física; correção posterior sobre ausência de triggers defensivos pressupostos em notas antigas.
- `docs/ETAPA_7_2B_COMPATIBILIDADE_RPCS.md`, contratos C1/C2 e relatório C2.
- Migrations de Pedidos A/B/B.1/C.1/C.2a/C.2b/C.2c; inventário `20261020000000_finished_product_inventory.sql`; autorização `20261026150000_pricing_actor_authorization.sql`, planos `20261025000000_stage6_plans_entitlements.sql` e `20261026060000_plan_business_regularization.sql`.

O documento geral “Modulus — Documento de Projeto | 2026” não foi localizado. A análise 7.1 propunha estados Novo/Produção/Pronto e terminais sem reabertura; o contrato técnico posterior e a solicitação C.3 explicitam reabertura. Portanto, não transportar aquela matriz nem sua proibição antiga para os estados atuais.

Verificação executada: `node supabase/tests/orders_stage72c2_source_checks.cjs` passou (assertions de fonte somente, não sintaxe/execução PostgreSQL). Não há teste C.3 executável nesta entrega porque não há implementação C.3.

## 2. Decisões já explícitas — não precisam de nova confirmação

- Estados atuais: em_conversao, orcado, pago, modelando, imprimindo, entregue, cancelado. Pago é etapa operacional, não recebimento.
- Transição comum exige sales.write, não altera estoque nem pagamentos. Entregue/cancelado somente por RPCs específicas.
- Versão esperada, empresa/ator da sessão business_ready, idempotência e histórico imutável em todas as operações.
- Cancelar libera somente reservas ativas, sem baixa física; entregue não pode ser cancelado.
- Reabrir somente cancelado, preservando pedido/itens e criando novos ciclos de reserva, jamais reativando released/consumed.
- Nova capacidade física exige intermediate efetivo pago. Cancelamento/liberação e entrega de reservas legítimas anteriores não exigem renovar entitlement físico após downgrade.
- Entrega é integral; make_to_order físico não alocado bloqueia. Pedido inteiramente untracked pode ser entregue no Free.
- Não alterar cota vitalícia, numeração, preços, snapshots, pagamentos, matriz global de permissões ou proteção de edição C2c.

## 3. Matriz proposta — decisão comercial pendente M1

Não foi encontrada matriz aprovada dos sete estados nas fontes disponíveis. Proposta conservadora: avanços adjacentes e retornos adjacentes auditados; uma exceção explícita permite produção antes da etapa pago. Não liberar saltos arbitrários.

| Origem | Destinos de transition_order propostos |
| --- | --- |
| em_conversao | orcado |
| orcado | em_conversao, pago, modelando |
| pago | orcado, modelando |
| modelando | pago, orcado, imprimindo |
| imprimindo | modelando |
| cancelado | nenhum; somente reopen_order |
| entregue | nenhum; sem reabertura/devolução nesta etapa |

Justificativas:

- orcado → modelando evita forçar a etapa pago para produzir uma venda a prazo; modelando → orcado é o retorno simétrico. Não escreve order_payments.
- Retorno de etapa e a exceção que pula pago exigem motivo não vazio; avanços adjacentes podem ter motivo opcional. Proposta de limite comum: texto aparado, 1–1000 caracteres quando presente (compatível com evento).
- Mesmo estado com nova tentativa falha `invalid_order_transition`/P0001, sem versão/evento/recibo novo. Mesma tentativa já concluída recupera recibo.
- Retornos não liberam estoque nem desfazem produção/finanças. Não adicionar fase Pronto ou checklist persistido inexistente.
- A C2c continua permitindo edição integral de pedidos totalmente untracked em qualquer estado não terminal; esta proposta não amplia nem restringe essa regra incidentalmente.

**M2, entrega:** propor deliver_order a partir de qualquer um dos cinco estados não terminais, desde que todo atendimento físico esteja completo. Isso atende venda manual sem produção e evita obrigar transitar por imprimindo ou pago. A chamada explícita de entrega é o atesto do atendimento untracked; não criar checklist/coluna adicional. Alternativa: lista restrita de origens, a ser definida antes de implementar. Não bloquear por saldo financeiro nem consultar pagamentos nesta etapa.

## 4. Divisão proposta de migrations

| Etapa | Conteúdo e dependências |
| --- | --- |
| C.3a | transition_order com matriz aprovada, validação de resultado histórico vinculado a evento, versão/evento/recibo. Sem inventário. |
| C.3b | cancel_order usando finalize_order_item_reservation(...,'release',reason). Conjunto completo de locks antes da primeira liberação; status/timestamp/evento/recibo. |
| C.3c | reopen_order com política aprovada de saldo e retorno de status. Reutiliza reserve_order_item_stock para novos ciclos, mantendo IDs/modos dos itens. |
| C.3d | deliver_order: valida atendimento integral, consome via helper B, insere um movimento e settlement por reserva, status/timestamp/evento/recibo atômicos. |

Não criar schema paralelo ou tabela permanente de operações. Preferir validações de recibo estreitas em cada comando; um helper privado comum só se repetição real justificar, sem autoridade alternativa de autorização. Não redefinir writers anteriores por conveniência.

## 5. Contratos preliminares das RPCs

Todas SECURITY DEFINER, owner postgres, search_path vazio, objetos qualificados, EXECUTE somente authenticated; sem grants novos de tabela ou inventory.write.

```sql
public.transition_order(
  p_attempt_id uuid, p_order_id uuid, p_expected_version bigint,
  p_target_status text, p_reason text DEFAULT NULL
)
public.cancel_order(
  p_attempt_id uuid, p_order_id uuid, p_expected_version bigint,
  p_reason text
)
public.reopen_order(
  p_attempt_id uuid, p_order_id uuid, p_expected_version bigint,
  p_reason text
)
public.deliver_order(
  p_attempt_id uuid, p_order_id uuid, p_expected_version bigint
)
```

Retorno comum proposto:

```sql
RETURNS TABLE(
  status text, order_id uuid, operational_status text,
  version bigint, event_id uuid
)
```

Status de resultado: transitioned/cancelled/reopened/delivered. Recibos usam transition/cancel/reopen/deliver, já permitidos por A. Incluir no hash canônico todos os argumentos, inclusive expected_version e motivo; sem empresa/ator/plano/totais do cliente. Event_id permite vincular resposta ao fato histórico imutável sem carregar arrays potencialmente >8192 bytes.

Permissões propostas (**M3**, não ratificadas na análise antiga): transition/reopen/deliver em sales.write; cancel em sales.delete, preservando owner/admin e excluindo operator do cancelamento. Não alterar a matriz global. Alternativa: cancelar também em sales.write, explicitamente permitindo operator. Aprovar o mapeamento antes de implementação.

### Replay e erros

Contexto/autorização atuais antes de acessar recibo. Mutex de tentativa por empresa/ator/comando/attempt antes da leitura; hash divergente → idempotency_conflict/23505. Recibo ausente permite caminho novo. JSON inválido/incompleto/incoerente → receipt_result_unavailable/P0002, sem reparo automático.

Validar tipos e conversões de UUID/versão com captura limitada de erros, identidade de empresa/ator/comando/tentativa/pedido, status de resposta, versão expected+1 e evento correspondente (tipo, ator, from/to, order_version, event_id). Pedido deve existir na mesma empresa com versão atual >= versão histórica. Nunca exigir igualdade do status atual com o resultado histórico. Em entrega, conferir também vínculos imutáveis de settlement/movimento/reserva consumida; não basta um JSON formalmente válido. Não exigir reservas ainda ativas no replay de cancel/reopen.

Erros novos propostos P0001: invalid_order_transition, order_already_cancelled, order_not_cancelled, order_already_delivered, order_fulfillment_incomplete. Reutilizar version_conflict/40001, version_limit_exceeded/22003, unauthorized/42501, plan_feature_unavailable/42501, insufficient_stock/P0003, order_unavailable/P0002 e os erros de inconsistência existentes. Vocabulário final será fechado nos contratos de implementação.

## 6. Cancelamento e reabertura

### Cancelamento

De qualquer não terminal para cancelado. Motivo obrigatório aparado 1–1000 caracteres, reutilizado nas liberações e no evento. Liberar cada reserva ativa integralmente; untracked/make_to_order sem reserva não provocam operação fictícia. Não mudar os modos dos itens ao cancelar. cancelled_at preenchido; delivered_at continua nulo; versão do pedido +1 uma vez. Inventário: reservado diminui e versão +1 por liberação, físico/ledger/settlements iguais. Inconsistência prévia bloqueia, não é reparada silenciosamente.

**M4:** nova tentativa em pedido já cancelado deve falhar order_already_cancelled (sem novo recibo/no-op); tentativa original válida retorna seu sucesso histórico. Versão divergente é rejeitada antes do estado, como C2c. Mesmo padrão para nova tentativa em pedido já entregue.

### Reabertura — política recomendada M5

- Destino fixo em_conversao: não inferir estágio anterior por eventos, nem restaurar pago como atestado financeiro. Motivo obrigatório; cancelled_at deve ser limpo devido ao CHECK A, e delivered_at permanece nulo. Evento de cancelamento conserva o timestamp/motivo histórico; não sobrescrever eventos.
- Pedido inteiramente untracked pode reabrir no Free autorizado. Não cria pedido nem consome nova cota/número.
- Qualquer item físico exige intermediate efetivo pago, inclusive make_to_order ainda sem reserva. Downgrade bloqueia reabertura física, mas não cancelamento/entrega de obrigação anterior.
- Para todos os itens atuais stock (originalmente reservados), somar quantidades por produto e exigir saldo integral para **todo o pedido a reabrir**. Havendo falta em qualquer produto, abortar reabertura inteira e manter cancelado, sem novas reservas.
- Com saldo, criar uma reserva nova por item stock. Reservas released permanecem intocadas. Não reutilizar IDs de reserva. make_to_order sem histórico continua demanda sem reserva automática, como C2.
- Cancelado com reserva active ou consumed é inconsistência, não atalho de reabertura; bloquear e diagnosticar.

Alternativa comercial: reabrir mesmo sem saldo, convertendo stock em make_to_order, sem reserva parcial por produto. **Não recomendada neste recorte**: allocate_order_stock C2b rejeita qualquer histórico do item, mesmo released (`20261026174000...`, linhas 133–137). Um stock cancelado convertido em demanda ficaria sem caminho de alocação pública. Essa alternativa exigiria redefinição incremental aprovada de alocação (sem editar C2 histórica), validação de ciclos liberados e expansão da entrega. O caminho estrito preserva os contratos C2 e evita esse bloqueio.

## 7. Compatibilidade de estoque e desenho de entrega

### Helpers efetivos nas fontes B

- `private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint) RETURNS uuid`: exige item persistido com produto/quantidade exatos e modo stock/make_to_order; aceita novo ciclo após released por não haver active. Exige produto ativo/não excluído, saldo integral e teto de versão; reservado +q, inventário versão +1; físico igual. Não autoriza tenant nem adquire todo o conjunto de locks.
- `private.finalize_order_item_reservation(uuid,uuid,uuid,text,text) RETURNS TABLE(product_id uuid,quantity bigint,resulting_balance bigint,resulting_reserved_balance bigint,inventory_version bigint)`: release subtrai reservado; consume subtrai reservado **e físico**; ambos versão +1 e active → released/consumed. Não grava movimento/settlement/evento/recibo. Caller deve possuir locks de produtos e posições.
- O finalizador não rejeita explicitamente p_action NULL. C3 deve passar somente literais release/consume; não encaminhar ação do cliente. Não é necessária uma nova API genérica de finalização; eventual hardening privado incremental pode ser discutido sem editar B.

### Entrega integral

1. Conferir todos os itens sob pedido bloqueado: untracked não demanda reserva; cada stock exige uma única reserva active com quantidade integral e vínculos exatos; make_to_order não alocado bloqueia mesmo que haja saldo livre. Não alocar implicitamente em deliver.
2. Bloquear conjunto completo de produtos/posições/reservas, validar soma ativa de toda a empresa/produto contra reservado e quantidade deste pedido; validar teto de versões por produto para todas as finalizações. Reservas inesperadas em untracked, quantidades incompatíveis ou consumed prévios bloqueiam por inconsistência.
3. Para cada reserva, em ordem determinística, chamar finalize(...,'consume',NULL). Usar o retorno de **cada chamada**, inclusive quando o produto se repete.
4. Inserir movimento oficial product_inventory_movements do tipo exit, quantity=-q, request_quantity=q, request_counted_balance=NULL, balance_after=retorno, balance_before=retorno+q, result_version=retorno.inventory_version, request_expected_version=result_version-1. Motivo de sistema aparado 1–500 caracteres sem PII, identificando entrega. Não incrementar inventário novamente.
5. Inserir settlement exato ligando empresa/pedido/item/reserva/produto/quantidade/movimento e delivery_operation_id comum. Proposta: usar event_id da entrega, gerado antes, como identificador comum; movimento tem attempt UUID interno novo por reserva, diferente do attempt público. Nenhuma nova tabela necessária.
6. Marcar entregue e delivered_at, versão do pedido +1 uma vez; evento delivered from/to correto e recibo. Pedido só se torna entregue se todos os vínculos forem gravados. Qualquer erro, inclusive último item/evento/recibo, desfaz a operação inteira.

**Não chamar move_product_inventory para a baixa:** além do gate inventory.write/estoque livre, isso duplicaria a baixa já realizada pelo finalizador. A extensão mínima é a orquestração transacional C3d no mecanismo B existente, não um segundo writer físico.

Constraints relevantes: settlement é único por reserva e por movimento; cada movimento exige attempt único por empresa/ator, não por produto. Portanto, um único movimento agregado para várias linhas é incompatível. Usar um por reserva com tentativas internas distintas e o mesmo identificador de entrega. FKs asseguram identidade tenant-safe, mas não provam sinal/quantidade/estado consumido/ator: o caller e testes devem validar essas semânticas. Timestamps A exigem entregue iff delivered_at e cancelado iff cancelled_at.

## 8. Locks, downgrade e limites de acesso

Ordem proposta para pedidos existentes:

1. Mutex global de gestão já existente → contexto/identidade → autorização central e resolução de plano.
2. Mutex de tentativa/recibo; recuperar histórico antes de rejeitar nova capacidade física/estado/versão.
3. Pedido FOR UPDATE → versão e estado → leitura das identidades dos itens/reservas, sem row locks de reserva.
4. Todos os produtos por UUID crescente → todas as posições por product_id crescente (tenant fixo).
5. Reservas afetadas por UUID crescente → finalizações/novas reservas → movimentos/settlements → evento/recibo.

Transição comum termina no pedido/evento, não toma locks físicos desnecessários. Todos os locks são retidos até commit. Não adquirir contexto depois de locks físicos nem processar produto→posição→reserva alternadamente por item. B1 usa a mesma barreira produto→posição nas saídas/arquivo/delete. C2c somente consulta/rejeita histórico sob pedido e não toma lock antecipado de reserva. Criação C2 mantém quota/contador próprios; C3 não adquire contador/cota.

Precisão importante: `get_my_access_context()` nas fontes retorna contexto, mas não adquire os locks alegados em alguns comentários antigos. C3 deve adquirir explicitamente o mutex global antes do contexto, como C2, sem depender desses comentários. O avaliador efetivo `can_access_enterprise` delega ao avaliador por usuário e ao predicado de plano; não substituir por testes isolados de role.

Após downgrade, owner ainda pode sales.write/sales.delete pelo predicado Free existente; admin/operator perdem operação Free. Não contornar esse controle para manter exatamente os mesmos atores após downgrade. Não exigir inventory.write, plano pago ou janela de três produtos para **liberar/consumir reservas anteriores**; usar acesso estritamente vinculado ao pedido/reserva, sem expor catálogo nem criar nova reserva. Produto ausente/posição ausente/inconsistência continuam erros; produto apenas fora da janela Free não deve prender obrigação. Arquivo/delete com active é vedado por B1: estado incompatível sinaliza drift, não deve ser reparado implicitamente.

Seleção pendente, identidade/membership/empresa inválida ou regularização de equipe ainda podem ser barradas pela autorização central. O requisito de downgrade não autoriza bypass global dessas restrições. Mutex global pode serializar operações entre empresas e reduzir throughput; será preservado, não é substituto de lock order nem comprovação de ausência de deadlock.

## 9. Validação futura (tudo pendente)

Antes da implementação/aplicação, coletar manualmente definições efetivas/ACL/owners/search_path e constraints/triggers de A/B/C2, incluindo helpers e ledger. Nenhum SQL remoto será executado pelo agente. Pode-se reaproveitar o preflight read-only C2 como base e ampliar a coleta na implementação C3.

Roteiro para interface + banco autorizado:

- Avanços/retornos de M1, motivo obrigatório, exceção sem pago, salto proibido, mesmo estado e versões concorrentes.
- Cancelamento com várias reservas/produtos, sem reserva, tentativas novas/replay, entregue rejeitado; saldo físico/ledger iguais e reservado reconciliado.
- Reabertura manual Free; física paga com saldo completo; saldo insuficiente em um de vários produtos mantém tudo cancelado; ciclos released preservados; downgrade impede nova reserva.
- Entrega untracked Free; mista integral; make_to_order pendente bloqueia; stock sem reserva ou quantidade divergente bloqueia; dois itens de mesmo produto geram movimentos/settlements individuais com versões sequenciais.
- Cancelar/entregar reserva anterior após downgrade sem exigir janela de catálogo; ator sem sales atual deve ser recusado.
- Replay depois de cancelar→reabrir→entregar e depois de produto mudar: resultado histórico consistente sem repetir estoque; JSON corrompido ou vínculo errado falha semanticamente.
- Falhas injetadas no último movimento/settlement/evento/recibo: rollback de todos os saldos, estados, timestamps e versões; ledger físico versus posição e soma active versus reserved_balance.
- Sessões simultâneas: cancelar×entregar, reabrir×criar, alocar×cancelar, entrega×saída manual, mesmo attempt, tentativas distintas com mesma expected_version e downgrade concorrente.
- Tenant estrangeiro, operator cancelando conforme M3, anônimo, helpers/table DML direto, RPC autorizada somente sales sem inventory.write. Pagamentos existentes permanecem byte-for-byte iguais.

Navegador cobre fluxos e auth de aplicação; não prova sozinho lock order, todas as constraints ou rollback injetado. Registrar PostgreSQL/fixtures/payloads/versões e resultados reais; não converter checklist ou aplicação bem-sucedida em teste aprovado.

## 10. Aprovações necessárias antes de migrations

Aprovar a divisão C3a–d e os contratos preliminares, com estas decisões comerciais ainda não fechadas:

- **M1:** matriz e motivos de retornos/exceção sem pago (§3).
- **M2:** entrega a partir de qualquer não terminal mediante atendimento integral, sem gate financeiro/checklist novo.
- **M3:** cancel em sales.delete; transition/reopen/deliver em sales.write.
- **M4:** nova tentativa em cancelado/entregue retorna erro, não sucesso no-op.
- **M5:** reabrir para em_conversao; estoque integral obrigatório para todo stock ou rollback; make_to_order sem histórico permanece demanda; físico só intermediate pago.

As regras já explícitas no pedido C3 não estão sendo submetidas novamente à confirmação. **Aguardar aprovação; nenhuma migration C3 nesta execução.**

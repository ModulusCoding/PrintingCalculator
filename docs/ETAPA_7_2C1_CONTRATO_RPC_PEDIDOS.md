# M7.2-C.1 — Contrato de RPCs de criação e edição

**Estado:** candidata corrigida para revisão manual; não aplicada nem executada. A/B foram informadas como aplicadas em desenvolvimento, mas o catálogo remoto não foi consultado. O documento geral “Modulus — Documento de Projeto | 2026” não foi encontrado. Requisitos explícitos de C.1 são tratados como decisão limitada desta etapa.

## Atualização de contexto na C.2

Na solicitação C.2, o responsável informou a aplicação manual de A/B/B.1/C.1 em desenvolvimento, com inspeção de permissões/constraints/triggers. Isso atualiza o estado informado acima, sem representar consulta remota pelo agente. Testes funcionais e de concorrência foram adiados, não aprovados. A C.2 propõe substituir somente `create_order` e adicionar alocação em migrations novas; o contrato incremental está em `ETAPA_7_2C2_CONTRATO_RPC_PEDIDOS.md`. O contrato abaixo descreve a C.1 histórica. A candidata C.2c redefine `update_order` sem modificar o arquivo histórico, acrescentando bloqueio de substituição de itens físicos existentes; contrato incremental em `ETAPA_7_2C2_CONTRATO_RPC_PEDIDOS.md`.

## Assinaturas

- `public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)` recebe attempt, snapshot comprador/notes, JSON itens, tipo/valor desconto e frete em string decimal. Não recebe tenant, actor, plano ou totais.
- `public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)` recebe attempt, pedido, expected_version, snapshot comercial completo e substituição integral de itens.
- Ambos retornam `(status, order_id, display_number, version, subtotal, discount_amount, shipping_amount, total_amount)`.
- SECURITY DEFINER, owner postgres, `search_path=''`; EXECUTE somente authenticated. Helpers privados revogados às roles API. Sem DML direto para anon/authenticated.

## Regras de domínio

- `sales.write` e contexto empresarial derivam de sessão interna; IDs de tenant/actor não são input.
- Free (Aprendiz) conta todo histórico vitalício; no máximo três pedidos por empresa. Serialização com advisory transaction lock por empresa cobre count+insert, inclusive criações concorrentes. Intermediate e Advanced/Visionário sem limite de pedidos. Códigos inesperados falham fechado. Edição não consome cota.
- Numeração usa `order_number_counters` com `FOR UPDATE`, incremento e pedido na mesma transação; jamais `MAX()+1` para alocação. Se o counter estiver ausente e não houver histórico, cria em 1. Se houver histórico e faltar counter, falha `order_number_counter_bootstrap_required`; divergência do counter falha `order_number_counter_drift`.
- Idempotência por `(enterprise, actor, command, attempt)`, advisory lock antes de verificar recibo. Payload igual retorna resposta original sem repetir efeitos; payload diferente produz `idempotency_conflict`.
- Preços/frete/desconto são strings decimais canônicas; cálculo exato numeric no PostgreSQL. Fixed: `LEAST(input, subtotal)`. Percent: `round(subtotal*percent/100,2)`. Valores negativos, expoentes, escala >2 e limites inválidos são rejeitados. Sem subtotais do cliente.
- Itens de 1–100, quantity 1..1e9; modos apenas `untracked`. `stock`/`make_to_order` falham `stock_integration_unavailable`; sem writes de inventário/reservas.
- Qualquer `product_id`, mesmo em `origin='custom'`, requer produto da mesma empresa, ativo, não removido e visível. Produtos únicos bloqueados por UUID ascendente. Catalog usa snapshot de nome/descrição sob o lock; preço de venda pode ser negociado. Custom sem product_id permitido.
- Edição não-terminal usa expected_version, não muda status e incrementa versão pelo UPDATE de cabeçalho; trigger A atualiza `updated_at`, constraints validam cálculo/versão. Evento `updated` não contém PII.

## Reservas históricas e limite de edição

A M7.2-A define FKs compostas das reservas para `(enterprise_id,order_id,order_item_id)` e para o produto da linha, com `ON DELETE RESTRICT`; não há CASCADE. Estados `active`, `released` e `consumed` permanecem ligados ao item. C.1 rejeita antes da substituição integral: active → `active_reservation_edit_unsupported`; released/consumed → `reservation_history_edit_unsupported`. Não altera nem apaga reserva e não apaga itens referenciados. A edição completa de itens só prossegue sem qualquer reserva histórica. Preservar IDs/matching de linhas ao editar histórico requer definição de identidade de item (e comportamento para produto/quantidade/modo), que fica para aprovação futura; não foi inventada nesta correção.

## Locks, auditoria, riscos

Create adquire mutex global de gestão/contexto, cota, receipt key, valida payload, bloqueia produtos distintos em UUID crescente, valida cota, bloqueia counter e insere pedido/itens/evento/receipt atomicamente. Update adquire contexto, receipt key, pedido `FOR UPDATE`, reservas por id ordenado e produtos distintos em UUID crescente; nenhuma posição/reserva é alterada. Eventos A são imutáveis. Falhas PostgreSQL revertem a transação.

Risco ainda aberto: locks são analisados estaticamente, mas não foram testados com sessões simultâneas. Receipts idempotentes e cota requerem execução concorrente real; product rows ainda sincronizam com escritores existentes cuja definição remota B.1 não foi verificada. Não afirmar segurança comprovada.

## Erros estáveis pretendidos

`invalid_input`/22023; `unauthorized`/42501; `selection_required`/42501; `plan_feature_unavailable`/42501; `plan_limit_reached`/P0001; `idempotency_conflict`/23505; `product_unavailable`/P0001; `stock_integration_unavailable`/P0001; `order_unavailable`/P0002; `order_not_editable`/P0001; `active_reservation_edit_unsupported`/P0001; `reservation_history_edit_unsupported`/P0001; `version_conflict`/40001; `version_limit_exceeded`/22003; `order_number_counter_drift`/P0001; `order_number_counter_bootstrap_required`/P0001.

## Compatibilidade e validação

A candidata preflighta nomes/assinaturas de alguns helpers e verifica existência/tipos básicos; o teste estrutural compara triggers/FKs/enum/grants esperados contra A local. Isso não é prova de correspondência com catálogo remoto, nem de corpo semântico de B/B.1, grants efetivos ou constraints completas. Confirmar catalog/owners/ACLs/constraints/triggers remotos em modo read-only antes de decidir aplicação.

Testes SQL funcionais, estruturais e concorrentes estão preparados e **não executados**. `git diff --check` passou; não há `psql` ou `pg_format`; Docker está instalado, mas daemon não iniciou, portanto não foi possível parser ou PostgreSQL local. Nenhum SQL remoto foi executado.

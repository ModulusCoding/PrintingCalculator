# M7.2-FLEX — homologação backend (NÃO EXECUTADA)

**Apenas roteiro; testes PostgreSQL continuam NÃO EXECUTADOS.** Na tentativa de homologação de 27/10/2026, o Docker Desktop foi iniciado, mas pull da imagem Supabase e criação de container exclusivo falharam com `read-only file system` no armazenamento interno. Nenhum banco foi criado; nenhum SQL, fluxo, ACL efetivo, rollback ou corrida foi validado. Evidências e procedimento de reprodução: `docs/ETAPA_7_2FLEX_BACKEND.md`. `node --test supabase/tests/orders_stage72flex_static.mjs` verifica **texto-fonte**, não interpreta SQL nem substitui estes testes. Migration alvo: `supabase/migrations/20261027120000_orders_stage72flex_delivery_cycles.sql`. Sem frontend ou dependências novas.

## Ambiente e evidências

Somente banco descartável autorizado; nunca produção. Aplicação manual pelo responsável, com dependências A/B/B1/C1/C2/C3/C4/D1 e definições efetivas conferidas. Registrar commit/migrations, ator, empresa, plano, payload integral, attempt, versão, resultado/SQLSTATE/mensagem e snapshots antes/depois. Não afirmar sucesso sem evidência. Cada caso usa pedido independente, salvo ciclos/replays explícitos.

Reusar padrão de `general_materials_manual.sql` e `product_window_capacity_manual.sql`: provisionar auth/identities/issuer/membership por infraestrutura local existente, não inventar linhas em `auth.users`; `request.jwt.claims` sozinho não cria usuário válido. Empresas A/B, owner/admin/operator, membro sem permissão, removido, anon; paid regular, Free, downgrade, seleção/regularização pendente. Não substituir ator por postgres/service_role. Criar pedidos/itens/reservas com RPCs aprovadas; adulteração apenas em clone de auditoria separado.

Fixtures de pedidos: sem itens; untracked; stock simples; dois itens mesmo produto; vários produtos; make_to_order; mistura dos três modos; reservas active/released/consumed; histórico de entrega anterior à FLEX; stock sem reserva/cadeia incompleta (clone apenas). Guardar UUID do **evento**, não PK bigint de `order_events`.

## Bloco SQL base executável após substituir fixtures

Exemplo de preservação sobre pedido stock já entregue com manifest válido. Alvo permitido: em_conversao/orcado/pago/modelando/imprimindo. Classificação `actual_delivery` preserva a baixa; `incorrect_record` compensa a baixa quando elegível. A ordem posicional de undo é **attempt uuid, order uuid, expected_version bigint, delivery_event uuid, target_status text, reason text, classification text**. Não inverter os três argumentos text. Resultado: status, order_id, operational_status, version, event_id UUID, source_delivery_event_id UUID, physical_effect.

```sql
BEGIN;
CREATE TEMP TABLE _flex_fixture (
  jwt_sub text, jwt_issuer text, enterprise_id uuid, actor_id uuid,
  order_id uuid, expected_version bigint, source_event uuid,
  target text, classification text, reason text, attempt uuid
) ON COMMIT DROP;
-- Substituir TODOS os __...__; não executar com placeholders.
INSERT INTO _flex_fixture VALUES (
  '__JWT_SUB_A__','__JWT_ISSUER_A__','__ENTERPRISE_A__','__INTERNAL_USER_A__',
  '__DELIVERED_ORDER_A__',__CURRENT_VERSION__,'__DELIVERY_EVENT_UUID__',
  'orcado','actual_delivery','FLEX regression',
  '72000000-0000-0000-0000-000000000001');
GRANT SELECT ON _flex_fixture TO authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub',jwt_sub,'iss',jwt_issuer,'role','authenticated')::text,true)
FROM _flex_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record; f record; BEGIN
  SELECT * INTO f FROM _flex_fixture;
  SELECT * INTO c FROM public.get_my_access_context();
  IF c.state IS DISTINCT FROM 'business_ready'
     OR c.enterprise_id IS DISTINCT FROM f.enterprise_id
     OR c.user_id IS DISTINCT FROM f.actor_id THEN
    RAISE EXCEPTION 'invalid authorized fixture';
  END IF;
END $$;
CREATE TEMP TABLE _flex_before AS
 SELECT to_jsonb(s) AS result FROM public.get_order_physical_state(
   (SELECT order_id FROM _flex_fixture)) s;
CREATE TEMP TABLE _flex_first AS
 SELECT to_jsonb(r) AS result FROM _flex_fixture f,
 LATERAL public.undo_order_delivery(f.attempt,f.order_id,f.expected_version,
   f.source_event,f.target,f.reason,f.classification) r;
CREATE TEMP TABLE _flex_replay AS
 SELECT to_jsonb(r) AS result FROM _flex_fixture f,
 LATERAL public.undo_order_delivery(f.attempt,f.order_id,f.expected_version,
   f.source_event,f.target,f.reason,f.classification) r;
DO $$ DECLARE r jsonb; f record; BEGIN
  IF (SELECT count(*) FROM _flex_first) <> 1 OR
     (SELECT count(*) FROM _flex_replay) <> 1 OR
     (SELECT result FROM _flex_first) IS DISTINCT FROM
     (SELECT result FROM _flex_replay) THEN
    RAISE EXCEPTION 'replay mismatch';
  END IF;
  SELECT result INTO r FROM _flex_first;
  SELECT * INTO f FROM _flex_fixture;
  IF (r->>'order_id')::uuid IS DISTINCT FROM f.order_id OR
     (r->>'source_delivery_event_id')::uuid IS DISTINCT FROM f.source_event OR
     (r->>'version')::bigint IS DISTINCT FROM f.expected_version+1 OR
     (r->>'event_id')::uuid IS NULL OR
     r->>'physical_effect' IS DISTINCT FROM 'preserved' THEN
    RAISE EXCEPTION 'undo contract mismatch';
  END IF;
END $$;
SELECT * FROM public.get_order_physical_state((SELECT order_id FROM _flex_fixture));
RESET ROLE;
-- Audit as inspector here: exactly one undo/event/receipt; no compensation,
-- no inventory/reservation/settlement/movement/payment delta for preservation.
ROLLBACK;
-- In a separate inspector transaction compare full pre-call baseline to prove
-- external rollback, not merely a successful ROLLBACK statement.
```

Para erro esperado usar subtransação PL/pgSQL (abaixo) ou SAVEPOINT + ROLLBACK TO; nunca continuar consultando numa transação abortada. Conferir **mensagem e SQLSTATE** do contrato efetivo, não aceitar qualquer exceção.

```sql
-- Executar dentro da transação autenticada acima, após o primeiro sucesso.
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM _flex_fixture;
  BEGIN
    PERFORM public.undo_order_delivery(f.attempt,f.order_id,f.expected_version,
      f.source_event,f.target,f.reason || ' changed',f.classification);
    RAISE EXCEPTION 'expected idempotency_conflict was not raised';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE; END IF;
  END;
END $$;
```

## Matriz funcional e invariantes (cada linha requer snapshots)

| ID | Caso | Resultado/invariante a verificar |
|---|---|---|
| F01 | Entregar untracked; desfazer para cada alvo permitido | Manifest completo sem baixa fictícia; undo `no_physical_movement`, uma versão/evento/recibo, sem inventário. |
| F02 | Entregar stock, preservar, retornar por estados não terminais, entregar novamente | Primeiro ciclo baixa uma vez; undo `preserved`; nova entrega não baixa novamente obrigação já satisfeita. Manifest vincula explicitamente ciclo e origem; nenhum settlement/movement duplicado. |
| F03 | Entregar stock, compensar integralmente | `compensated`; entrada exatamente igual à baixa original, uma compensation por vínculo exigido; histórico consumed/settlement/exit intacto; nenhuma reserva active recriada implicitamente. |
| F04 | Compensar → replanejar/reservar explicitamente → entregar | Nova reserva/baixa apenas por intenção explícita; ciclo anterior não é reinterpretado; saldo acompanha duas saídas e uma entrada. |
| F05 | Preservar → cancelar/reabrir/transitar → entregar → undo do novo ciclo | Não devolver duas vezes nem baixar duas vezes; qualquer bloqueio exigido por obrigações pendentes é explícito/atômico. |
| F06 | Dois itens mesmo produto e vários produtos | Agregados corretos, vínculos por item/ciclo, ordem determinística de locks; versão inventário segundo contrato, pedido +1 por comando. |
| F07 | make_to_order, combinação stock/untracked/make_to_order | Aplicar política FLEX final por modo: nenhum movimento inventado para não-stock; rejeições não deixam escrita parcial. |
| F08 | Pedido vazio, origem não entregue, cancelado, alvo inválido/terminal, modo desconhecido | Rejeição específica antes de qualquer efeito; conferir explicitamente matriz de transições final. |
| F09 | Origem inexistente, de outro pedido/tenant, evento não-delivery, ciclo antigo/já desfeito | Falha fechada; nenhum encadeamento entre pedidos, tenants ou ciclos. |
| F10 | Entrega anterior à FLEX | Política legacy explícita (reconstrução comprovável ou rejeição específica), nunca inferir que ausência de manifest significa ausência de movimento. |
| F11 | Produto inativo/arquivado/fora de janela; ator de reserva diferente | Preservação/compensação de obrigação histórica não exige elegibilidade de nova reserva; autorização central continua aplicada. |
| F12 | Pagamentos parciais/totais/refunds antes/depois | FLEX não altera ledger financeiro, total, net/pending ou produz refund; C4 continua funcional. |
| F13 | Versão stale, NULL, negativa, teto 9007199254740991 | `version_conflict`/invalid_input/version limit conforme contrato; replay válido histórico não exige versão atual. |
| F14 | NULL em cada argumento obrigatório; razão vazia/espaços/limites/Unicode; UUID malformado | SQL typing e validação de negócio distintas; limites exatos, nenhuma escrita. Texto bruto diferente no mesmo attempt conflita. |
| F15 | Leitura antes/depois de cada etapa, pedido desconhecido/tenant B | `get_order_physical_state(uuid)` reflete estado físico separado do operacional; não inventa movimento; nenhum efeito, vazamento ou enumeração cross-tenant. |
| F16 | Edição comercial/física e allocate após preservar/compensar | Guardas FLEX de histórico e imutabilidade de identidade respeitadas; não apagar/recriar item/reserva para fugir do ciclo. |
| F17 | Cancel/reopen/transition direto de entregue | Caminhos alternativos não contornam undo; política de alvo/reason/version/idempotência consistente. |

Após cada comando/replay: conferir quantidade de eventos/recibos/manifests/undos/compensations, order.version/updated_at, identidade/ator/attempt/hash/source, reserva e settlement. Para cada produto, `saldo_final = saldo_inicial + SUM(deltas oficiais no intervalo)`; `reserved_balance = SUM(quantity WHERE state='active')`, `0 <= reserved_balance <= balance`. Preservação tem delta zero; compensação soma apenas baixas históricas efetivamente compensadas; cada baixa só pode ser compensada uma vez. Sem DELETE/UPDATE de ledger histórico. Comparar C4 antes/depois integralmente.

## Replay, corrupção e rollback

- Mesmo attempt/payload duas vezes, após novas versões/ciclos/estoque alterado/downgrade: resposta histórica **idêntica**, sem escrita. Autorização atual continua obrigatória; membro removido não obtém replay.
- Mesmo attempt mudando isoladamente order/version/source/target/classification/reason (incluindo espaços): conflito. Mesmo UUID de attempt entre atores/tenants/comandos: isolamento conforme chave, nunca retorno do recibo alheio.
- Clone de auditoria: um campo por vez no recibo (tipo/UUID/versão/status/source/physical_effect/ator/hash), evento (UUID/versão/metadata), manifest (item/produto/quantidade/tenant/origem), undo/compensation e cadeia reservation→settlement→movement (ausente, extra, sinal, quantidade, produto, ator). Replay deve falhar `receipt_result_unavailable` onde contratado, nunca sucesso falso. Não exigir saldo/status presente igual ao snapshot histórico.
- Falha injetada no último INSERT de evento/recibo e após primeiro produto de vários: desfazer saldo, versão, timestamp, manifest, undo, compensation, reservas e movimentos integralmente. Instrumentação somente clone; remover apenas triggers de teste, nunca desativar proteções compartilhadas.
- ROLLBACK externo depois de sucesso e replay; falha de FK/unique/check/overflow; confirmar snapshots em conexão distinta após rollback. Registrar SQLSTATE real.

## Segurança e catálogo (inspeção + chamadas com papel real)

Inspecionar `pg_proc`, `pg_get_functiondef`, `pg_get_function_result`, `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, `relrowsecurity`, owners e ACLs. RPCs SECURITY DEFINER/postgres/search_path vazio; assinatura exata undo e get físico; sem overload público acidental. `aclexplode` deve excluir PUBLIC EXECUTE; `has_function_privilege` authenticated somente para RPC pública, anon/service_role negados, helpers privados negados a todos os papéis API. Verificar `has_table_privilege` e `has_any_column_privilege` para INSERT/UPDATE/DELETE/TRUNCATE nos três novos ledgers e histórico compartilhado. Conferir triggers imutáveis habilitados, FKs compostas de tenant/pedido/evento/movimento e unicidade por ciclo/origem/compensação e quantidades positivas. Manifest não tem FK para item vivo: mantém identidade histórica. Compensation não duplica order_id: deriva pedido via settlement e undo, ambos com FKs tenant-scoped; conferir coerência semântica entre os dois nas validações; tentar violações em fixtures privilegiadas e DML direto como authenticated/anon/service_role. RLS não substitui revogação de privilégios.

| Ator/contexto | Testar |
|---|---|
| Owner/admin paid; operator sales.write sem sales.delete | Delivery e undo exigem sales.write, portanto operator autorizado pode corrigir entrega; leitura exige sales.read. Cancel exige sales.delete e continua negado ao operator. |
| Membro sem sales.read/write/delete, removido, identidade/issuer divergente | Cada RPC negada, inclusive replay; sem leak de snapshot. |
| Owner Free/downgrade e admin/operator Free | Política central de equipe/plano preservada; não adicionar paid/inventory.write gate à correção de obrigação existente. Novas reservas obedecem gates próprios. |
| business não-ready, seleção pendente, empresa inativa, token ausente/anon | Negado antes de acesso/efeitos; avaliar todos os endpoints, inclusive get físico. |
| Tenant A com todos os UUIDs conhecidos de B | Nenhum read/write/replay em B; comparar contagens B e texto de erro sem dado sensível. |

## Concorrência: duas conexões reais e barreiras observáveis

Não basta Promise.all. Preparar JWT em **cada conexão**; A: BEGIN, chamada sem COMMIT; B: BEGIN, chamada bloqueante; observador inspeciona `pg_stat_activity/pg_locks`; A: COMMIT ou ROLLBACK; colher B e fechar transações. Timeouts e SQLSTATE registrados. Usar attempts distintos salvo teste de replay; repetir ordem inversa e primeiro vencedor com rollback.

| Corrida | Invariante final |
|---|---|
| undo × undo mesmo attempt/payload | Ambos retornam snapshot idêntico, efeito único. |
| undo × undo attempts distintos (preserve/preserve, compensate/compensate, preserve/compensate) | Um vencedor na mesma versão/origem; outro conflito, nunca duas entradas/undos. |
| deliver × deliver; deliver × undo do ciclo anterior | Sem baixa duplicada nem reutilização indevida de origem; perdedor deve renovar intenção/versão. |
| undo × cancel/reopen/transition/update/allocate | Serialização por pedido; não gravar intenção com versão antiga nem misturar manifest e itens de versões diferentes. |
| undo compensação × move_inventory/allocate/deliver de outro pedido mesmo produto | Sem lost update/overflow/reserved_balance inválido; locks em ordem consistente, sem deadlock recorrente. |
| multi-produtos A/B × B/A | Ordem global determinística; timeout não conta como aprovação. |
| auth/equipe/plano × undo/deliver/replay/read | Mutex global antes de contexto e locks físicos; nenhuma autorização stale após remoção/downgrade. |

## Migration e regressões

Em clones separados: instalação com tabelas vazias, histórico válido multi-ciclo/legacy, e histórico incompatível (duplicado, órfão, quantidade/tenant divergente). Compatível passa sem reparo destrutivo; incompatível aborta com diagnóstico e **sem objetos parciais**. Testar rollback de DDL, locks/tempo com volume representativo e política de reaplicação (não assumir idempotência). Comparar definições/triggers/ACLs legadas antes/depois. Rodar roteiros C1–C4/D1 existentes com ênfase em create/update/allocate/cancel/reopen/deliver e paginação de eventos. Aprovação depende de executar e anexar evidências de todos os casos aplicáveis; esta lista não é evidência de execução.

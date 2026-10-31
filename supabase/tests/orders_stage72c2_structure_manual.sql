-- C2a/C2b/C2c: inspeção MANUAL LOCAL futura; não é migração e não instala C2.
-- NÃO EXECUTADO: PostgreSQL local indisponível; daemon Docker indisponível.
-- A/B/B1/C1 informadas como aplicadas manualmente em dev, não verificadas aqui.
-- Testes adiados, sem aprovação funcional/concorrente ou alegação de segurança.
-- Não executar SQL remoto. Nenhum INSERT/UPDATE/DELETE/DDL/GRANT neste arquivo.
-- Consultas de catálogo e DO somente leitura; última consulta lê reconciliação.
-- Executar futuramente com papel de inspeção local que possa ler private/catalog.
-- Falha por ausência de allocate_order_stock é esperada antes da instalação C2b.
BEGIN TRANSACTION READ ONLY;

DO $checks$
DECLARE
  sig text;
  f oid;
  role_name text;
  rel text;
  privilege_name text;
  row_info record;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)',
    'public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)',
    'public.allocate_order_stock(uuid,uuid,uuid,bigint)',
    'private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)',
    'private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)',
    'private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid)',
    'private.orders_c1_payload_hash(jsonb)',
    'public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)',
    'public.set_internal_product_active(uuid,bigint,boolean)',
    'public.delete_internal_product(uuid,uuid,bigint)'
  ] LOOP
    f := pg_catalog.to_regprocedure(sig);
    IF f IS NULL THEN RAISE EXCEPTION 'missing signature: %', sig; END IF;
    SELECT p.prosecdef,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
      INTO row_info FROM pg_catalog.pg_proc p WHERE p.oid=f;
    IF NOT row_info.prosecdef OR row_info.owner_name <> 'postgres'
       OR NOT coalesce(row_info.proconfig @> ARRAY['search_path=""']::text[],false) THEN
      RAISE EXCEPTION 'review SECURITY DEFINER/owner/empty search_path: %',sig;
    END IF;
    -- PUBLIC is an ACL pseudo-role (OID 0), not a role for has_function_privilege.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN RAISE EXCEPTION 'PUBLIC execute: %',sig; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
        IF pg_catalog.has_function_privilege(role_name,f,'EXECUTE') IS DISTINCT FROM
           (role_name='authenticated' AND sig LIKE 'public.%') THEN
          RAISE EXCEPTION 'unexpected effective EXECUTE for % on %',role_name,sig;
        END IF;
      ELSE
        RAISE EXCEPTION 'missing expected API role: %',role_name;
      END IF;
    END LOOP;
  END LOOP;

  f := pg_catalog.to_regprocedure('public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)');
  IF pg_catalog.pg_get_function_result(f) IS DISTINCT FROM
     'TABLE(status text, order_id uuid, display_number bigint, version bigint, subtotal numeric, discount_amount numeric, shipping_amount numeric, total_amount numeric)' THEN
    RAISE EXCEPTION 'update return contract mismatch';
  END IF;
  -- Presence only: source assertions separately check placement before item writes.
  IF position('physical_order_edit_unsupported' IN pg_catalog.pg_get_functiondef(f))=0 THEN
    RAISE EXCEPTION 'C2c physical edit guard missing';
  END IF;

  f := pg_catalog.to_regprocedure('public.allocate_order_stock(uuid,uuid,uuid,bigint)');
  IF (SELECT pg_catalog.pg_get_function_result(f)) IS DISTINCT FROM
     'TABLE(status text, order_id uuid, order_item_id uuid, reservation_id uuid, version bigint)' THEN
    RAISE EXCEPTION 'allocation return contract mismatch';
  END IF;
  IF (SELECT p.proargnames[1:4] FROM pg_catalog.pg_proc p WHERE p.oid=f)
       IS DISTINCT FROM ARRAY['p_attempt_id','p_order_id','p_order_item_id','p_expected_version']::text[] THEN
    RAISE EXCEPTION 'allocation named arguments mismatch';
  END IF;

  FOREACH rel IN ARRAY ARRAY[
    'public.orders','public.order_items','public.order_events','public.order_number_counters',
    'public.order_stock_reservations','public.order_stock_settlements',
    'public.product_inventory','public.product_inventory_movements',
    'private.order_operation_receipts'
  ] LOOP
    IF pg_catalog.to_regclass(rel) IS NULL THEN RAISE EXCEPTION 'missing relation: %',rel; END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
            WHERE c.oid=pg_catalog.to_regclass(rel)) THEN
      RAISE EXCEPTION 'RLS not enabled: %',rel;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(role_name,rel,privilege_name) THEN
          RAISE EXCEPTION 'direct % for % on %',privilege_name,role_name,rel;
        END IF;
      END LOOP;
      -- Column ACLs can grant DML even when the table ACL does not.
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
        IF pg_catalog.has_any_column_privilege(role_name,rel,privilege_name) THEN
          RAISE EXCEPTION 'column % for % on %',privilege_name,role_name,rel;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF pg_catalog.to_regclass('private.order_stock_reservation_reconciliation') IS NULL THEN
    RAISE EXCEPTION 'missing reconciliation view';
  END IF;
END
$checks$;

-- Inspect exact return signatures, ACLs, function bodies and search paths.
-- Catalog assertions do NOT prove body semantics or correct lock acquisition.
SELECT p.oid::regprocedure AS signature, pg_catalog.pg_get_function_result(p.oid) AS result,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,p.prosecdef,p.proconfig,p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN
       ('create_order','update_order','allocate_order_stock','move_product_inventory',
        'set_internal_product_active','delete_internal_product'))
   OR (n.nspname='private' AND (p.proname IN
       ('reserve_order_item_stock','finalize_order_item_reservation')
       OR p.proname LIKE 'orders_c1_%' OR p.proname LIKE '%receipt%valid%'))
ORDER BY n.nspname,p.proname,p.oid;
-- Review: no accidental overloads; create/update returns unchanged; update replaced by C2c.
-- C2a: typed public.order_items%ROWTYPE[]; normalize once under sorted product locks;
-- all position locks before counter; insert fresh order/items before reserve helper.
-- C2b: management/context -> plan -> attempt/receipt -> order -> item read -> product
-- -> position -> reservations -> event/receipt. Replay before current version/product
-- and new-operation paid-plan rejection; sales.write, never inventory.write requirement.
-- C2b: mudar modo para stock ANTES do helper, na mesma transação; rollback restaura
-- make_to_order se reserva falhar. Helper aceita ambos; conferir guard efetivo.
-- Check inline validator or optional private allocation validator; no new reserve helper.
-- Allocation replay vinculado ao evento histórico E à reserva correspondente.
-- C1 validator herdado não autentica dinheiro histórico original: identidade/faixas/
-- aritmética não são proteção exaustiva contra snapshot coerente adulterado.
-- C2c update: replay antes das novas guardas; plano -> pedido/versão -> estado ->
-- histórico (consulta sem row lock, rejeição imediata) -> modos físicos persistidos.
-- stock/make_to_order sem histórico: physical_order_edit_unsupported/P0001.
-- Histórico conserva erros próprios; nenhum produto/posição/reserva é alterado.
-- Somente pedido inteiramente untracked sem histórico alcança substituição de itens.
-- Do not rely on LIKE/body text alone to certify any of those semantics.

-- Existing A/B constraints already support stock/make_to_order, stock_allocated NULL
-- status pair, and allocate_stock receipts. Inspect their actual definitions, validated
-- flags and historical FK rules; no replacement constraint is authorized by this test.
SELECT c.conrelid::regclass AS relation,c.conname,c.contype,c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid IN (
  'public.order_items'::regclass,'public.order_events'::regclass,
  'public.order_stock_reservations'::regclass,'public.product_inventory'::regclass,
  'private.order_operation_receipts'::regclass)
ORDER BY c.conrelid::regclass::text,c.conname;
-- Expected notably:
-- order_items_fulfillment_mode_check: stock, make_to_order, untracked.
-- physical requires product; custom without product untracked.
-- order_events_type_check/status_pair_check: stock_allocated with both statuses NULL.
-- order_operation_receipts_command_check: allocate_stock allowed.
-- receipts PK: enterprise_id,actor_id,command_name,attempt_id; JSON object/hash checks
-- do not replace semantic receipt validation in the RPC.
-- reserved_balance CHECK between 0 and balance; item/product/tenant composite FKs.

SELECT i.indrelid::regclass AS relation,ci.relname AS index_name,
       i.indisunique,i.indisvalid,pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid=i.indexrelid
WHERE i.indrelid IN ('public.order_stock_reservations'::regclass,
                    'private.order_operation_receipts'::regclass)
ORDER BY i.indrelid::regclass::text,ci.relname;
-- Expect unique partial active reservation per enterprise/item; no duplicate active.

SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS definition
FROM pg_catalog.pg_trigger t
WHERE NOT t.tgisinternal AND t.tgrelid IN (
 'public.orders'::regclass,'public.order_items'::regclass,
 'public.order_events'::regclass,'public.order_stock_reservations'::regclass,
 'public.product_inventory'::regclass,'public.order_stock_settlements'::regclass)
ORDER BY t.tgrelid::regclass::text,t.tgname;
-- Historical docs claiming aggregate-maintenance trigger are inaccurate: actual B
-- helper updates reserved_balance and inventory version per full-item reservation.
-- Reconciliation equality depends on trusted protocol, not aggregate trigger magic.

SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public','private') AND tablename IN
 ('orders','order_items','order_events','order_stock_reservations',
  'order_operation_receipts','product_inventory','product_inventory_movements')
ORDER BY schemaname,tablename,policyname;

-- Diagnostic data query only (no repair). Expected zero rows on consistent fixtures.
-- An empty result is NOT proof of correctness under concurrency or of paid-plan ACLs.
SELECT enterprise_id,product_id,inventory_id,reserved_balance,
       active_reservation_quantity,discrepancy
FROM private.order_stock_reservation_reconciliation
WHERE discrepancy <> 0 OR (inventory_id IS NULL AND active_reservation_quantity <> 0)
ORDER BY enterprise_id,product_id;

ROLLBACK;

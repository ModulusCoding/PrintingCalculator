-- C3: MANUAL read-only catalog assertions. NOT EXECUTED.
-- This file neither installs migrations nor approves installation, functionality,
-- authorization semantics, replay, rollback, or concurrency. No RPC/helper calls.
-- Run only in an explicitly authorized inspection environment after the approved
-- compatibility migration and C3 RPCs. Missing objects are not permission to install.
-- event_id returns persisted event_uuid; bigint GENERATED ALWAYS identity stays PK.
BEGIN TRANSACTION READ ONLY;
DO $checks$
DECLARE
  sig text; f oid; role_name text; rel text; privilege_name text;
  info record; expected_args text[]; id_att smallint; uuid_att smallint;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'missing expected API role: %',role_name;
    END IF;
  END LOOP;

  -- Catalog-only: verify additive identity and the original immutable row trigger.
  f:=pg_catalog.to_regclass('public.order_events');
  IF f IS NULL THEN RAISE EXCEPTION 'missing public.order_events'; END IF;
  SELECT a.attnum INTO id_att FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=f AND a.attname='id' AND NOT a.attisdropped
      AND a.atttypid='pg_catalog.int8'::regtype AND a.attidentity='a' AND a.attnotnull;
  IF id_att IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=f
      AND c.contype='p' AND c.convalidated AND c.conkey=ARRAY[id_att]::smallint[]
  ) THEN RAISE EXCEPTION 'bigint GENERATED ALWAYS identity primary key changed'; END IF;
  SELECT a.attnum INTO uuid_att FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=f AND a.attname='event_uuid' AND NOT a.attisdropped
      AND a.atttypid='pg_catalog.uuid'::regtype AND a.attnotnull AND a.attidentity='';
  IF uuid_att IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
    WHERE c.conrelid=f AND c.contype='u' AND c.convalidated AND NOT c.condeferrable
      AND c.conkey=ARRAY[uuid_att]::smallint[] AND i.indisvalid AND i.indisready
  ) THEN RAISE EXCEPTION 'event_uuid UUID/NOT NULL/unique contract mismatch'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=f AND d.adnum=uuid_att
      -- Deparser may omit pg_catalog when the built-in is visible.
      AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN
        ('gen_random_uuid()', 'pg_catalog.gen_random_uuid()')
  ) THEN RAISE EXCEPTION 'event_uuid default is not gen_random_uuid()'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=f AND t.tgname='order_events_immutable' AND NOT t.tgisinternal
      AND t.tgenabled='O' AND t.tgtype=27 -- ROW | BEFORE | UPDATE | DELETE
      AND t.tgfoid=pg_catalog.to_regprocedure('public.order_events_forbid_mutation()')
      AND t.tgqual IS NULL AND t.tgnargs=0
      AND p.prosrc ~ 'RAISE EXCEPTION ''order_events_immutable'''
      AND p.prosrc ~ 'ERRCODE[[:space:]]*=[[:space:]]*''42501'''
  ) THEN RAISE EXCEPTION 'original enabled immutable event trigger mismatch'; END IF;

  FOREACH sig IN ARRAY ARRAY[
    'public.transition_order(uuid,uuid,bigint,text,text)',
    'public.cancel_order(uuid,uuid,bigint,text)',
    'public.reopen_order(uuid,uuid,bigint,text)',
    'public.deliver_order(uuid,uuid,bigint)'
  ] LOOP
    f:=pg_catalog.to_regprocedure(sig);
    IF f IS NULL THEN RAISE EXCEPTION 'missing expected RPC: %',sig; END IF;
    SELECT p.prosecdef,p.proconfig,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
           p.proargnames[1:p.pronargs] AS arg_names,p.proretset
      INTO info FROM pg_catalog.pg_proc p WHERE p.oid=f;
    IF NOT info.prosecdef OR info.owner_name IS DISTINCT FROM 'postgres'
       OR NOT coalesce(info.proconfig @> ARRAY['search_path=""']::text[],false) THEN
      RAISE EXCEPTION 'SECURITY DEFINER/postgres/empty search_path mismatch: %',sig;
    END IF;
    expected_args:=CASE
      WHEN sig LIKE 'public.transition_order(%' THEN
        ARRAY['p_attempt_id','p_order_id','p_expected_version','p_target_status','p_reason']
      WHEN sig LIKE 'public.deliver_order(%' THEN
        ARRAY['p_attempt_id','p_order_id','p_expected_version']
      ELSE ARRAY['p_attempt_id','p_order_id','p_expected_version','p_reason'] END;
    IF info.arg_names IS DISTINCT FROM expected_args OR NOT info.proretset
       OR pg_catalog.pg_get_function_result(f) IS DISTINCT FROM
          'TABLE(status text, order_id uuid, operational_status text, version bigint, event_id uuid)' THEN
      RAISE EXCEPTION 'named input/return contract mismatch (event_id must be UUID): %',sig;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN RAISE EXCEPTION 'PUBLIC EXECUTE: %',sig; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF pg_catalog.has_function_privilege(role_name,f,'EXECUTE') IS DISTINCT FROM
         (role_name='authenticated') THEN
        RAISE EXCEPTION 'unexpected effective EXECUTE for % on %',role_name,sig;
      END IF;
    END LOOP;
  END LOOP;

  -- Reject additional public overloads as possible unintended API entry points.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('transition_order','cancel_order','reopen_order','deliver_order')
      AND p.oid NOT IN (
        pg_catalog.to_regprocedure('public.transition_order(uuid,uuid,bigint,text,text)'),
        pg_catalog.to_regprocedure('public.cancel_order(uuid,uuid,bigint,text)'),
        pg_catalog.to_regprocedure('public.reopen_order(uuid,uuid,bigint,text)'),
        pg_catalog.to_regprocedure('public.deliver_order(uuid,uuid,bigint)'))
  ) THEN RAISE EXCEPTION 'unexpected C3 public overload'; END IF;

  FOREACH sig IN ARRAY ARRAY[
    'private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)',
    'private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)',
    'private.orders_c1_payload_hash(jsonb)',
    'private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid)',
    'private.orders_c1_decimal(text,numeric,integer)',
    'private.orders_c1_safe_uuid(text)',
    'private.orders_c1_safe_quantity(text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(sig) IS NULL THEN
      RAISE EXCEPTION 'missing dependency helper: %',sig;
    END IF;
  END LOOP;
  -- Also inspect every overload/new C3 helper in these domain naming families.
  FOR info IN
    SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND
      (p.proname LIKE 'orders_c1_%' OR p.proname LIKE 'orders_c3_%'
       OR p.proname IN ('reserve_order_item_stock','finalize_order_item_reservation'))
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(
        coalesce(info.proacl,pg_catalog.acldefault('f',info.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
    ) THEN RAISE EXCEPTION 'PUBLIC helper EXECUTE: %',info.oid::regprocedure; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF pg_catalog.has_function_privilege(role_name,info.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'effective helper EXECUTE for % on %',role_name,info.oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;

  -- Stage A explicitly enables RLS on private.order_operation_receipts too;
  -- private schema placement alone is not the isolation assertion.
  FOREACH rel IN ARRAY ARRAY[
    'public.orders','public.order_number_counters','public.order_items',
    'public.order_events','public.order_payments','public.order_stock_reservations',
    'public.order_stock_settlements','public.product_inventory',
    'public.product_inventory_movements','private.order_operation_receipts'
  ] LOOP
    f:=pg_catalog.to_regclass(rel);
    IF f IS NULL THEN RAISE EXCEPTION 'missing relation: %',rel; END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid=f) THEN
      RAISE EXCEPTION 'RLS not enabled: %',rel;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c,
        LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid=f AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a,
        LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE a.attrelid=f AND NOT a.attisdropped AND acl.grantee=0
        AND acl.privilege_type IN ('INSERT','UPDATE')
    ) THEN RAISE EXCEPTION 'PUBLIC direct table/column DML: %',rel; END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(role_name,f,privilege_name) THEN
          RAISE EXCEPTION 'effective direct % for % on %',privilege_name,role_name,rel;
        END IF;
      END LOOP;
      FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
        IF pg_catalog.has_any_column_privilege(role_name,f,privilege_name) THEN
          RAISE EXCEPTION 'effective column % for % on %',privilege_name,role_name,rel;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$checks$;
ROLLBACK;
-- Even a future successful catalog run is not a functional/security approval.

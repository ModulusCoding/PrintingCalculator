-- NOT EXECUTED. Preparation only; plain SQL for the SQL editor.
-- Inspector only, BEFORE FLEX, exclusively in an authorized disposable project.
-- CRITICAL: any exception, missing object, reconciliation row, or unexplained catalog
-- difference BLOCKS installation. Do not repair history or disable guards to proceed.
-- Archive ALL result sets and compare full definitions against the SaaS historical
-- files (20261002000000 through 20261026190000), not merely migration version names.
-- The seven pre-core calculator migrations are NOT this project's dependency chain.
BEGIN TRANSACTION READ ONLY;
SELECT version(), current_database(), current_user, session_user;
SELECT extname, extversion, extnamespace::regnamespace FROM pg_catalog.pg_extension ORDER BY extname;
DO $inventory$
DECLARE r record;
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'Migration registry absent: NOT a failure by itself; compare effective definitions with historical source.';
  ELSE
    FOR r IN EXECUTE 'SELECT to_jsonb(m) AS row_data FROM supabase_migrations.schema_migrations m' LOOP
      RAISE NOTICE 'migration registry: %',r.row_data;
    END LOOP;
  END IF;
END $inventory$;
DO $preflight$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['public.orders','public.order_items','public.order_events',
    'public.order_stock_reservations','public.order_stock_settlements','public.products',
    'public.product_inventory','public.product_inventory_movements','public.order_payments',
    'private.order_operation_receipts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass(name)
      AND relkind='r' AND relrowsecurity) THEN
      RAISE EXCEPTION 'BLOCKED: missing pre-FLEX table or RLS: %',name;
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['public.deliver_order(uuid,uuid,bigint)',
    'public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)',
    'private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)',
    'private.orders_c1_payload_hash(jsonb)','private.orders_c4_financial(uuid,uuid)',
    'private.orders_c4_total_guard()','public.get_my_access_context()'] LOOP
    IF pg_catalog.to_regprocedure(name) IS NULL THEN
      RAISE EXCEPTION 'BLOCKED: missing pre-FLEX function %',name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
      ('order_delivery_manifest','order_delivery_undos','order_delivery_compensations'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE (n.nspname='private' AND p.proname LIKE 'orders_flex_%')
         OR (n.nspname='public' AND p.proname IN ('undo_order_delivery','get_order_physical_state')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname LIKE '%flex%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname LIKE '%flex%') THEN
    RAISE EXCEPTION 'BLOCKED: FLEX objects already present; do not reapply or remove evidence';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_inventory i WHERE i.balance<0 OR i.reserved_balance<0
      OR i.reserved_balance>i.balance OR i.reserved_balance IS DISTINCT FROM
      (SELECT coalesce(sum(r.quantity),0) FROM public.order_stock_reservations r
       WHERE r.enterprise_id=i.enterprise_id AND r.product_id=i.product_id AND r.state='active'))
    OR EXISTS (SELECT 1 FROM public.order_stock_reservations r WHERE r.state='active' AND NOT EXISTS
      (SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=r.enterprise_id AND i.product_id=r.product_id)) THEN
    RAISE EXCEPTION 'BLOCKED: reservation reconciliation failed; preserve evidence';
  END IF;
END $preflight$;
-- Broad catalog export intentionally includes bodies, exact types, ACLs and all
-- overloads. Presence is not proof of compatible semantics. Review before FLEX.
SELECT n.nspname,c.relname,c.relkind,c.relowner::regrole,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','v','p') ORDER BY 1,2;
SELECT a.attrelid::regclass,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
 a.attnotnull,a.attidentity,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
ORDER BY 1, a.attnum;
SELECT p.oid::regprocedure,p.proowner::regrole,p.prosecdef,p.proconfig,p.proacl,
 pg_catalog.pg_get_function_result(p.oid),pg_catalog.pg_get_functiondef(p.oid)
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prokind='f' ORDER BY 1;
SELECT t.oid::regtype,t.typtype,e.enumlabel,e.enumsortorder
FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
LEFT JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid
WHERE n.nspname IN ('public','private') ORDER BY 1,e.enumsortorder;
SELECT c.conrelid::regclass,c.conname,c.convalidated,c.condeferrable,pg_catalog.pg_get_constraintdef(c.oid,true)
FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname IN ('public','private') ORDER BY 1,2;
SELECT t.tgrelid::regclass,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true)
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','private') AND NOT t.tgisinternal ORDER BY 1,2;
SELECT schemaname,tablename,indexname,indexdef FROM pg_catalog.pg_indexes
WHERE schemaname IN ('public','private') ORDER BY 1,2,3;
SELECT * FROM pg_catalog.pg_policies WHERE schemaname IN ('public','private') ORDER BY schemaname,tablename,policyname;
-- Historical delivery evidence requiring content review; FLEX backfill is stricter
-- than simple existence. Compare receipts, timestamps, items and full physical chain.
SELECT e.*,to_jsonb(o) AS current_order FROM public.order_events e
JOIN public.orders o ON o.enterprise_id=e.enterprise_id AND o.id=e.order_id
WHERE e.event_type='delivered' ORDER BY e.enterprise_id,e.order_id,e.order_version;
SELECT * FROM public.order_stock_settlements ORDER BY enterprise_id,order_id,id;
SELECT * FROM private.order_operation_receipts WHERE command_name='deliver';
COMMIT;

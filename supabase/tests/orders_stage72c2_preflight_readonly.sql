-- C.2 manual target-catalog collection ONLY. SELECTs; no RPC invocation / DDL / DML.
-- Save complete output for manual comparison. Missing objects block review.
SELECT p.oid::regprocedure AS signature,p.proowner::regrole AS owner,
       p.prosecdef,p.proconfig,p.proacl,pg_catalog.pg_get_functiondef(p.oid) AS body
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='public' AND p.proname IN
  ('create_order','update_order','allocate_order_stock','move_product_inventory',
   'set_internal_product_active','delete_internal_product','get_my_access_context'))
   OR (n.nspname='private' AND p.proname IN
  ('reserve_order_item_stock','orders_c1_receipt_result_valid','orders_c1_payload_hash',
   'resolve_enterprise_plan','can_access_enterprise','plan_permission_allowed'))
ORDER BY p.oid::regprocedure::text;

SELECT c.conrelid::regclass AS relation,c.conname,c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c
WHERE c.conrelid IN (to_regclass('public.order_items'),to_regclass('public.order_events'),
  to_regclass('public.order_stock_reservations'),to_regclass('public.product_inventory'),
  to_regclass('private.order_operation_receipts'))
ORDER BY c.conrelid::regclass::text,c.conname;

SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
       pg_catalog.pg_get_functiondef(t.tgfoid) AS function_body
FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
  (to_regclass('public.orders'),to_regclass('public.order_items'),
   to_regclass('public.order_stock_reservations'),to_regclass('public.product_inventory'),to_regclass('public.products'))
ORDER BY t.tgrelid::regclass::text,t.tgname;

SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.oid IN (to_regclass('public.orders'),to_regclass('public.order_items'),
  to_regclass('public.order_events'),to_regclass('public.order_stock_reservations'),
  to_regclass('public.product_inventory'),to_regclass('private.order_operation_receipts'))
ORDER BY n.nspname,c.relname;

-- Reconciliation without invoking an operational function or assuming a view shape.
WITH active AS (
  SELECT enterprise_id,product_id,sum(quantity) AS quantity
  FROM public.order_stock_reservations WHERE state='active' GROUP BY enterprise_id,product_id
)
SELECT COALESCE(i.enterprise_id,a.enterprise_id) AS enterprise_id,
       COALESCE(i.product_id,a.product_id) AS product_id,i.balance,i.reserved_balance,
       COALESCE(a.quantity,0) AS active_quantity
FROM public.product_inventory i FULL JOIN active a
  ON a.enterprise_id=i.enterprise_id AND a.product_id=i.product_id
WHERE i.id IS NULL OR i.reserved_balance IS DISTINCT FROM COALESCE(a.quantity,0)
   OR i.reserved_balance<0 OR i.reserved_balance>i.balance;

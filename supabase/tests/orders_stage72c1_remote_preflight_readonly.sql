-- M7.2-C.1 remote preflight: READ ONLY. Run in Supabase SQL Editor before approval.
-- This script performs catalog SELECTs only; it does not apply DDL/DML or test mutations.
-- Save complete output with environment/project reference and timestamp for review.

-- 1. Relations, RLS, owner, persistence and columns/types/nullability/defaults.
SELECT n.nspname AS schema_name,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS column_default
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE (n.nspname='public' AND c.relname IN ('orders','order_items','order_events','order_payments','order_stock_reservations','order_number_counters','products','product_inventory','product_inventory_movements','enterprise_plan_access','enterprise_members'))
   OR (n.nspname='private' AND c.relname IN ('order_operation_receipts'))
ORDER BY n.nspname,c.relname,a.attnum;

-- 2. Constraints: definitions and FK actions (r=RESTRICT, a=NO ACTION).
SELECT con.conrelid::regclass AS relation,con.conname,con.contype,con.convalidated,
       con.confdeltype,con.confupdtype,pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
FROM pg_catalog.pg_constraint con
WHERE con.conrelid IN ('public.orders'::regclass,'public.order_items'::regclass,
  'public.order_events'::regclass,'public.order_stock_reservations'::regclass,
  'public.order_number_counters'::regclass,'private.order_operation_receipts'::regclass)
ORDER BY con.conrelid::regclass::text,con.conname;

-- 3. Indexes and uniqueness.
SELECT schemaname,tablename,indexname,indexdef FROM pg_catalog.pg_indexes
WHERE schemaname IN ('public','private') AND tablename IN
 ('orders','order_items','order_events','order_stock_reservations','order_number_counters','order_operation_receipts')
ORDER BY schemaname,tablename,indexname;

-- 4. Triggers and exact trigger functions/bodies.
SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS trigger_def,
       p.oid::regprocedure AS function_signature,pg_catalog.pg_get_functiondef(p.oid) AS function_body
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND t.tgrelid IN
 ('public.orders'::regclass,'public.order_items'::regclass,'public.order_events'::regclass,
  'public.order_stock_reservations'::regclass,'public.products'::regclass,'public.product_inventory'::regclass)
ORDER BY t.tgrelid::regclass::text,t.tgname;

-- 5. Enum labels and plan schema/functions.
SELECT n.nspname,typ.typname,e.enumsortorder,e.enumlabel
FROM pg_catalog.pg_type typ JOIN pg_catalog.pg_namespace n ON n.oid=typ.typnamespace
JOIN pg_catalog.pg_enum e ON e.enumtypid=typ.oid
WHERE (n.nspname='public' AND typ.typname IN ('modulus_plan_code'))
   OR (n.nspname='public' AND typ.typname LIKE '%plan%')
ORDER BY n.nspname,typ.typname,e.enumsortorder;
SELECT p.oid::regprocedure signature,p.proowner::regrole owner,p.prosecdef,p.proconfig,p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) body
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE p.oid IN ('public.get_my_access_context()'::regprocedure,
 'private.current_internal_user_id()'::regprocedure,'private.can_access_enterprise(uuid,text)'::regprocedure,
 'private.resolve_enterprise_plan(uuid)'::regprocedure,'private.stage6b_product_visible(uuid,uuid)'::regprocedure,
 'public.order_events_forbid_mutation()'::regprocedure,'public.orders_set_updated_at()'::regprocedure,
 'public.order_reservations_validate_transition()'::regprocedure)
ORDER BY p.oid::regprocedure::text;

-- 6. C.1 RPC signatures/grants if candidate was installed on a disposable environment.
SELECT p.oid::regprocedure signature,p.proowner::regrole owner,p.prosecdef,p.proconfig,p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) body
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('create_order','update_order')
ORDER BY p.oid::regprocedure::text;

-- 7. RLS policies / table ACLs; table grants must not give API direct DML.
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies WHERE schemaname IN ('public','private')
 AND tablename IN ('orders','order_items','order_events','order_stock_reservations','order_number_counters','order_operation_receipts')
ORDER BY schemaname,tablename,policyname;
-- 7. RLS policies / table ACLs
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    pg_catalog.array_to_string(
        c.relacl,
        E'\n'
    ) AS relation_acl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
WHERE (
    n.nspname = 'public'
    AND c.relname IN (
        'orders',
        'order_items',
        'order_events',
        'order_stock_reservations',
        'order_number_counters'
    )
)
OR (
    n.nspname = 'private'
    AND c.relname = 'order_operation_receipts'
)
ORDER BY
    n.nspname,
    c.relname;

-- 8. Effective inventory/product RPC signatures, ACL/owner/body and lock-relevant triggers.
SELECT p.oid::regprocedure signature,p.proowner::regrole owner,p.prosecdef,p.proconfig,p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) body
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('move_product_inventory','set_internal_product_active','delete_internal_product')
ORDER BY p.oid::regprocedure::text;

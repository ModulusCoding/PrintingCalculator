-- M7.2-B REMOTE PREFLIGHT: read-only catalog evidence only.
-- Paste/run manually in Supabase SQL Editor against the intended development DB.
-- No DDL/DML, application data rows, secrets, tokens, or personal data are queried.
-- Save the result with deployment context before considering M7.2-B.

-- 1) Migration bookkeeping and required relation columns/types/security.
SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_table;
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_schema, table_name) IN (
 ('public','product_inventory'), ('public','product_inventory_movements'),
 ('public','products'), ('public','orders'), ('public','order_items'),
 ('public','order_stock_reservations'), ('public','enterprise_plan_access')
)
ORDER BY table_schema, table_name, ordinal_position;

-- 2) Exact required RPC overloads, owners, security flags, config and full bodies.
SELECT n.nspname AS schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_result(p.oid) AS result_type,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS function_settings,
       p.proacl AS raw_acl,
       pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname,p.proname) IN (
 ('public','move_product_inventory'), ('public','set_internal_product_active'),
 ('public','delete_internal_product'), ('private','lock_product_inventory_context'),
 ('private','lock_internal_product_context'), ('private','resolve_enterprise_plan'),
 ('private','can_access_enterprise'), ('private','stage6b_product_visible'),
 ('public','order_events_forbid_mutation')
)
ORDER BY n.nspname,p.proname,identity_arguments;

-- 3) Effective triggers on relevant tables, including definition and enabled state.
SELECT ns.nspname AS schema_name, rel.relname AS table_name, trg.tgname,
       trg.tgenabled, pg_get_triggerdef(trg.oid,true) AS trigger_definition,
       pg_get_userbyid(proc.proowner) AS trigger_function_owner,
       pg_get_functiondef(proc.oid) AS trigger_function_definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid=trg.tgrelid
JOIN pg_namespace ns ON ns.oid=rel.relnamespace
JOIN pg_proc proc ON proc.oid=trg.tgfoid
WHERE NOT trg.tgisinternal
  AND (ns.nspname,rel.relname) IN (
    ('public','products'),('public','product_inventory'),
    ('public','product_inventory_movements'),('public','order_items'),
    ('public','order_stock_reservations')
  )
ORDER BY ns.nspname,rel.relname,trg.tgname;

-- 4) Constraints/indexes on schema dependencies (definitions, no table contents).
SELECT ns.nspname AS schema_name, rel.relname AS table_name,
       con.conname, con.contype, con.convalidated,
       pg_get_constraintdef(con.oid,true) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid=con.conrelid
JOIN pg_namespace ns ON ns.oid=rel.relnamespace
WHERE (ns.nspname,rel.relname) IN (
 ('public','product_inventory'),('public','product_inventory_movements'),
 ('public','products'),('public','orders'),('public','order_items'),
 ('public','order_stock_reservations')
)
ORDER BY ns.nspname,rel.relname,con.conname;

SELECT ns.nspname AS schema_name, tbl.relname AS table_name,
       idx.relname AS index_name, ix.indisunique, ix.indisprimary,
       ix.indisvalid, pg_get_indexdef(idx.oid) AS definition
FROM pg_index ix
JOIN pg_class tbl ON tbl.oid=ix.indrelid
JOIN pg_class idx ON idx.oid=ix.indexrelid
JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
WHERE (ns.nspname,tbl.relname) IN (
 ('public','product_inventory'),('public','product_inventory_movements'),
 ('public','order_items'),('public','order_stock_reservations')
)
ORDER BY ns.nspname,tbl.relname,idx.relname;

-- 5) Grants: explicit ACLs plus effective role privileges for relevant RPCs/tables.
SELECT routine_schema,routine_name,specific_name,grantee,privilege_type,is_grantable
FROM information_schema.routine_privileges
WHERE (routine_schema,routine_name) IN (
 ('public','move_product_inventory'),('public','set_internal_product_active'),
 ('public','delete_internal_product'),('private','reserve_order_item_stock'),
 ('private','finalize_order_item_reservation'),('private','order_inventory_assert_reserved_balance')
)
ORDER BY routine_schema,routine_name,specific_name,grantee;

SELECT c.oid::regclass AS relation,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
       has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated_any,
       has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS service_role_any
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','private')
  AND c.relname IN ('product_inventory','product_inventory_movements','order_items',
    'order_stock_reservations','order_stock_settlements','stage5_delete_receipts')
ORDER BY n.nspname,c.relname;

-- 6) Policy metadata only; do not query tenant rows as postgres to infer RLS behavior.
SELECT schemaname,tablename,policyname,roles,cmd,permissive,qual,with_check
FROM pg_policies
WHERE (schemaname,tablename) IN (
 ('public','product_inventory'),('public','product_inventory_movements'),
 ('public','products'),('public','order_items'),('public','order_stock_reservations')
)
ORDER BY schemaname,tablename,policyname;

-- 7) Migration ledger identifiers only, no application data.
-- Inspect columns first via information_schema if this table exists.
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='supabase' AND table_name='migrations'
ORDER BY ordinal_position;
-- Then, if the columns are version/name as usual, inspect only relevant ids:
-- SELECT version,name FROM supabase.migrations.schema_migrations
-- WHERE version IN ('20261026160000','20261026170000') ORDER BY version;

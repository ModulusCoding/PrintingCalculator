-- PREPARED ONLY / NOT EXECUTED. SELECT only; no SQL parser/DB used by audit.
-- Authorized isolated project only. Catalog queries work BEFORE M8; no M8 table
-- is referenced statically. No rows containing IDs, payloads, PII or secrets.
SELECT version(), current_user, current_setting('TimeZone');
SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
 ELSE query_to_xml('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',true,false,'') END AS ordered_history;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_function_result(p.oid) AS result,p.prosecdef,p.provolatile,p.proconfig,
 pg_get_userbyid(p.proowner) AS owner,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND (p.proname LIKE 'm8_%' OR p.proname IN
 ('resolve_enterprise_plan','confirm_enterprise_paid_access','cancel_enterprise_paid_access','get_my_access_context','get_my_plan_access'))
ORDER BY n.nspname,p.proname,arguments;
SELECT n.nspname,t.typname,e.enumlabel,e.enumsortorder FROM pg_type t
JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid
WHERE n.nspname='public' AND t.typname IN ('modulus_plan_code','modulus_access_state') ORDER BY t.typname,e.enumsortorder;
SELECT table_schema,table_name,column_name,data_type,udt_schema,udt_name,is_nullable,column_default
FROM information_schema.columns WHERE (table_schema='public' AND table_name IN ('users','enterprises','enterprise_members','enterprise_plan_access'))
 OR (table_schema='private' AND (table_name='enterprise_authorization_receipts' OR table_name LIKE 'saas_%'))
ORDER BY table_schema,table_name,ordinal_position;
SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='private' AND (c.relname LIKE 'saas_%' OR c.relname='enterprise_authorization_receipts'))
 OR (n.nspname='public' AND c.relname='enterprise_plan_access');
SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname='private' AND (c.relname LIKE 'saas_%' OR c.relname='enterprise_authorization_receipts'))
 OR (n.nspname='public' AND c.relname='enterprise_plan_access') ORDER BY n.nspname,c.relname,k.conname;
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE (schemaname='private' AND (tablename LIKE 'saas_%' OR tablename='enterprise_authorization_receipts'))
 OR (schemaname='public' AND tablename='enterprise_plan_access');
SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND ((n.nspname='private' AND c.relname LIKE 'saas_%') OR (n.nspname='public' AND c.relname='enterprise_plan_access'));
-- Effective execute ACLs, including PUBLIC/inherited privileges; does not invoke RPCs.
SELECT r.rolname,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE r.rolname IN ('anon','authenticated','service_role') AND n.nspname IN ('public','private')
AND (p.proname LIKE 'm8_%' OR p.proname IN ('confirm_enterprise_paid_access','cancel_enterprise_paid_access','resolve_enterprise_plan','get_my_access_context','get_my_saas_billing'));
-- Guarded aggregate legacy consistency; CASE prevents evaluation on missing relations.
SELECT CASE WHEN to_regclass('public.enterprise_plan_access') IS NULL OR to_regclass('private.enterprise_authorization_receipts') IS NULL THEN NULL ELSE
 query_to_xml($q$SELECT count(*) AS access_rows,
 count(*) FILTER (WHERE a.access_state='paid' AND a.paid_until<=statement_timestamp()) AS expired_persisted_paid,
 count(*) FILTER (WHERE a.authorization_id IS NOT NULL AND (r.authorization_id IS NULL OR r.enterprise_id<>a.enterprise_id OR r.authorization_version>a.authorization_version)) AS inconsistent_receipts,
 count(*) FILTER (WHERE a.authorization_version<0 OR (a.authorization_id IS NOT NULL AND a.authorization_version<1)) AS invalid_versions
 FROM public.enterprise_plan_access a LEFT JOIN private.enterprise_authorization_receipts r ON r.authorization_id=a.authorization_id$q$,true,false,'') END AS legacy_consistency;
SELECT CASE WHEN to_regclass('private.saas_coverage_cycles') IS NULL THEN NULL ELSE
 query_to_xml('SELECT count(*) AS invalid_intervals FROM private.saas_coverage_cycles WHERE NOT isfinite(paid_from) OR NOT isfinite(paid_until) OR paid_from>=paid_until',true,false,'') END AS m8_intervals;
SELECT CASE WHEN to_regclass('private.saas_billing_attempts') IS NULL THEN NULL ELSE
 query_to_xml('SELECT operation,state,phase,count(*) FROM private.saas_billing_attempts GROUP BY operation,state,phase',true,false,'') END AS m8_attempts;
SELECT CASE WHEN to_regclass('private.saas_billing_accounts') IS NULL THEN NULL ELSE
 query_to_xml('SELECT state,count(*) FROM private.saas_billing_accounts GROUP BY state',true,false,'') END AS m8_accounts;

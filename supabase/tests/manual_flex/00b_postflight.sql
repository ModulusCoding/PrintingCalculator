-- NOT EXECUTED. Preparation only. Run AFTER the complete FLEX migration committed.
-- Plain SQL, inspector in authorized disposable project. Any exception BLOCKS tests.
-- Archive inventory and compare full bodies/constraints with the candidate file;
-- this catalog inspection does not prove runtime authorization or concurrency.
BEGIN TRANSACTION READ ONLY;
SELECT version(),current_database(),current_user;
DO $check$
DECLARE name text; rel oid; p record; r record; a record; is_rpc boolean;
BEGIN
  FOREACH name IN ARRAY ARRAY['order_delivery_manifest','order_delivery_undos','order_delivery_compensations'] LOOP
    rel:=pg_catalog.to_regclass('public.'||name);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=rel AND relkind='r'
      AND relrowsecurity AND relowner='postgres'::regrole) THEN
      RAISE EXCEPTION 'BLOCKED: FLEX table/RLS/owner mismatch: %',name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=rel) THEN
      RAISE EXCEPTION 'BLOCKED: unexpected policy on %',name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=rel
      AND tgname=name||'_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal
      AND (tgtype::integer & 27)=27
      AND tgfoid='public.order_events_forbid_mutation()'::regprocedure) THEN
      RAISE EXCEPTION 'BLOCKED: immutable trigger missing: %',name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid=rel),pg_catalog.acldefault('r','postgres'::regrole))) x
      WHERE x.grantee=0 OR x.grantee IN (SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon','authenticated','service_role'))) THEN
      RAISE EXCEPTION 'BLOCKED: explicit table API/PUBLIC grant: %',name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute at,
      LATERAL pg_catalog.aclexplode(at.attacl) x WHERE at.attrelid=rel
      AND (x.grantee=0 OR x.grantee IN (SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon','authenticated','service_role')))) THEN
      RAISE EXCEPTION 'BLOCKED: column grant on %',name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=rel
      AND (NOT convalidated OR condeferrable)) THEN
      RAISE EXCEPTION 'BLOCKED: untrusted/deferred constraint on %',name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=rel AND contype='p')
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=rel AND contype='f') THEN
      RAISE EXCEPTION 'BLOCKED: key/FK missing on %',name;
    END IF;
    FOR r IN SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      -- A superuser's implicit privilege is NOT a leaked grant. Owner inheritance
      -- is reported separately below; ordinary inherited API privileges must fail.
      IF NOT r.rolsuper AND (pg_catalog.has_table_privilege(r.oid,rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(r.oid,rel,'SELECT,INSERT,UPDATE,REFERENCES')) THEN
        RAISE EXCEPTION 'BLOCKED: effective/inherited table privilege: % %',r.rolname,name;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['public.undo_order_delivery(uuid,uuid,bigint,uuid,text,text,text)',
    'public.get_order_physical_state(uuid)','private.orders_flex_validate_delivery(uuid,uuid)',
    'private.orders_flex_valid_coverage(uuid,uuid,uuid)'] LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(name);
    IF NOT FOUND THEN RAISE EXCEPTION 'BLOCKED: missing signature %',name; END IF;
    IF NOT p.prosecdef OR p.proowner<>'postgres'::regrole OR NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg IN ('search_path=""','search_path=')) THEN
      RAISE EXCEPTION 'BLOCKED: owner/SECURITY DEFINER/restrictive search_path: %',name;
    END IF;
    is_rpc:=name LIKE 'public.%';
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
      LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=x.grantee
      WHERE x.privilege_type='EXECUTE' AND (x.grantee=0 OR gr.rolname IN ('anon','service_role')
        OR (NOT is_rpc AND gr.rolname='authenticated'))) THEN
      RAISE EXCEPTION 'BLOCKED: explicit forbidden EXECUTE %',name;
    END IF;
    IF is_rpc AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
      WHERE x.grantee='authenticated'::regrole AND x.privilege_type='EXECUTE' AND NOT x.is_grantable) THEN
      RAISE EXCEPTION 'BLOCKED: authenticated RPC grant missing %',name;
    END IF;
    FOR r IN SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      IF NOT r.rolsuper AND pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') IS DISTINCT FROM
        (is_rpc AND r.rolname='authenticated') THEN
        RAISE EXCEPTION 'BLOCKED: effective/inherited EXECUTE % %',r.rolname,name;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('undo_order_delivery','get_order_physical_state'))<>2 THEN
    RAISE EXCEPTION 'BLOCKED: accidental RPC overload';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.order_stock_settlements'::regclass AND conname='order_stock_settlements_flex_delivery_event_fk'
      AND contype='f' AND convalidated AND NOT condeferrable
      AND confrelid='public.order_events'::regclass AND confdeltype='r') THEN
    RAISE EXCEPTION 'BLOCKED: settlement delivery FK missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.order_delivery_manifest'::regclass
    AND contype='f' AND confrelid='public.order_items'::regclass) THEN
    RAISE EXCEPTION 'BLOCKED: manifest must not depend on live item';
  END IF;
END $check$;
-- Full semantic review REQUIRED: tenant/order/event composite FK column order,
-- RESTRICT, positive quantities, modes, classification/status checks, unique
-- settlement/original/compensation/cycle, and original-source inheritance.
SELECT c.conrelid::regclass,c.conname,c.convalidated,c.condeferrable,
 pg_catalog.pg_get_constraintdef(c.oid,true) AS definition
FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ('public.order_delivery_manifest'::regclass,
 'public.order_delivery_undos'::regclass,'public.order_delivery_compensations'::regclass,
 'public.order_events'::regclass,'public.order_stock_settlements'::regclass,'private.order_operation_receipts'::regclass)
ORDER BY 1,2;
SELECT schemaname,tablename,indexname,indexdef FROM pg_catalog.pg_indexes
WHERE tablename IN ('order_delivery_manifest','order_delivery_undos','order_delivery_compensations','order_events','order_stock_settlements') ORDER BY 1,2,3;
SELECT c.oid::regclass,c.relowner::regrole,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_catalog.pg_class c WHERE c.oid IN ('public.order_delivery_manifest'::regclass,
 'public.order_delivery_undos'::regclass,'public.order_delivery_compensations'::regclass);
SELECT t.tgrelid::regclass,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true)
FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
 ('public.order_delivery_manifest'::regclass,'public.order_delivery_undos'::regclass,
 'public.order_delivery_compensations'::regclass,'private.order_operation_receipts'::regclass) ORDER BY 1,2;
SELECT p.oid::regprocedure,p.proowner::regrole,p.prosecdef,p.proconfig,p.proacl,
 pg_catalog.pg_get_function_result(p.oid),pg_catalog.pg_get_functiondef(p.oid)
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='private' AND p.proname LIKE 'orders_flex_%') OR (n.nspname='public' AND p.proname IN
 ('undo_order_delivery','get_order_physical_state','deliver_order','transition_order','cancel_order','reopen_order','allocate_order_stock')) ORDER BY 1;
-- Distinguish explicit ACLs above from superuser/owner/inherited effective powers.
SELECT rolname,rolsuper,rolinherit,rolbypassrls,pg_catalog.pg_has_role(oid,'postgres','MEMBER') AS member_of_owner
FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres');
SELECT member::regrole,roleid::regrole,admin_option FROM pg_catalog.pg_auth_members ORDER BY 1,2;
COMMIT;

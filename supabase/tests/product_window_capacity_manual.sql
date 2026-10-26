-- LOCAL ONLY, deliberately not run by the agent. Apply migrations through
-- 20261026090000 to an isolated disposable database. Replace placeholders first.
-- Fixtures provisioned normally: A is business_ready Free owner, empty products;
-- B is business_ready paid Intermediate OPERATOR (exactly one active operator),
-- C is business_ready paid Intermediate ADMIN. No elevated JWT/service key.
-- This script uses postgres only for local fixtures; RPC calls run authenticated.
-- Everything is rolled back. Never run against a remote/shared database.
BEGIN;
CREATE TEMP TABLE _window_fixture(k text PRIMARY KEY,v text NOT NULL);
INSERT INTO _window_fixture VALUES
 ('enterprise_a','__ENTERPRISE_A__'),
 ('sub_a','__OWNER_SUB_A__'),('iss_a','__OWNER_ISSUER_A__'),
 ('sub_b','__OPERATOR_SUB_B__'),('iss_b','__OPERATOR_ISSUER_B__'),
 ('sub_c','__ADMIN_SUB_C__'),('iss_c','__ADMIN_ISSUER_C__');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM _window_fixture WHERE starts_with(v,'__')) THEN RAISE EXCEPTION 'replace fixtures'; END IF;
 IF EXISTS(SELECT 1 FROM public.products WHERE enterprise_id=(SELECT v::uuid FROM _window_fixture WHERE k='enterprise_a')) THEN RAISE EXCEPTION 'A must have no products'; END IF;
 IF NOT has_function_privilege('authenticated','public.get_my_creation_capacity(text)','EXECUTE')
 OR has_function_privilege('anon','public.get_my_creation_capacity(text)','EXECUTE')
 OR has_function_privilege('service_role','public.get_my_creation_capacity(text)','EXECUTE') THEN RAISE EXCEPTION 'capacity ACL regression'; END IF;
END $$;
GRANT SELECT ON _window_fixture TO authenticated;
INSERT INTO public.products(id,enterprise_id,name,created_at) SELECT
 ('70000000-0000-4000-8000-00000000000'||n)::uuid,
 (SELECT v::uuid FROM _window_fixture WHERE k='enterprise_a'),
 'Window test '||n,'2026-01-01'::timestamptz+n*interval '1 day'
FROM generate_series(1,4) n;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT v FROM _window_fixture WHERE k='sub_a'),'iss',(SELECT v FROM _window_fixture WHERE k='iss_a'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r record; n bigint; BEGIN
 SELECT * INTO r FROM public.get_my_access_context();
 IF r.role<>'owner' OR r.state<>'business_ready' THEN RAISE EXCEPTION 'A owner fixture invalid'; END IF;
 SELECT * INTO r FROM public.get_my_creation_capacity('products');
 IF r.used<>4 OR r.capacity_limit<>3 THEN RAISE EXCEPTION 'Free capacity must count hidden/archived rows'; END IF;
 SELECT count(*) INTO n FROM public.products WHERE id='70000000-0000-4000-8000-000000000001';
 IF n<>0 THEN RAISE EXCEPTION 'old URL read bypass'; END IF;
 SELECT * INTO r FROM public.update_internal_product('70000000-0000-4000-8000-000000000001',999,'Hidden mutation',NULL,NULL);
 IF r.status<>'product_unavailable' OR r.version IS NOT NULL THEN RAISE EXCEPTION 'update window/version bypass'; END IF;
 SELECT * INTO r FROM public.set_internal_product_active('70000000-0000-4000-8000-000000000001',999,false);
 IF r.status<>'product_unavailable' OR r.version IS NOT NULL THEN RAISE EXCEPTION 'archive window/version bypass'; END IF;
 BEGIN
  PERFORM public.delete_internal_product('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',999);
  RAISE EXCEPTION 'delete hidden should fail';
 EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
 SELECT * INTO r FROM public.prepare_internal_product_image_upload('70000000-0000-4000-8000-000000000001',0);
 IF r.status<>'permission_denied' OR r.storage_path IS NOT NULL THEN RAISE EXCEPTION 'image window bypass'; END IF;
 -- Visible archived products remain in the window and quota.
 SELECT * INTO r FROM public.set_internal_product_active('70000000-0000-4000-8000-000000000004',0,false);
 IF r.status<>'success' THEN RAISE EXCEPTION 'visible archive failed'; END IF;
 SELECT * INTO r FROM public.get_my_creation_capacity('products');
 IF r.used<>4 THEN RAISE EXCEPTION 'archived must count'; END IF;
 SELECT * INTO r FROM public.delete_internal_product('71000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004',1);
 IF r.status<>'deleted' THEN RAISE EXCEPTION 'visible delete failed'; END IF;
 SELECT * INTO r FROM public.delete_internal_product('71000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004',1);
 IF r.status<>'deleted' OR r.version<>2 THEN RAISE EXCEPTION 'receipt replay must precede deleted/window check'; END IF;
 BEGIN
  PERFORM public.delete_internal_product('71000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000004',0);
  RAISE EXCEPTION 'receipt payload mismatch accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT * INTO r FROM public.get_my_creation_capacity('products');
 IF r.used<>3 THEN RAISE EXCEPTION 'deleted must not count'; END IF;
 SELECT count(*) INTO n FROM public.products WHERE id='70000000-0000-4000-8000-000000000001';
 IF n<>1 THEN RAISE EXCEPTION 'window must advance after delete'; END IF;
 BEGIN PERFORM public.get_my_creation_capacity('unknown'); RAISE EXCEPTION 'unknown accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.get_my_creation_capacity('shared_materials'); RAISE EXCEPTION 'Free shared allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Operator/admin capacity is not owner-only. Gates still use the real role and
-- authoritative plan; use paid regularized tenants, not an excess-team fixture.
DO $$ DECLARE who text; c record; r record; BEGIN
 FOREACH who IN ARRAY ARRAY['b','c'] LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT v FROM _window_fixture WHERE k='sub_'||who),'iss',(SELECT v FROM _window_fixture WHERE k='iss_'||who),'role','authenticated')::text,true);
  SELECT * INTO c FROM public.get_my_access_context();
  IF c.state<>'business_ready' OR c.role<>CASE WHEN who='b' THEN 'operator' ELSE 'admin' END THEN RAISE EXCEPTION 'paid role fixture invalid'; END IF;
  -- SET ROLE at the SQL call site below also validates the EXECUTE grant.
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO r FROM public.get_my_creation_capacity('products');
  IF r.used IS NULL OR r.capacity_limit IS NOT NULL THEN RAISE EXCEPTION 'paid products not unlimited'; END IF;
  SELECT * INTO r FROM public.get_my_creation_capacity('shared_materials');
  IF r.used IS NULL OR r.capacity_limit<>15 THEN RAISE EXCEPTION 'paid shared capacity incorrect'; END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
-- Missing identity/context must fail, not return enterprise-wide counters.
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.get_my_creation_capacity('products'); RAISE EXCEPTION 'missing identity allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

-- Additional local matrix (requires dedicated fixtures; do not weaken guards):
-- * selected-plan-required owner, Free admin/operator, paid team excess owner/
--   admin/operator: capacity raises 42501; existing regularization is unchanged.
-- * paid regularized owner/admin: old products outside Free's three-row window
--   remain editable/deletable; another tenant id remains unavailable.
-- * linked image, unexpired upload and tombstone paths of a hidden product:
--   Storage authenticated SELECT/INSERT/DELETE policies deny them. A signed URL
--   already issued by Storage may survive until expiry; this migration cannot
--   revoke cached bytes or signed tokens. No public bucket/URL is introduced.

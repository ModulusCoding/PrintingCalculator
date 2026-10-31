-- MANUAL, PERSISTENT, DISPOSABLE DEVELOPMENT PROJECT ONLY. Never run in production.
-- This file is reviewed source, NOT a migration. No infrastructure/Auth SQL here.
-- Run in the SQL editor as postgres/admin, with stop-on-error, as one transaction.
-- Replace EVERY REPLACE_* token in this suite. Never paste tokens/passwords here.
-- Exact authorization phrase: I AUTHORIZE PERSISTENT FLEX MANUAL TEST FIXTURES
--
-- ADMIN PREPARATION (outside this script):
-- 1. Verify the Dashboard project ref and the active private.auth_issuer_config row.
--    This script deliberately does NOT create/change issuer configuration.
--    TRUST BOUNDARY: SQL has no portable independent proof of the hosting project
--    ref. The operator MUST verify Dashboard/connection externally. This guard
--    checks the existing active issuer, not a proof an administrator cannot forge.
-- 2. Generate a fresh run UUID. Create FIVE real, email-confirmed Auth users via
--    Auth Dashboard (not INSERT auth.users; no service_role impersonation):
--      flex-<run_uuid>-owner_visionary@example.invalid
--      flex-<run_uuid>-owner_apprentice@example.invalid
--      flex-<run_uuid>-operator@example.invalid
--      flex-<run_uuid>-no_membership@example.invalid
--      flex-<run_uuid>-inactive@example.invalid
--    Use fictitious names, no real customer data. Copy their Auth UUIDs below.
--    Users MUST be new, not onboarded, and not linked to an existing app identity.
-- 3. All repo migrations through 20261027120000 must already be applied by the
--    operator. This file neither applies migrations nor creates app mocks.
--
-- ADMIN fixture provisioning is deliberately separate from authenticated RPCs:
-- app users/identities/enterprises/members and plan fixtures are inserted directly
-- into their REAL tables. Billing confirmation is service-only: do NOT SET ROLE
-- service_role or fabricate service claims to call it. These paid/free test rows
-- are explicit administrator fixtures, not evidence of a tested billing flow.
-- Labels visionary/apprentice mean actual intermediate-paid/free plan codes.
-- Existing schemas/runs are never overwritten: a second run fails, without DELETE.

BEGIN;
DO $guard$
DECLARE
  run_text text := 'REPLACE_RUN_UUID';
  project_text text := 'REPLACE_PROJECT_REF';
  issuer_text text := 'https://REPLACE_PROJECT_REF.supabase.co/auth/v1';
  authorization text := 'REPLACE_AUTHORIZATION_PHRASE';
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'admin postgres SQL session required'; END IF;
  IF authorization IS DISTINCT FROM 'I AUTHORIZE PERSISTENT FLEX MANUAL TEST FIXTURES'
     OR run_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR project_text !~ '^[a-z0-9]{20}$'
     OR issuer_text IS DISTINCT FROM 'https://' || project_text || '.supabase.co/auth/v1'
     OR run_text::uuid = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'replace run/project/issuer and explicit authorization; refusing fixture writes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.auth_issuer_config
    WHERE issuer=issuer_text AND provider='supabase' AND status='active') THEN
    RAISE EXCEPTION 'expected project issuer is not configured active; stop and verify project';
  END IF;
  IF to_regprocedure('public.undo_order_delivery(uuid,uuid,bigint,uuid,text,text,text)') IS NULL
     OR to_regclass('public.order_delivery_manifest') IS NULL THEN
    -- Verify signature/table against the installed FLEX migration if this fails.
    RAISE EXCEPTION 'FLEX migration prerequisites missing';
  END IF;
END $guard$;

CREATE SCHEMA flex_manual_test;
REVOKE ALL ON SCHEMA flex_manual_test FROM PUBLIC, anon, authenticated;
CREATE TABLE flex_manual_test.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  run_id uuid NOT NULL UNIQUE,
  project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9]{20}$'),
  issuer text NOT NULL,
  CHECK (issuer = 'https://' || project_ref || '.supabase.co/auth/v1')
);
CREATE TABLE flex_manual_test.actors (
  label text PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  internal_user_id uuid NOT NULL,
  enterprise_id uuid
);
CREATE TABLE flex_manual_test.objects (label text PRIMARY KEY, id uuid NOT NULL);
CREATE TABLE flex_manual_test.calls (
  label text PRIMARY KEY, rpc text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL
);
CREATE TABLE flex_manual_test.checkpoints (label text PRIMARY KEY, data jsonb NOT NULL);
INSERT INTO flex_manual_test.config(run_id,project_ref,issuer)
VALUES ('REPLACE_RUN_UUID'::uuid,'REPLACE_PROJECT_REF','https://REPLACE_PROJECT_REF.supabase.co/auth/v1');

-- Invoker on purpose: call as ADMIN before SET LOCAL ROLE authenticated, in
-- EVERY mutable script. No private-table SELECT grant or SECURITY DEFINER bypass.
CREATE FUNCTION flex_manual_test.assert_run(p_run text,p_project text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c flex_manual_test.config%ROWTYPE;
BEGIN
  IF p_run IS NULL OR p_project IS NULL
     OR p_run !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_project !~ '^[a-z0-9]{20}$' THEN
    RAISE EXCEPTION 'explicit real run UUID/project ref required';
  END IF;
  SELECT * INTO STRICT c FROM flex_manual_test.config WHERE singleton;
  IF c.run_id IS DISTINCT FROM p_run::uuid OR c.project_ref IS DISTINCT FROM p_project
     OR c.issuer IS DISTINCT FROM 'https://' || p_project || '.supabase.co/auth/v1'
     OR NOT EXISTS (SELECT 1 FROM private.auth_issuer_config i
       WHERE i.issuer=c.issuer AND i.provider='supabase' AND i.status='active') THEN
    RAISE EXCEPTION 'wrong run/project or inactive actual issuer';
  END IF;
END $$;
CREATE FUNCTION flex_manual_test.assert_true(p_ok boolean,p_message text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FLEX assertion failed: %',p_message; END IF;
END $$;
CREATE FUNCTION flex_manual_test.set_actor(p_label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a flex_manual_test.actors%ROWTYPE; c flex_manual_test.config%ROWTYPE;
BEGIN
  SELECT * INTO STRICT a FROM flex_manual_test.actors WHERE label=p_label;
  SELECT * INTO STRICT c FROM flex_manual_test.config WHERE singleton;
  PERFORM pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object(
    'sub',a.auth_user_id::text,'iss',c.issuer,'role','authenticated','aud','authenticated')::text,true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
  -- No role switch. The caller MUST next execute SET LOCAL ROLE authenticated.
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA flex_manual_test FROM PUBLIC, anon, authenticated;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');

DO $admin_fixtures$
DECLARE
  c flex_manual_test.config%ROWTYPE; a record; au auth.users%ROWTYPE;
  u uuid; ea uuid := gen_random_uuid(); eb uuid := gen_random_uuid();
BEGIN
  SELECT * INTO STRICT c FROM flex_manual_test.config;
  -- Validate ALL real Auth users before inserting any application business data.
  FOR a IN SELECT * FROM (VALUES
    ('owner_visionary','REPLACE_OWNER_VISIONARY_AUTH_UUID'),
    ('owner_apprentice','REPLACE_OWNER_APPRENTICE_AUTH_UUID'),
    ('operator','REPLACE_OPERATOR_AUTH_UUID'),
    ('no_membership','REPLACE_NO_MEMBERSHIP_AUTH_UUID'),
    ('inactive','REPLACE_INACTIVE_AUTH_UUID')
  ) AS x(label,auth_id) LOOP
    IF a.auth_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'replace real Dashboard Auth UUID for %',a.label;
    END IF;
    SELECT * INTO STRICT au FROM auth.users WHERE id=a.auth_id::uuid;
    IF au.email IS DISTINCT FROM 'flex-' || c.run_id::text || '-' || a.label || '@example.invalid'
       OR au.email_confirmed_at IS NULL OR au.deleted_at IS NOT NULL
       OR (au.banned_until IS NOT NULL AND au.banned_until>now()) THEN
      RAISE EXCEPTION 'Auth user % must be confirmed, unbanned, run-prefixed fictitious account',a.label;
    END IF;
    IF EXISTS (SELECT 1 FROM public.auth_identities WHERE subject=au.id::text)
       OR EXISTS (SELECT 1 FROM public.users WHERE email_normalized=lower(au.email)) THEN
      RAISE EXCEPTION 'Auth user % already linked/onboarded; use fresh users',a.label;
    END IF;
    INSERT INTO flex_manual_test.actors VALUES(a.label,au.id,gen_random_uuid(),
      CASE WHEN a.label='owner_apprentice' THEN eb WHEN a.label='no_membership' THEN NULL ELSE ea END);
  END LOOP;
  PERFORM flex_manual_test.assert_true((SELECT count(DISTINCT auth_user_id)=5 FROM flex_manual_test.actors),'distinct Auth accounts');
  INSERT INTO public.enterprises(id,name) VALUES
    (ea,'FLEX '||c.run_id||' visionary'),(eb,'FLEX '||c.run_id||' apprentice');
  FOR a IN SELECT * FROM flex_manual_test.actors LOOP
    INSERT INTO public.users(id,full_name,email,status,must_change_password)
    SELECT a.internal_user_id,'FLEX '||a.label,email,'active',false FROM auth.users WHERE id=a.auth_user_id;
    INSERT INTO public.auth_identities(user_id,provider,issuer,subject,status)
    VALUES(a.internal_user_id,'supabase',c.issuer,a.auth_user_id::text,'active');
    IF a.enterprise_id IS NOT NULL THEN
      INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status)
      VALUES(a.enterprise_id,a.internal_user_id,
        CASE WHEN a.label LIKE 'owner_%' THEN 'owner' ELSE 'operator' END,
        CASE WHEN a.label='inactive' THEN 'inactive' ELSE 'active' END);
    END IF;
  END LOOP;
  INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,
    paid_until,authorization_id,authorization_version)
  VALUES (ea,'intermediate','intermediate','paid',now()+interval '7 days','flex-manual-'||c.run_id,1),
         (eb,'free','free','free',NULL,NULL,0);
  INSERT INTO public.enterprise_plan_access_audit(enterprise_id,operation,selected_plan,effective_plan,
    access_state,paid_until,authorization_id,authorization_version,integration_actor)
  SELECT enterprise_id,'selection_fixture',selected_plan,effective_plan,access_state,paid_until,
    authorization_id,authorization_version,'ADMIN flex manual fixture '||c.run_id
  FROM public.enterprise_plan_access WHERE enterprise_id IN(ea,eb);
END $admin_fixtures$;

-- Only synthetic registry data is readable. No passwords/JWTs/credentials stored.
-- No application-table grants, policies, mocked functions, or service-role changes.
GRANT USAGE ON SCHEMA flex_manual_test TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA flex_manual_test TO authenticated;
GRANT INSERT ON flex_manual_test.objects,flex_manual_test.calls,flex_manual_test.checkpoints TO authenticated;
GRANT EXECUTE ON FUNCTION flex_manual_test.set_actor(text),flex_manual_test.assert_true(boolean,text) TO authenticated;
-- assert_run remains admin-only, since it intentionally checks private issuer config.
COMMIT;

-- DEV ONLY. Run this ENTIRE standalone file in Supabase SQL Editor as postgres.
-- Requires all migrations through 20261026120000. No psql commands, HTTP/Auth
-- API calls, trigger disabling or writes to preexisting tenants. NOT read-only:
-- real auth.users fixtures are inserted locally and discarded by ROLLBACK.
-- Never COMMIT this file. On error: ROLLBACK before retrying. Not run remotely.
-- Legacy admin fixtures cannot legitimately be created AFTER the new guard.
-- See companion concurrency guide for the explicitly separate pre-migration test.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE _team_ids(k text PRIMARY KEY,id uuid NOT NULL);
INSERT INTO _team_ids SELECT k,gen_random_uuid() FROM unnest(ARRAY[
 'a','b','free','owner_a','owner_b','owner_free','spare','direct_user','auth_employee','auth_pending']) k;
GRANT SELECT ON _team_ids TO service_role,authenticated;
CREATE FUNCTION pg_temp.f(k text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pg_temp._team_ids WHERE _team_ids.k=$1 $$;
CREATE FUNCTION pg_temp.issuer() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT 'team-capacity-test-'||pg_temp.f('a')::text $$;
CREATE FUNCTION pg_temp.ok(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.error(label text, statement text, expected text, expectedmessage text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text; caught_message text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE,caught_message=MESSAGE_TEXT;
 END;
 IF caught IS DISTINCT FROM expected THEN
  RAISE EXCEPTION '%: SQLSTATE %, expected %',label,coalesce(caught,'success'),expected;
 END IF;
 IF expectedmessage IS NOT NULL AND caught_message IS DISTINCT FROM expectedmessage THEN
  RAISE EXCEPTION '%: message %, expected %',label,caught_message,expectedmessage;
 END IF;
END $$;
-- Invoke the REAL granted role, not merely JWT role claims. Explicit provisioning
-- actor must work without a user JWT; session member RPCs use authenticated JWT.
CREATE FUNCTION pg_temp.rpc(statement text, db_role text DEFAULT 'service_role')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 IF db_role NOT IN ('service_role','authenticated') THEN RAISE EXCEPTION 'invalid test role'; END IF;
 EXECUTE 'SET LOCAL ROLE '||quote_ident(db_role);
 EXECUTE 'SELECT to_jsonb(r) FROM ('||statement||') r' INTO STRICT result;
 RESET ROLE;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RESET ROLE; RAISE;
END $$;
CREATE FUNCTION pg_temp.jwt(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f(who)::text,
 'iss',pg_temp.issuer(),'role','authenticated')::text,true);
END $$;
CREATE FUNCTION pg_temp.start_sql(actor text, suffix text, requested text DEFAULT 'operator')
RETURNS text LANGUAGE sql AS $$
 SELECT format('SELECT * FROM public.start_employee_provisioning(%L::uuid,%L,%L,%L,%L)',
 pg_temp.f(actor),pg_temp.issuer(),suffix||'-'||pg_temp.f('a')||'@example.test','Team fixture '||suffix,requested)
$$;
CREATE FUNCTION pg_temp.state() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM public.enterprise_members m WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'))),
 'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM private.employee_provisioning_operations o WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'))),
 -- Compare ALL public users/identities so an orphan created before failed member
 -- insertion cannot escape the snapshot. Keep JSON internal; never print it.
 -- Run in quiet DEV: unrelated concurrent writes can make this comparison fail.
 'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]') FROM public.users u),
 'identities',(SELECT coalesce(jsonb_agg(to_jsonb(ai) ORDER BY ai.id),'[]') FROM public.auth_identities ai))
$$;
INSERT INTO private.auth_issuer_config(issuer,provider,status) VALUES (pg_temp.issuer(),'supabase','active');
INSERT INTO public.enterprises(id,name,status)
SELECT id,'Team capacity fixture '||k,'active' FROM _team_ids WHERE k IN ('a','b','free');
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,authorization_id)
SELECT pg_temp.f(k),'intermediate','intermediate','paid',now()+interval '1 day','team-test-'||pg_temp.f(k)
FROM unnest(ARRAY['a','b']) k;
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state)
VALUES (pg_temp.f('free'),'free','free','free');
INSERT INTO public.users(id,full_name,email,status,must_change_password)
SELECT id,'Team fixture '||k,id||'@example.test','active',false FROM _team_ids WHERE k IN ('owner_a','owner_b','owner_free','spare','direct_user');
INSERT INTO public.auth_identities(provider,issuer,subject,user_id,status)
SELECT 'supabase',pg_temp.issuer(),id::text,id,'active' FROM _team_ids WHERE k IN ('owner_a','owner_b','owner_free','spare','direct_user');
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status) VALUES
(pg_temp.f('a'),pg_temp.f('owner_a'),'owner','active'),
(pg_temp.f('b'),pg_temp.f('owner_b'),'owner','active'),
(pg_temp.f('free'),pg_temp.f('owner_free'),'owner','active'),
(pg_temp.f('a'),pg_temp.f('spare'),'operator','inactive');
-- No user sub in service-role provisioning calls, deliberately.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE TEMP TABLE _team_result(k text PRIMARY KEY, result jsonb NOT NULL);
DO $$
DECLARE r jsonb; before_state jsonb;
BEGIN
 before_state:=pg_temp.state();
 PERFORM pg_temp.error('Free operator blocked',format('SELECT pg_temp.rpc(%L)',pg_temp.start_sql('owner_free','free')), 'P0001','team_limit_reached');
 PERFORM pg_temp.ok('Free denial untouched',pg_temp.state()=before_state);
 PERFORM pg_temp.error('new admin blocked',format('SELECT pg_temp.rpc(%L)',pg_temp.start_sql('owner_a','admin','admin')), '42501');
 PERFORM pg_temp.ok('admin denial untouched',pg_temp.state()=before_state);
 r:=pg_temp.rpc(pg_temp.start_sql('owner_a','first'));
 PERFORM pg_temp.ok('first paid operator reserves pending',r->>'status'='pending' AND (r->>'operation_id') IS NOT NULL);
 INSERT INTO _team_result VALUES ('first',r);
 before_state:=pg_temp.state();
 PERFORM pg_temp.error('pending reservation blocks second',format('SELECT pg_temp.rpc(%L)',pg_temp.start_sql('owner_a','second')), 'P0001','team_limit_reached');
 PERFORM pg_temp.ok('second denial untouched',pg_temp.state()=before_state);
 -- A privileged ordinary INSERT cannot borrow the reservation owned by finish.
 -- Use an unlinked fixture user, never another tenant's user or operation.
 PERFORM pg_temp.error('direct insert cannot consume another reservation',
  format('INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status) VALUES (%L,%L,%L,%L)',
   pg_temp.f('a'),pg_temp.f('direct_user'),'operator','active'),
  'P0001','team_limit_reached');
 PERFORM pg_temp.ok('direct insert denial untouched',pg_temp.state()=before_state);
 PERFORM pg_temp.ok('start pending idempotent',pg_temp.rpc(pg_temp.start_sql('owner_a','first'))=r);
 PERFORM pg_temp.ok('resume before Auth is safe and explicit',
  pg_temp.rpc(format('SELECT * FROM public.resume_employee_provisioning(%L,%L,%L)',r->>'operation_id',pg_temp.f('owner_a'),pg_temp.issuer()))->>'status'='auth_account_not_found');
 PERFORM pg_temp.ok('missing Auth resume untouched',pg_temp.state()=before_state);
END $$;
-- A REAL local Auth fixture: standard columns only, no password, no API, no
-- invitation/email delivery. Marker and confirmed timestamp are required by finish.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT pg_temp.f('auth_employee'),'authenticated','authenticated',r.result->>'email_normalized',now(),
 jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
 'modulus_employee_provisioning_operation_id',r.result->>'operation_id'), '{}',clock_timestamp(),clock_timestamp()
FROM _team_result r WHERE k='first';
DO $$
DECLARE op uuid; sql text; r jsonb; original jsonb; before_state jsonb;
BEGIN
 SELECT (result->>'operation_id')::uuid INTO op FROM _team_result WHERE k='first';
 sql:=format('SELECT * FROM public.finish_employee_provisioning(%L,%L,%L,%L,%L)',op,pg_temp.f('owner_a'),pg_temp.issuer(),pg_temp.f('auth_employee'),pg_temp.issuer());
 r:=pg_temp.rpc(sql); original:=r;
 PERFORM pg_temp.ok('finish consumes OWN pending reservation',r->>'status'='completed' AND (r->>'membership_id') IS NOT NULL);
 INSERT INTO _team_result VALUES ('finished',r);
 before_state:=pg_temp.state();
 PERFORM pg_temp.ok('finish idempotent',pg_temp.rpc(sql)=original);
 r:=pg_temp.rpc(format('SELECT * FROM public.resume_employee_provisioning(%L,%L,%L)',op,pg_temp.f('owner_a'),pg_temp.issuer()));
 PERFORM pg_temp.ok('resume completed exact identity',r->>'status'='already_completed' AND r->>'membership_id'=original->>'membership_id');
 PERFORM pg_temp.ok('finish/resume replay untouched',pg_temp.state()=before_state);
 PERFORM pg_temp.error('active first blocks second',format('SELECT pg_temp.rpc(%L)',pg_temp.start_sql('owner_a','second')), 'P0001','team_limit_reached');
 PERFORM pg_temp.error('other tenant finish blocked',format('SELECT pg_temp.rpc(%L)',format('SELECT * FROM public.finish_employee_provisioning(%L,%L,%L,%L,%L)',op,pg_temp.f('owner_b'),pg_temp.issuer(),pg_temp.f('auth_employee'),pg_temp.issuer())), '42501');
 PERFORM pg_temp.error('other tenant resume blocked',format('SELECT pg_temp.rpc(%L)',format('SELECT * FROM public.resume_employee_provisioning(%L,%L,%L)',op,pg_temp.f('owner_b'),pg_temp.issuer())), '42501');
 PERFORM pg_temp.error('different actor same tenant finish blocked',format('SELECT pg_temp.rpc(%L)',format('SELECT * FROM public.finish_employee_provisioning(%L,%L,%L,%L,%L)',op,pg_temp.f('spare'),pg_temp.issuer(),pg_temp.f('auth_employee'),pg_temp.issuer())), '42501');
 PERFORM pg_temp.error('different actor same tenant resume blocked',format('SELECT pg_temp.rpc(%L)',format('SELECT * FROM public.resume_employee_provisioning(%L,%L,%L)',op,pg_temp.f('spare'),pg_temp.issuer())), '42501');
 PERFORM pg_temp.ok('all service denials untouched',pg_temp.state()=before_state);
END $$;
SELECT pg_temp.jwt('owner_a');
DO $$
DECLARE target public.enterprise_members%ROWTYPE; person public.users%ROWTYPE; r jsonb; before_state jsonb;
BEGIN
 SELECT * INTO target FROM public.enterprise_members WHERE enterprise_id=pg_temp.f('a') AND user_id=pg_temp.f('spare');
 before_state:=pg_temp.state();
 -- Guard errors are propagated by the RPC; a future explicit RPC status must be
 -- reflected here intentionally, never accepted as any error/any denial.
 PERFORM pg_temp.error('reactivation at capacity',format('SELECT pg_temp.rpc(%L,%L)',format('SELECT * FROM public.set_my_enterprise_member_status(%L,%L,%s)',target.id,'active',target.version),'authenticated'),'P0001','team_limit_reached');
 PERFORM pg_temp.ok('reactivation denial untouched',pg_temp.state()=before_state);
 SELECT * INTO target FROM public.enterprise_members WHERE id=(SELECT (result->>'membership_id')::uuid FROM _team_result WHERE k='finished');
 SELECT * INTO person FROM public.users WHERE id=target.user_id;
 PERFORM pg_temp.error('operator promotion to admin blocked',format('SELECT pg_temp.rpc(%L,%L)',format('SELECT * FROM public.update_my_enterprise_member(%L,%L,%L,%s,%L)',target.id,person.full_name,'admin',target.version,person.full_name),'authenticated'),'42501');
 PERFORM pg_temp.ok('promotion denial untouched',pg_temp.state()=before_state);
 -- Exact existing RPC statuses and full-row comparison for permission denial.
 PERFORM pg_temp.jwt('owner_b');
 r:=pg_temp.rpc(format('SELECT * FROM public.set_my_enterprise_member_status(%L,%L,%s)',target.id,'inactive',target.version),'authenticated');
 PERFORM pg_temp.ok('cross tenant member target unavailable',r->>'status'='target_unavailable');
 PERFORM pg_temp.ok('cross tenant target untouched',pg_temp.state()=before_state);
 PERFORM pg_temp.jwt('spare');
 r:=pg_temp.rpc(format('SELECT * FROM public.set_my_enterprise_member_status(%L,%L,%s)',target.id,'inactive',target.version),'authenticated');
 PERFORM pg_temp.ok('inactive actor permission denied',r->>'status'='permission_denied');
 PERFORM pg_temp.ok('inactive actor denial untouched',pg_temp.state()=before_state);
END $$;
-- Downgrade preserves records but revokes non-owner business access. Clearing the
-- employee password obligation is fixture preparation, not a provisioning replay.
UPDATE public.users SET must_change_password=false WHERE id=(SELECT (result->>'user_id')::uuid FROM _team_result WHERE k='finished');
CREATE TEMP TABLE _before_downgrade AS SELECT pg_temp.state() state;
UPDATE public.enterprise_plan_access SET selected_plan='free',effective_plan='free',access_state='free',paid_until=NULL,authorization_id=NULL WHERE enterprise_id=pg_temp.f('a');
SELECT pg_temp.ok('downgrade preserves team records',pg_temp.state()=(SELECT state FROM _before_downgrade));
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f('auth_employee'),'iss',pg_temp.issuer(),'role','authenticated')::text,true);
SELECT pg_temp.ok('downgraded operator no business access',NOT private.can_access_enterprise(pg_temp.f('a'),'products.read'));
-- Owner can still remediate on Free; successful status is exact, not just no error.
SELECT pg_temp.jwt('owner_a');
DO $$
DECLARE target public.enterprise_members%ROWTYPE; r jsonb; before_state jsonb;
BEGIN
 SELECT * INTO target FROM public.enterprise_members WHERE id=(SELECT (result->>'membership_id')::uuid FROM _team_result WHERE k='finished');
 r:=pg_temp.rpc(format('SELECT * FROM public.set_my_enterprise_member_status(%L,%L,%s)',target.id,'inactive',target.version),'authenticated');
 PERFORM pg_temp.ok('Free owner deactivates for remediation',r->>'status'='success');
 SELECT * INTO target FROM public.enterprise_members WHERE id=target.id;
 before_state:=pg_temp.state();
 PERFORM pg_temp.error('Free reactivation blocked',format('SELECT pg_temp.rpc(%L,%L)',format('SELECT * FROM public.set_my_enterprise_member_status(%L,%L,%s)',target.id,'active',target.version),'authenticated'),'P0001','team_limit_reached');
 PERFORM pg_temp.ok('Free reactivation untouched',pg_temp.state()=before_state);
END $$;
-- Reserve in a second paid tenant, create its own correlated Auth fixture, then
-- downgrade BEFORE finish. Denial must roll back reservation consumption and
-- any public user/identity writes; Auth fixture itself must remain untouched.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO _team_result VALUES ('pending_downgrade',pg_temp.rpc(pg_temp.start_sql('owner_b','pending-downgrade')));
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT pg_temp.f('auth_pending'),'authenticated','authenticated',r.result->>'email_normalized',now(),
 jsonb_build_object('provider','email','providers',jsonb_build_array('email'),
 'modulus_employee_provisioning_operation_id',r.result->>'operation_id'),'{}',clock_timestamp(),clock_timestamp()
FROM _team_result r WHERE k='pending_downgrade';
UPDATE public.enterprise_plan_access SET selected_plan='free',effective_plan='free',access_state='free',paid_until=NULL,authorization_id=NULL WHERE enterprise_id=pg_temp.f('b');
DO $$
DECLARE op uuid; before_state jsonb; before_auth jsonb; employee_email text;
BEGIN
 SELECT (result->>'operation_id')::uuid,result->>'email_normalized' INTO op,employee_email FROM _team_result WHERE k='pending_downgrade';
 before_state:=pg_temp.state();
 SELECT to_jsonb(au) INTO before_auth FROM auth.users au WHERE id=pg_temp.f('auth_pending');
 PERFORM pg_temp.error('finish after pending downgrade rejected',
  format('SELECT pg_temp.rpc(%L)',format('SELECT * FROM public.finish_employee_provisioning(%L,%L,%L,%L,%L)',
   op,pg_temp.f('owner_b'),pg_temp.issuer(),pg_temp.f('auth_pending'),pg_temp.issuer())),
  'P0001','team_limit_reached');
 PERFORM pg_temp.ok('failed finish full public state rolled back',pg_temp.state()=before_state);
 PERFORM pg_temp.ok('failed finish reservation remains pending',
  (SELECT status='pending' AND user_id IS NULL AND auth_identity_id IS NULL AND membership_id IS NULL AND auth_user_id IS NULL
   FROM private.employee_provisioning_operations WHERE id=op));
 PERFORM pg_temp.ok('failed finish no orphan public user',NOT EXISTS(SELECT 1 FROM public.users WHERE email_normalized=employee_email));
 PERFORM pg_temp.ok('failed finish no orphan public identity',NOT EXISTS(SELECT 1 FROM public.auth_identities WHERE issuer=pg_temp.issuer() AND subject=pg_temp.f('auth_pending')::text));
 PERFORM pg_temp.ok('failed finish Auth fixture preserved',
  (SELECT to_jsonb(au)=before_auth FROM auth.users au WHERE id=pg_temp.f('auth_pending')));
END $$;
-- Legacy semantics in final migration: active admin->operator must fit the
-- operator + pending limit, even though total active seats do not increase.
-- Inactive legacy admin/operator reactivation consumes capacity. Those fixtures
-- require the pre-migration disposable-clone procedure; never bypass the guard.
SELECT 'PASS: standalone scenarios; legacy/admin-transition and concurrency require companion procedure' AS result;
ROLLBACK;

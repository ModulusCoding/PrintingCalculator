-- Standalone Supabase SQL Editor regression: run ENTIRE file as postgres.
-- Requires all migrations through 20261026150000 (actor authorization fix).
-- Expected internal helper: private.can_access_enterprise_for_user(uuid,uuid,text).
-- Disposable/local database recommended. Random fixtures only; no auth.users,
-- existing tenants, disabled triggers, production grants or persistent helpers.
-- All writes roll back. On error issue ROLLBACK before retrying the entire file.
-- Statically reviewed only; NOT executed against a database.
-- Unlike the older manual V3 editor suite, authoritative RPC calls below really
-- execute as service_role with EMPTY JWT claims, not postgres with an owner JWT.
-- Legacy V1/V2 rows are authorization-only fixtures, NOT valid legacy save tests.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claim.role','',true);

CREATE TEMP TABLE _actor_fixture(k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO _actor_fixture SELECT k,gen_random_uuid() FROM unnest(ARRAY[
 'a','b','owner_a','owner_b','operator','inactive_operator',
 'actor_a','actor_b','actor_operator','actor_inactive',
 'product','foreign_product','attempt','legacy_1','legacy_2']) k;
-- Grants ONLY on this transaction's temporary fixture, never application objects.
GRANT SELECT ON TABLE _actor_fixture TO service_role, authenticated, anon;
CREATE FUNCTION pg_temp.f(k text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM pg_temp._actor_fixture WHERE _actor_fixture.k=$1
$$;
CREATE FUNCTION pg_temp.check_true(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(label text, statement text, expected text,
 expected_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text; caught_message text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS
  caught=RETURNED_SQLSTATE, caught_message=MESSAGE_TEXT; END;
 IF caught IS DISTINCT FROM expected THEN
  RAISE EXCEPTION '%: SQLSTATE %, expected %',label,coalesce(caught,'success'),expected;
 END IF;
 IF expected_message IS NOT NULL AND caught_message IS DISTINCT FROM expected_message THEN
  RAISE EXCEPTION '%: message %, expected %',label,coalesce(caught_message,'success'),expected_message;
 END IF;
END $$;
CREATE FUNCTION pg_temp.jwt(actor text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
  'sub',pg_temp.f(actor)::text,'iss','actor-test-'||pg_temp.f('a'),
  'role','authenticated')::text,true);
END $$;

INSERT INTO private.auth_issuer_config(issuer,provider,status)
VALUES ('actor-test-'||pg_temp.f('a'),'supabase','active');
INSERT INTO public.enterprises(id,name,status)
SELECT id,'Actor regression '||k,'active' FROM _actor_fixture WHERE k IN ('a','b');
-- Paid bootstrap permits one legitimate active operator; do not bypass team rules
-- or insert a new admin. Inactive membership occupies no active operator seat.
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,authorization_id)
VALUES (pg_temp.f('a'),'intermediate','intermediate','paid',now()+interval '1 day','actor-bootstrap-'||pg_temp.f('a'));
INSERT INTO public.users(id,full_name,email,status,must_change_password)
SELECT id,'Actor regression '||k,id::text||'@example.test','active',false
FROM _actor_fixture WHERE k IN ('owner_a','owner_b','operator','inactive_operator');
-- External subject deliberately differs from internal user UUID. Actor permission
-- checks must use resolved user_id, not blindly treat the supplied subject as uid.
INSERT INTO public.auth_identities(provider,issuer,subject,user_id,status)
SELECT 'supabase','actor-test-'||pg_temp.f('a'),pg_temp.f(actor)::text,pg_temp.f(usr),'active'
FROM (VALUES ('actor_a','owner_a'),('actor_b','owner_b'),
 ('actor_operator','operator'),('actor_inactive','inactive_operator')) v(actor,usr);
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status)
VALUES (pg_temp.f('a'),pg_temp.f('inactive_operator'),'operator','inactive'),
 (pg_temp.f('a'),pg_temp.f('owner_a'),'owner','active'),
 (pg_temp.f('b'),pg_temp.f('owner_b'),'owner','active'),
 (pg_temp.f('a'),pg_temp.f('operator'),'operator','active');
UPDATE public.enterprise_plan_access SET selected_plan='free',effective_plan='free',
 access_state='free',paid_until=NULL,authorization_id=NULL WHERE enterprise_id=pg_temp.f('a');
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state)
VALUES (pg_temp.f('b'),'free','free','free');
INSERT INTO public.products(id,enterprise_id,name,price,active)
VALUES (pg_temp.f('product'),pg_temp.f('a'),'Actor manual V3',10,true),
 (pg_temp.f('foreign_product'),pg_temp.f('b'),'Foreign actor V3',10,true);

-- Action-shaped V3 envelope copied from the standalone manual V3 suite. Capture
-- before switching role so helpers need no privileged production-table access.
CREATE TEMP TABLE _actor_snapshot AS
SELECT jsonb_build_object(
 'schema_version','3','source','manual',
 'input',jsonb_build_object('quantity',3,'printTimeHours',1,
  'printer',jsonb_build_object('name','Manual printer','purchasePrice',100,'lifeHours',3,'powerWatts',100,'maintenancePerHour',0),
  'energyRate',0.5,'lossPercent',0,
  'spoolLines',jsonb_build_array(jsonb_build_object('consumptionGrams',1,'purchasePrice',1,'originalFilamentGrams',3)),
  'packagingLines',jsonb_build_array(jsonb_build_object('mode','per_lot','quantity',1,'referenceQuantity',3,'referencePrice',1,'conversionFactor',1)),
  'finishing',jsonb_build_object('manualTimeHours',0,'laborPerHour',0,'fixedCost',0),
  'packagingPerPiece',0,'markupPercent',0),
 'result',jsonb_build_object('material',0.3333333333333333,'energy',0.05,
  'depreciation',33.333333333333336,'maintenance',0,'finishing',0,
  'packaging',0.3333333333333333,'total',34.05,'unitCost',11.35,
  'suggestedLotPrice',34.05,'suggestedUnitPrice',11.35,'markupAmount',0),
 'product_snapshot',jsonb_build_object('id',p.id,'name',p.name,'active',p.active,'version',p.version,'price',p.price),
 'units',jsonb_build_object('filament','g/lot','printTime','h/lot','finishing','lot','packagingPerPiece','BRL/piece','quantity','piece'),
 'config_snapshot',jsonb_build_object('source','manual','energyRate',0.5),
 'manual_input_references',jsonb_build_object('spool_names',jsonb_build_array('Manual spool'),
  'packaging_names',jsonb_build_array('Manual packaging'),'packaging_units',jsonb_build_array('unidade'))
) snapshot, p.version FROM public.products p WHERE p.id=pg_temp.f('product');
GRANT SELECT ON TABLE _actor_snapshot TO service_role, authenticated, anon;
CREATE FUNCTION pg_temp.manual_call(
 actor uuid DEFAULT pg_temp.f('actor_a'), attempt uuid DEFAULT gen_random_uuid(),
 issuer text DEFAULT 'actor-test-'||pg_temp.f('a'), pid uuid DEFAULT pg_temp.f('product'))
RETURNS TABLE(status text,calculation_id uuid) LANGUAGE sql AS $$
 SELECT r.* FROM pg_temp._actor_snapshot s CROSS JOIN LATERAL
 public.save_manual_pricing_attempt(actor,issuer,attempt,repeat('a',64),repeat('b',64),
  jsonb_set(s.snapshot,'{product_snapshot,id}',to_jsonb(pid::text)),pid,s.version,11.35) r
$$;
CREATE FUNCTION pg_temp.apply_call(actor uuid DEFAULT pg_temp.f('actor_a'),
 calculation uuid DEFAULT pg_temp.f('attempt'), issuer text DEFAULT 'actor-test-'||pg_temp.f('a'))
RETURNS TABLE(status text,product_id uuid,version bigint,applied_price numeric) LANGUAGE sql AS $$
 SELECT r.* FROM pg_temp._actor_snapshot s CROSS JOIN LATERAL
 public.apply_pricing_price(actor,issuer,calculation,s.version) r
$$;
-- These temporary functions are invokers (default EXECUTE), NOT privileged
-- wrappers. Role switching below therefore exercises real RPC ACLs/definers.

SELECT pg_temp.check_true('helper exists',
 to_regprocedure('private.can_access_enterprise_for_user(uuid,uuid,text)') IS NOT NULL);
SELECT pg_temp.check_true('internal helper not exposed to API roles',NOT EXISTS (
 SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE has_function_privilege(r,'private.can_access_enterprise_for_user(uuid,uuid,text)','EXECUTE')));
SELECT pg_temp.check_true('JWT wrapper stays authenticated-only',
 has_function_privilege('authenticated','private.can_access_enterprise(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','private.can_access_enterprise(uuid,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','private.can_access_enterprise(uuid,text)','EXECUTE'));
SELECT pg_temp.check_true('authoritative RPCs stay service-only',NOT EXISTS (
 SELECT 1 FROM unnest(ARRAY[
 'public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric)',
 'public.apply_pricing_price(uuid,text,uuid,bigint)']) sig
 WHERE NOT has_function_privilege('service_role',sig,'EXECUTE')
 OR has_function_privilege('authenticated',sig,'EXECUTE')
 OR has_function_privilege('anon',sig,'EXECUTE')));

SET LOCAL ROLE service_role;
SELECT pg_temp.check_true('actual service role and no user JWT',
 current_user='service_role' AND current_setting('request.jwt.claims')='{}');
SELECT pg_temp.expect_error('service cannot directly use internal helper with known UUID',
 'SELECT private.can_access_enterprise_for_user(pg_temp.f(''owner_a''),pg_temp.f(''a''),''products.write'')','42501');
DO $$ DECLARE r record; applied_version bigint; applied_product uuid; BEGIN
 SELECT * INTO r FROM public.lookup_pricing_attempt(pg_temp.f('actor_a'),
  'actor-test-'||pg_temp.f('a'),pg_temp.f('attempt'),repeat('a',64));
 PERFORM pg_temp.check_true('service lookup missing without JWT',r.status='missing' AND r.calculation_id IS NULL);
 SELECT * INTO r FROM pg_temp.manual_call(attempt=>pg_temp.f('attempt'));
 PERFORM pg_temp.check_true('Free owner save without JWT',r.status='created' AND r.calculation_id=pg_temp.f('attempt'));
 SELECT * INTO r FROM public.lookup_pricing_attempt(pg_temp.f('actor_a'),
  'actor-test-'||pg_temp.f('a'),pg_temp.f('attempt'),repeat('a',64));
 PERFORM pg_temp.check_true('service lookup found without JWT',r.status='found' AND r.calculation_id=pg_temp.f('attempt'));
 SELECT * INTO r FROM pg_temp.manual_call(attempt=>pg_temp.f('attempt'));
 PERFORM pg_temp.check_true('Free owner retry without JWT',r.status='idempotent' AND r.calculation_id=pg_temp.f('attempt'));
 SELECT * INTO r FROM pg_temp.apply_call();
 PERFORM pg_temp.check_true('Free owner apply without JWT',r.status='applied' AND r.applied_price=11.35
  AND r.product_id=pg_temp.f('product') AND r.version>(SELECT version FROM pg_temp._actor_snapshot));
 applied_version := r.version;
 applied_product := r.product_id;
 SELECT * INTO r FROM pg_temp.apply_call();
 PERFORM pg_temp.check_true('Free owner apply replay without JWT',r.status='idempotent' AND r.applied_price=11.35
  AND r.version=applied_version AND r.product_id=applied_product);
END $$;
SELECT pg_temp.expect_error('inactive membership',
 'SELECT * FROM pg_temp.manual_call(actor=>pg_temp.f(''actor_inactive''))','42501','unauthorized');
SELECT pg_temp.expect_error('Free operator cannot save',
 'SELECT * FROM pg_temp.manual_call(actor=>pg_temp.f(''actor_operator''))','42501');
SELECT pg_temp.expect_error('Free operator cannot recover owner apply',
 'SELECT * FROM pg_temp.apply_call(actor=>pg_temp.f(''actor_operator''))','42501');
SELECT pg_temp.expect_error('untrusted issuer save',
 'SELECT * FROM pg_temp.manual_call(issuer=>''untrusted-actor-regression'')','42501','unauthorized');
SELECT pg_temp.expect_error('untrusted issuer cannot recover receipt',
 'SELECT * FROM pg_temp.apply_call(issuer=>''untrusted-actor-regression'')','42501','unauthorized');
SELECT pg_temp.expect_error('unknown external actor',
 'SELECT * FROM pg_temp.manual_call(actor=>gen_random_uuid())','42501','unauthorized');
SELECT pg_temp.expect_error('internal uid is not an external subject',
 'SELECT * FROM pg_temp.manual_call(actor=>pg_temp.f(''owner_a''))','42501');
SELECT pg_temp.expect_error('other tenant product cannot save',
 'SELECT * FROM pg_temp.manual_call(pid=>pg_temp.f(''foreign_product''))','40001');
SELECT pg_temp.check_true('other tenant lookup cannot discover known attempt',
 (SELECT status='missing' AND calculation_id IS NULL FROM public.lookup_pricing_attempt(
  pg_temp.f('actor_b'),'actor-test-'||pg_temp.f('a'),pg_temp.f('attempt'),repeat('a',64))));
-- Valid owner B lacks pricing.apply on Free: no cross-tenant receipt recovery.
SELECT pg_temp.expect_error('other tenant actor cannot recover apply',
 'SELECT * FROM pg_temp.apply_call(actor=>pg_temp.f(''actor_b''))','42501');
RESET ROLE;

CREATE TEMP TABLE _actor_before AS SELECT
 (SELECT to_jsonb(c) FROM public.pricing_calculations c WHERE id=pg_temp.f('attempt')) calculation,
 (SELECT to_jsonb(p) FROM public.products p WHERE id=pg_temp.f('product')) product,
 (SELECT to_jsonb(a) FROM public.pricing_price_applications a WHERE calculation_id=pg_temp.f('attempt')) receipt;
-- Privileged fixture setup only; ordinary INSERT triggers remain enabled.
INSERT INTO public.pricing_calculations(
 id,enterprise_id,product_id,actor_id,attempt_id,request_hash,snapshot_hash,
 product_version,enterprise_version,electricity_rate_original,electricity_rate_used,price_suggested_unit,snapshot)
SELECT pg_temp.f('legacy_'||v),c.enterprise_id,c.product_id,c.actor_id,pg_temp.f('legacy_'||v),c.request_hash,c.snapshot_hash,
 c.product_version,c.enterprise_version,c.electricity_rate_original,c.electricity_rate_used,c.price_suggested_unit,
 jsonb_set(c.snapshot-'source','{schema_version}',to_jsonb(v))
FROM public.pricing_calculations c CROSS JOIN unnest(ARRAY['1','2']) v WHERE c.id=pg_temp.f('attempt');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('Free V1 apply still forbidden',
 'SELECT * FROM pg_temp.apply_call(calculation=>pg_temp.f(''legacy_1''))','42501');
SELECT pg_temp.expect_error('Free V2 apply still forbidden',
 'SELECT * FROM pg_temp.apply_call(calculation=>pg_temp.f(''legacy_2''))','42501');
RESET ROLE;

-- Mutations between role switches are postgres fixture setup, never a privileged
-- temporary RPC shim. Both new saves and existing receipts must revalidate actor.
UPDATE public.enterprise_members SET status='inactive' WHERE enterprise_id=pg_temp.f('a') AND user_id=pg_temp.f('owner_a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('inactive owner membership save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('inactive owner membership replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE public.enterprise_members SET status='active' WHERE enterprise_id=pg_temp.f('a') AND user_id=pg_temp.f('owner_a');
UPDATE public.enterprises SET status='inactive' WHERE id=pg_temp.f('a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('inactive enterprise save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('inactive enterprise replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE public.enterprises SET status='active' WHERE id=pg_temp.f('a');
UPDATE public.users SET status='inactive' WHERE id=pg_temp.f('owner_a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('inactive user new save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('inactive user save retry','SELECT * FROM pg_temp.manual_call(attempt=>pg_temp.f(''attempt''))','42501');
SELECT pg_temp.expect_error('inactive user apply replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE public.users SET status='active',must_change_password=true WHERE id=pg_temp.f('owner_a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('password-change user save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('password-change user replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE public.users SET must_change_password=false WHERE id=pg_temp.f('owner_a');
UPDATE public.auth_identities SET status='inactive' WHERE user_id=pg_temp.f('owner_a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('inactive identity save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('inactive identity replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE public.auth_identities SET status='active' WHERE user_id=pg_temp.f('owner_a');
UPDATE private.auth_issuer_config SET status='inactive' WHERE issuer='actor-test-'||pg_temp.f('a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('inactive trusted issuer save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('inactive trusted issuer replay','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
RESET ROLE;
UPDATE private.auth_issuer_config SET status='active' WHERE issuer='actor-test-'||pg_temp.f('a');
DELETE FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('selection-required new manual save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
SELECT pg_temp.expect_error('selection-required apply replay not newly eligible','SELECT * FROM pg_temp.apply_call()','42501','unauthorized');
SELECT pg_temp.check_true('selection-required durable save retry',
 (SELECT status='idempotent' FROM pg_temp.manual_call(attempt=>pg_temp.f('attempt'))));
RESET ROLE;
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,authorization_id)
VALUES (pg_temp.f('a'),'intermediate','intermediate','paid',now()+interval '1 day','actor-paid-'||pg_temp.f('a'));
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('paid owner not eligible for NEW manual Free save','SELECT * FROM pg_temp.manual_call()','42501','unauthorized');
RESET ROLE;

-- JWT-wrapper equivalence: privileged test context may evaluate the internal
-- helper, but authenticated and anon must never call it directly. Exercise all
-- current permissions for real owner/operator identities in BOTH paid and Free.
DO $$ DECLARE actor text; uid uuid; eid uuid; permission text; plan_name text; BEGIN
 FOREACH plan_name IN ARRAY ARRAY['intermediate','free'] LOOP
  IF plan_name='free' THEN
   UPDATE public.enterprise_plan_access SET selected_plan='free',effective_plan='free',
    access_state='free',paid_until=NULL,authorization_id=NULL WHERE enterprise_id=pg_temp.f('a');
  END IF;
  FOREACH actor IN ARRAY ARRAY['actor_a','actor_b','actor_operator'] LOOP
   PERFORM pg_temp.jwt(actor);
   uid := CASE actor WHEN 'actor_a' THEN pg_temp.f('owner_a') WHEN 'actor_b' THEN pg_temp.f('owner_b') ELSE pg_temp.f('operator') END;
   FOREACH eid IN ARRAY ARRAY[pg_temp.f('a'),pg_temp.f('b'),gen_random_uuid()] LOOP
    FOREACH permission IN ARRAY ARRAY[
     'products.read','products.write','products.delete','catalogs.read','catalogs.write','catalogs.delete',
     'filters.read','filters.write','filters.delete','sales.read','sales.write','sales.delete',
     'printers.read','printers.write','printers.archive','materials.read','materials.write','materials.archive',
     'pricing.read','pricing.write','pricing.apply','enterprise.manage','enterprise.pricing_loss.write',
     'members.manage_admins','members.manage_operators','spools.read','spools.write','spools.archive','spools.delete',
     'inventory.read','inventory.write','stock.materials.read','stock.materials.write','stock.materials.archive','stock.materials.delete',
     'unknown.permission',NULL] LOOP
     PERFORM pg_temp.check_true('JWT/helper equivalent '||actor||' '||coalesce(permission,'NULL'),
      private.can_access_enterprise(eid,permission) IS NOT DISTINCT FROM
      private.can_access_enterprise_for_user(uid,eid,permission));
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
-- Negative identity states must agree too, not merely the active matrix.
SELECT pg_temp.jwt('actor_a');
UPDATE public.users SET status='inactive' WHERE id=pg_temp.f('owner_a');
SELECT pg_temp.check_true('inactive owner JWT/helper both false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE
 AND private.can_access_enterprise_for_user(pg_temp.f('owner_a'),pg_temp.f('a'),'products.write') IS FALSE);
UPDATE public.users SET status='active',must_change_password=true WHERE id=pg_temp.f('owner_a');
SELECT pg_temp.check_true('password-change owner JWT/helper both false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE
 AND private.can_access_enterprise_for_user(pg_temp.f('owner_a'),pg_temp.f('a'),'products.write') IS FALSE);
UPDATE public.users SET must_change_password=false WHERE id=pg_temp.f('owner_a');
SELECT pg_temp.check_true('NULL internal uid cannot authorize',
 private.can_access_enterprise_for_user(NULL,pg_temp.f('a'),'products.write') IS FALSE);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('JWT wrapper no JWT is false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE);
SELECT pg_temp.expect_error('authenticated known UUID helper entry forbidden',
 'SELECT private.can_access_enterprise_for_user(pg_temp.f(''owner_a''),pg_temp.f(''a''),''products.write'')','42501');
SELECT pg_temp.expect_error('authenticated cannot enter service save',
 'SELECT * FROM pg_temp.manual_call()','42501');
SELECT pg_temp.jwt('actor_b');
SELECT pg_temp.check_true('incompatible tenant JWT remains false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE);
SELECT set_config('request.jwt.claims',jsonb_build_object(
 'sub',pg_temp.f('actor_a')::text,'iss','untrusted-actor-regression','role','authenticated')::text,true);
SELECT pg_temp.check_true('invalid issuer JWT wrapper false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE);
SELECT set_config('request.jwt.claims',jsonb_build_object(
 'sub',gen_random_uuid()::text,'iss','actor-test-'||pg_temp.f('a'),'role','authenticated')::text,true);
SELECT pg_temp.check_true('unknown subject JWT wrapper false',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS FALSE);
SELECT pg_temp.jwt('actor_a');
SELECT pg_temp.check_true('legitimate tenant JWT remains true',
 private.can_access_enterprise(pg_temp.f('a'),'products.write') IS TRUE);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('anon known UUID helper entry forbidden',
 'SELECT private.can_access_enterprise_for_user(pg_temp.f(''owner_a''),pg_temp.f(''a''),''products.write'')','42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.check_true('authorized final replay still works without JWT',
 (SELECT status='idempotent' FROM pg_temp.apply_call()));
RESET ROLE;
SELECT pg_temp.check_true('denials and replays preserve entire calculation/product/receipt',
 (SELECT calculation=(SELECT to_jsonb(c) FROM public.pricing_calculations c WHERE id=pg_temp.f('attempt'))
 AND product=(SELECT to_jsonb(p) FROM public.products p WHERE id=pg_temp.f('product'))
 AND receipt=(SELECT to_jsonb(a) FROM public.pricing_price_applications a WHERE calculation_id=pg_temp.f('attempt')) FROM _actor_before));
SELECT pg_temp.check_true('exactly one application; legacy denials create none',
 (SELECT count(*)=1 FROM public.pricing_price_applications WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('only intended manual and legacy fixture calculations exist',
 (SELECT count(*)=3 FROM public.pricing_calculations WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))));
ROLLBACK;

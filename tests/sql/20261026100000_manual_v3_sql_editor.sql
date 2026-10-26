-- Standalone Supabase SQL Editor suite: run ENTIRE file as postgres.
-- Requires ALL repository migrations through 20261026130000 already applied.
-- Local/disposable DB recommended. All fixture writes are rolled back.
-- On any error issue ROLLBACK before retrying; do not run selected fragments.
-- Based on assertions -> manual_v3_fixture -> initial_free_plan_fixture;
-- standalone bootstrap adapted to current team rules (no unused legacy admin).
-- Copy-only fixes: paid bootstrap before team inserts, inactive operator first;
-- bounds via legitimate save, distinct unapplied window intent, deleted_by.
-- No triggers disabled, no auth.users, no migrations or existing tenant writes.
-- Not executed against a database. Legacy V1/V2 below are historical fixtures,
-- NOT validation of their original save RPCs. Full legacy save/replay and
-- concurrency coverage remain gaps; no authorization bypass is used.
-- Owner JWT claims below simulate an authenticated context only. This does NOT
-- reproduce the HTTP service-role client used by Server Actions; test that path
-- separately in the browser (pricing_actor also reads JWT-dependent permissions).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
-- Expanded manual fixture; never run against an API connection.
-- Reuse isolated tenants, identities and exact-SQLSTATE helpers; no auth.users.
-- Shared fixture ONLY: caller must BEGIN and ultimately ROLLBACK (or use a
-- disposable database per the concurrency guide). Run as postgres, never via API.
-- No auth.users rows, existing tenant data, policies or triggers are modified.
CREATE TEMP TABLE _initial_free_fixture(k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO _initial_free_fixture SELECT k,gen_random_uuid()
FROM unnest(ARRAY['a','b','owner_a','owner_b','operator','inactive_operator','material_a','material_b']) k;
CREATE FUNCTION pg_temp.f(k text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pg_temp._initial_free_fixture WHERE _initial_free_fixture.k=$1 $$;
CREATE FUNCTION pg_temp.check_true(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(label text, statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
  IF caught IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: SQLSTATE %, expected %',label,coalesce(caught,'success'),expected;
  END IF;
END $$;
CREATE FUNCTION pg_temp.jwt(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f(who)::text,
 'iss','initial-free-test-'||pg_temp.f('a')::text,'role','authenticated')::text,true);
END $$;
INSERT INTO private.auth_issuer_config(issuer,provider,status)
VALUES ('initial-free-test-'||pg_temp.f('a')::text,'supabase','active');
INSERT INTO public.enterprises(id,name,status)
SELECT id,'Initial Free fixture '||k,'active' FROM _initial_free_fixture WHERE k IN ('a','b');
-- Paid bootstrap allows the real team-limit INSERT trigger to run normally.
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,authorization_id)
VALUES (pg_temp.f('a'),'intermediate','intermediate','paid',now()+interval '1 day','bootstrap-'||pg_temp.f('a'));
INSERT INTO public.users(id,full_name,email,status,must_change_password)
SELECT id,'Initial Free '||k,id::text||'@example.test','active',false
FROM _initial_free_fixture WHERE k IN ('owner_a','owner_b','operator','inactive_operator');
INSERT INTO public.auth_identities(provider,issuer,subject,user_id,status)
SELECT 'supabase','initial-free-test-'||pg_temp.f('a')::text,id::text,id,'active'
FROM _initial_free_fixture WHERE k IN ('owner_a','owner_b','operator','inactive_operator');
-- Inactive operator consumes no active seat; one active operator fits paid quota.
-- No admin fixture: new admins are forbidden by 20261026120000 and are not used
-- by any V3 assertion. This expansion intentionally omits the shared legacy admin.
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status)
VALUES (pg_temp.f('a'),pg_temp.f('inactive_operator'),'operator','inactive');
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status) VALUES
(pg_temp.f('a'),pg_temp.f('owner_a'),'owner','active'),
(pg_temp.f('b'),pg_temp.f('owner_b'),'owner','active'),
(pg_temp.f('a'),pg_temp.f('operator'),'operator','active');
DELETE FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a');
-- A: two live registrations (including archived), one soft-deleted of each kind.
-- B: one of each; distinct counts expose cross-tenant leakage.
INSERT INTO public.products(enterprise_id,name,active,deleted_at)
SELECT pg_temp.f(t), 'Product '||n, n=1, CASE WHEN n=3 THEN clock_timestamp() END
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.materials(id,enterprise_id,name,material_type,reference_weight_grams,reference_price)
VALUES (pg_temp.f('material_a'),pg_temp.f('a'),'Reference A','PLA',1000,20),
       (pg_temp.f('material_b'),pg_temp.f('b'),'Reference B','PLA',1000,20);
INSERT INTO public.filament_spools(enterprise_id,material_id,internal_identifier,
 original_filament_grams,current_balance_grams,purchase_price,active,deleted_at,
 create_attempt_id,create_actor_id,create_internal_identifier,create_initial_balance_grams,create_purchase_price)
SELECT pg_temp.f(t),pg_temp.f('material_'||t),'Spool '||n,1000,0,20,n=1,
 CASE WHEN n=3 THEN clock_timestamp() END,gen_random_uuid(),pg_temp.f('owner_'||t),'Spool '||n,0,20
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.general_materials(enterprise_id,name,control_unit,reference_quantity,reference_price,
 active,deleted_at,create_actor_id,create_attempt_id,create_payload)
SELECT pg_temp.f(t),'General '||n,'unidade',1,1,n=1,
 CASE WHEN n=3 THEN clock_timestamp() END,pg_temp.f('owner_'||t),gen_random_uuid(),'{}'::jsonb
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.printers(enterprise_id,name,purchase_price,estimated_life_hours,average_power_watts,active)
SELECT pg_temp.f(t),'Printer '||n,100,1000,100,n=1
FROM (VALUES ('a',2),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;


INSERT INTO _initial_free_fixture SELECT k,gen_random_uuid()
FROM unnest(ARRAY['manual_product','foreign_product','manual_attempt','hidden_product']) k;
INSERT INTO public.products(id,enterprise_id,name,price,active,created_at)
VALUES (pg_temp.f('manual_product'),pg_temp.f('a'),'Manual V3',10,true,clock_timestamp()),
       (pg_temp.f('foreign_product'),pg_temp.f('b'),'Foreign V3',10,true,clock_timestamp()),
       (pg_temp.f('hidden_product'),pg_temp.f('a'),'Outside free window',10,true,'2000-01-01');
-- Valid baseline: explicitly selected Free. Selection-required is tested separately.
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state)
VALUES (pg_temp.f('a'),'free','free','free')
ON CONFLICT (enterprise_id) DO UPDATE SET selected_plan='free',effective_plan='free',access_state='free';
CREATE FUNCTION pg_temp.manual_snapshot(pid uuid DEFAULT pg_temp.f('manual_product'))
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'schema_version','3','source','manual',
  'input',jsonb_build_object(
    'quantity',3,'printTimeHours',1,
    'printer',jsonb_build_object('name','Manual printer','purchasePrice',100,'lifeHours',3,'powerWatts',100,'maintenancePerHour',0),
    'energyRate',0.5,'lossPercent',0,
    'spoolLines',jsonb_build_array(jsonb_build_object('consumptionGrams',1,'purchasePrice',1,'originalFilamentGrams',3)),
    'packagingLines',jsonb_build_array(jsonb_build_object('mode','per_lot','quantity',1,'referenceQuantity',3,'referencePrice',1,'conversionFactor',1)),
    'finishing',jsonb_build_object('manualTimeHours',0,'laborPerHour',0,'fixedCost',0),
    'packagingPerPiece',0,'markupPercent',0),
  -- All eleven FdmPricingResult fields; deliberately unrounded fractions.
  -- SQL validates the envelope and suggested price, NOT a second calculator.
  'result',jsonb_build_object('material',0.3333333333333333,'energy',0.05,
    'depreciation',33.333333333333336,'maintenance',0,'finishing',0,
    'packaging',0.3333333333333333,'total',34.05,'unitCost',11.35,
    'suggestedLotPrice',34.05,'suggestedUnitPrice',11.35,'markupAmount',0),
  'product_snapshot',jsonb_build_object('id',p.id,'name',p.name,'active',p.active,'version',p.version,'price',p.price),
  'units',jsonb_build_object('filament','g/lot','printTime','h/lot','finishing','lot','packagingPerPiece','BRL/piece','quantity','piece'),
  'config_snapshot',jsonb_build_object('source','manual','energyRate',0.5),
  'manual_input_references',jsonb_build_object('spool_names',jsonb_build_array('Manual spool'),
    'packaging_names',jsonb_build_array('Manual packaging'),'packaging_units',jsonb_build_array('unidade')))
 FROM public.products p WHERE p.id=pid
$$;
CREATE FUNCTION pg_temp.manual_call(
 s jsonb DEFAULT pg_temp.manual_snapshot(), actor uuid DEFAULT pg_temp.f('owner_a'),
 attempt uuid DEFAULT gen_random_uuid(), request_hash text DEFAULT repeat('a',64),
 snapshot_hash text DEFAULT repeat('b',64), pid uuid DEFAULT pg_temp.f('manual_product'),
 product_version bigint DEFAULT (pg_temp.manual_snapshot()->'product_snapshot'->>'version')::bigint,
 suggested numeric DEFAULT 11.35,
 issuer text DEFAULT 'initial-free-test-'||pg_temp.f('a')::text)
RETURNS TABLE(status text,calculation_id uuid) LANGUAGE sql AS $$
 SELECT * FROM public.save_manual_pricing_attempt(actor,issuer,attempt,request_hash,snapshot_hash,s,pid,product_version,suggested)
$$;
CREATE FUNCTION pg_temp.bad_snapshot(label text, s jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.expect_error(label,format('SELECT * FROM pg_temp.manual_call(%L::jsonb)',s),'22023');
END $$;
-- Capture full rows, not just counts, so unintended balance/version changes fail.
CREATE FUNCTION pg_temp.inventory_state() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
 'spools',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.filament_spools t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))),
 'general',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.general_materials t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))),
 'spool_ledger',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.filament_spool_movements t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))),
 'general_ledger',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.general_material_movements t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))),
 'product_balances',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.product_inventory t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))),
 'product_ledger',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.product_inventory_movements t WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))))
$$;
CREATE TEMP TABLE _manual_before AS SELECT pg_temp.inventory_state() inventory;

-- pricing_actor ultimately checks can_access_enterprise via the JWT-backed
-- current_internal_user_id, even when the RPC receives an explicit actor.
-- Set the isolated owner context before any RPC assertions; SET LOCAL claims
-- are transaction-scoped and disappear on ROLLBACK. No owner_b RPCs run here.
SELECT pg_temp.jwt('owner_a');


SELECT pg_temp.check_true('RPC restricted to authoritative service actor',
 has_function_privilege('service_role','public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric)','EXECUTE')
 AND NOT has_function_privilege('anon','public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric)','EXECUTE'));

-- Each malformed case starts from a valid action-shaped envelope and a NEW intent.
-- expect_error catches only the RPC exception and compares the exact SQLSTATE;
-- a successful write or a cast/array traversal error cannot pass accidentally.
DO $$
DECLARE s jsonb := pg_temp.manual_snapshot(); k text; path text[]; val jsonb; item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('null attempt','attempt => NULL'),('null product','pid => NULL'),
  ('null version','product_version => NULL'),('negative version','product_version => -1'),
  ('null request hash','request_hash => NULL'),('null snapshot hash','snapshot_hash => NULL'),
  ('empty request hash','request_hash => '''''),('short hash','snapshot_hash => ''abc'''),
  ('uppercase hash','request_hash => repeat(''A'',64)'),('nonhex hash','snapshot_hash => repeat(''g'',64)'),
  ('null price','suggested => NULL'),('negative price','suggested => -1'),
  ('nan price','suggested => ''NaN''::numeric'),('infinite price','suggested => ''Infinity''::numeric')
 ) v(label,args) LOOP
  PERFORM pg_temp.expect_error(item.label,'SELECT * FROM pg_temp.manual_call('||item.args||')','22023');
 END LOOP;
 PERFORM pg_temp.bad_snapshot('SQL null root',NULL);
 FOREACH val IN ARRAY ARRAY['null','[]','1','"manual"','true']::jsonb[] LOOP
  PERFORM pg_temp.bad_snapshot('root type '||val::text,val);
 END LOOP;
 FOREACH k IN ARRAY ARRAY['schema_version','source'] LOOP
  PERFORM pg_temp.bad_snapshot('absent '||k,s-k);
  FOREACH val IN ARRAY ARRAY['null','{}','[]','3','true','"wrong"']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot(k||' type/value '||val::text,jsonb_set(s,ARRAY[k],val));
  END LOOP;
 END LOOP;
END $$;

DO $$
DECLARE s jsonb := pg_temp.manual_snapshot(); path text[]; val jsonb; key text;
BEGIN
 FOR path IN SELECT string_to_array(p,'.') FROM unnest(ARRAY[
  'input','result','product_snapshot','units','config_snapshot','manual_input_references',
  'input.printer','input.finishing','input.spoolLines','input.packagingLines',
  'manual_input_references.spool_names','manual_input_references.packaging_names','manual_input_references.packaging_units']) p LOOP
  PERFORM pg_temp.bad_snapshot('absent container '||path::text,s #- path);
  FOREACH val IN ARRAY ARRAY['null','true','1','"x"']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot('container type '||path::text,jsonb_set(s,path,val));
  END LOOP;
  IF path[array_length(path,1)] IN ('spoolLines','packagingLines','spool_names','packaging_names','packaging_units') THEN
   PERFORM pg_temp.bad_snapshot('object instead of array '||path::text,jsonb_set(s,path,'{}'));
  ELSE
   PERFORM pg_temp.bad_snapshot('array instead of object '||path::text,jsonb_set(s,path,'[]'));
  END IF;
 END LOOP;
 FOR path IN SELECT string_to_array(p,'.') FROM unnest(ARRAY[
  'input.quantity','input.printTimeHours','input.energyRate','input.lossPercent','input.packagingPerPiece','input.markupPercent',
  'input.printer.purchasePrice','input.printer.lifeHours','input.printer.powerWatts','input.printer.maintenancePerHour',
  'input.spoolLines.0.consumptionGrams','input.spoolLines.0.purchasePrice','input.spoolLines.0.originalFilamentGrams',
  'input.packagingLines.0.quantity','input.packagingLines.0.referenceQuantity','input.packagingLines.0.referencePrice','input.packagingLines.0.conversionFactor',
  'input.finishing.manualTimeHours','input.finishing.laborPerHour','input.finishing.fixedCost','config_snapshot.energyRate',
  'result.material','result.energy','result.depreciation','result.maintenance','result.finishing','result.packaging','result.total',
  'result.unitCost','result.suggestedLotPrice','result.suggestedUnitPrice','result.markupAmount']) p LOOP
  PERFORM pg_temp.bad_snapshot('absent number '||path::text,s #- path);
  FOREACH val IN ARRAY ARRAY['null','"1"','"NaN"','"Infinity"','true','{}','[]']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot('number type '||path::text||' '||val::text,jsonb_set(s,path,val));
  END LOOP;
  PERFORM pg_temp.bad_snapshot('negative number '||path::text,jsonb_set(s,path,'-1'));
 END LOOP;
 FOREACH key IN ARRAY ARRAY['filament','printTime','finishing','packagingPerPiece','quantity'] LOOP
  PERFORM pg_temp.bad_snapshot('missing unit '||key,s #- ARRAY['units',key]);
  FOREACH val IN ARRAY ARRAY['null','1','"wrong"']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot('wrong unit '||key,jsonb_set(s,ARRAY['units',key],val));
  END LOOP;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['spoolLines','packagingLines'] LOOP
  FOREACH val IN ARRAY ARRAY['null','1','"x"','[]']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot('line element '||key,jsonb_set(s,ARRAY['input',key,'0'],val));
  END LOOP;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['spool_names','packaging_names','packaging_units'] LOOP
  PERFORM pg_temp.bad_snapshot('reference cardinality '||key,jsonb_set(s,ARRAY['manual_input_references',key],'[]'));
  FOREACH val IN ARRAY ARRAY['null','1','true','{}','[]']::jsonb[] LOOP
   PERFORM pg_temp.bad_snapshot('reference element '||key,jsonb_set(s,ARRAY['manual_input_references',key,'0'],val));
  END LOOP;
 END LOOP;
 PERFORM pg_temp.bad_snapshot('integrated root IDs forbidden',s||'{"spools":[]}'::jsonb);
 PERFORM pg_temp.bad_snapshot('integrated printer ID forbidden',jsonb_set(s,'{input,printer,id}',to_jsonb(pg_temp.f('manual_product')::text)));
 PERFORM pg_temp.bad_snapshot('integrated spool ID forbidden',jsonb_set(s,'{input,spoolLines,0,spoolId}',to_jsonb(pg_temp.f('manual_product')::text)));
 PERFORM pg_temp.bad_snapshot('integrated material ID forbidden',jsonb_set(s,'{input,packagingLines,0,materialId}',to_jsonb(pg_temp.f('manual_product')::text)));
 PERFORM pg_temp.bad_snapshot('empty spool lines',jsonb_set(s,'{input,spoolLines}','[]'));
 PERFORM pg_temp.bad_snapshot('loss over 100',jsonb_set(s,'{input,lossPercent}','100.0001'));
 PERFORM pg_temp.bad_snapshot('fractional quantity',jsonb_set(s,'{input,quantity}','1.5'));
 PERFORM pg_temp.bad_snapshot('price mismatch',jsonb_set(s,'{result,suggestedUnitPrice}','12'));
 PERFORM pg_temp.bad_snapshot('config source absent',s #- '{config_snapshot,source}');
 PERFORM pg_temp.bad_snapshot('config source wrong',jsonb_set(s,'{config_snapshot,source}','"integrated"'));
 PERFORM pg_temp.bad_snapshot('packaging mode absent',s #- '{input,packagingLines,0,mode}');
 PERFORM pg_temp.bad_snapshot('packaging mode wrong',jsonb_set(s,'{input,packagingLines,0,mode}','"integrated"'));
 PERFORM pg_temp.bad_snapshot('conversion must be one',jsonb_set(s,'{input,packagingLines,0,conversionFactor}','2'));
 PERFORM pg_temp.bad_snapshot('packaging unit enum',jsonb_set(s,'{manual_input_references,packaging_units,0}','"kg"'));
 FOR path IN SELECT string_to_array(p,'.') FROM unnest(ARRAY[
  'input.quantity','input.printTimeHours','input.printer.lifeHours','input.printer.powerWatts',
  'input.spoolLines.0.consumptionGrams','input.spoolLines.0.originalFilamentGrams',
  'input.packagingLines.0.quantity','input.packagingLines.0.referenceQuantity']) p LOOP
  PERFORM pg_temp.bad_snapshot('positive/divisor zero '||path::text,jsonb_set(s,path,'0'));
 END LOOP;
END $$;

-- Valid input precision is not a database scale restriction. Both packaging
-- modes, all canonical supplied units, and explicitly selected Free are valid.
DO $$
DECLARE s jsonb; r record; u text;
BEGIN
 FOREACH u IN ARRAY ARRAY['unidade','metro','centimetro','grama','quilograma'] LOOP
  s := jsonb_set(pg_temp.manual_snapshot(),'{manual_input_references,packaging_units,0}',to_jsonb(u));
  s := jsonb_set(s,'{input,packagingLines,0,mode}','"per_piece"');
  s := jsonb_set(s,'{input,printTimeHours}','0.3333333333333333');
  s := jsonb_set(s,'{input,finishing,manualTimeHours}','0.016666666666666666');
  SELECT * INTO r FROM pg_temp.manual_call(s => s);
  PERFORM pg_temp.check_true('free owner precise input and packaging unit '||u,r.status='created');
 END LOOP;
END $$;
DELETE FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a');
SELECT pg_temp.expect_error('selection_required cannot create manual V3',
 'SELECT * FROM pg_temp.manual_call()','42501');
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state)
VALUES (pg_temp.f('a'),'free','free','free');

-- Access errors must not masquerade as validation errors.
SELECT pg_temp.expect_error('operator is not owner',
 'SELECT * FROM pg_temp.manual_call(actor => pg_temp.f(''operator''))','42501');
SELECT pg_temp.expect_error('inactive actor',
 'SELECT * FROM pg_temp.manual_call(actor => pg_temp.f(''inactive_operator''))','42501');
SELECT pg_temp.expect_error('untrusted issuer',
 'SELECT * FROM pg_temp.manual_call(issuer => ''untrusted-fixture-issuer'')','42501');
SELECT pg_temp.expect_error('other tenant product',
 'SELECT * FROM pg_temp.manual_call(s => pg_temp.manual_snapshot(pg_temp.f(''foreign_product'')), pid => pg_temp.f(''foreign_product''), product_version => (pg_temp.manual_snapshot(pg_temp.f(''foreign_product''))->''product_snapshot''->>''version'')::bigint)','40001');
SELECT pg_temp.expect_error('outside latest three window',
 'SELECT * FROM pg_temp.manual_call(s => pg_temp.manual_snapshot(pg_temp.f(''hidden_product'')), pid => pg_temp.f(''hidden_product''), product_version => (pg_temp.manual_snapshot(pg_temp.f(''hidden_product''))->''product_snapshot''->>''version'')::bigint)','40001');

-- Historical V1/V2 authorization-only fixtures. INSERT is privileged setup,
-- with every normal INSERT trigger enabled; not a claim of valid legacy saves.
DO $$
DECLARE legacy_id uuid; legacy_schema text; pv bigint;
BEGIN
 SELECT version INTO pv FROM public.products WHERE id=pg_temp.f('manual_product');
 FOREACH legacy_schema IN ARRAY ARRAY['1','2'] LOOP
  legacy_id := gen_random_uuid();
  INSERT INTO public.pricing_calculations(
   id,enterprise_id,product_id,actor_id,attempt_id,request_hash,snapshot_hash,
   product_version,enterprise_version,electricity_rate_original,electricity_rate_used,price_suggested_unit,snapshot)
  SELECT legacy_id,c.enterprise_id,c.product_id,c.actor_id,legacy_id,c.request_hash,c.snapshot_hash,
   c.product_version,c.enterprise_version,c.electricity_rate_original,c.electricity_rate_used,c.price_suggested_unit,
   jsonb_set(c.snapshot - 'source','{schema_version}',to_jsonb(legacy_schema))
  FROM public.pricing_calculations c WHERE c.enterprise_id=pg_temp.f('a') LIMIT 1;
  PERFORM pg_temp.check_true('legacy fixture inserted '||legacy_schema,EXISTS (
   SELECT 1 FROM public.pricing_calculations WHERE id=legacy_id));
  PERFORM pg_temp.expect_error('Free cannot apply V'||legacy_schema,format(
   'SELECT * FROM public.apply_pricing_price(%L::uuid,%L,%L::uuid,%s)',
   pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),legacy_id,pv),'42501');
  PERFORM pg_temp.check_true('legacy denied without receipt',NOT EXISTS (
   SELECT 1 FROM public.pricing_price_applications WHERE calculation_id=legacy_id));
 END LOOP;
END $$;

DO $$
DECLARE s jsonb := pg_temp.manual_snapshot(); r record; original jsonb; pv bigint;
 bounds_id uuid; window_id uuid; inactive_id uuid; replay_product jsonb; replay_count bigint;
BEGIN
 SELECT version INTO pv FROM public.products WHERE id=pg_temp.f('manual_product');
 -- Only explicitly selected Free authorizes new manual V3 calculations.
 PERFORM pg_temp.check_true('selected Free fixture',
  (SELECT NOT selection_required AND effective_plan='free' FROM private.resolve_enterprise_plan(pg_temp.f('a'))));
 SELECT * INTO r FROM pg_temp.manual_call(attempt => pg_temp.f('manual_attempt'));
 PERFORM pg_temp.check_true('valid V3 created',r.status='created' AND r.calculation_id=pg_temp.f('manual_attempt'));
 SELECT to_jsonb(c) INTO original FROM public.pricing_calculations c WHERE id=r.calculation_id;
 PERFORM pg_temp.check_true('snapshot preserved exactly',original->'snapshot'=s);
 -- Change live product metadata and version: retry uses the previously saved intent.
 UPDATE public.products SET name='Renamed after calculation',price=20 WHERE id=pg_temp.f('manual_product');
 SELECT * INTO r FROM pg_temp.manual_call(s => pg_temp.manual_snapshot(),attempt => pg_temp.f('manual_attempt'),
  snapshot_hash => repeat('c',64),product_version => (pg_temp.manual_snapshot()->'product_snapshot'->>'version')::bigint);
 PERFORM pg_temp.check_true('retry ignores volatile product snapshot/hash',r.status='idempotent' AND r.calculation_id=pg_temp.f('manual_attempt'));
 PERFORM pg_temp.expect_error('different request hash conflicts',
  'SELECT * FROM pg_temp.manual_call(attempt => pg_temp.f(''manual_attempt''), request_hash => repeat(''d'',64))','23505');
 -- Durable save receipts survive selection-required and a paid upgrade.
 DELETE FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a');
 SELECT * INTO r FROM pg_temp.manual_call(attempt => pg_temp.f('manual_attempt'),snapshot_hash => repeat('e',64));
 PERFORM pg_temp.check_true('selection-required retry receipt',r.status='idempotent' AND r.calculation_id=pg_temp.f('manual_attempt'));
 PERFORM pg_temp.expect_error('selection-required different intent conflicts',
  'SELECT * FROM pg_temp.manual_call(attempt => pg_temp.f(''manual_attempt''),request_hash => repeat(''f'',64))','23505');
 INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,paid_until,authorization_id)
 VALUES (pg_temp.f('a'),'intermediate','intermediate','paid',now()+interval '1 day','manual-v3-test-'||pg_temp.f('a'));
 SELECT * INTO r FROM pg_temp.manual_call(attempt => pg_temp.f('manual_attempt'),snapshot_hash => repeat('e',64));
 PERFORM pg_temp.check_true('upgrade retry receipt',r.status='idempotent' AND r.calculation_id=pg_temp.f('manual_attempt'));
 PERFORM pg_temp.expect_error('upgrade different intent conflicts',
  'SELECT * FROM pg_temp.manual_call(attempt => pg_temp.f(''manual_attempt''),request_hash => repeat(''f'',64))','23505');
 UPDATE public.enterprise_plan_access SET selected_plan='free',effective_plan='free',access_state='free',paid_until=NULL,authorization_id=NULL
 WHERE enterprise_id=pg_temp.f('a');
 PERFORM pg_temp.check_true('retry left entire history immutable',
  (SELECT to_jsonb(c)=original FROM public.pricing_calculations c WHERE id=pg_temp.f('manual_attempt')));
 SELECT version INTO pv FROM public.products WHERE id=pg_temp.f('manual_product');
 PERFORM pg_temp.expect_error('history UPDATE denied',
  'UPDATE public.pricing_calculations SET price_suggested_unit=1000001 WHERE id=pg_temp.f(''manual_attempt'')','42501');
 SELECT * INTO r FROM pg_temp.manual_call(
  s => jsonb_set(pg_temp.manual_snapshot(),'{result,suggestedUnitPrice}','1000001'),suggested => 1000001);
 bounds_id := r.calculation_id;
 PERFORM pg_temp.check_true('bounds calculation saved',r.status='created');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),bounds_id,pv);
 PERFORM pg_temp.check_true('apply price bounds',r.status='price_out_of_bounds' AND r.version=pv AND r.applied_price IS NULL);
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv+1);
 PERFORM pg_temp.check_true('unapplied version conflict',r.status='product_version_conflict' AND r.version=pv AND r.applied_price IS NULL);
 PERFORM pg_temp.check_true('conflict has no receipt',NOT EXISTS (
  SELECT 1 FROM public.pricing_price_applications WHERE calculation_id=pg_temp.f('manual_attempt')));
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('apply saved V3',r.status='applied' AND r.applied_price=11.35 AND r.version>pv);
 SELECT to_jsonb(p) INTO replay_product FROM public.products p WHERE id=pg_temp.f('manual_product');
 SELECT count(*) INTO replay_count FROM public.pricing_price_applications WHERE enterprise_id=pg_temp.f('a');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('apply replay idempotent',r.status='idempotent');
 -- Applied receipt precedes current product version checks.
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),0);
 PERFORM pg_temp.check_true('applied retry ignores changed version',r.status='idempotent' AND r.applied_price=11.35);
 PERFORM pg_temp.check_true('one price application ledger',
  (SELECT count(*)=1 FROM public.pricing_price_applications WHERE calculation_id=pg_temp.f('manual_attempt')));
 PERFORM pg_temp.check_true('apply did not rewrite historical snapshot',
  (SELECT to_jsonb(c)=original FROM public.pricing_calculations c WHERE id=pg_temp.f('manual_attempt')));
 PERFORM pg_temp.check_true('replays preserve product price/version/full row',
  (SELECT to_jsonb(p)=replay_product FROM public.products p WHERE id=pg_temp.f('manual_product')));
 PERFORM pg_temp.check_true('replays preserve receipt count',
  (SELECT count(*)=replay_count FROM public.pricing_price_applications WHERE enterprise_id=pg_temp.f('a')));
 PERFORM pg_temp.expect_error('application history UPDATE denied',
  'UPDATE public.pricing_price_applications SET applied_price=0 WHERE calculation_id=pg_temp.f(''manual_attempt'')','42501');
 -- DISTINCT unapplied intent: applied receipts intentionally bypass the window.
 SELECT * INTO r FROM pg_temp.manual_call();
 window_id := r.calculation_id;
 PERFORM pg_temp.check_true('window intent saved',r.status='created');
 UPDATE public.products SET created_at='1900-01-01' WHERE id=pg_temp.f('manual_product');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),window_id,pv);
 PERFORM pg_temp.check_true('out-of-window apply unavailable',r.status='product_unavailable' AND r.version IS NULL);
 UPDATE public.products SET created_at=clock_timestamp() WHERE id=pg_temp.f('manual_product');
 SELECT * INTO r FROM pg_temp.manual_call();
 inactive_id := r.calculation_id;
 PERFORM pg_temp.check_true('inactive test intent saved',r.status='created');
 UPDATE public.products SET active=false WHERE id=pg_temp.f('manual_product');
 -- Keep the envelope valid so this reaches the live-product check, not 22023.
 PERFORM pg_temp.expect_error('inactive product new save',format(
  'SELECT * FROM pg_temp.manual_call(s => %L::jsonb, product_version => %s)',
  jsonb_set(pg_temp.manual_snapshot(),'{product_snapshot,active}','true'::jsonb),
  (pg_temp.manual_snapshot()->'product_snapshot'->>'version')::bigint),'40001');
 SELECT version INTO pv FROM public.products WHERE id=pg_temp.f('manual_product');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),inactive_id,pv);
 PERFORM pg_temp.check_true('inactive product apply',r.status='product_unavailable' AND r.version IS NULL AND r.applied_price IS NULL);
 PERFORM pg_temp.check_true('rejected intents have no receipts',NOT EXISTS (
  SELECT 1 FROM public.pricing_price_applications WHERE calculation_id IN (window_id,inactive_id,bounds_id)));
 UPDATE public.products SET active=true WHERE id=pg_temp.f('manual_product');
 -- New attempts cannot save a soft-deleted product (old version matches snapshot).
 UPDATE public.products SET deleted_at=clock_timestamp(),deleted_by=pg_temp.f('owner_a') WHERE id=pg_temp.f('manual_product');
 PERFORM pg_temp.expect_error('deleted product',format(
  'SELECT * FROM pg_temp.manual_call(s => %L::jsonb, product_version => %s)',
  pg_temp.manual_snapshot(),(pg_temp.manual_snapshot()->'product_snapshot'->>'version')::bigint),'40001');
END $$;
SELECT pg_temp.check_true('all balances and inventory ledgers unchanged',
 (SELECT inventory=pg_temp.inventory_state() FROM _manual_before));
ROLLBACK;


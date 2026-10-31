-- Run from repository root as postgres with all migrations applied:
-- psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/sql/20261026100000_manual_v3_assertions.sql
-- Local/disposable DB only. Every fixture and successful write is rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir 20261026100000_manual_v3_fixture.sql

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

DO $$
DECLARE s jsonb := pg_temp.manual_snapshot(); r record; original jsonb; pv bigint;
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
 UPDATE public.pricing_calculations SET price_suggested_unit=1000001 WHERE id=pg_temp.f('manual_attempt');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('apply price bounds',r.status='price_out_of_bounds' AND r.version=pv AND r.applied_price IS NULL);
 UPDATE public.pricing_calculations SET price_suggested_unit=11.35 WHERE id=pg_temp.f('manual_attempt');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('apply saved V3',r.status='applied' AND r.applied_price=11.35 AND r.version>pv);
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('apply replay idempotent',r.status='idempotent');
 -- Applied receipt precedes current product version checks.
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),0);
 PERFORM pg_temp.check_true('applied retry ignores changed version',r.status='idempotent' AND r.applied_price=11.35);
 PERFORM pg_temp.check_true('one price application ledger',
  (SELECT count(*)=1 FROM public.pricing_price_applications WHERE calculation_id=pg_temp.f('manual_attempt')));
 PERFORM pg_temp.check_true('apply did not rewrite historical snapshot',
  (SELECT to_jsonb(c)=original FROM public.pricing_calculations c WHERE id=pg_temp.f('manual_attempt')));
 -- Apply rejects an out-of-window V3 product with null version; then restore
 -- the Free window to isolate the subsequent deleted-product save assertion.
 UPDATE public.products SET created_at='2000-01-01' WHERE id=pg_temp.f('manual_product');
 SELECT * INTO r FROM public.apply_pricing_price(pg_temp.f('owner_a'),'initial-free-test-'||pg_temp.f('a'),pg_temp.f('manual_attempt'),pv);
 PERFORM pg_temp.check_true('out-of-window apply unavailable',r.status='product_unavailable' AND r.version IS NULL);
 UPDATE public.products SET created_at=clock_timestamp() WHERE id=pg_temp.f('manual_product');
 -- New attempts cannot save a soft-deleted product (old version matches snapshot).
 UPDATE public.products SET deleted_at=clock_timestamp() WHERE id=pg_temp.f('manual_product');
 PERFORM pg_temp.expect_error('deleted product',format(
  'SELECT * FROM pg_temp.manual_call(s => %L::jsonb, product_version => %s)',
  pg_temp.manual_snapshot(),(pg_temp.manual_snapshot()->'product_snapshot'->>'version')::bigint),'40001');
END $$;
SELECT pg_temp.check_true('all balances and inventory ledgers unchanged',
 (SELECT inventory=pg_temp.inventory_state() FROM _manual_before));
ROLLBACK;

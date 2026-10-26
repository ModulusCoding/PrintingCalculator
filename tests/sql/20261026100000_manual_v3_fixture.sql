-- Included by the assertions inside BEGIN; never run against an API connection.
-- Reuse isolated tenants, identities and exact-SQLSTATE helpers; no auth.users.
\ir 20261026050000_initial_free_plan_fixture.sql

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

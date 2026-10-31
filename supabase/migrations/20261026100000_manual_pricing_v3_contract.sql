-- Manual V3 only. V2 persistence, historical snapshots and apply remain unchanged.
BEGIN;

-- Exact shapes reject integrated IDs/references as well as missing required keys.
CREATE OR REPLACE FUNCTION private.manual_v3_object(p jsonb, p_keys text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN p ?& p_keys AND (p - p_keys) = '{}'::jsonb;
END $$;

-- No decimal-scale restriction: times and engine results carry JS precision.
-- A separate type branch must precede the cast (SQL boolean evaluation is unordered).
CREATE OR REPLACE FUNCTION private.manual_v3_number(
  p jsonb, p_max numeric, p_positive boolean DEFAULT false, p_integer boolean DEFAULT false
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  n numeric;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n := (p #>> '{}')::numeric;
  IF n::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN false; END IF;
  IF n < 0 OR n > p_max THEN RETURN false; END IF;
  IF p_positive AND n <= 0 THEN RETURN false; END IF;
  IF p_integer AND n <> trunc(n) THEN RETURN false; END IF;
  RETURN true;
END $$;

ALTER FUNCTION private.manual_v3_object(jsonb,text[]) OWNER TO postgres;
ALTER FUNCTION private.manual_v3_number(jsonb,numeric,boolean,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.manual_v3_object(jsonb,text[]),
  private.manual_v3_number(jsonb,numeric,boolean,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_manual_pricing_attempt(
  p_actor uuid,
  p_issuer text,
  p_attempt_id uuid,
  p_request_hash text,
  p_snapshot_hash text,
  p_snapshot jsonb,
  p_product_id uuid,
  p_product_version bigint,
  p_suggested_price numeric
)
RETURNS TABLE(status text, calculation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  x record;
  c public.pricing_calculations%ROWTYPE;
  p public.products%ROWTYPE;
  plan record;
  actor_role text;
  v_input jsonb;
  v_printer jsonb;
  v_finishing jsonb;
  v_result jsonb;
  v_product jsonb;
  v_config jsonb;
  v_refs jsonb;
  ref_items jsonb;
  item jsonb;
  k text;
  v_rate numeric;
  -- Exact decimal representation of Number.MAX_VALUE, not an arbitrary business cap.
  js_max CONSTANT numeric := 1.7976931348623157e308;
  input_max CONSTANT numeric := 1000000000000;
BEGIN
  -- A. Scalar boundary. Actor/issuer failures retain the authorization convention.
  IF p_actor IS NULL OR p_issuer IS NULL OR btrim(p_issuer) = '' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL OR p_product_id IS NULL
     OR p_product_version IS NULL OR p_product_version < 0 OR p_product_version > 9007199254740991
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_snapshot_hash IS NULL OR p_snapshot_hash !~ '^[0-9a-f]{64}$'
     OR p_suggested_price IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_suggested_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_suggested_price < 0 OR p_suggested_price > 1e30 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Authenticate and recover a durable receipt before consulting mutable plan,
  -- product or snapshot state. Request hash is intent; snapshot hash is not.
  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.write');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pricing:manual:' || x.enterprise_id::text, 0));
  SELECT * INTO c FROM public.pricing_calculations
    WHERE enterprise_id = x.enterprise_id AND attempt_id = p_attempt_id
    FOR UPDATE;
  IF FOUND THEN
    IF c.actor_id = x.uid AND c.request_hash = p_request_hash THEN
      RETURN QUERY SELECT 'idempotent'::text, c.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  -- B. Root and containers: every required object/array is checked before use.
  IF NOT private.manual_v3_object(p_snapshot, ARRAY[
    'schema_version','source','input','result','product_snapshot','units',
    'config_snapshot','manual_input_references'
  ]) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot->'schema_version' IS DISTINCT FROM '"3"'::jsonb
     OR p_snapshot->'source' IS DISTINCT FROM '"manual"'::jsonb THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF NOT private.manual_v3_object(p_snapshot->'units', ARRAY[
    'filament','printTime','finishing','packagingPerPiece','quantity'
  ]) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  v_input := p_snapshot->'input';
  v_result := p_snapshot->'result';
  v_product := p_snapshot->'product_snapshot';
  v_config := p_snapshot->'config_snapshot';
  v_refs := p_snapshot->'manual_input_references';
  IF NOT private.manual_v3_object(v_input, ARRAY[
    'quantity','printTimeHours','printer','energyRate','lossPercent','spoolLines',
    'packagingLines','finishing','packagingPerPiece','markupPercent'
  ]) OR NOT private.manual_v3_object(v_result, ARRAY[
    'material','energy','depreciation','maintenance','finishing','packaging','total',
    'unitCost','suggestedLotPrice','suggestedUnitPrice','markupAmount'
  ]) OR NOT private.manual_v3_object(v_product, ARRAY['id','name','active','version','price'])
     OR NOT private.manual_v3_object(v_config, ARRAY['source','energyRate'])
     OR NOT private.manual_v3_object(v_refs, ARRAY['spool_names','packaging_names','packaging_units']) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  v_printer := v_input->'printer';
  v_finishing := v_input->'finishing';
  IF NOT private.manual_v3_object(v_printer, ARRAY['name','purchasePrice','lifeHours','powerWatts','maintenancePerHour'])
     OR NOT private.manual_v3_object(v_finishing, ARRAY['manualTimeHours','laborPerHour','fixedCost']) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_input->'spoolLines') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_input->'packagingLines') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_refs->'spool_names') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_refs->'packaging_names') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_refs->'packaging_units') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_input->'spoolLines') NOT BETWEEN 1 AND 10
     OR jsonb_array_length(v_input->'packagingLines') > 10
     OR jsonb_array_length(v_refs->'spool_names') <> jsonb_array_length(v_input->'spoolLines')
     OR jsonb_array_length(v_refs->'packaging_names') <> jsonb_array_length(v_input->'packagingLines')
     OR jsonb_array_length(v_refs->'packaging_units') <> jsonb_array_length(v_input->'packagingLines') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- C. Required fields and element types, without any numeric cast.
  IF jsonb_typeof(v_product->'id') IS DISTINCT FROM 'string'
     OR v_product->>'id' IS DISTINCT FROM p_product_id::text
     OR jsonb_typeof(v_product->'name') IS DISTINCT FROM 'string'
     OR v_product->'active' IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(v_product->'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_product->'price') NOT IN ('number','null')
     OR v_config->'source' IS DISTINCT FROM '"manual"'::jsonb
     OR jsonb_typeof(v_config->'energyRate') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_printer->'name') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(v_printer->>'name')) NOT BETWEEN 1 AND 200
     OR v_printer->>'name' IS DISTINCT FROM btrim(v_printer->>'name') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['quantity','printTimeHours','energyRate','lossPercent','packagingPerPiece','markupPercent'] LOOP
    IF jsonb_typeof(v_input->k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['purchasePrice','lifeHours','powerWatts','maintenancePerHour'] LOOP
    IF jsonb_typeof(v_printer->k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['manualTimeHours','laborPerHour','fixedCost'] LOOP
    IF jsonb_typeof(v_finishing->k) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(v_input->'spoolLines') LOOP
    IF NOT private.manual_v3_object(item, ARRAY['consumptionGrams','purchasePrice','originalFilamentGrams']) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    FOREACH k IN ARRAY ARRAY['consumptionGrams','purchasePrice','originalFilamentGrams'] LOOP
      IF jsonb_typeof(item->k) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(v_input->'packagingLines') LOOP
    IF NOT private.manual_v3_object(item, ARRAY['mode','quantity','referenceQuantity','referencePrice','conversionFactor']) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF item->'mode' IS DISTINCT FROM '"per_piece"'::jsonb AND item->'mode' IS DISTINCT FROM '"per_lot"'::jsonb THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    FOREACH k IN ARRAY ARRAY['quantity','referenceQuantity','referencePrice','conversionFactor'] LOOP
      IF jsonb_typeof(item->k) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  FOR k, ref_items IN SELECT key, value FROM jsonb_each(v_refs) LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(ref_items) LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
      END IF;
      IF k = 'packaging_units' THEN
        -- Canonical suppliedUnit values from manualPackagingUnitSchema.
        IF (item #>> '{}') NOT IN ('unidade','metro','centimetro','grama','quilograma') THEN
          RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
        END IF;
      ELSE
        IF char_length(btrim(item #>> '{}')) NOT BETWEEN 1 AND 200
           OR (item #>> '{}') IS DISTINCT FROM btrim(item #>> '{}') THEN
          RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_each(v_result) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- D. Numeric domain checks only after types; no motor reimplementation.
  IF NOT private.manual_v3_number(v_product->'version', 9007199254740991, false, true)
     OR (v_product->>'version')::numeric <> p_product_version THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF v_product->'price' <> 'null'::jsonb THEN
    IF NOT private.manual_v3_number(v_product->'price', 1000000) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT private.manual_v3_number(v_input->'quantity', input_max, true, true)
     OR NOT private.manual_v3_number(v_input->'printTimeHours', input_max, true)
     OR NOT private.manual_v3_number(v_input->'energyRate', 100)
     OR NOT private.manual_v3_number(v_input->'lossPercent', 100)
     OR NOT private.manual_v3_number(v_input->'packagingPerPiece', input_max)
     OR NOT private.manual_v3_number(v_input->'markupPercent', input_max)
     OR NOT private.manual_v3_number(v_config->'energyRate', 100) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  v_rate := (v_input->>'energyRate')::numeric;
  IF (v_config->>'energyRate')::numeric <> v_rate THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['purchasePrice','lifeHours','powerWatts','maintenancePerHour'] LOOP
    IF NOT private.manual_v3_number(v_printer->k, input_max, k IN ('lifeHours','powerWatts')) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['manualTimeHours','laborPerHour','fixedCost'] LOOP
    IF NOT private.manual_v3_number(v_finishing->k, input_max) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(v_input->'spoolLines') LOOP
    IF NOT private.manual_v3_number(item->'consumptionGrams', input_max, true)
       OR NOT private.manual_v3_number(item->'purchasePrice', input_max)
       OR NOT private.manual_v3_number(item->'originalFilamentGrams', input_max, true) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(v_input->'packagingLines') LOOP
    IF NOT private.manual_v3_number(item->'quantity', input_max, true)
       OR NOT private.manual_v3_number(item->'referenceQuantity', input_max, true)
       OR NOT private.manual_v3_number(item->'referencePrice', input_max)
       OR (item->>'conversionFactor')::numeric <> 1 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_each(v_result) LOOP
    IF NOT private.manual_v3_number(item, js_max) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (v_result->>'suggestedUnitPrice')::numeric <> p_suggested_price THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot->'units' IS DISTINCT FROM '{
    "filament":"g/lot", "printTime":"h/lot", "finishing":"lot",
    "packagingPerPiece":"BRL/piece", "quantity":"piece"
  }'::jsonb THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Only NEW attempts consult the current manual-pricing eligibility matrix.
  SELECT em.role INTO actor_role FROM public.enterprise_members em
    WHERE em.enterprise_id = x.enterprise_id AND em.user_id = x.uid AND em.status = 'active';
  SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);
  IF actor_role IS DISTINCT FROM 'owner'
     OR plan.effective_plan IS DISTINCT FROM 'free'
     OR plan.access_state IS NULL OR plan.access_state NOT IN ('free','expired','cancelled') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.products
    WHERE enterprise_id = x.enterprise_id AND id = p_product_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND OR p.active IS DISTINCT FROM true OR p.version IS DISTINCT FROM p_product_version
     OR NOT private.stage6b_product_visible(x.enterprise_id, p_product_id) THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  -- Snapshot bytes and their hash are authoritative in the action; JSONB cannot
  -- reconstruct JSON.stringify bytes, so SQL validates hash format only.
  INSERT INTO public.pricing_calculations(
    id, enterprise_id, product_id, actor_id, attempt_id, request_hash, snapshot_hash,
    product_version, enterprise_version, electricity_rate_original, electricity_rate_used,
    price_suggested_unit, snapshot
  ) VALUES (
    p_attempt_id, x.enterprise_id, p.id, x.uid, p_attempt_id, p_request_hash, p_snapshot_hash,
    p.version, 0, v_rate, v_rate, p_suggested_price, p_snapshot
  );
  RETURN QUERY SELECT 'created'::text, p_attempt_id;
END $$;

ALTER FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) TO service_role;

COMMIT;

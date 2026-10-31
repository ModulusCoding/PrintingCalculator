-- Stage 6BC Manual Contract Fix Migration
-- Refactors save_manual_pricing_attempt to perform staged jsonb validation,
-- permit free owner and selection_required, validate V3 input structure fully,
-- enforce strict idempotency (same request hash -> idempotent, mismatched snapshot hash -> conflict).

BEGIN;

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
  role text;
  v_rate numeric;
  v_suggested numeric;
  v_input jsonb;
  v_printer jsonb;
  v_units jsonb;
  v_result jsonb;
  v_product_snap jsonb;
  v_config_snap jsonb;
BEGIN
  -- Staged Step 1: Scalar inputs basic validation
  IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_product_version IS NULL OR p_product_version < 0
     OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_snapshot_hash !~ '^[0-9a-f]{64}$'
     OR p_suggested_price IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF NOT private.stage6bc_numeric(p_suggested_price, 0, 1000000000000000000000000000000, 6) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 2: Root JSONB structure
  IF jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF p_snapshot->>'schema_version' <> '3' OR p_snapshot->>'source' <> 'manual' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 3: Product snapshot
  v_product_snap := p_snapshot->'product_snapshot';
  IF jsonb_typeof(v_product_snap) <> 'object'
     OR v_product_snap->>'id' IS DISTINCT FROM p_product_id::text
     OR v_product_snap->>'version' IS DISTINCT FROM p_product_version::text THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 4: Config snapshot & Energy Rate
  v_config_snap := p_snapshot->'config_snapshot';
  IF jsonb_typeof(v_config_snap) <> 'object'
     OR v_config_snap->>'source' <> 'manual'
     OR jsonb_typeof(v_config_snap->'energyRate') <> 'number' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  v_rate := (v_config_snap->>'energyRate')::numeric;
  IF NOT private.stage6bc_numeric(v_rate, 0, 100, 6) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 5: Result snapshot
  v_result := p_snapshot->'result';
  IF jsonb_typeof(v_result) <> 'object'
     OR jsonb_typeof(v_result->'suggestedUnitPrice') <> 'number' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  v_suggested := (v_result->>'suggestedUnitPrice')::numeric;
  IF v_suggested IS DISTINCT FROM p_suggested_price THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 6: Units snapshot
  v_units := p_snapshot->'units';
  IF jsonb_typeof(v_units) <> 'object' OR v_units = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Staged Step 7: Input fields (V3)
  v_input := p_snapshot->'input';
  IF jsonb_typeof(v_input) <> 'object' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Verify quantity & printTimeHours
  IF jsonb_typeof(v_input->'quantity') <> 'number'
     OR jsonb_typeof(v_input->'printTimeHours') <> 'number'
     OR NOT private.stage6bc_numeric((v_input->>'quantity')::numeric, 1, 1000000, 0)
     OR NOT private.stage6bc_numeric((v_input->>'printTimeHours')::numeric, 0, 10000, 4) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Printer inside input
  v_printer := v_input->'printer';
  IF jsonb_typeof(v_printer) <> 'object'
     OR jsonb_typeof(v_printer->'purchasePrice') <> 'number'
     OR jsonb_typeof(v_printer->'lifeHours') <> 'number'
     OR jsonb_typeof(v_printer->'powerWatts') <> 'number'
     OR jsonb_typeof(v_printer->'maintenancePerHour') <> 'number'
     OR NOT private.stage6bc_numeric((v_printer->>'purchasePrice')::numeric, 0, 1000000, 2)
     OR NOT private.stage6bc_numeric((v_printer->>'lifeHours')::numeric, 0.0001, 1000000, 4)
     OR NOT private.stage6bc_numeric((v_printer->>'powerWatts')::numeric, 0, 1000000, 2)
     OR NOT private.stage6bc_numeric((v_printer->>'maintenancePerHour')::numeric, 0, 1000000, 2) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Spool lines inside input
  IF jsonb_typeof(v_input->'spoolLines') <> 'array'
     OR jsonb_array_length(v_input->'spoolLines') < 1
     OR jsonb_array_length(v_input->'spoolLines') > 10
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_input->'spoolLines') s
       WHERE jsonb_typeof(s) <> 'object'
          OR jsonb_typeof(s->'consumptionGrams') <> 'number'
          OR jsonb_typeof(s->'purchasePrice') <> 'number'
          OR jsonb_typeof(s->'originalFilamentGrams') <> 'number'
          OR NOT private.stage6bc_numeric((s->>'consumptionGrams')::numeric, 0.0001, 1000000, 4)
          OR NOT private.stage6bc_numeric((s->>'purchasePrice')::numeric, 0, 1000000, 2)
          OR NOT private.stage6bc_numeric((s->>'originalFilamentGrams')::numeric, 0.0001, 1000000, 4)
     ) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Authorization and Identity Check
  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.write');
  SELECT em.role INTO role FROM public.enterprise_members em WHERE em.enterprise_id = x.enterprise_id AND em.user_id = x.uid AND em.status = 'active';
  SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);

  -- Enforce: must be enterprise owner, free plan, and valid state (free, selection_required, expired, cancelled)
  IF role IS DISTINCT FROM 'owner'
     OR plan.effective_plan IS DISTINCT FROM 'free'
     OR plan.access_state NOT IN ('free', 'selection_required', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Lock specifically for manual pricing
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pricing:manual:' || x.enterprise_id::text, 0));

  -- Idempotency check: look up existing calculation by attempt_id
  SELECT * INTO c FROM public.pricing_calculations
  WHERE enterprise_id = x.enterprise_id AND attempt_id = p_attempt_id
  FOR UPDATE;

  IF FOUND THEN
    IF c.actor_id = x.uid AND c.request_hash = p_request_hash THEN
      IF c.snapshot_hash = p_snapshot_hash THEN
        RETURN QUERY SELECT 'idempotent'::text, c.id;
        RETURN;
      ELSE
        RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
      END IF;
    ELSE
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Product existence and active state check
  SELECT * INTO p FROM public.products
  WHERE enterprise_id = x.enterprise_id AND id = p_product_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT p.active OR p.version <> p_product_version OR NOT private.stage6b_product_visible(x.enterprise_id, p_product_id) THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  -- Insert the calculation record
  INSERT INTO public.pricing_calculations(
    id, enterprise_id, product_id, actor_id, attempt_id, request_hash, snapshot_hash,
    product_version, enterprise_version, electricity_rate_original, electricity_rate_used,
    price_suggested_unit, snapshot
  )
  VALUES (
    p_attempt_id, x.enterprise_id, p.id, x.uid, p_attempt_id, p_request_hash, p_snapshot_hash,
    p.version, 0, v_rate, v_rate, p_suggested_price, p_snapshot
  );

  RETURN QUERY SELECT 'created'::text, p_attempt_id;
END $$;

ALTER FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) TO service_role;

COMMIT;

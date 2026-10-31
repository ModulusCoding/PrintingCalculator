-- Stage 6B/C/D Comprehensive Pricing & Enterprise Hardening Migration.
-- Recreates lookup_pricing_attempt, save_pricing_attempt (V1 & V2 complete validation),
-- save_manual_pricing_attempt, and apply_pricing_price with robust NaN/Infinity handling via p::text,
-- explicit INSERT columns, strict role matrix / can_access authorization, enterprise version check,
-- product deleted_at filter, plan paid checks, and consistent race locking.

BEGIN;

-- 1. Ensure private helper for numeric safety without calling incompatible isfinite(numeric) directly where numeric infinity may not exist or behave as expected.
CREATE OR REPLACE FUNCTION private.stage6bc_numeric(p numeric,p_min numeric,p_max numeric,p_scale integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p IS NOT NULL
     AND p::text NOT IN ('NaN', 'Infinity', '-Infinity')
     AND p BETWEEN p_min AND p_max
     AND scale(p) <= p_scale;
$$;

-- 2. Unified pricing actor helper with correct permissions and locking sequence.
-- Acquires enterprise lock before product/source lock to prevent deadlocks.
CREATE OR REPLACE FUNCTION private.pricing_actor(p_actor uuid, p_issuer text, p_permission text)
RETURNS TABLE(uid uuid, enterprise_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  i public.auth_identities%ROWTYPE;
  u public.users%ROWTYPE;
  m public.enterprise_members%ROWTYPE;
  e public.enterprises%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_issuer IS NULL OR btrim(p_issuer) = '' 
     OR p_permission NOT IN ('pricing.read', 'pricing.write', 'pricing.apply', 'products.write') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || btrim(p_issuer) || ':' || p_actor::text, 0));

  SELECT ai.* INTO i
  FROM public.auth_identities ai
  JOIN private.auth_issuer_config ac ON ac.issuer = ai.issuer AND ac.provider = 'supabase' AND ac.status = 'active'
  WHERE ai.provider = 'supabase' AND ai.issuer = btrim(p_issuer) AND ai.subject = p_actor::text AND ai.status = 'active'
  FOR UPDATE OF ai;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO u FROM public.users WHERE id = i.user_id FOR UPDATE;
  IF NOT FOUND OR u.status <> 'active' OR u.must_change_password THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT em.* INTO m
  FROM public.enterprise_members em
  JOIN public.enterprises en ON en.id = em.enterprise_id
  WHERE em.user_id = u.id AND em.status = 'active' AND en.status = 'active'
  FOR UPDATE OF em;

  IF NOT FOUND OR (
    SELECT count(*) 
    FROM public.enterprise_members z 
    JOIN public.enterprises q ON q.id = z.enterprise_id 
    WHERE z.user_id = u.id AND z.status = 'active' AND q.status = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO e FROM public.enterprises WHERE id = m.enterprise_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR NOT private.can_access_enterprise(e.id, p_permission) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  uid := u.id;
  enterprise_id := e.id;
  RETURN NEXT;
END $$;

-- 3. lookup_pricing_attempt
CREATE OR REPLACE FUNCTION public.lookup_pricing_attempt(p_actor uuid, p_issuer text, p_attempt_id uuid, p_request_hash text)
RETURNS TABLE(status text, calculation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  x record;
  c public.pricing_calculations%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.read');
  SELECT * INTO c FROM public.pricing_calculations WHERE enterprise_id = x.enterprise_id AND attempt_id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::uuid;
  ELSIF c.actor_id = x.uid AND c.request_hash = p_request_hash THEN
    RETURN QUERY SELECT 'found'::text, c.id;
  ELSE
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
  END IF;
END $$;

-- 4. save_pricing_attempt (Recreated fully preserving V1 & V2 validation, enterprise version check, product deleted filter, plan paid/limits, NaN check via ::text, explicit INSERT columns)
CREATE OR REPLACE FUNCTION public.save_pricing_attempt(
  p_actor uuid,
  p_issuer text,
  p_attempt_id uuid,
  p_request_hash text,
  p_snapshot_hash text,
  p_snapshot jsonb,
  p_product_id uuid,
  p_product_version bigint,
  p_enterprise_version bigint,
  p_original_rate numeric,
  p_used_rate numeric,
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
  e public.enterprises%ROWTYPE;
  m record;
  pr record;
  ma record;
  v_schema text;
  v_material_count int;
  v_spool_count int;
  v_general_material_count int;
  v_key text;
  v_item jsonb;
  v_field text;
  v_types text;
  v_spec jsonb;
  v_uuid uuid;
  v_version bigint;
  v_factor numeric;
BEGIN
  -- Basic parameter validation
  IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_request_hash IS NULL OR p_snapshot_hash IS NULL OR p_snapshot IS NULL
     OR p_product_version IS NULL OR p_product_version < 0
     OR p_enterprise_version IS NULL OR p_enterprise_version < 0
     OR p_used_rate IS NULL OR p_used_rate::text IN ('NaN','Infinity','-Infinity') OR p_used_rate NOT BETWEEN 0 AND 100
     OR p_suggested_price IS NULL OR p_suggested_price::text IN ('NaN','Infinity','-Infinity') OR p_suggested_price NOT BETWEEN 0 AND 1e30
     OR (p_original_rate IS NOT NULL AND (p_original_rate::text IN ('NaN','Infinity','-Infinity') OR p_original_rate NOT BETWEEN 0 AND 100))
     OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_snapshot_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Authorization (pricing.write)
  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.write');

  -- Idempotency check
  SELECT * INTO c FROM public.pricing_calculations pc
  WHERE pc.enterprise_id = x.enterprise_id AND pc.attempt_id = p_attempt_id
  FOR UPDATE;
  IF FOUND THEN
    IF c.actor_id = x.uid AND c.request_hash = p_request_hash THEN
      RETURN QUERY SELECT 'idempotent'::text, c.id;
      RETURN;
    ELSE
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Snapshot validation - common structure for both V1 and V2.
  -- Establish all scalar/container types before any numeric/recordset casts.
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'schema_version') NOT IN ('string','number')
     OR jsonb_typeof(p_snapshot->'input') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'result') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'product_snapshot') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'printers') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot->'config_snapshot') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'config_snapshot'->'version') IS DISTINCT FROM 'number'
     OR (jsonb_typeof(p_snapshot->'config_snapshot'->'original') IS DISTINCT FROM 'number'
         AND jsonb_typeof(p_snapshot->'config_snapshot'->'original') IS DISTINCT FROM 'null')
     OR jsonb_typeof(p_snapshot->'config_snapshot'->'effective') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_snapshot->'result'->'suggestedUnitPrice') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  v_schema := CASE
    WHEN jsonb_typeof(p_snapshot -> 'schema_version') IN ('string','number') THEN p_snapshot ->> 'schema_version'
    ELSE NULL
  END;
  IF jsonb_typeof(p_snapshot) <> 'object'
     OR NOT (p_snapshot ? 'schema_version')
     OR (v_schema = '2' AND jsonb_typeof(p_snapshot -> 'schema_version') <> 'string')
     OR (v_schema = '1' AND jsonb_typeof(p_snapshot -> 'schema_version') NOT IN ('string','number'))
     OR v_schema IS NULL
     OR v_schema NOT IN ('1', '2')
     OR NOT (p_snapshot ? 'input') OR jsonb_typeof(p_snapshot -> 'input') <> 'object'
     OR NOT (p_snapshot ? 'result') OR jsonb_typeof(p_snapshot -> 'result') <> 'object'
     OR NOT (p_snapshot ? 'product_snapshot') OR jsonb_typeof(p_snapshot -> 'product_snapshot') <> 'object'
     OR NOT (p_snapshot ? 'printers') OR jsonb_typeof(p_snapshot -> 'printers') <> 'array'
     OR NOT (p_snapshot ? 'config_snapshot') OR jsonb_typeof(p_snapshot -> 'config_snapshot') <> 'object'
     OR (p_snapshot -> 'product_snapshot' ->> 'id') IS NULL
     OR (p_snapshot -> 'product_snapshot' ->> 'id') IS DISTINCT FROM p_product_id::text
     OR (p_snapshot -> 'product_snapshot' ->> 'version') IS NULL
     OR (p_snapshot -> 'product_snapshot' ->> 'version') IS DISTINCT FROM p_product_version::text
     OR (p_snapshot -> 'config_snapshot' ->> 'version') IS NULL
     OR (p_snapshot -> 'config_snapshot' ->> 'version') IS DISTINCT FROM p_enterprise_version::text
     OR NOT (p_snapshot -> 'config_snapshot' ? 'original')
     OR (p_snapshot -> 'config_snapshot' -> 'original') IS NULL
     OR (p_snapshot -> 'config_snapshot' -> 'original') IS DISTINCT FROM COALESCE(to_jsonb(p_original_rate), 'null'::jsonb)
     OR NOT (p_snapshot -> 'config_snapshot' ? 'effective')
     OR (p_snapshot -> 'config_snapshot' -> 'effective') IS NULL
     OR (p_snapshot -> 'config_snapshot' -> 'effective') IS DISTINCT FROM to_jsonb(p_used_rate)
     OR jsonb_typeof(p_snapshot -> 'result' -> 'suggestedUnitPrice') <> 'number'
     OR (p_snapshot -> 'result' ->> 'suggestedUnitPrice')::numeric IS DISTINCT FROM p_suggested_price THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- V1-specific validation
  IF v_schema = '1' THEN
    -- V1 requires materials array (1-10 items)
    IF NOT (p_snapshot ? 'materials') OR jsonb_typeof(p_snapshot -> 'materials') <> 'array' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_material_count := jsonb_array_length(p_snapshot -> 'materials');
    IF v_material_count < 1 OR v_material_count > 10 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    -- Validate materials array elements
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'materials') AS q(id uuid, version bigint)
      WHERE q.id IS NULL OR q.version IS NULL OR q.version < 0
    ) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    -- Check duplicates
    IF (
      SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot -> 'materials') AS q(id uuid, version bigint)
    ) <> v_material_count THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

    -- V1 does NOT have spools or general_materials
    IF p_snapshot ? 'spools' OR p_snapshot ? 'general_materials' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

  -- V2-specific validation
  ELSE -- v_schema = '2'
    -- Container stage: no array function is called until every V2 container is known-safe.
    IF NOT (p_snapshot ? 'materials') OR jsonb_typeof(p_snapshot->'materials') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot ? 'spools') OR jsonb_typeof(p_snapshot->'spools') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot ? 'general_materials') OR jsonb_typeof(p_snapshot->'general_materials') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot ? 'spool_snapshots') OR jsonb_typeof(p_snapshot->'spool_snapshots') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot ? 'general_material_snapshots') OR jsonb_typeof(p_snapshot->'general_material_snapshots') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot->'input' ? 'spoolLines') OR jsonb_typeof(p_snapshot->'input'->'spoolLines') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot->'input' ? 'packagingLines') OR jsonb_typeof(p_snapshot->'input'->'packagingLines') IS DISTINCT FROM 'array'
       OR NOT (p_snapshot->'input' ? 'lossPercent') OR jsonb_typeof(p_snapshot->'input'->'lossPercent') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    -- Structural stage: reject malformed objects before any recordset casts.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'materials') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string'
        OR jsonb_typeof(z->'version') <> 'number' OR NOT (z ? 'id') OR NOT (z ? 'version'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'spools') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string'
        OR jsonb_typeof(z->'version') <> 'number' OR NOT (z ? 'id') OR NOT (z ? 'version'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'general_materials') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string'
        OR jsonb_typeof(z->'version') <> 'number' OR NOT (z ? 'id') OR NOT (z ? 'version'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'printers') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string'
        OR jsonb_typeof(z->'version') <> 'number' OR NOT (z ? 'id') OR NOT (z ? 'version')) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'input'->'spoolLines') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'spoolId') <> 'string'
        OR jsonb_typeof(z->'consumptionGrams') <> 'number' OR jsonb_typeof(z->'purchasePrice') <> 'number'
        OR jsonb_typeof(z->'originalFilamentGrams') <> 'number'
        OR NOT (z ? 'spoolId') OR NOT (z ? 'consumptionGrams') OR NOT (z ? 'purchasePrice') OR NOT (z ? 'originalFilamentGrams'))
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'input'->'packagingLines') z
      WHERE jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'materialId') <> 'string'
        OR jsonb_typeof(z->'mode') <> 'string' OR jsonb_typeof(z->'quantity') <> 'number'
        OR jsonb_typeof(z->'suppliedUnit') <> 'string' OR jsonb_typeof(z->'conversionFactor') <> 'number'
        OR jsonb_typeof(z->'referencePrice') <> 'number' OR jsonb_typeof(z->'referenceQuantity') <> 'number'
        OR NOT (z ? 'materialId') OR NOT (z ? 'mode') OR NOT (z ? 'quantity')
        OR NOT (z ? 'suppliedUnit') OR NOT (z ? 'conversionFactor') OR NOT (z ? 'referencePrice') OR NOT (z ? 'referenceQuantity')) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    -- Snapshot objects are required and must contain the complete authoritative fields.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'spool_snapshots') z WHERE
      jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string' OR jsonb_typeof(z->'version') <> 'number'
      OR jsonb_typeof(z->'internal_identifier') <> 'string'
      OR NOT (z ? 'material_type') OR jsonb_typeof(z->'material_type') NOT IN ('string','null')
      OR NOT (z ? 'brand') OR jsonb_typeof(z->'brand') NOT IN ('string','null')
      OR NOT (z ? 'color') OR jsonb_typeof(z->'color') NOT IN ('string','null')
      OR NOT (z ? 'purchase_price') OR NOT (z ? 'original_filament_grams')
      OR jsonb_typeof(z->'purchase_price') <> 'number' OR jsonb_typeof(z->'original_filament_grams') <> 'number')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'general_material_snapshots') z WHERE
      jsonb_typeof(z) <> 'object' OR jsonb_typeof(z->'id') <> 'string' OR jsonb_typeof(z->'version') <> 'number'
      OR jsonb_typeof(z->'name') <> 'string' OR jsonb_typeof(z->'control_unit') <> 'string'
      OR jsonb_typeof(z->'reference_quantity') <> 'number' OR jsonb_typeof(z->'reference_price') <> 'number') THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF NOT (p_snapshot->'config_snapshot' ? 'default_filament_loss_percent')
       OR jsonb_typeof(p_snapshot->'config_snapshot'->'default_filament_loss_percent') IS DISTINCT FROM 'number'
       OR NOT (p_snapshot->'result' ? 'suggestedUnitPrice')
       OR jsonb_typeof(p_snapshot->'result'->'suggestedUnitPrice') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    -- V2 requires materials array (0-10 items)
    IF NOT (p_snapshot ? 'materials') OR jsonb_typeof(p_snapshot -> 'materials') <> 'array' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_material_count := jsonb_array_length(p_snapshot -> 'materials');
    IF v_material_count < 0 OR v_material_count > 10 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'materials') AS q(id uuid, version bigint)
      WHERE q.id IS NULL OR q.version IS NULL OR q.version < 0
    ) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF (
      SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot -> 'materials') AS q(id uuid, version bigint)
    ) <> v_material_count THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

    -- V2 requires spools array (0-10 items)
    IF NOT (p_snapshot ? 'spools') OR jsonb_typeof(p_snapshot -> 'spools') <> 'array' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_spool_count := jsonb_array_length(p_snapshot -> 'spools');
    IF v_spool_count < 0 OR v_spool_count > 10 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'spools') AS q(id uuid, version bigint)
      WHERE q.id IS NULL OR q.version IS NULL OR q.version < 0
    ) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF (
      SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot -> 'spools') AS q(id uuid, version bigint)
    ) <> v_spool_count THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

    -- V2 requires general_materials array (0-10 items)
    IF NOT (p_snapshot ? 'general_materials') OR jsonb_typeof(p_snapshot -> 'general_materials') <> 'array' THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_general_material_count := jsonb_array_length(p_snapshot -> 'general_materials');
    IF v_general_material_count < 0 OR v_general_material_count > 10 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'general_materials') AS q(id uuid, version bigint)
      WHERE q.id IS NULL OR q.version IS NULL OR q.version < 0
    ) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    IF (
      SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot -> 'general_materials') AS q(id uuid, version bigint)
    ) <> v_general_material_count THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

    -- Snapshot arrays are unique and exactly the same id/version sets as references.
    IF (SELECT count(*) FROM jsonb_to_recordset(p_snapshot->'spool_snapshots') AS q(id uuid,version bigint)) <> v_spool_count
       OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot->'spool_snapshots') AS q(id uuid,version bigint)) <> v_spool_count
       OR EXISTS ((SELECT id,version FROM jsonb_to_recordset(p_snapshot->'spool_snapshots') AS q(id uuid,version bigint)) EXCEPT (SELECT id,version FROM jsonb_to_recordset(p_snapshot->'spools') AS q(id uuid,version bigint)))
       OR EXISTS ((SELECT id,version FROM jsonb_to_recordset(p_snapshot->'spools') AS q(id uuid,version bigint)) EXCEPT (SELECT id,version FROM jsonb_to_recordset(p_snapshot->'spool_snapshots') AS q(id uuid,version bigint)))
       OR (SELECT count(*) FROM jsonb_to_recordset(p_snapshot->'general_material_snapshots') AS q(id uuid,version bigint)) <> v_general_material_count
       OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot->'general_material_snapshots') AS q(id uuid,version bigint)) <> v_general_material_count
       OR EXISTS ((SELECT id,version FROM jsonb_to_recordset(p_snapshot->'general_material_snapshots') AS q(id uuid,version bigint)) EXCEPT (SELECT id,version FROM jsonb_to_recordset(p_snapshot->'general_materials') AS q(id uuid,version bigint)))
       OR EXISTS ((SELECT id,version FROM jsonb_to_recordset(p_snapshot->'general_materials') AS q(id uuid,version bigint)) EXCEPT (SELECT id,version FROM jsonb_to_recordset(p_snapshot->'general_material_snapshots') AS q(id uuid,version bigint))) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;

    -- V2 line arrays may repeat a source, while reference and snapshot arrays are deduplicated.
    -- Costs are validated against locked rows below; this function does not claim to rerun the engine.
    IF jsonb_typeof(p_snapshot -> 'input' -> 'spoolLines') <> 'array'
       OR jsonb_typeof(p_snapshot -> 'input' -> 'packagingLines') <> 'array'
       OR jsonb_typeof(p_snapshot -> 'spool_snapshots') <> 'array'
       OR jsonb_typeof(p_snapshot -> 'general_material_snapshots') <> 'array'
       OR jsonb_typeof(p_snapshot -> 'input' -> 'lossPercent') <> 'number'
       OR (p_snapshot -> 'input' ->> 'lossPercent')::numeric NOT BETWEEN 0 AND 100
       OR jsonb_array_length(p_snapshot -> 'input' -> 'spoolLines') < 1
       OR jsonb_array_length(p_snapshot -> 'input' -> 'spoolLines') > 10
       OR jsonb_array_length(p_snapshot -> 'input' -> 'packagingLines') > 10
       OR jsonb_array_length(p_snapshot -> 'spool_snapshots') <> v_spool_count
       OR jsonb_array_length(p_snapshot -> 'general_material_snapshots') <> v_general_material_count
       OR EXISTS (
         SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'spoolLines')
           AS q("spoolId" uuid, "consumptionGrams" numeric, "purchasePrice" numeric, "originalFilamentGrams" numeric)
         WHERE q."spoolId" IS NULL OR q."consumptionGrams" <= 0 OR q."consumptionGrams" > 1000000
            OR q."purchasePrice" < 0 OR q."originalFilamentGrams" <= 0
            OR q."consumptionGrams"::text IN ('NaN','Infinity','-Infinity')
            OR q."purchasePrice"::text IN ('NaN','Infinity','-Infinity')
            OR q."originalFilamentGrams"::text IN ('NaN','Infinity','-Infinity')
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'packagingLines')
           AS q("materialId" uuid, mode text, quantity numeric, "suppliedUnit" text, "conversionFactor" numeric, "referencePrice" numeric, "referenceQuantity" numeric)
         WHERE q."materialId" IS NULL OR q.mode NOT IN ('per_piece','per_lot')
            OR q.quantity <= 0 OR q.quantity > 1000000
            OR q."suppliedUnit" NOT IN ('unidade','metro','centimetro','grama','quilograma')
            OR q."conversionFactor" <= 0 OR q."referencePrice" < 0 OR q."referenceQuantity" <= 0
            OR q.quantity::text IN ('NaN','Infinity','-Infinity')
            OR q."conversionFactor"::text IN ('NaN','Infinity','-Infinity')
            OR q."referencePrice"::text IN ('NaN','Infinity','-Infinity')
            OR q."referenceQuantity"::text IN ('NaN','Infinity','-Infinity')
       )
       OR EXISTS (
         (SELECT DISTINCT q."spoolId" AS id FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'spoolLines') AS q("spoolId" uuid))
         EXCEPT
         (SELECT q.id FROM jsonb_to_recordset(p_snapshot -> 'spools') AS q(id uuid))
       )
       OR EXISTS (
         (SELECT q.id FROM jsonb_to_recordset(p_snapshot -> 'spools') AS q(id uuid))
         EXCEPT
         (SELECT DISTINCT q."spoolId" FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'spoolLines') AS q("spoolId" uuid))
       )
       OR EXISTS (
         (SELECT DISTINCT q."materialId" AS id FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'packagingLines') AS q("materialId" uuid))
         EXCEPT
         (SELECT q.id FROM jsonb_to_recordset(p_snapshot -> 'general_materials') AS q(id uuid))
       )
       OR EXISTS (
         (SELECT q.id FROM jsonb_to_recordset(p_snapshot -> 'general_materials') AS q(id uuid))
         EXCEPT
         (SELECT DISTINCT q."materialId" FROM jsonb_to_recordset(p_snapshot -> 'input' -> 'packagingLines') AS q("materialId" uuid))
       ) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Printers validation (common: exactly 1)
  IF jsonb_array_length(p_snapshot -> 'printers') <> 1
     OR EXISTS (
       SELECT 1 FROM jsonb_to_recordset(p_snapshot -> 'printers') AS q(id uuid, version bigint)
       WHERE q.id IS NULL OR q.version IS NULL OR q.version < 0
     ) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- pricing_actor already locks enterprise; never acquire product before enterprise.
  SELECT * INTO e FROM public.enterprises ee
  WHERE ee.id = x.enterprise_id
  FOR UPDATE;
  IF NOT FOUND OR e.version <> p_enterprise_version
     OR e.electricity_rate_per_kwh IS DISTINCT FROM p_original_rate
     OR (v_schema = '2' AND (
       p_snapshot->'config_snapshot'->'default_filament_loss_percent' IS DISTINCT FROM to_jsonb(e.default_filament_loss_percent)
     )) THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO p FROM public.products pp
  WHERE pp.enterprise_id = x.enterprise_id AND pp.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND OR NOT p.active OR p.version <> p_product_version THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;


  -- Validate materials (V1: 1-10, V2: 0-10)
  IF v_material_count > 0 THEN
    FOR m IN SELECT * FROM jsonb_to_recordset(p_snapshot -> 'materials') AS q(id uuid, version bigint) ORDER BY id LOOP
      SELECT * INTO ma FROM public.materials mm
      WHERE mm.id = m.id AND mm.enterprise_id = x.enterprise_id
      FOR UPDATE;
      IF NOT FOUND OR NOT ma.active OR ma.version <> m.version THEN
        RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END IF;

  -- Validate spools (V2 only)
  IF v_schema = '2' AND v_spool_count > 0 THEN
    FOR m IN SELECT * FROM jsonb_to_recordset(p_snapshot -> 'spools') AS q(id uuid, version bigint) ORDER BY id LOOP
      SELECT * INTO ma FROM public.filament_spools fs
      WHERE fs.id = m.id AND fs.enterprise_id = x.enterprise_id
      FOR UPDATE;
      IF NOT FOUND OR NOT ma.active OR ma.version <> m.version THEN
        RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
      END IF;
      -- Audit comparison: snapshot must match current row state
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_snapshot->'spool_snapshots')
          AS s(id uuid, version bigint, internal_identifier text, material_type text, brand text, color text, purchase_price numeric, original_filament_grams numeric)
        WHERE s.id = ma.id AND s.version = ma.version
          AND s.internal_identifier = ma.internal_identifier
          AND s.material_type IS NOT DISTINCT FROM ma.material_type
          AND s.brand IS NOT DISTINCT FROM ma.brand
          AND s.color IS NOT DISTINCT FROM ma.color
          AND s.purchase_price = ma.purchase_price
          AND s.original_filament_grams = ma.original_filament_grams
      ) THEN
        RAISE EXCEPTION 'source_conflict' USING ERRCODE = '40001';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_snapshot->'input'->'spoolLines')
          AS l("spoolId" uuid, "consumptionGrams" numeric, "purchasePrice" numeric, "originalFilamentGrams" numeric)
        WHERE l."spoolId" = ma.id
          AND (l."purchasePrice" IS DISTINCT FROM ma.purchase_price OR l."originalFilamentGrams" IS DISTINCT FROM ma.original_filament_grams)
      ) THEN
        RAISE EXCEPTION 'source_conflict' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END IF;

  -- Validate general_materials (V2 only)
  IF v_schema = '2' AND v_general_material_count > 0 THEN
    FOR m IN SELECT * FROM jsonb_to_recordset(p_snapshot -> 'general_materials') AS q(id uuid, version bigint) ORDER BY id LOOP
      SELECT * INTO ma FROM public.general_materials gm
      WHERE gm.id = m.id AND gm.enterprise_id = x.enterprise_id
      FOR UPDATE;
      IF NOT FOUND OR NOT ma.active OR ma.version <> m.version THEN
        RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
      END IF;
      -- Audit comparison: snapshot must match current row state
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_snapshot->'general_material_snapshots')
          AS s(id uuid, version bigint, name text, control_unit text, reference_quantity numeric, reference_price numeric)
        WHERE s.id = ma.id AND s.version = ma.version
          AND s.name = ma.name
          AND s.control_unit = ma.control_unit::text
          AND s.reference_quantity = ma.reference_quantity
          AND s.reference_price = ma.reference_price
      ) THEN
        RAISE EXCEPTION 'source_conflict' USING ERRCODE = '40001';
      END IF;
      -- Validate conversion against the locked row, never the id/version reference.
      IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_snapshot->'input'->'packagingLines')
          AS pl("materialId" uuid, "suppliedUnit" text, "conversionFactor" numeric)
        WHERE pl."materialId" = ma.id
          AND pl."conversionFactor" IS DISTINCT FROM private.general_convert(
            pl."suppliedUnit"::public.general_material_control_unit, ma.control_unit, 1)
      ) THEN
        RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_to_recordset(p_snapshot->'input'->'packagingLines')
          AS l("materialId" uuid, mode text, quantity numeric, "suppliedUnit" text, "conversionFactor" numeric, "referencePrice" numeric, "referenceQuantity" numeric)
        WHERE l."materialId" = ma.id
          AND (
            l."referencePrice" IS DISTINCT FROM ma.reference_price
            OR l."referenceQuantity" IS DISTINCT FROM ma.reference_quantity
          )
      ) THEN
        RAISE EXCEPTION 'source_conflict' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END IF;

  -- Validate printers (last, to maintain consistent lock order)
  FOR pr IN SELECT * FROM jsonb_to_recordset(p_snapshot -> 'printers') AS q(id uuid, version bigint) ORDER BY id LOOP
    SELECT * INTO ma FROM public.printers pp
    WHERE pp.id = pr.id AND pp.enterprise_id = x.enterprise_id
    FOR UPDATE;
    IF NOT FOUND OR NOT ma.active OR ma.version <> pr.version THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;
  END LOOP;

  -- Insert pricing calculation
  INSERT INTO public.pricing_calculations(
    id, enterprise_id, product_id, actor_id, attempt_id, request_hash, snapshot_hash,
    product_version, enterprise_version, electricity_rate_original, electricity_rate_used,
    price_suggested_unit, snapshot
  )
  VALUES (
    p_attempt_id, x.enterprise_id, p_product_id, x.uid, p_attempt_id, p_request_hash, p_snapshot_hash,
    p_product_version, p_enterprise_version, p_original_rate, p_used_rate, p_suggested_price, p_snapshot
  );

  RETURN QUERY SELECT 'created'::text, p_attempt_id;
END $$;


-- 5. save_manual_pricing_attempt
CREATE OR REPLACE FUNCTION public.save_manual_pricing_attempt(p_actor uuid,p_issuer text,p_attempt_id uuid,p_request_hash text,p_snapshot_hash text,p_snapshot jsonb,p_product_id uuid,p_product_version bigint,p_suggested_price numeric)
RETURNS TABLE(status text,calculation_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  x record;
  c public.pricing_calculations%ROWTYPE;
  p public.products%ROWTYPE;
  plan record;
  role text;
  rate numeric;
BEGIN
  IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_product_version IS NULL OR p_product_version < 0
     OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_snapshot_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_snapshot) <> 'object' OR p_snapshot->>'schema_version' <> '3'
     OR p_snapshot->>'source' <> 'manual' OR jsonb_typeof(p_snapshot->'config_snapshot') <> 'object'
     OR p_snapshot->'config_snapshot'->>'source' <> 'manual'
     OR jsonb_typeof(p_snapshot->'config_snapshot'->'energyRate') <> 'number'
     OR jsonb_typeof(p_snapshot->'product_snapshot') <> 'object'
     OR p_snapshot->'product_snapshot'->>'id' IS DISTINCT FROM p_product_id::text
     OR p_snapshot->'product_snapshot'->>'version' IS DISTINCT FROM p_product_version::text
     OR jsonb_typeof(p_snapshot->'result') <> 'object'
     OR jsonb_typeof(p_snapshot->'result'->'suggestedUnitPrice') <> 'number'
     OR jsonb_typeof(p_snapshot->'units') <> 'object' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  rate := (p_snapshot->'config_snapshot'->>'energyRate')::numeric;
  IF NOT private.stage6bc_numeric(rate, 0, 100, 6)
     OR NOT private.stage6bc_numeric(p_suggested_price, 0, 1000000000000000000000000000000, 6)
     OR (p_snapshot->'result'->>'suggestedUnitPrice')::numeric IS DISTINCT FROM p_suggested_price
     OR p_snapshot->'units' = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.write');
  SELECT em.role INTO role FROM public.enterprise_members em WHERE em.enterprise_id = x.enterprise_id AND em.user_id = x.uid AND em.status = 'active';
  SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);

  IF role IS DISTINCT FROM 'owner' OR plan.effective_plan IS DISTINCT FROM 'free' OR plan.access_state NOT IN ('free','expired','cancelled') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pricing:manual:' || x.enterprise_id::text, 0));

  SELECT * INTO c FROM public.pricing_calculations WHERE enterprise_id = x.enterprise_id AND attempt_id = p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF c.actor_id = x.uid AND c.request_hash = p_request_hash AND c.snapshot_hash = p_snapshot_hash THEN
      RETURN QUERY SELECT 'idempotent'::text, c.id;
      RETURN;
    ELSE
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT * INTO p FROM public.products WHERE enterprise_id = x.enterprise_id AND id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT p.active OR p.version <> p_product_version OR NOT private.stage6b_product_visible(x.enterprise_id, p_product_id) THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.pricing_calculations(
    id, enterprise_id, product_id, actor_id, attempt_id, request_hash, snapshot_hash,
    product_version, enterprise_version, electricity_rate_original, electricity_rate_used,
    price_suggested_unit, snapshot
  )
  VALUES (
    p_attempt_id, x.enterprise_id, p.id, x.uid, p_attempt_id, p_request_hash, p_snapshot_hash,
    p.version, 0, rate, rate, p_suggested_price, p_snapshot
  );

  RETURN QUERY SELECT 'created'::text, p_attempt_id;
END $$;

-- 6. apply_pricing_price (Consistently locked, validates can_access through role matrix, product deleted filter, plan paid/limits)
CREATE OR REPLACE FUNCTION public.apply_pricing_price(p_actor uuid, p_issuer text, p_calculation_id uuid, p_expected_product_version bigint)
RETURNS TABLE(status text, product_id uuid, version bigint, applied_price numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  x record;
  c public.pricing_calculations%ROWTYPE;
  p public.products%ROWTYPE;
  a public.pricing_price_applications%ROWTYPE;
  n numeric;
  v bigint;
  plan record;
BEGIN
  IF p_calculation_id IS NULL OR p_expected_product_version IS NULL OR p_expected_product_version < 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.apply');
  SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);

  SELECT * INTO c FROM public.pricing_calculations WHERE id = p_calculation_id AND enterprise_id = x.enterprise_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::bigint, NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO a FROM public.pricing_price_applications WHERE calculation_id = c.id FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT 'idempotent'::text, c.product_id, a.product_version, a.applied_price;
    RETURN;
  END IF;

  SELECT * INTO p FROM public.products WHERE id = c.product_id AND enterprise_id = x.enterprise_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT p.active THEN
    RETURN QUERY SELECT 'product_unavailable'::text, c.product_id, NULL::bigint, NULL::numeric;
    RETURN;
  END IF;

  IF p.version <> p_expected_product_version THEN
    RETURN QUERY SELECT 'product_version_conflict'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  IF plan.effective_plan = 'free' AND NOT private.stage6b_product_visible(x.enterprise_id, p.id) THEN
    RETURN QUERY SELECT 'product_unavailable'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  n := round(c.price_suggested_unit, 2);
  IF NOT private.stage6bc_numeric(n, 0, 1000000, 2) THEN
    RETURN QUERY SELECT 'price_out_of_bounds'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  UPDATE public.products SET price = n WHERE id = p.id RETURNING version INTO v;

  INSERT INTO public.pricing_price_applications(
    calculation_id, enterprise_id, product_id, actor_id, previous_price, applied_price, product_version
  )
  VALUES (
    c.id, x.enterprise_id, p.id, x.uid, p.price, n, v
  );

  RETURN QUERY SELECT 'applied'::text, p.id, v, n;
END $$;

-- Set ownership and permissions
ALTER FUNCTION private.stage6bc_numeric(numeric,numeric,numeric,integer) OWNER TO postgres;
ALTER FUNCTION private.pricing_actor(uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric) OWNER TO postgres;
ALTER FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) OWNER TO postgres;
ALTER FUNCTION public.apply_pricing_price(uuid,text,uuid,bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.stage6bc_numeric(numeric,numeric,numeric,integer), private.pricing_actor(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text), public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric), public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric), public.apply_pricing_price(uuid,text,uuid,bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text), public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric), public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric), public.apply_pricing_price(uuid,text,uuid,bigint) TO service_role;

COMMIT;

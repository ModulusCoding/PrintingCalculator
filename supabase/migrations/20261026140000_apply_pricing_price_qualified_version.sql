-- Fix only the ambiguous RETURNING version (also a RETURNS TABLE output).
-- Based on 20261026110000; preserve authorization, receipts and all ACLs.
BEGIN;

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
  actor_role text;
  manual_v3 boolean;
  free_manual_allowed boolean;
BEGIN
  IF p_calculation_id IS NULL OR p_expected_product_version IS NULL OR p_expected_product_version < 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Authenticate and lock the same identity/membership/enterprise before looking
  -- up the tenant-scoped calculation. Read is not itself permission to apply.
  SELECT * INTO x FROM private.pricing_actor(p_actor, p_issuer, 'pricing.read');
  SELECT * INTO c FROM public.pricing_calculations WHERE id = p_calculation_id AND enterprise_id = x.enterprise_id;
  IF NOT FOUND THEN
    -- Preserve the legacy authorization requirement even for missing IDs.
    PERFORM * FROM private.pricing_actor(p_actor, p_issuer, 'pricing.apply');
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::bigint, NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);
  SELECT em.role INTO actor_role FROM public.enterprise_members em
    WHERE em.enterprise_id = x.enterprise_id AND em.user_id = x.uid AND em.status = 'active';
  manual_v3 := coalesce(c.snapshot->>'schema_version' = '3' AND c.snapshot->>'source' = 'manual', false);
  free_manual_allowed := manual_v3
    AND actor_role IS NOT DISTINCT FROM 'owner'
    AND plan.effective_plan IS NOT DISTINCT FROM 'free'
    AND plan.selection_required IS NOT DISTINCT FROM false
    AND plan.access_state IN ('free', 'expired', 'cancelled')
    AND private.can_access_enterprise(x.enterprise_id, 'products.write');

  IF free_manual_allowed IS DISTINCT FROM true THEN
    -- V1/V2, paid V3 and every other path retain the original apply gate.
    PERFORM * FROM private.pricing_actor(p_actor, p_issuer, 'pricing.apply');
  END IF;

  -- Authorized receipt recovery precedes current product version, activity and
  -- window checks. It never writes again, even after edits or a plan change.
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

  -- V3 must not expose a version for a product outside the current Free window;
  -- product_unavailable is parsed with a null version by the application.
  IF manual_v3 AND plan.effective_plan = 'free' AND NOT private.stage6b_product_visible(x.enterprise_id, p.id) THEN
    RETURN QUERY SELECT 'product_unavailable'::text, p.id, NULL::bigint, NULL::numeric;
    RETURN;
  END IF;

  IF p.version <> p_expected_product_version THEN
    RETURN QUERY SELECT 'product_version_conflict'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  -- Keep legacy ordering and response unchanged for older snapshots.
  IF plan.effective_plan = 'free' AND NOT private.stage6b_product_visible(x.enterprise_id, p.id) THEN
    RETURN QUERY SELECT 'product_unavailable'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  -- Apply the persisted suggestion, never recalculate from current inputs.
  n := round(c.price_suggested_unit, 2);
  IF NOT private.stage6bc_numeric(n, 0, 1000000, 2) THEN
    RETURN QUERY SELECT 'price_out_of_bounds'::text, p.id, p.version, NULL::numeric;
    RETURN;
  END IF;

  UPDATE public.products AS pr
  SET price = n
  WHERE pr.id = p.id
  RETURNING pr.version INTO v;
  INSERT INTO public.pricing_price_applications(
    calculation_id, enterprise_id, product_id, actor_id, previous_price, applied_price, product_version
  ) VALUES (
    c.id, x.enterprise_id, p.id, x.uid, p.price, n, v
  );
  RETURN QUERY SELECT 'applied'::text, p.id, v, n;
END $$;

ALTER FUNCTION public.apply_pricing_price(uuid,text,uuid,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_pricing_price(uuid,text,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_price(uuid,text,uuid,bigint) TO service_role;

COMMIT;

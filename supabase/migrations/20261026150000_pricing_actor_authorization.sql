-- Share the current enterprise authorization matrix without substituting JWT claims.
-- The explicit user ID is internal and must already have been authenticated by
-- the caller. Only postgres-owned definers can invoke this private evaluator.
-- Service-only pricing RPCs validate and lock actor/issuer through pricing_actor
-- before passing u.id (or its returned x.uid); authenticated callers retain the
-- JWT-resolving can_access_enterprise wrapper and cannot choose an internal ID.
BEGIN;

-- Exact 260600 matrix and plan predicate; only identity resolution is parameterized.
CREATE FUNCTION private.can_access_enterprise_for_user(p_user_id uuid,p_enterprise_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT p_enterprise_id IS NOT NULL AND p_permission IS NOT NULL
 AND (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id WHERE em.user_id=p_user_id AND em.status='active' AND e.status='active')
 AND EXISTS(SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id JOIN public.enterprises e ON e.id=em.enterprise_id WHERE em.enterprise_id=p_enterprise_id AND em.user_id=p_user_id AND em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active' AND CASE p_permission
 WHEN 'products.read' THEN em.role IN('owner','admin','operator') WHEN 'products.write' THEN em.role IN('owner','admin','operator') WHEN 'products.delete' THEN em.role IN('owner','admin')
 WHEN 'catalogs.read' THEN em.role IN('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN('owner','admin') WHEN 'filters.read' THEN em.role IN('owner','admin','operator') WHEN 'filters.write' THEN em.role IN('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN('owner','admin')
 WHEN 'sales.read' THEN em.role IN('owner','admin','operator') WHEN 'sales.write' THEN em.role IN('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN('owner','admin') WHEN 'printers.read' THEN em.role IN('owner','admin','operator') WHEN 'printers.write' THEN em.role IN('owner','admin') WHEN 'printers.archive' THEN em.role IN('owner','admin')
 WHEN 'materials.read' THEN em.role IN('owner','admin','operator') WHEN 'materials.write' THEN em.role IN('owner','admin') WHEN 'materials.archive' THEN em.role IN('owner','admin') WHEN 'pricing.read' THEN em.role IN('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN('owner','admin','operator')
 WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'enterprise.pricing_loss.write' THEN em.role IN('owner','admin') WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN('owner','admin')
 WHEN 'spools.read' THEN em.role IN('owner','admin','operator') WHEN 'spools.write' THEN em.role IN('owner','admin','operator') WHEN 'spools.archive' THEN em.role IN('owner','admin') WHEN 'spools.delete' THEN em.role IN('owner','admin')
 WHEN 'inventory.read' THEN em.role IN('owner','admin','operator') WHEN 'inventory.write' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.read' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.write' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.archive' THEN em.role IN('owner','admin') WHEN 'stock.materials.delete' THEN em.role IN('owner','admin') ELSE false END AND private.plan_permission_allowed(p_enterprise_id,em.role,p_permission));
$$;
ALTER FUNCTION private.can_access_enterprise_for_user(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_enterprise_for_user(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT private.can_access_enterprise_for_user(private.current_internal_user_id(),p_enterprise_id,p_permission);
$$;
ALTER FUNCTION private.can_access_enterprise(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_enterprise(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(uuid,text) TO authenticated;

-- Full 260200 definition: only the final authorization helper call changes.
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
  IF NOT FOUND OR NOT private.can_access_enterprise_for_user(u.id, e.id, p_permission) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  uid := u.id;
  enterprise_id := e.id;
  RETURN NEXT;
END $$;
ALTER FUNCTION private.pricing_actor(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.pricing_actor(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Full 261400 definition: only free_manual_allowed's authorization call changes.
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
    AND private.can_access_enterprise_for_user(x.uid, x.enterprise_id, 'products.write');

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

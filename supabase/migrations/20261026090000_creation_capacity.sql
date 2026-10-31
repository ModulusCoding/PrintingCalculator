-- Presentation-only capacity for authorized creators (not owner-only billing UI).
-- No tenant argument, row/advisory locks, mutations or creation authorization.
-- Creation RPCs remain authoritative and serialize/recheck their own quotas.
BEGIN;
CREATE FUNCTION public.get_my_creation_capacity(p_resource text)
RETURNS TABLE(used bigint, capacity_limit bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; r record; b record;
BEGIN
  IF p_resource IS NULL OR p_resource NOT IN ('products','shared_materials') THEN
    RAISE EXCEPTION 'invalid_resource' USING ERRCODE='22023';
  END IF;
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.get_my_plan_business_access();
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF b.status IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '%',b.status USING ERRCODE='42501';
  END IF;
  IF p_resource='shared_materials' AND
     (b.effective_plan IS DISTINCT FROM 'intermediate' OR b.access_state IS DISTINCT FROM 'paid') THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  -- Each permission includes the real membership role, identity and plan gate.
  -- Shared capacity is useful to creators in either module; this does not grant
  -- access to individual records from the other module or bypass page guards.
  IF p_resource='products' THEN
    IF NOT private.can_access_enterprise(c.enterprise_id,'products.write') THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT (private.can_access_enterprise(c.enterprise_id,'spools.write')
         OR private.can_access_enterprise(c.enterprise_id,'stock.materials.write')) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT * INTO r FROM private.resolve_enterprise_plan(c.enterprise_id);
  IF NOT FOUND OR r.selection_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  IF p_resource='products' THEN
    IF r.effective_plan='free' THEN
      capacity_limit := 3;
    ELSIF r.effective_plan='intermediate' AND r.access_state='paid' THEN
      capacity_limit := NULL;
    ELSE
      RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
    END IF;
    SELECT count(*) INTO used FROM public.products p
    WHERE p.enterprise_id=c.enterprise_id AND p.deleted_at IS NULL;
  ELSE
    IF r.effective_plan IS DISTINCT FROM 'intermediate' OR r.access_state IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
    END IF;
    capacity_limit := 15;
    SELECT (SELECT count(*) FROM public.filament_spools fs
            WHERE fs.enterprise_id=c.enterprise_id AND fs.deleted_at IS NULL)
         + (SELECT count(*) FROM public.general_materials gm
            WHERE gm.enterprise_id=c.enterprise_id AND gm.deleted_at IS NULL)
    INTO used;
  END IF;
  -- Archived rows count; soft-deleted rows and legacy public.materials do not.
  RETURN NEXT;
END $$;
ALTER FUNCTION public.get_my_creation_capacity(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_creation_capacity(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_creation_capacity(text) TO authenticated;
COMMIT;

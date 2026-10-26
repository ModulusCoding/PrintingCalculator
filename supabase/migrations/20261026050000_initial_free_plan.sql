-- Initial free selection only; never replaces a billing authorization.
BEGIN;

ALTER TABLE public.enterprise_plan_access_audit
  DROP CONSTRAINT enterprise_plan_access_audit_operation_check;
ALTER TABLE public.enterprise_plan_access_audit
  ADD CONSTRAINT enterprise_plan_access_audit_operation_check
  CHECK (operation IN ('selection_fixture','paid_confirmed','cancelled','free_selected'));

CREATE FUNCTION public.select_initial_free_plan()
RETURNS TABLE(status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  ctx record;
  v_issuer text;
  identity public.auth_identities%ROWTYPE;
  actor public.users%ROWTYPE;
  member public.enterprise_members%ROWTYPE;
  enterprise public.enterprises%ROWTYPE;
  access public.enterprise_plan_access%ROWTYPE;
BEGIN
  -- Same administrative order as membership and billing mutations. This lock also
  -- serializes the absent-row case, which a row lock alone cannot protect.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
  SELECT * INTO ctx FROM public.get_my_access_context();
  IF NOT FOUND OR ctx.state IS DISTINCT FROM 'business_ready' OR ctx.role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  v_issuer := auth.jwt()->>'iss';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::text, 0));
  SELECT ai.* INTO identity FROM public.auth_identities ai
  JOIN private.auth_issuer_config ac ON ac.issuer=ai.issuer AND ac.provider='supabase' AND ac.status='active'
  WHERE ai.provider='supabase' AND ai.issuer=v_issuer AND ai.subject=auth.uid()::text AND ai.status='active'
  FOR UPDATE OF ai;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  SELECT u.* INTO actor FROM public.users u WHERE u.id=identity.user_id FOR UPDATE;
  IF NOT FOUND OR actor.id IS DISTINCT FROM ctx.user_id OR actor.status<>'active' OR actor.must_change_password THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT em.* INTO member FROM public.enterprise_members em
  WHERE em.user_id=actor.id AND em.enterprise_id=ctx.enterprise_id AND em.status='active' FOR UPDATE;
  IF NOT FOUND OR member.role IS DISTINCT FROM 'owner' OR member.id IS DISTINCT FROM ctx.membership_id THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM public.enterprise_members em JOIN public.enterprises en ON en.id=em.enterprise_id
      WHERE em.user_id=actor.id AND em.status='active' AND en.status='active') <> 1 THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT en.* INTO enterprise FROM public.enterprises en WHERE en.id=member.enterprise_id AND en.status='active' FOR UPDATE;
  IF NOT FOUND OR NOT private.can_access_enterprise(enterprise.id,'enterprise.manage') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT pa.* INTO access FROM public.enterprise_plan_access pa WHERE pa.enterprise_id=enterprise.id FOR UPDATE;
  IF FOUND THEN
    IF access.selected_plan='free' AND access.effective_plan='free' AND access.access_state='free'
       AND access.authorization_id IS NULL AND access.paid_until IS NULL AND access.cancelled_at IS NULL THEN
      RETURN QUERY SELECT 'no_change'::text; RETURN;
    END IF;
    IF access.selected_plan IS NOT NULL OR access.effective_plan<>'free' OR access.access_state<>'selection_required'
       OR access.authorization_id IS NOT NULL OR access.paid_until IS NOT NULL OR access.cancelled_at IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict'::text; RETURN;
    END IF;
  END IF;
  -- Historical billing receipts/audit must never become an initial-selection path.
  IF EXISTS (SELECT 1 FROM private.enterprise_authorization_receipts r WHERE r.enterprise_id=enterprise.id)
     OR EXISTS (SELECT 1 FROM public.enterprise_plan_access_audit a WHERE a.enterprise_id=enterprise.id AND a.operation IN ('paid_confirmed','cancelled')) THEN
    RETURN QUERY SELECT 'conflict'::text; RETURN;
  END IF;
  INSERT INTO public.enterprise_plan_access AS pa
    (enterprise_id,selected_plan,effective_plan,access_state,authorization_version,changed_by,changed_at)
  VALUES (enterprise.id,'free','free','free',1,actor.id,clock_timestamp())
  ON CONFLICT (enterprise_id) DO UPDATE SET
    selected_plan='free', effective_plan='free', access_state='free',
    authorization_version=pa.authorization_version+1, changed_by=actor.id, changed_at=clock_timestamp()
  RETURNING pa.* INTO access;

  INSERT INTO public.enterprise_plan_access_audit
    (enterprise_id,operation,selected_plan,effective_plan,access_state,paid_until,cancelled_at,authorization_id,authorization_version,changed_by)
  VALUES (enterprise.id,'free_selected',access.selected_plan,access.effective_plan,access.access_state,
    access.paid_until,access.cancelled_at,access.authorization_id,access.authorization_version,actor.id);
  RETURN QUERY SELECT 'selected'::text;
END $$;
ALTER FUNCTION public.select_initial_free_plan() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.select_initial_free_plan() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.select_initial_free_plan() TO authenticated;

-- Aggregate-only owner endpoint: no paid operational attributes or lists exposed.
-- Counting predicates match private.lock_plan_quota; archived registrations count.
CREATE FUNCTION public.get_my_plan_usage()
RETURNS TABLE(products bigint,shared_materials bigint,operators bigint,printers bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx record;
BEGIN
  SELECT * INTO ctx FROM public.get_my_access_context();
  IF NOT FOUND OR ctx.state IS DISTINCT FROM 'business_ready' OR ctx.role IS DISTINCT FROM 'owner'
     OR NOT private.can_access_enterprise(ctx.enterprise_id,'enterprise.manage') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.products p WHERE p.enterprise_id=ctx.enterprise_id AND p.deleted_at IS NULL),
    (SELECT count(*) FROM public.filament_spools s WHERE s.enterprise_id=ctx.enterprise_id AND s.deleted_at IS NULL)
      + (SELECT count(*) FROM public.general_materials m WHERE m.enterprise_id=ctx.enterprise_id AND m.deleted_at IS NULL),
    (SELECT count(*) FROM public.enterprise_members m WHERE m.enterprise_id=ctx.enterprise_id AND m.status='active' AND m.role='operator'),
    (SELECT count(*) FROM public.printers p WHERE p.enterprise_id=ctx.enterprise_id);
END $$;
ALTER FUNCTION public.get_my_plan_usage() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_plan_usage() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_plan_usage() TO authenticated;

COMMIT;

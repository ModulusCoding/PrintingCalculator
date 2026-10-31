-- Local corrective proposal; review before applying. No historical SQL changed.
-- Restore the advertised rate-only contract: NULL explicitly removes the rate.
-- The 230000 two-argument wrapper forwarded NULL to the three-argument patch
-- overload, which rejects both NULL and uses COALESCE to retain existing values.
-- Specialize that overload's locking/identity/version protocol for rate only;
-- do not replace the three-argument overload or change loss/plan permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_my_enterprise_config(
  p_rate numeric,
  p_expected_version bigint
)
RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ctx record;
  v_enterprise public.enterprises%ROWTYPE;
  v_issuer text;
  v_identity public.auth_identities%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_member public.enterprise_members%ROWTYPE;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF p_rate IS NOT NULL THEN
    IF p_rate < 0 OR p_rate > 100 OR pg_catalog.scale(p_rate) > 6
       OR p_rate = 'NaN'::NUMERIC OR p_rate = 'Infinity'::NUMERIC OR p_rate = '-Infinity'::NUMERIC THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));

  SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
  IF NOT FOUND OR v_ctx.state IS DISTINCT FROM 'business_ready' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_issuer := auth.jwt() ->> 'iss';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::text, 0));

  SELECT ai.* INTO v_identity
  FROM public.auth_identities AS ai
  JOIN private.auth_issuer_config AS ac ON ac.issuer = ai.issuer AND ac.provider = 'supabase' AND ac.status = 'active'
  WHERE ai.provider = 'supabase' AND ai.issuer = v_issuer AND ai.subject = auth.uid()::text AND ai.status = 'active'
  FOR UPDATE OF ai;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  SELECT u.* INTO v_actor FROM public.users AS u WHERE u.id = v_identity.user_id FOR UPDATE;
  IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.must_change_password THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT em.* INTO v_member
  FROM public.enterprise_members AS em
  WHERE em.user_id = v_actor.id AND em.enterprise_id = v_ctx.enterprise_id AND em.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  IF (
    SELECT count(*)
    FROM public.enterprise_members AS z
    JOIN public.enterprises AS ze ON ze.id = z.enterprise_id
    WHERE z.user_id = v_actor.id AND z.status = 'active' AND ze.status = 'active'
  ) <> 1 THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_enterprise
  FROM public.enterprises AS e
  WHERE e.id = v_member.enterprise_id AND e.status = 'active'
  FOR UPDATE;
  IF NOT FOUND
   OR private.can_access_enterprise(
       v_enterprise.id,
       'enterprise.manage'
   ) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_enterprise.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict'::text, v_enterprise.version;
    RETURN;
  END IF;

  -- NULL equals NULL for idempotence; preserve the original rate-only success
  -- status so existing callers do not misclassify an unchanged rate as unknown.
  IF v_enterprise.electricity_rate_per_kwh IS NOT DISTINCT FROM p_rate THEN
    RETURN QUERY SELECT 'updated'::text, v_enterprise.version;
    RETURN;
  END IF;

  -- Assign NULL directly; never touch default_filament_loss_percent.
  -- The existing enterprise version trigger owns version increments.
  UPDATE public.enterprises
  SET electricity_rate_per_kwh = p_rate
  WHERE id = v_enterprise.id;

  RETURN QUERY
  SELECT 'updated'::text, e.version
  FROM public.enterprises e
  WHERE e.id = v_enterprise.id;
END $$;

ALTER FUNCTION public.update_my_enterprise_config(numeric, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_my_enterprise_config(numeric, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_enterprise_config(numeric, bigint) TO authenticated;

COMMIT;

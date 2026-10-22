BEGIN;

CREATE OR REPLACE FUNCTION public.update_my_pricing_loss(
  p_loss numeric,
  p_expected_version bigint
)
RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ctx record;
  v_enterprise public.enterprises%ROWTYPE;
  v_issuer text;
  v_identity public.auth_identities%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_member public.enterprise_members%ROWTYPE;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_loss IS NULL
     OR p_loss < 0 OR p_loss > 100 OR pg_catalog.scale(p_loss) > 2
     OR p_loss = 'NaN'::numeric OR p_loss IN ('Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
  SELECT context.* INTO v_ctx FROM public.get_my_access_context() context;
  IF NOT FOUND OR v_ctx.state IS DISTINCT FROM 'business_ready' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  v_issuer := auth.jwt() ->> 'iss';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::text, 0));
  SELECT ai.* INTO v_identity FROM public.auth_identities ai
    JOIN private.auth_issuer_config ac ON ac.issuer=ai.issuer AND ac.provider='supabase' AND ac.status='active'
    WHERE ai.provider='supabase' AND ai.issuer=v_issuer AND ai.subject=auth.uid()::text AND ai.status='active' FOR UPDATE OF ai;
  IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT u.* INTO v_actor FROM public.users u WHERE u.id=v_identity.user_id FOR UPDATE;
  IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.must_change_password THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT em.* INTO v_member FROM public.enterprise_members em WHERE em.user_id=v_actor.id AND em.enterprise_id=v_ctx.enterprise_id AND em.status='active' FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.enterprise_members z JOIN public.enterprises ze ON ze.id=z.enterprise_id WHERE z.user_id=v_actor.id AND z.status='active' AND ze.status='active') <> 1 THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT e.* INTO v_enterprise FROM public.enterprises e WHERE e.id=v_member.enterprise_id AND e.status='active' FOR UPDATE;
  IF NOT FOUND OR NOT private.can_access_enterprise(v_enterprise.id, 'enterprise.pricing_loss.write') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF v_enterprise.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict'::text, v_enterprise.version; RETURN; END IF;
  IF v_enterprise.default_filament_loss_percent IS NOT DISTINCT FROM p_loss THEN RETURN QUERY SELECT 'no_change'::text, v_enterprise.version; RETURN; END IF;
  UPDATE public.enterprises SET default_filament_loss_percent=p_loss WHERE id=v_enterprise.id;
  RETURN QUERY SELECT 'updated'::text, e.version FROM public.enterprises e WHERE e.id=v_enterprise.id;
END $$;
ALTER FUNCTION public.update_my_pricing_loss(numeric,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_my_pricing_loss(numeric,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_pricing_loss(numeric,bigint) TO authenticated;

-- Effective permission matrix, including the dedicated loss-setting permission.
CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT p_enterprise_id IS NOT NULL AND p_permission IS NOT NULL
 AND (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id
      WHERE em.user_id=private.current_internal_user_id() AND em.status='active' AND e.status='active')
 AND EXISTS (SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id JOIN public.enterprises e ON e.id=em.enterprise_id
   WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id() AND em.status='active'
     AND u.status='active' AND NOT u.must_change_password AND e.status='active'
     AND CASE p_permission
       WHEN 'products.read' THEN em.role IN ('owner','admin','operator') WHEN 'products.write' THEN em.role IN ('owner','admin','operator') WHEN 'products.delete' THEN em.role IN ('owner','admin')
       WHEN 'catalogs.read' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN ('owner','admin')
       WHEN 'filters.read' THEN em.role IN ('owner','admin','operator') WHEN 'filters.write' THEN em.role IN ('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN ('owner','admin')
       WHEN 'sales.read' THEN em.role IN ('owner','admin','operator') WHEN 'sales.write' THEN em.role IN ('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN ('owner','admin')
       WHEN 'printers.read' THEN em.role IN ('owner','admin','operator') WHEN 'printers.write' THEN em.role IN ('owner','admin') WHEN 'printers.archive' THEN em.role IN ('owner','admin')
       WHEN 'materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'materials.write' THEN em.role IN ('owner','admin') WHEN 'materials.archive' THEN em.role IN ('owner','admin')
       WHEN 'pricing.read' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN ('owner','admin','operator')
       WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'enterprise.pricing_loss.write' THEN em.role IN ('owner','admin') WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN ('owner','admin')
       WHEN 'spools.read' THEN em.role IN ('owner','admin','operator') WHEN 'spools.write' THEN em.role IN ('owner','admin','operator') WHEN 'spools.archive' THEN em.role IN ('owner','admin')
       WHEN 'inventory.read' THEN em.role IN ('owner','admin','operator') WHEN 'inventory.write' THEN em.role IN ('owner','admin','operator')
       WHEN 'stock.materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'stock.materials.write' THEN em.role IN ('owner','admin','operator') WHEN 'stock.materials.archive' THEN em.role IN ('owner','admin') ELSE false END);
$$;
ALTER FUNCTION private.can_access_enterprise(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_enterprise(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(uuid,text) TO authenticated;
COMMIT;


BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_enterprise_config()
RETURNS TABLE (
    electricity_rate_per_kwh numeric,
    default_filament_loss_percent numeric,
    version bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enterprise_id uuid;
BEGIN
    v_enterprise_id :=
        private.lock_internal_printer_context('printers.read');

    IF v_enterprise_id IS NULL THEN
        RAISE EXCEPTION 'unauthorized'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        e.electricity_rate_per_kwh,
        e.default_filament_loss_percent,
        e.version
    FROM public.enterprises AS e
    WHERE e.id = v_enterprise_id;
END;
$$;

ALTER FUNCTION public.get_my_enterprise_config()
    OWNER TO postgres;

REVOKE ALL
ON FUNCTION public.get_my_enterprise_config()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.get_my_enterprise_config()
TO authenticated;

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_enterprise_config()
RETURNS TABLE (
    electricity_rate_per_kwh numeric,
    default_filament_loss_percent numeric,
    version bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_context record;
BEGIN
    SELECT ctx.*
    INTO v_context
    FROM public.get_my_access_context() AS ctx;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unauthorized'
            USING ERRCODE = '42501';
    END IF;

    IF v_context.state IS DISTINCT FROM 'business_ready' THEN
        RAISE EXCEPTION 'unauthorized'
            USING ERRCODE = '42501';
    END IF;

    IF private.can_access_enterprise(
        v_context.enterprise_id,
        'printers.read'
    ) IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'unauthorized'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        e.electricity_rate_per_kwh,
        e.default_filament_loss_percent,
        e.version
    FROM public.enterprises AS e
    WHERE e.id = v_context.enterprise_id
      AND e.status = 'active';
END;
$$;

ALTER FUNCTION public.get_my_enterprise_config()
    OWNER TO postgres;

REVOKE ALL
ON FUNCTION public.get_my_enterprise_config()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.get_my_enterprise_config()
TO authenticated;

COMMIT;
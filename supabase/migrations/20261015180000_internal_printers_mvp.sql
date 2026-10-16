-- Internal, tenant-owned printer MVP. Review and apply explicitly; do not run automatically.
-- Requires the core tenancy/access-context and enterprise management migrations.
BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.printers') IS NOT NULL THEN
    RAISE EXCEPTION 'internal printers migration aborted: public.printers already exists; review manually';
  END IF;
END;
$$;

CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  brand VARCHAR(120),
  model VARCHAR(160),
  technology TEXT NOT NULL DEFAULT 'fdm',
  purchase_price NUMERIC(12,2) NOT NULL,
  estimated_life_hours INTEGER NOT NULL,
  average_power_watts NUMERIC(12,2) NOT NULL,
  maintenance_cost_per_hour NUMERIC(10,4) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT printers_technology_check CHECK (technology = 'fdm'),
  CONSTRAINT printers_name_check CHECK (pg_catalog.btrim(name) = name AND pg_catalog.length(name) BETWEEN 2 AND 120),
  CONSTRAINT printers_brand_check CHECK (brand IS NULL OR (pg_catalog.btrim(brand) = brand AND pg_catalog.length(brand) BETWEEN 1 AND 120)),
  CONSTRAINT printers_model_check CHECK (model IS NULL OR (pg_catalog.btrim(model) = model AND pg_catalog.length(model) BETWEEN 1 AND 160)),
  CONSTRAINT printers_purchase_check CHECK (purchase_price BETWEEN 0 AND 1000000 AND purchase_price::TEXT <> 'NaN'),
  CONSTRAINT printers_life_check CHECK (estimated_life_hours BETWEEN 1 AND 100000),
  CONSTRAINT printers_power_check CHECK (average_power_watts > 0 AND average_power_watts <= 10000 AND average_power_watts::TEXT <> 'NaN'),
  CONSTRAINT printers_maintenance_check CHECK (maintenance_cost_per_hour BETWEEN 0 AND 1000 AND maintenance_cost_per_hour::TEXT <> 'NaN'),
  CONSTRAINT printers_version_check CHECK (version >= 0)
);

-- Serves the tenant/active filter and stable newest-first ordering. Substring
-- searches still scan the tenant slice; no pg_trgm extension is required.
CREATE INDEX printers_enterprise_active_created_idx
  ON public.printers (enterprise_id, active, created_at DESC, id DESC);

CREATE FUNCTION public.internal_printers_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id THEN
    RAISE EXCEPTION 'printer enterprise ownership is immutable' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := pg_catalog.now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.internal_printers_touch() OWNER TO postgres;
CREATE TRIGGER printers_touch BEFORE UPDATE ON public.printers
  FOR EACH ROW EXECUTE FUNCTION public.internal_printers_touch();

-- Preserve the 20261014193600 helper's exact eligibility rules for every
-- pre-existing permission. Only these three printer cases are additions.
CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_enterprise_id IS NULL
      OR p_permission IS NULL
      OR p_permission NOT IN (
        'products.read', 'products.write', 'products.delete',
        'catalogs.read', 'catalogs.write', 'catalogs.delete',
        'filters.read', 'filters.write', 'filters.delete',
        'sales.read', 'sales.write', 'sales.delete',
        'enterprise.manage', 'members.manage_admins', 'members.manage_operators',
        'printers.read', 'printers.write', 'printers.archive'
      ) THEN false
    ELSE (
      SELECT pg_catalog.count(*) = 1
      FROM public.enterprise_members AS eligible_em
      JOIN public.enterprises AS eligible_e ON eligible_e.id = eligible_em.enterprise_id
      WHERE eligible_em.user_id = private.current_internal_user_id()
        AND eligible_em.status = 'active'
        AND eligible_e.status = 'active'
    ) AND EXISTS (
      SELECT 1
      FROM public.enterprise_members AS em
      JOIN public.users AS u ON u.id = em.user_id
      JOIN public.enterprises AS e ON e.id = em.enterprise_id
      WHERE em.enterprise_id = p_enterprise_id
        AND em.user_id = private.current_internal_user_id()
        AND em.status = 'active'
        AND u.status = 'active'
        AND e.status = 'active'
        AND u.must_change_password = false
        AND CASE p_permission
          WHEN 'products.read' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'products.write' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'catalogs.read' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'catalogs.write' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'filters.read' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'filters.write' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'sales.read' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'sales.write' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'printers.read' THEN em.role IN ('owner', 'admin', 'operator')
          WHEN 'printers.write' THEN em.role IN ('owner', 'admin')
          WHEN 'printers.archive' THEN em.role IN ('owner', 'admin')
          WHEN 'products.delete' THEN em.role IN ('owner', 'admin')
          WHEN 'catalogs.delete' THEN em.role IN ('owner', 'admin')
          WHEN 'filters.delete' THEN em.role IN ('owner', 'admin')
          WHEN 'sales.delete' THEN em.role IN ('owner', 'admin')
          WHEN 'enterprise.manage' THEN em.role = 'owner'
          WHEN 'members.manage_admins' THEN em.role = 'owner'
          WHEN 'members.manage_operators' THEN em.role IN ('owner', 'admin')
          ELSE false
        END
    )
  END;
$$;
ALTER FUNCTION private.can_access_enterprise(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_enterprise(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(UUID, TEXT) TO authenticated;

ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY printers_read ON public.printers FOR SELECT TO authenticated
  USING (private.can_access_enterprise(enterprise_id, 'printers.read'));
REVOKE ALL ON TABLE public.printers FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, enterprise_id, name, brand, model, technology,
              purchase_price, estimated_life_hours, average_power_watts,
              maintenance_cost_per_hour, active, version, created_at, updated_at)
  ON public.printers TO authenticated;

-- Lock protocol shared with enterprise management and provisioning:
-- global advisory -> issuer/actor advisory -> identity -> user -> membership
-- -> enterprise -> (caller) printer. Never lock enterprise ahead of user.
-- Resolve the actor only from the verified Supabase issuer and auth.uid().
-- Re-read the access context and permission while all actor rows are locked.
CREATE FUNCTION private.lock_internal_printer_context(p_permission TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid UUID;
  v_issuer TEXT;
  v_context RECORD;
  v_identity public.auth_identities%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_member public.enterprise_members%ROWTYPE;
  v_enterprise public.enterprises%ROWTYPE;
BEGIN
  IF p_permission IS NULL OR p_permission NOT IN ('printers.write', 'printers.archive') THEN
    RETURN NULL;
  END IF;
  v_uid := auth.uid();
  v_issuer := auth.jwt() ->> 'iss';
  IF v_uid IS NULL OR v_issuer IS NULL OR pg_catalog.btrim(v_issuer) = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
  SELECT context.* INTO v_context FROM public.get_my_access_context() AS context;
  IF v_context.state IS DISTINCT FROM 'business_ready' THEN
    RETURN NULL;
  END IF;
  -- Do not take the provisioning actor lock for an unconfigured issuer.
  IF NOT EXISTS (
    SELECT 1 FROM private.auth_issuer_config AS issuer
    WHERE issuer.issuer = v_issuer AND issuer.provider = 'supabase' AND issuer.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'modulus:employee-provisioning:actor:' || v_issuer || ':' || v_uid::TEXT, 0));

  SELECT identity.* INTO v_identity
  FROM public.auth_identities AS identity
  JOIN private.auth_issuer_config AS issuer
    ON issuer.issuer = identity.issuer AND issuer.provider = 'supabase' AND issuer.status = 'active'
  WHERE identity.provider = 'supabase' AND identity.issuer = v_issuer
    AND identity.subject = v_uid::TEXT AND identity.status = 'active'
  FOR UPDATE OF identity;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT person.* INTO v_user FROM public.users AS person
  WHERE person.id = v_identity.user_id FOR UPDATE OF person;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.must_change_password THEN
    RETURN NULL;
  END IF;

  SELECT member.* INTO v_member FROM public.enterprise_members AS member
  WHERE member.user_id = v_user.id AND member.enterprise_id = v_context.enterprise_id
    AND member.status = 'active' FOR UPDATE OF member;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise
  WHERE enterprise.id = v_member.enterprise_id AND enterprise.status = 'active'
  FOR UPDATE OF enterprise;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT context.* INTO v_context FROM public.get_my_access_context() AS context;
  IF v_context.state IS DISTINCT FROM 'business_ready'
    OR v_context.user_id IS DISTINCT FROM v_user.id
    OR v_context.membership_id IS DISTINCT FROM v_member.id
    OR v_context.enterprise_id IS DISTINCT FROM v_enterprise.id
    OR NOT private.can_access_enterprise(v_enterprise.id, p_permission) THEN
    RETURN NULL;
  END IF;
  RETURN v_enterprise.id;
END;
$$;

-- Validate unbounded NUMERIC inputs BEFORE casts to constrained table columns.
-- Name is trimmed by the caller; blank/whitespace-only brand and model become NULL.
CREATE FUNCTION private.printer_args_ok(
  p_name TEXT, p_brand TEXT, p_model TEXT, p_purchase NUMERIC,
  p_life NUMERIC, p_power NUMERIC, p_maintenance NUMERIC
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_name IS NULL OR pg_catalog.length(p_name) NOT BETWEEN 2 AND 120
    OR (p_brand IS NOT NULL AND pg_catalog.length(p_brand) > 120)
    OR (p_model IS NOT NULL AND pg_catalog.length(p_model) > 160)
    OR p_purchase IS NULL OR p_life IS NULL OR p_power IS NULL OR p_maintenance IS NULL THEN
    RETURN false;
  END IF;
  IF p_purchase::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR p_life::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR p_power::TEXT IN ('NaN', 'Infinity', '-Infinity')
    OR p_maintenance::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN false;
  END IF;
  IF p_purchase < 0 OR p_purchase > 1000000 OR pg_catalog.scale(p_purchase) > 2
    OR p_life < 1 OR p_life > 100000 OR p_life <> pg_catalog.trunc(p_life)
    OR p_power <= 0 OR p_power > 10000 OR pg_catalog.scale(p_power) > 2
    OR p_maintenance < 0 OR p_maintenance > 1000 OR pg_catalog.scale(p_maintenance) > 4 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- Contract for all three RPCs: exactly one (status, printer_id, version) row.
-- Only success exposes an ID/version. All failures return NULL/NULL, including
-- conflicts and cross-tenant/unavailable rows. Technical SQL errors propagate.
CREATE FUNCTION public.create_my_printer(
  p_name TEXT, p_brand TEXT, p_model TEXT, p_purchase_price NUMERIC,
  p_estimated_life_hours NUMERIC, p_average_power_watts NUMERIC,
  p_maintenance_cost_per_hour NUMERIC
) RETURNS TABLE(status TEXT, printer_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id UUID;
  v_printer public.printers%ROWTYPE;
  v_name TEXT := pg_catalog.btrim(p_name);
  v_brand TEXT := NULLIF(pg_catalog.btrim(p_brand), '');
  v_model TEXT := NULLIF(pg_catalog.btrim(p_model), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 'session_expired'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_printer_context('printers.write');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF NOT private.printer_args_ok(v_name, v_brand, v_model, p_purchase_price,
       p_estimated_life_hours, p_average_power_watts, p_maintenance_cost_per_hour) THEN
    RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  INSERT INTO public.printers (enterprise_id, name, brand, model, purchase_price,
    estimated_life_hours, average_power_watts, maintenance_cost_per_hour)
  VALUES (v_enterprise_id, v_name, v_brand, v_model, p_purchase_price,
    p_estimated_life_hours::INTEGER, p_average_power_watts, p_maintenance_cost_per_hour)
  RETURNING * INTO v_printer;
  RETURN QUERY SELECT 'success'::TEXT, v_printer.id, v_printer.version;
END;
$$;

CREATE FUNCTION public.update_my_printer(
  p_id UUID, p_expected_version BIGINT, p_name TEXT, p_brand TEXT, p_model TEXT,
  p_purchase_price NUMERIC, p_estimated_life_hours NUMERIC,
  p_average_power_watts NUMERIC, p_maintenance_cost_per_hour NUMERIC
) RETURNS TABLE(status TEXT, printer_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id UUID;
  v_printer public.printers%ROWTYPE;
  v_name TEXT := pg_catalog.btrim(p_name);
  v_brand TEXT := NULLIF(pg_catalog.btrim(p_brand), '');
  v_model TEXT := NULLIF(pg_catalog.btrim(p_model), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 'session_expired'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_printer_context('printers.write');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 THEN
    RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  SELECT printer.* INTO v_printer FROM public.printers AS printer
  WHERE printer.id = p_id AND printer.enterprise_id = v_enterprise_id
  FOR UPDATE OF printer;
  IF NOT FOUND OR NOT v_printer.active THEN
    RETURN QUERY SELECT 'printer_unavailable'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF v_printer.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF NOT private.printer_args_ok(v_name, v_brand, v_model, p_purchase_price,
       p_estimated_life_hours, p_average_power_watts, p_maintenance_cost_per_hour) THEN
    RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  UPDATE public.printers AS printer
  SET name = v_name, brand = v_brand, model = v_model,
      purchase_price = p_purchase_price, estimated_life_hours = p_estimated_life_hours::INTEGER,
      average_power_watts = p_average_power_watts,
      maintenance_cost_per_hour = p_maintenance_cost_per_hour
  WHERE printer.id = v_printer.id
  RETURNING printer.* INTO v_printer;
  RETURN QUERY SELECT 'success'::TEXT, v_printer.id, v_printer.version;
END;
$$;

-- Archive AND restore use this one state RPC. Repeating either target is unavailable.
CREATE FUNCTION public.set_my_printer_active(p_id UUID, p_expected_version BIGINT, p_active BOOLEAN)
RETURNS TABLE(status TEXT, printer_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id UUID;
  v_printer public.printers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT 'session_expired'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_printer_context('printers.archive');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_active IS NULL THEN
    RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  SELECT printer.* INTO v_printer FROM public.printers AS printer
  WHERE printer.id = p_id AND printer.enterprise_id = v_enterprise_id
  FOR UPDATE OF printer;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'printer_unavailable'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF v_printer.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict'::TEXT, NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  IF v_printer.active IS NOT DISTINCT FROM p_active THEN
    RETURN QUERY SELECT 'success'::TEXT, v_printer.id, v_printer.version; RETURN;
  END IF;
  UPDATE public.printers AS printer SET active = p_active
  WHERE printer.id = v_printer.id RETURNING printer.* INTO v_printer;
  RETURN QUERY SELECT 'success'::TEXT, v_printer.id, v_printer.version;
END;
$$;

ALTER FUNCTION private.lock_internal_printer_context(TEXT) OWNER TO postgres;
ALTER FUNCTION private.printer_args_ok(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.update_my_printer(UUID, BIGINT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.set_my_printer_active(UUID, BIGINT, BOOLEAN) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.internal_printers_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lock_internal_printer_context(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.printer_args_ok(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_printer(UUID, BIGINT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_printer_active(UUID, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_printer(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_printer(UUID, BIGINT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_printer_active(UUID, BIGINT, BOOLEAN) TO authenticated;
COMMIT;

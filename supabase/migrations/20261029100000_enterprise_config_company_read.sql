-- Local proposal only: do not apply without the normal migration review.
-- Proven mismatch in the local migration chain:
-- * /empresa requires enterprise.manage and getCompany calls this reader.
-- * 20261026060000 preserves owner enterprise.manage for Free, selection and
--   team regularization; printers.read remains subject to paid plan access.
-- * The final reader in 20261023010000 requires printers.read alone, preventing
--   that already-authorized company owner from reading the company form.
-- Keep existing printers.read authorization unchanged and additionally accept
-- existing enterprise.manage authority for this same three-column company read.
-- No role matrix, plan helper, printer access, write RPC, or grant is expanded.
-- Paid owner/admin/operator readers retain their existing access. Blocked
-- admin/operator readers remain blocked; only the existing owner company
-- remediation permission supplies the additional path. Both checks fail closed
-- on NULL, and identity/business_ready/active-enterprise checks are retained.
-- A separate owner-only RPC would duplicate this return contract and require
-- application changes without improving the intended authorization boundary.
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
    ) IS DISTINCT FROM TRUE
    AND private.can_access_enterprise(
        v_context.enterprise_id,
        'enterprise.manage'
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

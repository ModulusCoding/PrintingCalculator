-- Repair the authenticated pricing read boundary without changing product RPCs,
-- RLS, plan resolution semantics or the wrapper's identity/context checks.
BEGIN;

GRANT SELECT (deleted_at) ON TABLE public.products TO authenticated;

-- ALTER preserves the existing body and business_ready/tenant validation.
ALTER FUNCTION public.get_my_plan_access() SECURITY DEFINER;
ALTER FUNCTION public.get_my_plan_access() SET search_path = '';
ALTER FUNCTION public.get_my_plan_access() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_plan_access() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_plan_access() TO authenticated;

-- Only the context-validating public wrapper may cross this private boundary.
REVOKE ALL ON FUNCTION private.resolve_enterprise_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Local disposable database only, after migrations through 20261026070000.
-- From repository root:
-- psql "$LOCAL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/sql/20261026070000_pricing_read_access_assertions.sql
-- Run as postgres. All fixture changes roll back; no remote/reset required.
\set ON_ERROR_STOP on
BEGIN;
\i tests/sql/20261026050000_initial_free_plan_fixture.sql

-- Helpers remain invoker functions, so queries below really execute as authenticated.
GRANT SELECT ON pg_temp._initial_free_fixture TO authenticated;
SELECT pg_temp.check_true('deleted_at column SELECT granted',
  has_column_privilege('authenticated','public.products','deleted_at','SELECT'));
SELECT pg_temp.check_true('wrapper definer, postgres owner, empty search_path',
  p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
  AND 'search_path=""'=ANY(p.proconfig))
FROM pg_proc p WHERE p.oid='public.get_my_plan_access()'::regprocedure;
SELECT pg_temp.check_true('authenticated wrapper execute',
  has_function_privilege('authenticated','public.get_my_plan_access()','EXECUTE'));
SELECT pg_temp.check_true('anon wrapper denied',
  NOT has_function_privilege('anon','public.get_my_plan_access()','EXECUTE'));
SELECT pg_temp.check_true('private resolver not callable by API roles',
  NOT has_function_privilege('authenticated','private.resolve_enterprise_plan(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','private.resolve_enterprise_plan(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','private.resolve_enterprise_plan(uuid)','EXECUTE'));

SELECT pg_temp.jwt('owner_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('missing plan resolves selection_required in own tenant',
  enterprise_id=pg_temp.f('a') AND selected_plan IS NULL AND effective_plan='free'
  AND access_state='selection_required' AND selection_required)
FROM public.get_my_plan_access();
SELECT pg_temp.expect_error('direct private resolver denied',
  format('SELECT * FROM private.resolve_enterprise_plan(%L::uuid)',pg_temp.f('a')), '42501');
SELECT public.select_initial_free_plan();
SELECT pg_temp.check_true('free wrapper works under authenticated',
  enterprise_id=pg_temp.f('a') AND effective_plan='free' AND access_state='free' AND NOT selection_required)
FROM public.get_my_plan_access();
RESET ROLE;

-- Make the deleted fixture active too: the pricing filter, not active alone,
-- must exclude it. B's product must never leak into A's window.
UPDATE public.products SET active=true WHERE enterprise_id=pg_temp.f('a') AND deleted_at IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('pricing product window and exact count',
  count(*)=1 AND min(total)=1 AND bool_and(enterprise_id=pg_temp.f('a') AND deleted_at IS NULL))
FROM (
  SELECT id,name,active,version,price,deleted_at,enterprise_id,count(*) OVER () AS total
  FROM public.products
  WHERE enterprise_id=pg_temp.f('a') AND active=true AND deleted_at IS NULL
  ORDER BY name,id LIMIT 20 OFFSET 0
) page;
SELECT pg_temp.check_true('foreign tenant window empty', count(*)=0)
FROM public.products WHERE enterprise_id=pg_temp.f('b') AND active=true AND deleted_at IS NULL;
SELECT pg_temp.jwt('operator');
SELECT pg_temp.check_true('free operator product window blocked', count(*)=0)
FROM public.products WHERE enterprise_id=pg_temp.f('a') AND active=true AND deleted_at IS NULL;
RESET ROLE;

-- Populate beyond the window. Search and pagination must never promote an old
-- matching row. Archived registrations occupy the window; deleted ones do not.
INSERT INTO public.products(enterprise_id,name,active,created_at)
SELECT pg_temp.f('a'),'Window newest '||n,n<>2,now()+n*interval '1 hour'
FROM generate_series(1,3) n;
SELECT pg_temp.jwt('owner_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('owner with legacy team retains operational access',status='allowed')
FROM public.get_my_plan_business_access();
SELECT pg_temp.check_true('three registrations, including archived, in window',count(*)=3)
FROM public.products WHERE enterprise_id=pg_temp.f('a') AND deleted_at IS NULL;
SELECT pg_temp.check_true('only two active products in authoritative window',count(*)=2)
FROM public.products WHERE enterprise_id=pg_temp.f('a') AND active AND deleted_at IS NULL;
SELECT pg_temp.check_true('search cannot promote older matching product',count(*)=0)
FROM public.products WHERE enterprise_id=pg_temp.f('a') AND name ILIKE '%Product 1%'
AND active AND deleted_at IS NULL;
SELECT pg_temp.check_true('pagination follows window',count(*)=0)
FROM (SELECT id FROM public.products WHERE enterprise_id=pg_temp.f('a') AND active
AND deleted_at IS NULL ORDER BY name,id LIMIT 1 OFFSET 2) page;
RESET ROLE;

-- Plan fixtures use privileged setup; all observations use the public wrapper
-- as authenticated (never bypassing its context with a supplied tenant id).
INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,
  paid_until,authorization_id,authorization_version)
VALUES (pg_temp.f('b'),'intermediate','intermediate','paid',now()+interval '1 day',
  'pricing-read-test-'||pg_temp.f('b')::text,1);
SELECT pg_temp.jwt('owner_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('paid Intermediate wrapper', enterprise_id=pg_temp.f('b')
  AND selected_plan='intermediate' AND effective_plan='intermediate' AND access_state='paid'
  AND authorization_version=1 AND NOT selection_required)
FROM public.get_my_plan_access();
SELECT pg_temp.check_true('paid pricing product window',count(*)=1)
FROM public.products WHERE enterprise_id=pg_temp.f('b') AND active=true AND deleted_at IS NULL;
RESET ROLE;
UPDATE public.enterprise_plan_access SET paid_until=now()-interval '1 hour'
WHERE enterprise_id=pg_temp.f('b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('expired derives Free without losing selected plan',
  selected_plan='intermediate' AND effective_plan='free' AND access_state='expired' AND NOT selection_required)
FROM public.get_my_plan_access();
RESET ROLE;
UPDATE public.enterprise_plan_access SET effective_plan='free',access_state='cancelled',cancelled_at=now()
WHERE enterprise_id=pg_temp.f('b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('cancelled derives Free', selected_plan='intermediate'
  AND effective_plan='free' AND access_state='cancelled' AND cancelled_at IS NOT NULL)
FROM public.get_my_plan_access();

RESET ROLE;
UPDATE public.users SET must_change_password=true WHERE id=pg_temp.f('owner_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('password-change context still unauthorized',
  'SELECT * FROM public.get_my_plan_access()', '42501');

-- SECURITY DEFINER must not turn missing identity into a tenant lookup.
SELECT set_config('request.jwt.claims','{}',true);
SELECT pg_temp.expect_error('missing identity still unauthorized',
  'SELECT * FROM public.get_my_plan_access()', '42501');
RESET ROLE;
ROLLBACK;

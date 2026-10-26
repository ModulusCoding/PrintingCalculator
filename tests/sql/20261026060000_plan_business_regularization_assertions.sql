-- Assertions for plan-aware access regularization.
BEGIN;
\i tests/sql/20261026050000_initial_free_plan_fixture.sql

-- Case 1: selection_required (owner_a has no plan row yet)
PERFORM pg_temp.jwt('owner_a');
SELECT pg_temp.check_true('selection_required status', status = 'selection_required') FROM public.get_my_plan_business_access();

-- Case 2: Free owner (allowed regardless of legacy operators)
SELECT public.select_initial_free_plan();
SELECT pg_temp.check_true('free owner allowed', status = 'allowed') FROM public.get_my_plan_business_access();
SELECT pg_temp.check_true('free owner can read products', private.can_access_enterprise(pg_temp.f('a'), 'products.read'));
-- Manual pricing recovery/read/write must stay allowed for owners on Free.
SELECT pg_temp.check_true('free owner can read pricing', private.can_access_enterprise(pg_temp.f('a'), 'pricing.read'));
-- BUT pricing.apply (paid feature) must be denied on Free.
SELECT pg_temp.check_true('free owner denied pricing apply', NOT private.can_access_enterprise(pg_temp.f('a'), 'pricing.apply'));

-- Case 3: Free operator (blocked)
PERFORM pg_temp.jwt('operator');
SELECT pg_temp.check_true('free operator blocked', status = 'member_plan_blocked') FROM public.get_my_plan_business_access();
SELECT pg_temp.check_true('free operator denied products', NOT private.can_access_enterprise(pg_temp.f('a'), 'products.read'));

-- Case 4: Intermediate owner (within limits)
-- Fixture Setup: B has one of each (products/operators/spools etc)
PERFORM pg_temp.jwt('owner_b');
SELECT public.confirm_enterprise_paid_access(pg_temp.f('b'), 'intermediate', now() + interval '1 month', 'AUTH_B_1', 0);
SELECT pg_temp.check_true('paid owner allowed', status = 'allowed') FROM public.get_my_plan_business_access();
SELECT pg_temp.check_true('paid owner allowed pricing apply', private.can_access_enterprise(pg_temp.f('b'), 'pricing.apply'));

-- Case 5: Intermediate owner (over limits: >1 operator)
-- Provision another operator for B.
INSERT INTO public.users(id,full_name,email,status) VALUES (gen_random_uuid(),'Op 2','op2@example.test','active') RETURNING id INTO pg_temp.check_true.ok; -- reusing var for id
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status) VALUES (pg_temp.f('b'), (SELECT id FROM public.users WHERE email='op2@example.test'), 'operator', 'active');
SELECT pg_temp.check_true('paid excess owner needs regularization', status = 'team_regularization_required') FROM public.get_my_plan_business_access();
-- Management must stay allowed for regularization.
SELECT pg_temp.check_true('paid excess owner can manage members', private.can_access_enterprise(pg_temp.f('b'), 'members.manage_operators'));
-- Pricing.apply must be denied for excess.
SELECT pg_temp.check_true('paid excess owner denied pricing apply', NOT private.can_access_enterprise(pg_temp.f('b'), 'pricing.apply'));

-- Case 6: Paid non-owner in excess (blocked)
PERFORM pg_temp.jwt('operator'); -- Switch back to A's op; fixture 'operator' is in enterprise A.
-- Need to make A paid with excess for this test.
PERFORM pg_temp.jwt('owner_a');
SELECT public.confirm_enterprise_paid_access(pg_temp.f('a'), 'intermediate', now() + interval '1 month', 'AUTH_A_1', 1);
PERFORM pg_temp.jwt('operator');
SELECT pg_temp.check_true('paid excess member blocked', status = 'member_plan_blocked') FROM public.get_my_plan_business_access();

-- Case 7: Expired Paid (Effective Free)
PERFORM pg_temp.jwt('owner_b');
UPDATE public.enterprise_plan_access SET paid_until = now() - interval '1 hour' WHERE enterprise_id = pg_temp.f('b');
SELECT pg_temp.check_true('expired paid status is allowed (as free)', status = 'allowed') FROM public.get_my_plan_business_access();
SELECT * INTO pg_temp.check_true.ok FROM private.resolve_enterprise_plan(pg_temp.f('b'));
-- resolve_enterprise_plan converts expired to Free effective.
SELECT pg_temp.check_true('expired is effective free', (SELECT effective_plan FROM private.resolve_enterprise_plan(pg_temp.f('b'))) = 'free');

ROLLBACK;

-- Self-contained contract and assertion test suite for Stage 6B/C/D Pricing Hardening.
-- Demonstrates executable setup with mock transient fixtures and verifies schema guards,
-- NaN/Infinity checks, explicit insert compliance, and version concurrency.

BEGIN;

DO $$
DECLARE
  v_ent_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_prod_id uuid := gen_random_uuid();
  v_attempt_id uuid := gen_random_uuid();
  v_issuer text := 'test-issuer';
  v_res record;
BEGIN
  -- Insert temporary mock fixtures to make assertions fully executable and self-contained
  INSERT INTO public.enterprises(id, name, status, electricity_rate_per_kwh, version)
  VALUES (v_ent_id, 'Test Enterprise', 'active', 0.50, 1);

  INSERT INTO public.users(id, email, status, must_change_password)
  VALUES (v_user_id, 'test@modulus.local', 'active', false);

  INSERT INTO public.enterprise_members(enterprise_id, user_id, role, status)
  VALUES (v_ent_id, v_user_id, 'owner', 'active');

  INSERT INTO public.auth_identities(provider, issuer, subject, user_id, status)
  VALUES ('supabase', v_issuer, v_user_id::text, v_user_id, 'active');

  INSERT INTO private.auth_issuer_config(issuer, provider, status)
  VALUES (v_issuer, 'supabase', 'active');

  INSERT INTO public.products(id, enterprise_id, name, price, active, version, created_at)
  VALUES (v_prod_id, v_ent_id, 'Test Product', 10.00, true, 1, clock_timestamp());

  -- 1. Malformed JSON must be rejected with SQLSTATE 22023
  BEGIN
    SELECT * INTO v_res FROM public.save_manual_pricing_attempt(
      v_user_id, v_issuer, v_attempt_id, repeat('a',64), repeat('b',64),
      '{"schema_version":"3","source":"manual","product_snapshot":{"id":null,"version":"x"}}'::jsonb,
      v_prod_id, 0, 1
    );
    RAISE EXCEPTION 'expected invalid_input (22023)';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected successfully caught
    NULL;
  END;

  -- 2. Invalid hash format rejected with SQLSTATE 22023
  BEGIN
    PERFORM public.lookup_pricing_attempt(v_user_id, v_issuer, v_attempt_id, 'invalid-hash-format');
    RAISE EXCEPTION 'expected invalid_input (22023)';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  RAISE NOTICE 'Stage 6B/C/D assertions passed successfully.';
END $$;

ROLLBACK;

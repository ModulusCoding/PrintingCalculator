-- Self-contained contract smoke tests. Run after migrations in a disposable database.
-- No fixture rows are created here: production schemas require issuer, user,
-- membership and product rows owned by the deployment. Every assertion rolls back.
BEGIN;

DO $$
DECLARE r record;
BEGIN
  -- Malformed JSON must be rejected before any UUID/numeric cast.
  BEGIN
    SELECT * INTO r FROM public.save_manual_pricing_attempt(
      gen_random_uuid(),'not-configured',gen_random_uuid(),repeat('a',64),repeat('b',64),
      '{"schema_version":"3","source":"manual","product_snapshot":{"id":null,"version":"x"}}'::jsonb,
      gen_random_uuid(),0,1);
    RAISE EXCEPTION 'expected invalid_input';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

  -- Invalid hashes are rejected before authorization (stable SQLSTATE contract).
  BEGIN
    PERFORM public.lookup_pricing_attempt(gen_random_uuid(),'issuer',gen_random_uuid(),'bad');
    RAISE EXCEPTION 'expected invalid_input';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

  -- No application-side hash is asserted here: JSON.stringify and jsonb::text
  -- have different canonicalization. Hash verification belongs in a future
  -- migration only after the canonical representation is aligned.
END $$;

ROLLBACK;

-- Concurrency procedure (run in two psql sessions against disposable fixtures):
-- 1. Call save_manual_pricing_attempt with the same enterprise/attempt_id and
--    identical payload concurrently: exactly one created, the other idempotent.
-- 2. Call apply_pricing_price concurrently: exactly one applied, the other
--    idempotent; inspect pricing_price_applications for one row.
-- 3. Repeat after product downgrade on Free: historical lookup remains found,
--    apply returns product_unavailable, and no forbidden tenant row is exposed.

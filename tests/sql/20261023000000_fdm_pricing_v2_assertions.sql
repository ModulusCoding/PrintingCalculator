-- Reproducible SQL assertions test file for 20261023000000 migration
-- This file contains SQL assertions that can be executed to verify the migration.
-- DO NOT EXECUTE - for verification review only.

BEGIN;

-- Setup test helper assertions
CREATE OR REPLACE FUNCTION pg_temp.assert(condition boolean, message text) RETURNS void AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'Assertion failed: %', message;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 1. Verify enterprises table structure
SELECT pg_temp.assert(
  EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'enterprises' 
      AND column_name = 'default_filament_loss_percent'
      AND data_type = 'numeric'
      AND numeric_precision = 5
      AND numeric_scale = 2
  ),
  'Column enterprises.default_filament_loss_percent must exist with type numeric(5,2)'
);

-- 2. Verify check constraint on default_filament_loss_percent
SELECT pg_temp.assert(
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
    WHERE ccu.table_schema = 'public' 
      AND ccu.table_name = 'enterprises' 
      AND ccu.column_name = 'default_filament_loss_percent'
  ),
  'Check constraint on enterprises.default_filament_loss_percent must exist'
);

-- 3. Verify get_my_enterprise_config signature and permissions
SELECT pg_temp.assert(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'get_my_enterprise_config'
  ),
  'Function public.get_my_enterprise_config must exist'
);

SELECT pg_temp.assert(
  has_function_privilege('authenticated', 'public.get_my_enterprise_config()', 'EXECUTE'),
  'authenticated must have EXECUTE on public.get_my_enterprise_config'
);

-- 4. Verify update_my_enterprise_config signature and permissions
SELECT pg_temp.assert(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'update_my_enterprise_config'
  ),
  'Function public.update_my_enterprise_config must exist'
);

SELECT pg_temp.assert(
  has_function_privilege('authenticated', 'public.update_my_enterprise_config(numeric, numeric, bigint)', 'EXECUTE'),
  'authenticated must have EXECUTE on public.update_my_enterprise_config'
);

-- 5. Verify save_pricing_attempt exists and has correct permissions
SELECT pg_temp.assert(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname = 'save_pricing_attempt'
  ),
  'Function public.save_pricing_attempt must exist'
);

SELECT pg_temp.assert(
  has_function_privilege('service_role', 'public.save_pricing_attempt(uuid, text, uuid, text, text, jsonb, uuid, bigint, bigint, numeric, numeric, numeric)', 'EXECUTE'),
  'service_role must have EXECUTE on public.save_pricing_attempt'
);

SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public.save_pricing_attempt(uuid, text, uuid, text, text, jsonb, uuid, bigint, bigint, numeric, numeric, numeric)', 'EXECUTE'),
  'authenticated must NOT have EXECUTE on public.save_pricing_attempt'
);

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.save_pricing_attempt(uuid, text, uuid, text, text, jsonb, uuid, bigint, bigint, numeric, numeric, numeric)', 'EXECUTE'),
  'anon must NOT have EXECUTE on public.save_pricing_attempt'
);

-- 6. Verify security properties
SELECT pg_temp.assert(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'get_my_enterprise_config') = true,
  'get_my_enterprise_config must be SECURITY DEFINER'
);

SELECT pg_temp.assert(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'update_my_enterprise_config') = true,
  'update_my_enterprise_config must be SECURITY DEFINER'
);

SELECT pg_temp.assert(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'save_pricing_attempt') = true,
  'save_pricing_attempt must be SECURITY DEFINER'
);

-- 7. Schema and permission assertions
SELECT pg_temp.assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='can_access_enterprise' AND pg_get_functiondef(p.oid) LIKE '%enterprise.pricing_loss.write%'), 'legacy migration must not retain pricing_loss permission');
SELECT pg_temp.assert(has_function_privilege('authenticated', 'public.update_my_pricing_loss(numeric,bigint)', 'EXECUTE'), 'loss RPC must be executable by authenticated');
SELECT pg_temp.assert(NOT has_function_privilege('anon', 'public.update_my_pricing_loss(numeric,bigint)', 'EXECUTE'), 'loss RPC must not be executable by anon');

-- 8. Snapshot Validation Logic Test Cases (Structure & Behavioral Rules)
-- Executable fixture contract (run in an isolated seeded database): each case invokes
-- save_pricing_attempt through service_role and asserts SQLSTATE 22023 or 40001.
-- The fixture must provide one active product, enterprise, printer, spool and general
-- material (control_unit=metro), plus matching actor/issuer context.
-- Cases: valid meter/centimeter conversion (0.01), missing/null lossPercent,
-- missing packagingLines, wrong conversion factor, incompatible family (grama),
-- scalar type mismatches, and divergent general/spool snapshots. The valid case must
-- retain general_materials=[{id,version}] only; full state belongs in snapshots.
-- A recommended harness is pg_temp.assert_raises_sqlstate(sqlstate, sql) using
-- EXECUTE format(...) around the RPC call, with unique attempt/hash values per case.
-- The following blocks document expected behaviors:
--
-- V1 Snapshot Tests:
-- - Valid V1 snapshot: schema_version='1', input object, result object, product_snapshot object,
--   printers array (length 1), materials array (length 1-10), config_snapshot object
-- - Invalid V1 with spools present: MUST fail with invalid_input (22023)
-- - Invalid V1 with general_materials present: MUST fail with invalid_input (22023)
-- - Invalid V1 with empty materials array: MUST fail with invalid_input (22023)
-- - Invalid V1 with duplicate material IDs: MUST fail with invalid_input (22023)
--
-- V2 Snapshot Tests:
-- - Valid V2 snapshot: schema_version='2', input object, result object, product_snapshot object,
--   printers array (length 1), materials array (length 0-10), spools array (length 0-10),
--   general_materials array (length 0-10), config_snapshot object
-- - Invalid V2 with missing spools array: MUST fail with invalid_input (22023)
-- - Invalid V2 with missing general_materials array: MUST fail with invalid_input (22023)
-- - Invalid V2 with duplicate spool IDs: MUST fail with invalid_input (22023)
-- - Invalid V2 with duplicate general_material IDs: MUST fail with invalid_input (22023)
-- - Invalid V2 with spools > 10 items: MUST fail with invalid_input (22023)
-- - Invalid V2 with general_materials > 10 items: MUST fail with invalid_input (22023)
--
-- Concurrency and Ordering Tests:
-- - Lock order MUST be consistent across all functions to avoid deadlocks:
--   1. products
--   2. enterprises
--   3. materials
--   4. filament_spools (V2)
--   5. general_materials (V2)
--   6. printers
-- - Pricing calculations MUST NOT create stock movements
-- - Idempotency MUST be preserved for identical actor_id + request_hash

ROLLBACK;

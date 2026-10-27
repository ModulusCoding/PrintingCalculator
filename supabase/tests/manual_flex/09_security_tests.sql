-- NOT EXECUTED. Manual only; run after the FLEX lifecycle fixtures, as administrator.
-- Replace BOTH guard literals. No infrastructure changes or fixture deletion.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');

-- Snapshot identifiers as administrator, not by granting business-table access.
CREATE TEMP TABLE flex_security_context ON COMMIT DROP AS
SELECT (SELECT id FROM flex_manual_test.objects WHERE label='foreign_order') AS foreign_order,
       (SELECT id FROM flex_manual_test.objects WHERE label='transition') AS own_order,
       (SELECT enterprise_id FROM flex_manual_test.actors WHERE label='owner_apprentice') AS foreign_enterprise;
GRANT SELECT ON flex_security_context TO authenticated, anon;
SELECT flex_manual_test.assert_true(
  (SELECT foreign_order IS NOT NULL AND own_order IS NOT NULL AND foreign_enterprise IS NOT NULL
   FROM flex_security_context), 'security fixtures missing');

SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE oid uuid; msg text;
BEGIN
  SELECT foreign_order INTO oid FROM pg_temp.flex_security_context;
  BEGIN
    PERFORM public.get_order_physical_state(oid);
    RAISE EXCEPTION 'cross-tenant read unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    PERFORM flex_manual_test.assert_true(msg='order_unavailable','cross-tenant read error');
  END;
  BEGIN
    PERFORM public.transition_order(gen_random_uuid(),oid,0,'pago',NULL);
    RAISE EXCEPTION 'cross-tenant mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    PERFORM flex_manual_test.assert_true(msg='order_unavailable','cross-tenant mutation error');
  END;
END $$;
RESET ROLE;

-- Operator retains its real permissions: do NOT weaken the fixture to manufacture denial.
SELECT flex_manual_test.set_actor('operator');
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg text;
BEGIN
  BEGIN
    PERFORM public.cancel_order(gen_random_uuid(),
      (SELECT own_order FROM pg_temp.flex_security_context),0,'security probe');
    RAISE EXCEPTION 'operator cancellation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
    PERFORM flex_manual_test.assert_true(msg='unauthorized','operator cancellation must be unauthorized/42501');
  END;
END $$;
RESET ROLE;

-- Harness contract: unauthorized is an authenticated identity with NO membership.
-- This must not be an operator with temporarily stripped permissions.
SELECT flex_manual_test.set_actor('unauthorized');
SET LOCAL ROLE authenticated;
DO $$
DECLARE probe integer; msg text;
BEGIN
  -- First no-membership claims; then a syntactically valid JWT with no subject.
  FOR probe IN 1..2 LOOP
    IF probe=2 THEN
      PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
      PERFORM set_config('request.jwt.claim.sub','',true);
    END IF;
    BEGIN
      PERFORM public.get_order_physical_state((SELECT own_order FROM pg_temp.flex_security_context));
      RAISE EXCEPTION 'unauthorized read unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
      PERFORM flex_manual_test.assert_true(msg='unauthorized','read must be unauthorized/42501');
    END;
    BEGIN
      PERFORM public.transition_order(gen_random_uuid(),
        (SELECT own_order FROM pg_temp.flex_security_context),0,'pago',NULL);
      RAISE EXCEPTION 'unauthorized write unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
      PERFORM flex_manual_test.assert_true(msg='unauthorized','write must be unauthorized/42501');
    END;
  END LOOP;
END $$;
RESET ROLE;

SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['public.order_delivery_manifest','public.order_delivery_undos',
    'public.order_delivery_compensations','private.order_operation_receipts'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM %s LIMIT 1',rel);
      -- Even an RLS-filtered empty result violates the no-direct-grant contract.
      RAISE EXCEPTION 'protected SELECT unexpectedly allowed: %',rel;
    EXCEPTION WHEN insufficient_privilege THEN NULL; -- exact SQLSTATE 42501
    END;
  END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_order_physical_state((SELECT own_order FROM pg_temp.flex_security_context));
    RAISE EXCEPTION 'anon EXECUTE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.transition_order(gen_random_uuid(),
      (SELECT own_order FROM pg_temp.flex_security_context),0,'pago',NULL);
    RAISE EXCEPTION 'anon mutation EXECUTE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Explicit ACL evidence, NOT has_*_privilege (superusers inherently bypass ACLs).
SELECT c.oid::regclass AS relation, a.grantee, r.rolname, r.rolsuper, a.privilege_type
FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
LEFT JOIN pg_roles r ON r.oid=a.grantee
WHERE c.oid IN ('public.order_delivery_manifest'::regclass,'public.order_delivery_undos'::regclass,
 'public.order_delivery_compensations'::regclass,'private.order_operation_receipts'::regclass);
DO $$
BEGIN
  PERFORM flex_manual_test.assert_true(NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid IN ('public.order_delivery_manifest'::regclass,'public.order_delivery_undos'::regclass,
      'public.order_delivery_compensations'::regclass,'private.order_operation_receipts'::regclass)
      AND a.grantee<>c.relowner), 'protected tables contain explicit non-owner grants');
  PERFORM flex_manual_test.assert_true(NOT EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.get_order_physical_state(uuid)'::regprocedure,
      'public.transition_order(uuid,uuid,bigint,text,text)'::regprocedure)
      AND a.privilege_type='EXECUTE'
      AND (a.grantee=0 OR a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon'))
  ), 'PUBLIC/anon explicit RPC execute grant');
END $$;

-- Run as administrator so denial proves the immutable trigger, not ACL or RLS.
DO $$
DECLARE rel text; msg text; affected bigint; src public.order_delivery_manifest%ROWTYPE;
BEGIN
  FOREACH rel IN ARRAY ARRAY['public.order_events','public.order_delivery_manifest',
    'public.order_delivery_undos','public.order_delivery_compensations','private.order_operation_receipts'] LOOP
    EXECUTE format('SELECT count(*) FROM %s',rel) INTO affected;
    PERFORM flex_manual_test.assert_true(affected>0,'immutable probe requires a row: '||rel);
    BEGIN
      EXECUTE format('UPDATE %s SET enterprise_id=enterprise_id WHERE ctid=(SELECT ctid FROM %s LIMIT 1)',rel,rel);
      RAISE EXCEPTION 'immutable UPDATE unexpectedly succeeded: %',rel;
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
      PERFORM flex_manual_test.assert_true(msg='order_events_immutable','wrong immutable trigger error: '||rel);
    END;
  END LOOP;
  -- Copy a VALID own stock manifest, changing ONLY enterprise_id. All CHECKs remain valid.
  SELECT d.* INTO src FROM public.order_delivery_manifest d
  WHERE d.enterprise_id=(SELECT enterprise_id FROM flex_manual_test.actors WHERE label='owner_visionary')
    AND d.fulfillment_mode='stock' LIMIT 1;
  PERFORM flex_manual_test.assert_true(FOUND,'stock manifest required for composite tenant FK probe');
  BEGIN
    INSERT INTO public.order_delivery_manifest
      (enterprise_id,order_id,delivery_event_id,order_item_id,product_id,quantity,
       fulfillment_mode,settlement_id,inherited_from_event_id)
    VALUES ((SELECT foreign_enterprise FROM pg_temp.flex_security_context),src.order_id,
      src.delivery_event_id,src.order_item_id,src.product_id,src.quantity,
      src.fulfillment_mode,src.settlement_id,src.inherited_from_event_id);
    RAISE EXCEPTION 'cross-enterprise manifest unexpectedly inserted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; -- exact SQLSTATE 23503, never CHECK 23514
  END;
END $$;
COMMIT;

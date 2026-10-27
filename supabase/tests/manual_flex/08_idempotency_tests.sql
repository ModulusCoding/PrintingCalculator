-- NOT EXECUTED. Dispatcher uses fixed RPC branches; no untrusted SQL.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE call record; p jsonb; r jsonb; oid uuid;
BEGIN
 FOR call IN SELECT * FROM flex_manual_test.calls ORDER BY label LOOP
  p:=call.payload;
  CASE call.rpc
   WHEN 'deliver_order' THEN
    SELECT to_jsonb(x) INTO r FROM public.deliver_order((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_expected_version')::bigint) x;
   WHEN 'allocate_stock' THEN
    SELECT to_jsonb(x) INTO r FROM public.allocate_order_stock((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_order_item_id')::uuid,(p->>'p_expected_version')::bigint) x;
   WHEN 'undo_order_delivery' THEN
    SELECT to_jsonb(x) INTO r FROM public.undo_order_delivery((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_expected_version')::bigint,(p->>'p_delivery_event_id')::uuid,p->>'p_target_status',p->>'p_reason',p->>'p_classification') x;
   WHEN 'cancel_order' THEN
    SELECT to_jsonb(x) INTO r FROM public.cancel_order((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_expected_version')::bigint,p->>'p_reason') x;
   WHEN 'reopen_order' THEN
    SELECT to_jsonb(x) INTO r FROM public.reopen_order((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_expected_version')::bigint,p->>'p_reason') x;
   ELSE RAISE EXCEPTION 'unknown_rpc: %',call.rpc;
  END CASE;
  -- Idempotency check: result must be identical to recorded snapshot.
  PERFORM flex_manual_test.assert_true(r=call.result,'idempotency match '||call.label);
 END LOOP;
END $$;
RESET ROLE;
COMMIT;

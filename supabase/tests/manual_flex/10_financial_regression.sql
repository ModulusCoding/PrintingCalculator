-- NOT EXECUTED. Manual only, after fixture/harness setup. No fixture deletion.
-- Replace both guard literals. Business mutations below use official RPCs ONLY,
-- authenticated as owner A. Administrator only snapshots version/ledger evidence.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO STRICT r FROM public.create_order(gen_random_uuid(),
    'FLEX financial regression',NULL,NULL,NULL,'Manual financial isolation fixture',
    '[{"origin":"custom","fulfillment_mode":"untracked","name":"Financial regression","quantity":"1","unit_price":"100.00"}]'::jsonb,
    'fixed','0','0');
  PERFORM flex_manual_test.assert_true(r.status='created' AND r.total_amount=100,
    'financial fixture create contract');
  INSERT INTO flex_manual_test.objects(label,id) VALUES ('financial_regression',r.order_id);
  -- create/payment are deliberately NOT added to calls: generic replay only
  -- supports the six operational commands. Dedicated checkpoint evidence instead.
  INSERT INTO flex_manual_test.checkpoints(label,data)
    VALUES ('financial_create',to_jsonb(r));
END $$;
RESET ROLE;

-- Separate administrator snapshot; no business-table grants or admin mutations.
CREATE TEMP TABLE flex_financial_context ON COMMIT DROP AS
SELECT o.id AS order_id,o.version FROM public.orders o
WHERE o.id=(SELECT id FROM flex_manual_test.objects WHERE label='financial_regression');
GRANT SELECT ON flex_financial_context TO authenticated;
SELECT flex_manual_test.assert_true((SELECT count(*)=1 FROM flex_financial_context),
  'financial current-version snapshot missing');

SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record;
BEGIN
  -- Actual supported methods: pix, card, cash, bank_transfer, other (C4).
  SELECT * INTO STRICT r FROM public.record_order_payment(gen_random_uuid(),
    (SELECT order_id FROM pg_temp.flex_financial_context),
    (SELECT version FROM pg_temp.flex_financial_context),'40.00','pix',transaction_timestamp(),
    'FLEX regression receipt');
  PERFORM flex_manual_test.assert_true(r.net_received=40 AND r.total_received=40
    AND r.total_refunded=0,'official receipt totals');
  INSERT INTO flex_manual_test.checkpoints(label,data) VALUES ('financial_payment',to_jsonb(r));
END $$;
RESET ROLE;

-- Capture exact full ledger rows, not merely rounded totals or a paginated count.
CREATE TEMP TABLE flex_financial_baseline ON COMMIT DROP AS
SELECT o.id AS order_id,o.version,count(p.id) AS payment_count,
  coalesce(sum(p.amount) FILTER (WHERE p.entry_type='receipt'),0) AS received,
  coalesce(sum(p.amount) FILTER (WHERE p.entry_type='refund'),0) AS refunded,
  jsonb_agg(to_jsonb(p) ORDER BY p.id) AS ledger
FROM public.orders o JOIN public.order_payments p ON p.enterprise_id=o.enterprise_id AND p.order_id=o.id
WHERE o.id=(SELECT order_id FROM pg_temp.flex_financial_context)
GROUP BY o.id,o.version;
GRANT SELECT ON flex_financial_baseline TO authenticated;
SELECT flex_manual_test.assert_true((SELECT payment_count=1 AND received=40 AND refunded=0
 FROM flex_financial_baseline),'payment baseline mismatch');

SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE oid uuid; v bigint; delivery uuid; step text; r record; s record;
  baseline_history jsonb; current_history jsonb;
BEGIN
  SELECT order_id,version INTO STRICT oid,v FROM pg_temp.flex_financial_baseline;
  SELECT jsonb_agg(to_jsonb(h) ORDER BY h.payment_id) INTO baseline_history
    FROM public.get_order_payment_history(oid) h;
  PERFORM flex_manual_test.assert_true(jsonb_array_length(baseline_history)=1,
    'official history baseline must contain exactly one receipt');
  FOREACH step IN ARRAY ARRAY['pago','deliver','undo_actual','cancel','reopen'] LOOP
    CASE step
      WHEN 'pago' THEN
        SELECT * INTO STRICT r FROM public.transition_order(gen_random_uuid(),oid,v,'pago',NULL);
        PERFORM flex_manual_test.assert_true(r.operational_status='pago','operational Pago');
      WHEN 'deliver' THEN
        SELECT * INTO STRICT r FROM public.deliver_order(gen_random_uuid(),oid,v);
        delivery:=r.event_id;
        PERFORM flex_manual_test.assert_true(r.operational_status='entregue','delivery');
      WHEN 'undo_actual' THEN
        SELECT * INTO STRICT r FROM public.undo_order_delivery(gen_random_uuid(),oid,v,delivery,
          'pago','Financial regression actual delivery exit','actual_delivery');
        PERFORM flex_manual_test.assert_true(r.operational_status='pago'
          AND r.physical_effect='no_physical_movement','untracked actual delivery undo');
      WHEN 'cancel' THEN
        SELECT * INTO STRICT r FROM public.cancel_order(gen_random_uuid(),oid,v,'Financial regression cancellation');
        PERFORM flex_manual_test.assert_true(r.operational_status='cancelado','cancellation');
      WHEN 'reopen' THEN
        SELECT * INTO STRICT r FROM public.reopen_order(gen_random_uuid(),oid,v,'Financial regression reopening');
        PERFORM flex_manual_test.assert_true(r.operational_status='em_conversao','reopening');
    END CASE;
    PERFORM flex_manual_test.assert_true(r.version=v+1,'lifecycle version increment: '||step);
    v:=r.version;
    SELECT * INTO STRICT s FROM public.get_order_financial_summary(oid);
    PERFORM flex_manual_test.assert_true(s.version=v AND s.total_amount=100
      AND s.total_received=40 AND s.total_refunded=0 AND s.net_received=40
      AND s.pending_amount=60,'financial arithmetic changed after '||step);
    PERFORM flex_manual_test.assert_true(s.cancelled_unreversed_amount=
      CASE WHEN step='cancel' THEN 40 ELSE 0 END,'cancelled financial exposure: '||step);
    SELECT jsonb_agg(to_jsonb(h) ORDER BY h.payment_id) INTO current_history
      FROM public.get_order_payment_history(oid) h;
    PERFORM flex_manual_test.assert_true(current_history IS NOT DISTINCT FROM baseline_history,
      'payment count/amount/identity changed after '||step);
    INSERT INTO flex_manual_test.checkpoints(label,data)
      VALUES ('financial_'||step,jsonb_build_object('operation',to_jsonb(r),
        'summary',to_jsonb(s),'history',current_history));
  END LOOP;
END $$;
RESET ROLE;

-- Administrator verifies full physical ledger equality after every supported RPC
-- has completed. No direct UPDATE, INSERT or DELETE to any business table.
DO $$
DECLARE actual jsonb; b record;
BEGIN
  SELECT * INTO STRICT b FROM pg_temp.flex_financial_baseline;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO actual
    FROM public.order_payments p WHERE p.order_id=b.order_id;
  PERFORM flex_manual_test.assert_true(actual IS NOT DISTINCT FROM b.ledger,
    'operational lifecycle mutated physical payment ledger');
  PERFORM flex_manual_test.assert_true(NOT EXISTS (
    SELECT 1 FROM public.order_events e WHERE e.order_id=b.order_id AND e.event_type='payment_refunded'),
    'operational lifecycle emitted a refund event');
  PERFORM flex_manual_test.assert_true((SELECT count(*)=1 FROM public.order_events e
    WHERE e.order_id=b.order_id AND e.event_type='payment_received'),
    'exactly one official receipt event required');
END $$;
-- Optional official reverse_order_payment is intentionally omitted: this fixture
-- retains its receipt to prove operational cancellation never implies a refund.
COMMIT;

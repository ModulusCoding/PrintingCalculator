-- NOT EXECUTED. Same inspector connection. Reopen is responsible for reservations.
-- PENDING, not passed: insufficient-stock reopen needs a separately approved stock
-- depletion fixture via official inventory RPC; downgrade needs official plan lifecycle;
-- concurrency needs two real sessions and lock/commit coordination. Do not simulate
-- these by updating inventory, subscriptions, coverage, or receipts directly.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
INSERT INTO flex_manual_test.checkpoints VALUES ('07_before',pg_temp.flex_snapshot());
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE name text; oid uuid; v bigint; ev uuid; p jsonb; r jsonb; command text;
BEGIN
 FOREACH name IN ARRAY ARRAY['cycle_a','cycle_b','reserved_cancel'] LOOP
  SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label=name;
  SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
  IF name<>'reserved_cancel' THEN
   SELECT (result->>'event_id')::uuid INTO STRICT ev FROM flex_manual_test.calls WHERE label=CASE name WHEN 'cycle_a' THEN 'delivery_a2' ELSE 'delivery_b2' END;
   p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v,'p_delivery_event_id',ev,'p_target_status','orcado','p_reason','  prepare cancellation  ','p_classification',CASE name WHEN 'cycle_a' THEN 'incorrect_record' ELSE 'actual_delivery' END);
   SELECT to_jsonb(x) INTO STRICT r FROM public.undo_order_delivery((p->>'p_attempt_id')::uuid,oid,v,ev,p->>'p_target_status',p->>'p_reason',p->>'p_classification') x;
   INSERT INTO flex_manual_test.calls VALUES('undo_before_cancel_'||name,'undo_order_delivery',p,r);
  END IF;
  FOREACH command IN ARRAY ARRAY['cancel_order','reopen_order'] LOOP
   SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
   p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v,'p_reason','  manual lifecycle  ');
   IF command='cancel_order' THEN
    SELECT to_jsonb(x) INTO STRICT r FROM public.cancel_order((p->>'p_attempt_id')::uuid,oid,v,p->>'p_reason') x;
   ELSE
    SELECT to_jsonb(x) INTO STRICT r FROM public.reopen_order((p->>'p_attempt_id')::uuid,oid,v,p->>'p_reason') x;
   END IF;
   PERFORM flex_manual_test.assert_true((r->>'version')::bigint=v+1 AND r->>'status'=CASE command WHEN 'cancel_order' THEN 'cancelled' ELSE 'reopened' END,command||' '||name);
   INSERT INTO flex_manual_test.calls VALUES(command||'_'||name,command,p,r);
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
INSERT INTO flex_manual_test.checkpoints VALUES ('07_after',pg_temp.flex_snapshot());
DO $$
DECLARE b jsonb; a jsonb; oid uuid;
BEGIN
 SELECT data INTO STRICT b FROM flex_manual_test.checkpoints WHERE label='07_before';
 SELECT data INTO STRICT a FROM flex_manual_test.checkpoints WHERE label='07_after';
 PERFORM flex_manual_test.assert_true(a->'payments'=b->'payments' AND (a#>>'{inventory,balance}')::bigint=(b#>>'{inventory,balance}')::bigint+2 AND (a#>>'{inventory,reserved_balance}')::bigint=(b#>>'{inventory,reserved_balance}')::bigint+2,'cancel/reopen preserves money and B physical coverage; reserves A again');
 PERFORM flex_manual_test.assert_true((a->>'events')::bigint=(b->>'events')::bigint+8 AND (a->>'receipts')::bigint=(b->>'receipts')::bigint+8 AND (a->>'undos')::bigint=(b->>'undos')::bigint+2 AND (a->>'compensations')::bigint=(b->>'compensations')::bigint+1 AND (a->>'movements')::bigint=(b->>'movements')::bigint+1 AND a->'settlements'=b->'settlements' AND a->'manifest'=b->'manifest','exact cancel/reopen ledger counts');
 SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label='cycle_b';
 PERFORM flex_manual_test.assert_true(NOT EXISTS(SELECT 1 FROM public.order_stock_reservations WHERE order_id=oid AND state='active'),'preserved B has no duplicate reservation');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_stock_reservations r JOIN flex_manual_test.objects o ON o.id=r.order_id WHERE o.label IN ('cycle_a','reserved_cancel') AND r.state='active')=2,'corrected A and released reserve each reopened exactly once');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_stock_reservations r JOIN flex_manual_test.objects o ON o.id=r.order_id WHERE o.label='reserved_cancel' AND r.state='released')=1,'cancel released original active reserve');
 PERFORM flex_manual_test.assert_true(NOT EXISTS(SELECT 1 FROM public.product_inventory i WHERE i.product_id=(SELECT id FROM flex_manual_test.objects WHERE label='stock_product') AND i.reserved_balance IS DISTINCT FROM (SELECT coalesce(sum(r.quantity),0) FROM public.order_stock_reservations r WHERE r.enterprise_id=i.enterprise_id AND r.product_id=i.product_id AND r.state='active')),'reserved balance reconciles with all tenant active obligations');
END $$;
COMMIT;

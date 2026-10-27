-- NOT EXECUTED. Continue same inspector connection; no direct business writes.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
INSERT INTO flex_manual_test.checkpoints VALUES ('06_before',pg_temp.flex_snapshot());
-- Inspector captures item identity only; authenticated cannot inspect protected tables.
CREATE TEMP TABLE flex_reallocate ON COMMIT DROP AS
 SELECT o.label,i.id item_id,i.order_id FROM public.order_items i JOIN flex_manual_test.objects o ON o.id=i.order_id
 WHERE o.label IN ('cycle_a','mixed') AND i.fulfillment_mode='stock';
GRANT SELECT ON flex_reallocate TO authenticated;
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE it record; name text; oid uuid; v bigint; p jsonb; r jsonb; old record;
BEGIN
 FOR it IN SELECT * FROM pg_temp.flex_reallocate ORDER BY label,item_id LOOP
  SELECT version INTO STRICT v FROM public.get_order_financial_summary(it.order_id);
  p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',it.order_id,'p_order_item_id',it.item_id,'p_expected_version',v);
  SELECT to_jsonb(x) INTO STRICT r FROM public.allocate_order_stock((p->>'p_attempt_id')::uuid,it.order_id,it.item_id,v) x;
  PERFORM flex_manual_test.assert_true(r->>'status'='allocated' AND (r->>'version')::bigint=v+1,'fresh allocation after compensation');
  INSERT INTO flex_manual_test.calls VALUES('reallocate_'||it.label||'_'||it.item_id::text,'allocate_order_stock',p,r);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['cycle_a','mixed','cycle_b'] LOOP
  SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label=name;
  SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
  p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v);
  SELECT to_jsonb(x) INTO STRICT r FROM public.deliver_order((p->>'p_attempt_id')::uuid,oid,v) x;
  PERFORM flex_manual_test.assert_true((r->>'version')::bigint=v+1 AND r->>'status'='delivered','second delivery');
  INSERT INTO flex_manual_test.calls VALUES(CASE name WHEN 'cycle_a' THEN 'delivery_a2' WHEN 'mixed' THEN 'delivery_mixed2' ELSE 'delivery_b2' END,'deliver_order',p,r);
  IF name='cycle_b' THEN
   BEGIN
    PERFORM public.undo_order_delivery(gen_random_uuid(),oid,(r->>'version')::bigint,(r->>'event_id')::uuid,'modelando','D4 must reject','incorrect_record');
    RAISE EXCEPTION 'D4 unexpectedly accepted';
   EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM flex_manual_test.assert_true(SQLERRM='delivery_reconciliation_required','D4 exact rejection');
   END;
  END IF;
 END LOOP;
 -- Old attempts remain historical results, even after compensating/redelivering.
 FOR old IN SELECT * FROM flex_manual_test.calls WHERE label IN ('delivery_a1','delivery_b1','delivery_mixed1') LOOP
  p:=old.payload;
  SELECT to_jsonb(x) INTO STRICT r FROM public.deliver_order((p->>'p_attempt_id')::uuid,(p->>'p_order_id')::uuid,(p->>'p_expected_version')::bigint) x;
  PERFORM flex_manual_test.assert_true(r=old.result,'historical deliver replay '||old.label);
 END LOOP;
END $$;
RESET ROLE;
INSERT INTO flex_manual_test.checkpoints VALUES ('06_after',pg_temp.flex_snapshot());
DO $$
DECLARE b jsonb; a jsonb;
BEGIN
 SELECT data INTO STRICT b FROM flex_manual_test.checkpoints WHERE label='06_before';
 SELECT data INTO STRICT a FROM flex_manual_test.checkpoints WHERE label='06_after';
 PERFORM flex_manual_test.assert_true(a->'payments'=b->'payments' AND a#>'{inventory,reserved_balance}'=b#>'{inventory,reserved_balance}' AND (a#>>'{inventory,balance}')::bigint=(b#>>'{inventory,balance}')::bigint-7,'redelivery consumes only corrected seven units');
 PERFORM flex_manual_test.assert_true((a->>'reservations')::bigint=(b->>'reservations')::bigint+3 AND (a->>'settlements')::bigint=(b->>'settlements')::bigint+3 AND (a->>'movements')::bigint=(b->>'movements')::bigint+3 AND (a->>'events')::bigint=(b->>'events')::bigint+6 AND (a->>'receipts')::bigint=(b->>'receipts')::bigint+6 AND a->'compensations'=b->'compensations' AND a->'undos'=b->'undos','exact reallocation/delivery counts; replays and D4 have no effect');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_delivery_manifest d JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=d.delivery_event_id JOIN public.order_delivery_manifest src ON src.delivery_event_id=d.inherited_from_event_id AND src.order_item_id=d.order_item_id WHERE c.label='delivery_b2' AND src.delivery_event_id=(SELECT (result->>'event_id')::uuid FROM flex_manual_test.calls WHERE label='delivery_b1') AND src.settlement_id=d.settlement_id AND src.quantity=d.quantity AND src.product_id=d.product_id)=1,'B inherits original settlement without another exit');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_stock_settlements s JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=s.delivery_operation_id JOIN public.order_stock_reservations r ON r.id=s.reservation_id JOIN public.product_inventory_movements m ON m.id=s.movement_id WHERE c.label IN ('delivery_a2','delivery_mixed2') AND r.state='consumed' AND m.quantity=-s.quantity AND m.balance_after=m.balance_before-s.quantity AND m.result_version=m.request_expected_version+1 AND NOT EXISTS(SELECT 1 FROM public.order_delivery_compensations k WHERE k.settlement_id=s.id))=3,'new original stock debits for corrected items');
END $$;
COMMIT;

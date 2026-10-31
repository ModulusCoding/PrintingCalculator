-- NOT EXECUTED. Same inspector connection as 03 (pg_temp.flex_snapshot).
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
INSERT INTO flex_manual_test.checkpoints VALUES ('04_before',pg_temp.flex_snapshot());
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE name text; src text; lab text; oid uuid; ev uuid; v bigint; p jsonb; r jsonb; bad text;
BEGIN
 FOREACH name IN ARRAY ARRAY['cycle_a','mixed','untracked'] LOOP
  src:=CASE name WHEN 'cycle_a' THEN 'delivery_a1' WHEN 'mixed' THEN 'delivery_mixed1' ELSE 'delivery_untracked1' END;
  lab:=CASE name WHEN 'cycle_a' THEN 'undo_a1' WHEN 'mixed' THEN 'undo_mixed1' ELSE 'undo_untracked1' END;
  SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label=name;
  SELECT (result->>'event_id')::uuid INTO STRICT ev FROM flex_manual_test.calls WHERE label=src;
  SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
  -- Catch only the exact expected business error; sentinel assertions escape.
  FOREACH bad IN ARRAY ARRAY['missing_reason','blank_reason','classification','terminal_target','stale','foreign_event'] LOOP
   BEGIN
    PERFORM public.undo_order_delivery(gen_random_uuid(),oid,
     CASE WHEN bad='stale' THEN v-1 ELSE v END,
     CASE WHEN bad='foreign_event' THEN (SELECT (result->>'event_id')::uuid FROM flex_manual_test.calls WHERE label='delivery_b1') ELSE ev END,
     CASE WHEN bad='terminal_target' THEN 'cancelado' ELSE 'modelando' END,
     CASE WHEN bad='missing_reason' THEN NULL WHEN bad='blank_reason' THEN '  ' ELSE 'manual negative' END,
     CASE WHEN bad='classification' THEN 'unknown' ELSE 'incorrect_record' END);
    RAISE EXCEPTION 'expected failure missing: %',bad;
   EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '40001' OR SQLSTATE 'P0001' THEN
    PERFORM flex_manual_test.assert_true(
     (bad IN ('missing_reason','blank_reason','classification','terminal_target') AND SQLSTATE='22023' AND SQLERRM='invalid_input') OR
     (bad='stale' AND SQLSTATE='40001' AND SQLERRM='version_conflict') OR
     (bad='foreign_event' AND SQLSTATE='P0001' AND SQLERRM='delivery_confirmation_unavailable'), 'exact undo rejection: '||bad||' / '||SQLERRM);
   END;
  END LOOP;
  p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v,'p_delivery_event_id',ev,'p_target_status','modelando','p_reason','  manual correction  ','p_classification','incorrect_record');
  SELECT to_jsonb(x) INTO STRICT r FROM public.undo_order_delivery((p->>'p_attempt_id')::uuid,oid,v,ev,p->>'p_target_status',p->>'p_reason',p->>'p_classification') x;
  PERFORM flex_manual_test.assert_true(r->>'status'='delivery_undone' AND (r->>'version')::bigint=v+1 AND r->>'physical_effect'=CASE WHEN name='untracked' THEN 'no_physical_movement' ELSE 'compensated' END,lab);
  INSERT INTO flex_manual_test.calls VALUES(lab,'undo_order_delivery',p,r);
 END LOOP;
END $$;
RESET ROLE;
INSERT INTO flex_manual_test.checkpoints VALUES ('04_after',pg_temp.flex_snapshot());
DO $$
DECLARE b jsonb; a jsonb;
BEGIN
 SELECT data INTO STRICT b FROM flex_manual_test.checkpoints WHERE label='04_before';
 SELECT data INTO STRICT a FROM flex_manual_test.checkpoints WHERE label='04_after';
 PERFORM flex_manual_test.assert_true(a->'payments'=b->'payments' AND a#>'{inventory,reserved_balance}'=b#>'{inventory,reserved_balance}','correction leaves finance and reservations unchanged');
 PERFORM flex_manual_test.assert_true((a#>>'{inventory,balance}')::bigint=(b#>>'{inventory,balance}')::bigint+7 AND (a->>'compensations')::bigint=(b->>'compensations')::bigint+3 AND (a->>'movements')::bigint=(b->>'movements')::bigint+3 AND (a->>'undos')::bigint=(b->>'undos')::bigint+3 AND (a->>'events')::bigint=(b->>'events')::bigint+3 AND (a->>'receipts')::bigint=(b->>'receipts')::bigint+3,'exact compensation/negative rollback counts');
 PERFORM flex_manual_test.assert_true(a->'settlements'=b->'settlements' AND a->'manifest'=b->'manifest' AND a->'reservations'=b->'reservations','immutable original evidence retained');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_delivery_compensations k JOIN public.order_stock_settlements s ON s.id=k.settlement_id JOIN public.product_inventory_movements m ON m.id=k.compensation_movement_id JOIN public.product_inventory_movements original ON original.id=k.original_movement_id JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=k.undo_event_id WHERE c.label IN ('undo_a1','undo_mixed1') AND k.original_movement_id=s.movement_id AND m.quantity=s.quantity AND m.inventory_id=original.inventory_id AND m.balance_after=m.balance_before+s.quantity AND m.result_version=m.request_expected_version+1 AND m.reason='Order delivery correction '||k.undo_event_id::text)=3,'exact compensation links');
 PERFORM flex_manual_test.assert_true(NOT EXISTS(SELECT 1 FROM (
  SELECT m.balance_before,m.request_expected_version,lag(m.balance_after) OVER(ORDER BY m.result_version) pb,lag(m.result_version) OVER(ORDER BY m.result_version) pv FROM public.product_inventory_movements m JOIN public.order_delivery_compensations k ON k.compensation_movement_id=m.id JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=k.undo_event_id WHERE c.label IN ('undo_a1','undo_mixed1')
 ) q WHERE pv IS NOT NULL AND (balance_before<>pb OR request_expected_version<>pv)),'compensation per-product chain');
END $$;
COMMIT;

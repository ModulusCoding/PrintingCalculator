-- NOT EXECUTED. Continue in same inspector connection.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
INSERT INTO flex_manual_test.checkpoints VALUES ('05_before',pg_temp.flex_snapshot());
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE oid uuid; ev uuid; v bigint; p jsonb; r jsonb;
BEGIN
 SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label='cycle_b';
 SELECT (result->>'event_id')::uuid INTO STRICT ev FROM flex_manual_test.calls WHERE label='delivery_b1';
 SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
 p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v,'p_delivery_event_id',ev,'p_target_status','imprimindo','p_reason','  physical handoff was real  ','p_classification','actual_delivery');
 SELECT to_jsonb(x) INTO STRICT r FROM public.undo_order_delivery((p->>'p_attempt_id')::uuid,oid,v,ev,p->>'p_target_status',p->>'p_reason',p->>'p_classification') x;
 PERFORM flex_manual_test.assert_true(r->>'physical_effect'='preserved' AND (r->>'version')::bigint=v+1,'actual delivery preserves debit');
 INSERT INTO flex_manual_test.calls VALUES('undo_b1','undo_order_delivery',p,r);
END $$;
RESET ROLE;
INSERT INTO flex_manual_test.checkpoints VALUES ('05_after',pg_temp.flex_snapshot());
DO $$
DECLARE b jsonb; a jsonb;
BEGIN
 SELECT data INTO STRICT b FROM flex_manual_test.checkpoints WHERE label='05_before';
 SELECT data INTO STRICT a FROM flex_manual_test.checkpoints WHERE label='05_after';
 PERFORM flex_manual_test.assert_true((a-ARRAY['orders','events','undos','receipts'])=(b-ARRAY['orders','events','undos','receipts']),'actual undo changes no physical/financial evidence');
 PERFORM flex_manual_test.assert_true((a->>'events')::bigint=(b->>'events')::bigint+1 AND (a->>'undos')::bigint=(b->>'undos')::bigint+1 AND (a->>'receipts')::bigint=(b->>'receipts')::bigint+1,'one actual undo');
 PERFORM flex_manual_test.assert_true(EXISTS(SELECT 1 FROM public.order_delivery_undos u JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=u.undo_event_id JOIN public.order_events e ON e.event_uuid=u.undo_event_id WHERE c.label='undo_b1' AND u.classification='actual_delivery' AND e.reason='physical handoff was real' AND e.metadata->>'physical_effect'='preserved'),'actual undo audit');
END $$;
COMMIT;

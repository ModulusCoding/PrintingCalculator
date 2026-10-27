-- NOT EXECUTED. Manual candidate only; source inspection is not runtime proof.
-- Run sequentially after 00/01/02, in an isolated approved project, as admin inspector.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
INSERT INTO flex_manual_test.checkpoints VALUES ('03_started','{}'); -- reruns fail closed

-- Inspector-only snapshots. Never grant business-table SELECT to authenticated.
CREATE OR REPLACE FUNCTION pg_temp.flex_snapshot() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'orders',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.orders x WHERE x.id IN (SELECT id FROM flex_manual_test.objects)),
 'payments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.order_payments x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'inventory',(SELECT to_jsonb(x) FROM public.product_inventory x WHERE x.product_id=(SELECT id FROM flex_manual_test.objects WHERE label='stock_product')),
 'events',(SELECT count(*) FROM public.order_events x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'reservations',(SELECT count(*) FROM public.order_stock_reservations x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'active',(SELECT coalesce(sum(x.quantity),0) FROM public.order_stock_reservations x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects) AND x.state='active'),
 'settlements',(SELECT count(*) FROM public.order_stock_settlements x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'manifest',(SELECT count(*) FROM public.order_delivery_manifest x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'undos',(SELECT count(*) FROM public.order_delivery_undos x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)),
 'compensations',(SELECT count(*) FROM public.order_delivery_compensations x WHERE x.settlement_id IN (SELECT id FROM public.order_stock_settlements WHERE order_id IN (SELECT id FROM flex_manual_test.objects))),
 'movements',(SELECT count(*) FROM public.product_inventory_movements x WHERE x.product_id=(SELECT id FROM flex_manual_test.objects WHERE label='stock_product')),
 'receipts',(SELECT count(*) FROM private.order_operation_receipts x WHERE x.order_id IN (SELECT id FROM flex_manual_test.objects)))
$$;
INSERT INTO flex_manual_test.checkpoints VALUES ('03_before',pg_temp.flex_snapshot());
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $$
DECLARE name text; lab text; oid uuid; v bigint; p jsonb; r jsonb;
BEGIN
 FOREACH name IN ARRAY ARRAY['cycle_a','cycle_b','mixed','untracked'] LOOP
  lab:=CASE name WHEN 'cycle_a' THEN 'delivery_a1' WHEN 'cycle_b' THEN 'delivery_b1' WHEN 'mixed' THEN 'delivery_mixed1' ELSE 'delivery_untracked1' END;
  SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label=name;
  SELECT version INTO STRICT v FROM public.get_order_financial_summary(oid);
  p:=jsonb_build_object('p_attempt_id',gen_random_uuid(),'p_order_id',oid,'p_expected_version',v);
  SELECT to_jsonb(x) INTO STRICT r FROM public.deliver_order((p->>'p_attempt_id')::uuid,oid,v) x;
  PERFORM flex_manual_test.assert_true(r->>'status'='delivered' AND r->>'operational_status'='entregue' AND (r->>'version')::bigint=v+1,lab);
  INSERT INTO flex_manual_test.calls VALUES(lab,'deliver_order',p,r);
 END LOOP;
END $$;
RESET ROLE;
INSERT INTO flex_manual_test.checkpoints VALUES ('03_after',pg_temp.flex_snapshot());
DO $$
DECLARE b jsonb; a jsonb;
BEGIN
 SELECT data INTO STRICT b FROM flex_manual_test.checkpoints WHERE label='03_before';
 SELECT data INTO STRICT a FROM flex_manual_test.checkpoints WHERE label='03_after';
 PERFORM flex_manual_test.assert_true(a->'payments'=b->'payments','delivery must not write finance');
 PERFORM flex_manual_test.assert_true((a#>>'{inventory,balance}')::bigint=(b#>>'{inventory,balance}')::bigint-9 AND (a#>>'{inventory,reserved_balance}')::bigint=(b#>>'{inventory,reserved_balance}')::bigint-9,'delivery balance/reserved -9');
 PERFORM flex_manual_test.assert_true((a->>'settlements')::bigint=(b->>'settlements')::bigint+4 AND (a->>'movements')::bigint=(b->>'movements')::bigint+4 AND (a->>'events')::bigint=(b->>'events')::bigint+4 AND (a->>'receipts')::bigint=(b->>'receipts')::bigint+4,'four deliveries/four stock exits');
 PERFORM flex_manual_test.assert_true(NOT EXISTS (
  SELECT 1 FROM flex_manual_test.calls c JOIN public.order_delivery_manifest d ON d.delivery_event_id=(c.result->>'event_id')::uuid
  LEFT JOIN public.order_stock_settlements s ON s.id=d.settlement_id
  LEFT JOIN public.product_inventory_movements m ON m.id=s.movement_id
  WHERE c.label IN ('delivery_a1','delivery_b1','delivery_mixed1','delivery_untracked1') AND
   (d.inherited_from_event_id IS NOT NULL OR (d.fulfillment_mode='stock' AND
    (s.id IS NULL OR s.delivery_operation_id<>d.delivery_event_id OR s.order_item_id<>d.order_item_id OR m.quantity<>-d.quantity OR m.balance_after<>m.balance_before-d.quantity OR m.result_version<>m.request_expected_version+1)))),'manifest binds original exits');
 PERFORM flex_manual_test.assert_true((SELECT count(*) FROM public.order_delivery_manifest d JOIN public.order_items i ON i.id=d.order_item_id JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=d.delivery_event_id WHERE c.label IN ('delivery_a1','delivery_b1','delivery_mixed1','delivery_untracked1') AND d.quantity=i.quantity AND d.fulfillment_mode=i.fulfillment_mode)=(SELECT count(*) FROM public.order_items WHERE order_id IN (SELECT id FROM flex_manual_test.objects WHERE label IN ('cycle_a','cycle_b','mixed','untracked'))),'complete manifest including custom items');
 PERFORM flex_manual_test.assert_true(NOT EXISTS(SELECT 1 FROM (
  SELECT m.balance_before,m.request_expected_version,lag(m.balance_after) OVER(ORDER BY m.result_version) prev_balance,lag(m.result_version) OVER(ORDER BY m.result_version) prev_version
  FROM public.product_inventory_movements m JOIN public.order_stock_settlements s ON s.movement_id=m.id JOIN flex_manual_test.calls c ON (c.result->>'event_id')::uuid=s.delivery_operation_id WHERE c.label IN ('delivery_a1','delivery_b1','delivery_mixed1')
 ) q WHERE prev_version IS NOT NULL AND (balance_before<>prev_balance OR request_expected_version<>prev_version)),'same-product exits form exact chain');
END $$;
COMMIT;

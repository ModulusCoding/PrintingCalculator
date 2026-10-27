-- NOT EXECUTED. Preparation only. Admin inspector, authorized disposable project.
-- Read-only audit, not business RPC testing. Archive every output; no repair here.
BEGIN TRANSACTION READ ONLY;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT * FROM flex_manual_test.actors ORDER BY label;
SELECT * FROM flex_manual_test.objects ORDER BY label;
SELECT label,rpc,payload,result FROM flex_manual_test.calls ORDER BY label;
SELECT label,data FROM flex_manual_test.checkpoints ORDER BY label;
DO $integrity$
DECLARE e record; b jsonb; a jsonb; prefix text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM flex_manual_test.objects WHERE label='stock_product')
    OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN flex_manual_test.objects f ON f.id=o.id) THEN
    RAISE EXCEPTION 'BLOCKED: fixture registry incomplete';
  END IF;
  -- Global basic invariant, including active reservations with no inventory row.
  IF EXISTS (SELECT 1 FROM public.product_inventory i WHERE i.balance<0 OR i.reserved_balance<0
      OR i.reserved_balance>i.balance OR i.reserved_balance IS DISTINCT FROM
      (SELECT coalesce(sum(r.quantity),0) FROM public.order_stock_reservations r
       WHERE r.enterprise_id=i.enterprise_id AND r.product_id=i.product_id AND r.state='active'))
    OR EXISTS (SELECT 1 FROM public.order_stock_reservations r WHERE r.state='active' AND NOT EXISTS
      (SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=r.enterprise_id AND i.product_id=r.product_id)) THEN
    RAISE EXCEPTION 'global reservation reconciliation failed';
  END IF;
  -- Every delivery of every registered fixture order, not just the latest call.
  -- Helper authenticates receipts, tenant/order/item/product/quantity, consumed
  -- reservation->settlement->exit, inheritance, undo, full compensation, version
  -- and balance chains. It reads historical evidence; no business command invoked.
  FOR e IN SELECT ev.* FROM public.order_events ev
    WHERE ev.event_type='delivered' AND EXISTS
      (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=ev.order_id) LOOP
    PERFORM private.orders_flex_validate_delivery(e.enterprise_id,e.event_uuid);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations r
    WHERE r.state='consumed' AND EXISTS (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=r.order_id)
      AND (SELECT count(*) FROM public.order_stock_settlements s
        WHERE s.enterprise_id=r.enterprise_id AND s.reservation_id=r.id)<>1) THEN
    RAISE EXCEPTION 'fixture consumed reservation without exactly one settlement';
  END IF;
  -- Scope the generated-exit signature to KNOWN ORIGINAL delivery UUIDs. A manual
  -- exit with an arbitrary description is NOT automatically an orphan delivery.
  IF EXISTS (SELECT 1 FROM public.order_events ev
    JOIN public.product_inventory_movements m ON m.enterprise_id=ev.enterprise_id
      AND m.reason='Order delivery '||ev.event_uuid::text AND m.movement_type='exit'
    WHERE ev.event_type='delivered' AND EXISTS
      (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=ev.order_id)
      AND NOT EXISTS (SELECT 1 FROM public.order_stock_settlements s
        WHERE s.enterprise_id=m.enterprise_id AND s.order_id=ev.order_id
          AND s.delivery_operation_id=ev.event_uuid AND s.movement_id=m.id)) THEN
    RAISE EXCEPTION 'known fixture delivery exit without settlement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_stock_settlements s
    WHERE EXISTS (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=s.order_id)
      AND NOT EXISTS (SELECT 1 FROM public.order_events ev WHERE ev.enterprise_id=s.enterprise_id
        AND ev.order_id=s.order_id AND ev.event_uuid=s.delivery_operation_id AND ev.event_type='delivered')) THEN
    RAISE EXCEPTION 'fixture settlement crosses tenant/order or lacks original event';
  END IF;
  -- Completeness in both directions, including stray compensation not reached
  -- from a manifest. Preserve never compensates; incorrect_record compensates ALL.
  IF EXISTS (SELECT 1 FROM public.order_delivery_compensations c
    LEFT JOIN public.order_stock_settlements s ON s.enterprise_id=c.enterprise_id AND s.id=c.settlement_id
    LEFT JOIN public.order_delivery_undos u ON u.enterprise_id=c.enterprise_id AND u.undo_event_id=c.undo_event_id
    WHERE (EXISTS (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=s.order_id OR f.id=u.order_id))
      AND (s.id IS NULL OR u.undo_event_id IS NULL OR s.order_id IS DISTINCT FROM u.order_id
        OR s.delivery_operation_id IS DISTINCT FROM u.delivery_event_id
        OR c.original_movement_id IS DISTINCT FROM s.movement_id OR u.classification<>'incorrect_record'))
    OR EXISTS (SELECT 1 FROM public.order_delivery_undos u
      JOIN public.order_stock_settlements s ON s.enterprise_id=u.enterprise_id AND s.delivery_operation_id=u.delivery_event_id
      WHERE EXISTS (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=u.order_id)
        AND ((u.classification='incorrect_record' AND NOT EXISTS
          (SELECT 1 FROM public.order_delivery_compensations c WHERE c.enterprise_id=s.enterprise_id
            AND c.settlement_id=s.id AND c.undo_event_id=u.undo_event_id))
          OR (u.classification='actual_delivery' AND EXISTS
          (SELECT 1 FROM public.order_delivery_compensations c WHERE c.enterprise_id=u.enterprise_id AND c.undo_event_id=u.undo_event_id)))) THEN
    RAISE EXCEPTION 'fixture compensation completeness/tenant/order mismatch';
  END IF;
  -- Official immutable payment rows in paired phase snapshots. No zero-payment
  -- assumption: financial tests legitimately add payments in their own phase.
  FOR prefix IN SELECT left(label,length(label)-7) FROM flex_manual_test.checkpoints
    WHERE right(label,7)='_before' LOOP
    SELECT data INTO b FROM flex_manual_test.checkpoints WHERE label=prefix||'_before';
    SELECT data INTO a FROM flex_manual_test.checkpoints WHERE label=prefix||'_after';
    IF a IS NULL THEN
      RAISE NOTICE 'No paired after checkpoint for %; no financial assertion claimed',prefix;
    ELSIF prefix IN ('02','03','04','05','06') AND b ? 'payments' AND a ? 'payments' THEN
      IF a->'payments' IS DISTINCT FROM b->'payments' THEN
        RAISE EXCEPTION 'unexpected fixture payment delta in operational phase %',prefix;
      END IF;
    END IF;
  END LOOP;
END $integrity$;
-- Official ledger inventory for reconciliation with checkpoint evidence. Counts
-- without a known baseline are REPORTS, never a fabricated financial assertion.
SELECT o.id,o.enterprise_id,o.version,o.operational_status,count(p.id) AS payment_rows,
 coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS payments
FROM public.orders o LEFT JOIN public.order_payments p ON p.enterprise_id=o.enterprise_id AND p.order_id=o.id
WHERE EXISTS (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=o.id)
GROUP BY o.id,o.enterprise_id,o.version,o.operational_status ORDER BY o.id;
SELECT i.* FROM public.product_inventory i WHERE i.product_id IN
 (SELECT id FROM flex_manual_test.objects WHERE label='stock_product');
SELECT m.* FROM public.product_inventory_movements m WHERE m.product_id IN
 (SELECT id FROM flex_manual_test.objects WHERE label='stock_product') ORDER BY m.enterprise_id,m.result_version,m.id;
-- Foreign-tenant fixture is included in all audits above. Compare its immutable
-- rows with security-test before/after checkpoints; do not assume it has no history.
SELECT o.* FROM public.orders o JOIN flex_manual_test.objects f ON f.id=o.id WHERE f.label='foreign_order';
COMMIT;

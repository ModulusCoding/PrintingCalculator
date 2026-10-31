-- M7.2-C.3c: strict, atomic reopening. Source-reviewed only; NOT database-tested.
-- Requires the approved compatibility migration: order_events.event_uuid uuid
-- NOT NULL UNIQUE DEFAULT gen_random_uuid(); the bigint primary key is unchanged.
-- Review effective definitions/ACLs/triggers against A/B/B.1/C.1/C.2 before apply.
-- No quota, numbering, payments, ledger, snapshots or historical rows are changed.
-- Inventory reconciliation failures use 23514, matching B (not C2b's P0001).
BEGIN;
-- Static review complete; PostgreSQL execution/ACL/rollback/concurrency tests pending.
DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_events') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL
     OR to_regclass('public.order_stock_settlements') IS NULL
     OR to_regclass('public.product_inventory') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.resolve_enterprise_plan(uuid)') IS NULL
     OR to_regprocedure('private.stage6b_product_visible(uuid,uuid)') IS NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR to_regprocedure('private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)') IS NULL
     OR to_regprocedure('public.allocate_order_stock(uuid,uuid,uuid,bigint)') IS NULL
     OR to_regprocedure('public.cancel_order(uuid,uuid,bigint,text)') IS NULL
     OR to_regprocedure('public.order_events_forbid_mutation()') IS NULL THEN
    RAISE EXCEPTION 'orders_c3c_dependency_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.product_inventory'::regclass AND attname='reserved_balance'
        AND atttypid='bigint'::regtype AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_events'::regclass AND attname='id'
        AND atttypid='bigint'::regtype AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_events'::regclass AND attname='event_uuid'
        AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'orders_c3c_schema_mismatch';
  END IF;
  IF to_regprocedure('public.reopen_order(uuid,uuid,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'orders_c3c_rpc_collision';
  END IF;
END $preflight$;

CREATE FUNCTION public.reopen_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; product public.products%ROWTYPE;
  inv public.product_inventory%ROWTYPE; reservation public.order_stock_reservations%ROWTYPE;
  it public.order_items%ROWTYPE; pid uuid; product_ids uuid[];
  demand numeric; reserve_count bigint; active_quantity numeric;
  result_value jsonb; result_order uuid; result_event uuid; result_version bigint;
  new_event uuid;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  reason_value:=pg_catalog.btrim(p_reason);
  IF pg_catalog.length(reason_value) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Context itself takes no management mutex: acquire it explicitly first.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid,'sales.write') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'selection_required' USING ERRCODE='42501';
  END IF;
  -- Hash raw arguments, not the trimmed reason; whitespace changes conflict too.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version,'reason',p_reason));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:reopen:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=actor AND r.command_name='reopen' AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'reopen' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id OR receipt.result IS NULL
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR NOT (receipt.result ?& ARRAY['status','order_id','operational_status','version','event_id']) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'operational_status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'event_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_order:=(receipt.result->>'order_id')::uuid;
      result_event:=(receipt.result->>'event_id')::uuid;
      result_version:=(receipt.result->>'version')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF receipt.result->>'status' IS DISTINCT FROM 'reopened'
       OR receipt.result->>'operational_status' IS DISTINCT FROM 'em_conversao'
       OR result_order IS DISTINCT FROM p_order_id OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Historical replay deliberately ignores today's state, modes, stock and plan
    -- physical entitlement. Reservation cycles may already be released/consumed.
    IF NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid
        AND x.id=result_order AND x.version>=result_version)
       OR (SELECT count(*) FROM public.order_events e
        WHERE e.enterprise_id=eid AND e.order_id=result_order AND e.actor_id=actor
          AND e.event_type='reopened' AND e.from_status='cancelado' AND e.to_status='em_conversao'
          AND e.order_version=result_version AND e.reason=reason_value
          AND e.event_uuid=result_event
          AND e.metadata->'attempt_id'=pg_catalog.to_jsonb(p_attempt_id)
          AND e.metadata->'payload_hash'=pg_catalog.to_jsonb(hash_value))<>1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT 'reopened'::text,result_order,'em_conversao'::text,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.operational_status<>'cancelado' THEN RAISE EXCEPTION 'order_not_cancelled' USING ERRCODE='P0001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode IN ('stock','make_to_order'))
     AND (plan.effective_plan IS DISTINCT FROM 'intermediate' OR plan.access_state IS DISTINCT FROM 'paid') THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;

  -- Order lock stabilizes item/history identities. Include historical products so
  -- even inconsistent references cannot escape the complete product barrier.
  SELECT pg_catalog.array_agg(s.product_id ORDER BY s.product_id) INTO product_ids FROM (
    SELECT x.product_id FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode IN ('stock','make_to_order')
    UNION
    SELECT r.product_id FROM public.order_stock_reservations r WHERE r.enterprise_id=eid AND r.order_id=p_order_id
  ) s;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT p.* INTO product FROM public.products p WHERE p.enterprise_id=eid AND p.id=pid FOR UPDATE;
    IF NOT FOUND OR NOT product.active OR product.deleted_at IS NOT NULL
       OR NOT private.stage6b_product_visible(eid,pid) THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- Acquire ALL positions before ANY reservation row lock. Missing MTO positions
  -- are legitimate demand; missing stock positions mean no available stock.
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    PERFORM 1 FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=pid FOR UPDATE;
  END LOOP;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id FOR UPDATE LOOP
    SELECT x.* INTO it FROM public.order_items x WHERE x.enterprise_id=eid
      AND x.order_id=p_order_id AND x.id=reservation.order_item_id;
    IF NOT FOUND OR reservation.state<>'released' OR it.fulfillment_mode<>'stock'
       OR it.product_id IS DISTINCT FROM reservation.product_id OR it.quantity IS DISTINCT FROM reservation.quantity THEN
      RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Every stock item must originate from a legitimate released allocation cycle.
  -- Settlements imply prior delivery and cannot be revived by reopening.
  IF EXISTS (SELECT 1 FROM public.order_items x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock'
        AND NOT EXISTS (SELECT 1 FROM public.order_stock_reservations r
          WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.order_item_id=x.id
            AND r.state='released' AND r.product_id=x.product_id AND r.quantity=x.quantity))
     OR EXISTS (SELECT 1 FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id) THEN
    RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001';
  END IF;

  -- Whole-order validation, including reconciliation of ALL active tenant/product
  -- reservations and capacity for every per-item inventory version increment.
  -- No reserve helper is called until every product has passed.
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=pid;
    SELECT COALESCE(sum(r.quantity),0) INTO active_quantity FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.product_id=pid AND r.state='active';
    IF (inv.id IS NULL AND active_quantity<>0)
       OR (inv.id IS NOT NULL AND (inv.reserved_balance<0 OR inv.reserved_balance>inv.balance
         OR inv.reserved_balance IS DISTINCT FROM active_quantity)) THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(sum(x.quantity),0),count(*) INTO demand,reserve_count FROM public.order_items x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.product_id=pid AND x.fulfillment_mode='stock';
    IF demand>COALESCE(inv.balance-inv.reserved_balance,0) THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003';
    END IF;
    IF reserve_count>0 AND inv.version>9007199254740991-reserve_count THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  -- Preserve item IDs/modes/quantities/prices/snapshots; MTO remains unallocated.
  FOR it IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode='stock' ORDER BY x.product_id,x.id LOOP
    PERFORM private.reserve_order_item_stock(eid,p_order_id,it.id,it.product_id,it.quantity);
  END LOOP;
  UPDATE public.orders x SET operational_status='em_conversao',cancelled_at=NULL,version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  INSERT INTO public.order_events AS e(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,reason,metadata)
    VALUES(eid,p_order_id,actor,'reopened','cancelado','em_conversao',o.version,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value))
    RETURNING e.event_uuid INTO new_event;
  result_value:=pg_catalog.jsonb_build_object('status','reopened','order_id',p_order_id,
    'operational_status','em_conversao','version',o.version,'event_id',new_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'reopen',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'reopened'::text,p_order_id,'em_conversao'::text,o.version,new_event;
END $$;

ALTER FUNCTION public.reopen_order(uuid,uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.reopen_order(uuid,uuid,bigint,text) SET search_path='';
REVOKE ALL ON FUNCTION public.reopen_order(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reopen_order(uuid,uuid,bigint,text) TO authenticated;
COMMIT;

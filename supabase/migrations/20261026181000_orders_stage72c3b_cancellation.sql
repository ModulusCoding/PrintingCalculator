-- M7.2-C.3b: atomic cancellation; source-reviewed only, not database-tested.
-- Requires the approved compatibility migration: order_events.event_uuid uuid
-- NOT NULL UNIQUE DEFAULT gen_random_uuid(); the bigint primary key is unchanged.
-- No inventory entitlement/window gate: this only releases existing obligations.
-- Inventory reconciliation failures use 23514, matching the B finalizer (not C2b's P0001).
BEGIN;
-- Static review complete; PostgreSQL execution/ACL/rollback/concurrency tests pending.

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_events') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL
     OR to_regclass('public.order_stock_settlements') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.product_inventory') IS NULL
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.resolve_enterprise_plan(uuid)') IS NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR to_regprocedure('private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.allocate_order_stock(uuid,uuid,uuid,bigint)') IS NULL
     OR to_regprocedure('public.order_events_forbid_mutation()') IS NULL THEN
    RAISE EXCEPTION 'orders_c3b_dependency_missing';
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
    RAISE EXCEPTION 'orders_c3b_schema_mismatch';
  END IF;
END $preflight$;

CREATE FUNCTION public.cancel_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE;
  product public.products%ROWTYPE;
  inv public.product_inventory%ROWTYPE;
  reservation public.order_stock_reservations%ROWTYPE;
  pid uuid; product_ids uuid[]; release_count bigint;
  result_value jsonb; result_status text; result_order uuid;
  result_operational_status text; result_version bigint; result_event uuid;
  previous_status text;
BEGIN
  reason_value:=pg_catalog.btrim(p_reason);
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
     OR reason_value IS NULL OR pg_catalog.length(reason_value) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid,'sales.delete') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'selection_required' USING ERRCODE='42501';
  END IF;
  -- Raw reason binds the request; only the normalized reason is persisted in events.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,
    'expected_version',p_expected_version,'reason',p_reason));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:cancel:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r
    WHERE r.enterprise_id=eid AND r.actor_id=actor AND r.command_name='cancel'
      AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'cancel' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
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
      result_status:=receipt.result->>'status';
      result_order:=(receipt.result->>'order_id')::uuid;
      result_operational_status:=receipt.result->>'operational_status';
      result_version:=(receipt.result->>'version')::bigint;
      result_event:=(receipt.result->>'event_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF result_status IS DISTINCT FROM 'cancelled' OR result_order IS DISTINCT FROM p_order_id
       OR result_operational_status IS DISTINCT FROM 'cancelado' OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Historical success survives reopening, delivery and further order versions.
    -- Bind the real UUID event column; typed JSON equality binds attempt/hash metadata.
    IF NOT EXISTS (SELECT 1 FROM public.orders x
        WHERE x.enterprise_id=eid AND x.id=result_order AND x.version>=result_version)
       OR (SELECT count(*) FROM public.order_events e
        WHERE e.enterprise_id=eid AND e.order_id=result_order AND e.actor_id=actor
          AND e.event_type='cancelled' AND e.order_version=result_version
          AND e.from_status IN ('em_conversao','orcado','pago','modelando','imprimindo')
          AND e.to_status='cancelado' AND e.reason=reason_value
          AND e.event_uuid=result_event
          AND e.metadata->'attempt_id'=pg_catalog.to_jsonb(p_attempt_id)
          AND e.metadata->'payload_hash'=pg_catalog.to_jsonb(hash_value))<>1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT result_status,result_order,result_operational_status,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x
    WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.operational_status='cancelado' THEN RAISE EXCEPTION 'order_already_cancelled' USING ERRCODE='P0001'; END IF;
  IF o.operational_status='entregue' THEN RAISE EXCEPTION 'order_already_delivered' USING ERRCODE='P0001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  previous_status:=o.operational_status;

  -- Identity reads only. All supported reservation/item writers serialize on order.
  -- Take the COMPLETE product set, then COMPLETE position set, then reservations;
  -- never alternate these layers for individual items. Include historical cycles.
  SELECT pg_catalog.array_agg(s.product_id ORDER BY s.product_id) INTO product_ids
    FROM (SELECT DISTINCT r.product_id FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id) s;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT p.* INTO product FROM public.products p
      WHERE p.enterprise_id=eid AND p.id=pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
    -- B1 forbids archive/delete with active reservations: reject impossible drift,
    -- not normal catalog/window eligibility (no visibility or paid-plan gate here).
    IF (NOT product.active OR product.deleted_at IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.order_stock_reservations r WHERE r.enterprise_id=eid
          AND r.order_id=p_order_id AND r.product_id=pid AND r.state='active') THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT i.* INTO inv FROM public.product_inventory i
      WHERE i.enterprise_id=eid AND i.product_id=pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  PERFORM r.id FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id FOR UPDATE;

  -- Reject previous consumption or corrupt active identities, not silently repair.
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations r
      LEFT JOIN public.order_items it ON it.enterprise_id=r.enterprise_id
        AND it.order_id=r.order_id AND it.id=r.order_item_id
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id
        AND (r.state='consumed' OR (r.state='active' AND
          (it.id IS NULL OR it.fulfillment_mode IS DISTINCT FROM 'stock'
           OR it.product_id IS DISTINCT FROM r.product_id OR it.quantity IS DISTINCT FROM r.quantity))))
     OR EXISTS (SELECT 1 FROM public.order_items it
      WHERE it.enterprise_id=eid AND it.order_id=p_order_id AND it.fulfillment_mode='stock'
        AND (SELECT count(*) FROM public.order_stock_reservations r
          WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.order_item_id=it.id
            AND r.state='active')<>1)
     OR EXISTS (SELECT 1 FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id) THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT i.* INTO inv FROM public.product_inventory i
      WHERE i.enterprise_id=eid AND i.product_id=pid;
    IF inv.reserved_balance IS DISTINCT FROM (SELECT COALESCE(sum(r.quantity),0)
        FROM public.order_stock_reservations r
        WHERE r.enterprise_id=eid AND r.product_id=pid AND r.state='active')
       OR inv.reserved_balance<0 OR inv.reserved_balance>inv.balance THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO release_count FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.product_id=pid AND r.state='active';
    IF inv.version>9007199254740991-release_count THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.state='active' ORDER BY r.id LOOP
    PERFORM * FROM private.finalize_order_item_reservation(eid,p_order_id,reservation.id,'release',reason_value);
  END LOOP;

  UPDATE public.orders x SET operational_status='cancelado',cancelled_at=pg_catalog.now(),
    version=x.version+1 WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  INSERT INTO public.order_events AS e(enterprise_id,order_id,actor_id,event_type,
    from_status,to_status,order_version,reason,metadata)
    VALUES(eid,p_order_id,actor,'cancelled',previous_status,'cancelado',o.version,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value))
    RETURNING e.event_uuid INTO result_event;
  result_value:=pg_catalog.jsonb_build_object('status','cancelled','order_id',p_order_id,
    'operational_status','cancelado','version',o.version,'event_id',result_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'cancel',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'cancelled'::text,p_order_id,'cancelado'::text,o.version,result_event;
END $$;

ALTER FUNCTION public.cancel_order(uuid,uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.cancel_order(uuid,uuid,bigint,text) SET search_path='';
REVOKE ALL ON FUNCTION public.cancel_order(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid,uuid,bigint,text) TO authenticated;
COMMIT;

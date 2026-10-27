-- M7.2-C.2b: full later allocation of ONE make_to_order item.
-- REVIEW ONLY. No physical ledger movement, delivery or cancellation.
-- A/B/B.1/C.1 application is user-reported; PostgreSQL tests remain pending.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)') IS NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR to_regprocedure('public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL THEN
    RAISE EXCEPTION 'orders_c2_dependency_missing';
  END IF;
END $preflight$;

CREATE FUNCTION public.allocate_order_stock(
  p_attempt_id uuid,p_order_id uuid,p_order_item_id uuid,p_expected_version bigint
) RETURNS TABLE(status text,order_id uuid,order_item_id uuid,reservation_id uuid,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; it public.order_items%ROWTYPE;
  product public.products%ROWTYPE; inv public.product_inventory%ROWTYPE;
  reservation public.order_stock_reservations%ROWTYPE;
  rid uuid; result_value jsonb; result_status text;
  result_order uuid; result_item uuid; result_reservation uuid; result_version bigint;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_order_item_id IS NULL
     OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Same global mutex as identity/plan writers; never acquire context after stock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR NOT private.can_access_enterprise(eid,'sales.write') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'order_id',p_order_id,'order_item_id',p_order_item_id,'expected_version',p_expected_version));
  -- This is an attempt mutex, not a reservation lock. Receipt lookup is read-only;
  -- every writer of this command serializes on the same key before insertion.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:allocate_stock:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r
    WHERE r.enterprise_id=eid AND r.actor_id=actor AND r.command_name='allocate_stock'
      AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'allocate_stock' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id OR receipt.result IS NULL
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR NOT (receipt.result ?& ARRAY['status','order_id','order_item_id','reservation_id','version']) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_item_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'reservation_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_status:=receipt.result->>'status';
      result_order:=(receipt.result->>'order_id')::uuid;
      result_item:=(receipt.result->>'order_item_id')::uuid;
      result_reservation:=(receipt.result->>'reservation_id')::uuid;
      result_version:=(receipt.result->>'version')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF result_status IS DISTINCT FROM 'allocated' OR result_order IS DISTINCT FROM p_order_id
       OR result_item IS DISTINCT FROM p_order_item_id OR result_reservation IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- A historical replay need not match today's mode, stock or order version.
    -- Immutable reservation identity and event bind this result to its original effect.
    IF NOT EXISTS(SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid AND x.id=result_order AND x.version>=result_version)
       OR NOT EXISTS(SELECT 1 FROM public.order_stock_reservations r JOIN public.order_items x
           ON x.enterprise_id=r.enterprise_id AND x.order_id=r.order_id AND x.id=r.order_item_id
         WHERE r.enterprise_id=eid AND r.id=result_reservation AND r.order_id=result_order
           AND r.order_item_id=result_item AND r.actor_id=actor
           AND r.product_id=x.product_id AND r.quantity=x.quantity)
       OR NOT EXISTS(SELECT 1 FROM public.order_events e WHERE e.enterprise_id=eid AND e.order_id=result_order
           AND e.actor_id=actor AND e.event_type='stock_allocated' AND e.order_version=result_version
           AND e.metadata->>'order_item_id'=result_item::text
           AND e.metadata->>'reservation_id'=result_reservation::text) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT result_status,result_order,result_item,result_reservation,result_version;
    RETURN;
  END IF;

  -- Historical receipt recovery does not grant a new physical capability after downgrade.
  IF plan.effective_plan IS DISTINCT FROM 'intermediate' OR plan.access_state IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.operational_status IN ('entregue','cancelado') THEN RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  -- All item writers serialize on the order. Do not take item/reservation locks
  -- before the common product -> inventory barrier.
  SELECT x.* INTO it FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=p_order_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_item_unavailable' USING ERRCODE='P0002'; END IF;
  IF it.fulfillment_mode<>'make_to_order' OR it.product_id IS NULL THEN
    RAISE EXCEPTION 'order_item_not_allocatable' USING ERRCODE='P0001';
  END IF;
  SELECT x.* INTO product FROM public.products x WHERE x.enterprise_id=eid AND x.id=it.product_id FOR UPDATE;
  IF NOT FOUND OR NOT product.active OR product.deleted_at IS NOT NULL
     OR NOT private.stage6b_product_visible(eid,it.product_id) THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
  END IF;
  SELECT x.* INTO inv FROM public.product_inventory x
    WHERE x.enterprise_id=eid AND x.product_id=it.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003'; END IF;
  IF inv.reserved_balance IS DISTINCT FROM (SELECT COALESCE(sum(r.quantity),0)
      FROM public.order_stock_reservations r WHERE r.enterprise_id=eid AND r.product_id=it.product_id AND r.state='active') THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='P0001';
  END IF;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_item_id=it.id ORDER BY r.id FOR UPDATE LOOP
    -- No public operation in C.2 may reuse historical allocation identity.
    RAISE EXCEPTION 'order_item_already_allocated' USING ERRCODE='P0001';
  END LOOP;
  IF it.quantity>inv.balance-inv.reserved_balance THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003'; END IF;
  -- Resolve the mode before creating the active reference. B accepts stock and
  -- make_to_order; a later failure rolls this change back with the reservation.
  UPDATE public.order_items x SET fulfillment_mode='stock',updated_at=pg_catalog.now()
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=it.id;
  rid:=private.reserve_order_item_stock(eid,p_order_id,it.id,it.product_id,it.quantity);
  UPDATE public.orders x SET version=x.version+1 WHERE x.enterprise_id=eid AND x.id=p_order_id
    RETURNING x.* INTO o;
  INSERT INTO public.order_events(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,metadata)
    VALUES(eid,p_order_id,actor,'stock_allocated',NULL,NULL,o.version,
      pg_catalog.jsonb_build_object('order_item_id',it.id,'reservation_id',rid));
  result_value:=pg_catalog.jsonb_build_object('status','allocated','order_id',p_order_id,
    'order_item_id',it.id,'reservation_id',rid,'version',o.version);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'allocate_stock',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'allocated'::text,p_order_id,it.id,rid,o.version;
END $$;

ALTER FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) SET search_path='';
REVOKE ALL ON FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) TO authenticated;
COMMIT;

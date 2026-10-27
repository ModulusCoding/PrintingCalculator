-- M7.2-C.3d: integral delivery of existing obligations. REVIEW ONLY / NOT APPLIED.
-- Source contracts: A, B, B.1, C2b and the approved C3 plan. No payment writes.
-- Requires the additive order_events.event_uuid UUID contract installed before C3a.
-- order_events.id remains the original bigint identity/primary key.
-- Catalog/ACL comparison, PostgreSQL execution, rollback and concurrency tests
-- remain mandatory before manual application. This preflight is not homologation.
BEGIN;
-- Static draft reviewed against local A/B/B.1/C2 contracts; no database execution.

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_events') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.product_inventory') IS NULL
     OR to_regclass('public.product_inventory_movements') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL
     OR to_regclass('public.order_stock_settlements') IS NULL
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR to_regprocedure('private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.allocate_order_stock(uuid,uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'orders_c3d_dependency_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_events'::regclass AND attname='event_uuid'
        AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_events'::regclass AND attname='id'
        AND atttypid='bigint'::regtype AND attidentity='a' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='event_uuid'
      WHERE k.conrelid='public.order_events'::regclass AND k.contype='u'
        AND k.conkey=ARRAY[a.attnum] AND k.convalidated AND NOT k.condeferrable)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d
       JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.order_events'::regclass AND a.attname='event_uuid'
        AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN ('gen_random_uuid()','pg_catalog.gen_random_uuid()'))
     OR (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_stock_settlements'::regclass
        AND attname IN ('id','enterprise_id','order_id','order_item_id','reservation_id',
          'movement_id','product_id','delivery_operation_id')
        AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)<>8
     OR (SELECT count(*) FROM pg_catalog.pg_constraint
      WHERE conrelid='public.order_stock_settlements'::regclass AND convalidated
        AND ((contype='u' AND conname='order_stock_settlements_delivery_item_unique')
          OR (contype='f' AND conname IN ('order_stock_settlements_order_fk',
            'order_stock_settlements_item_fk','order_stock_settlements_reservation_fk',
            'order_stock_settlements_movement_fk'))))<>5
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.product_inventory'::regclass AND attname='reserved_balance'
        AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid='public.order_stock_settlements'::regclass
        AND conname='order_stock_settlements_reservation_unique' AND contype='u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid='public.order_stock_settlements'::regclass
        AND conname='order_stock_settlements_movement_unique' AND contype='u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid='public.product_inventory_movements'::regclass
        AND conname='product_inventory_movements_attempt_key' AND contype='u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid='public.product_inventory_movements'::regclass
        AND conname='product_inventory_movements_pair_fk' AND contype='f') THEN
    RAISE EXCEPTION 'orders_c3d_schema_mismatch';
  END IF;
END $preflight$;

CREATE FUNCTION public.deliver_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; hash_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; ev public.order_events%ROWTYPE;
  inv public.product_inventory%ROWTYPE;
  r public.order_stock_reservations%ROWTYPE;
  consumed record; item record; group_value record; chain record;
  result_order uuid; result_event uuid; result_version bigint;
  new_event uuid; movement_uuid uuid; internal_attempt uuid; product_uuid uuid;
  old_status text; result_value jsonb; stock_count bigint;
  previous_product uuid; previous_version bigint; previous_balance bigint;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Global identity/plan barrier MUST precede context and every physical lock.
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
  -- Central authorization retains plan selection/team restrictions. Consuming an
  -- existing reservation has NO paid, inventory.write, product-window or active gate.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:deliver:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT x.* INTO receipt FROM private.order_operation_receipts x
    WHERE x.enterprise_id=eid AND x.actor_id=actor AND x.command_name='deliver'
      AND x.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'deliver' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'operational_status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(receipt.result->'event_id') IS DISTINCT FROM 'string'
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
    IF receipt.result->>'status' IS DISTINCT FROM 'delivered'
       OR receipt.result->>'operational_status' IS DISTINCT FROM 'entregue'
       OR result_order IS DISTINCT FROM p_order_id OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991
       OR NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid
         AND x.id=result_order AND x.version>=result_version) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    SELECT x.* INTO ev FROM public.order_events x WHERE x.enterprise_id=eid AND x.event_uuid=result_event;
    IF NOT FOUND OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
       OR ev.event_type IS DISTINCT FROM 'delivered' OR ev.order_version IS DISTINCT FROM result_version
       OR ev.from_status IS NULL OR ev.from_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo')
       OR ev.to_status IS DISTINCT FROM 'entregue' OR ev.reason IS NOT NULL
       OR pg_catalog.jsonb_typeof(ev.metadata->'attempt_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(ev.metadata->'payload_hash') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(ev.metadata->'delivery_operation_id') IS DISTINCT FROM 'string'
       OR ev.metadata->>'attempt_id' IS DISTINCT FROM p_attempt_id::text
       OR ev.metadata->>'payload_hash' IS DISTINCT FROM hash_value
       OR ev.metadata->>'delivery_operation_id' IS DISTINCT FROM result_event::text THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Terminal item identity is preserved by C2c. Do not require today's order
    -- status, inventory balance, product eligibility or reservation actor to match
    -- delivery actor (allocation and delivery may be performed by different users).
    SELECT count(*) INTO stock_count FROM public.order_items x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock';
    IF NOT EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id)
       OR EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
         AND x.fulfillment_mode='make_to_order')
       OR (SELECT count(*) FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
         AND s.order_id=p_order_id)<>stock_count
       OR (SELECT count(*) FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
         AND s.delivery_operation_id=result_event)<>stock_count
       OR (SELECT count(*) FROM public.order_stock_reservations x WHERE x.enterprise_id=eid
         AND x.order_id=p_order_id AND x.state='consumed')<>stock_count
       OR EXISTS (SELECT 1 FROM public.order_stock_reservations x WHERE x.enterprise_id=eid
         AND x.order_id=p_order_id AND x.state='active')
       OR EXISTS (SELECT 1 FROM public.order_items x JOIN public.order_stock_reservations z
         ON z.enterprise_id=x.enterprise_id AND z.order_item_id=x.id
         WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='untracked') THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    FOR item IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid
      AND x.order_id=p_order_id AND x.fulfillment_mode='stock' ORDER BY x.id LOOP
      -- Exactly one complete, semantically valid immutable settlement chain per item.
      IF (SELECT count(*) FROM public.order_stock_settlements s
        JOIN public.order_stock_reservations z ON z.enterprise_id=s.enterprise_id AND z.id=s.reservation_id
        JOIN public.product_inventory_movements m ON m.enterprise_id=s.enterprise_id AND m.id=s.movement_id
        JOIN public.product_inventory i ON i.enterprise_id=m.enterprise_id AND i.id=m.inventory_id
        WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.order_item_id=item.id
          AND s.delivery_operation_id=result_event AND s.product_id=item.product_id AND s.quantity=item.quantity
          AND z.order_id=s.order_id AND z.order_item_id=s.order_item_id
          AND z.product_id=s.product_id AND z.quantity=s.quantity AND z.state='consumed'
          AND z.finalized_at IS NOT NULL AND z.finalization_reason IS NULL
          AND m.product_id=s.product_id AND m.actor_id=actor AND m.movement_type='exit'
          AND m.quantity=-s.quantity AND m.request_quantity=s.quantity AND m.request_counted_balance IS NULL
          AND m.attempt_id<>p_attempt_id AND m.reason='Order delivery '||result_event::text
          AND m.balance_before BETWEEN 0 AND 1000000000 AND m.balance_after BETWEEN 0 AND 1000000000
          AND m.balance_after=m.balance_before-s.quantity
          AND m.request_expected_version BETWEEN 0 AND 9007199254740990
          AND m.result_version=m.request_expected_version+1
          AND i.product_id=s.product_id AND i.version>=m.result_version)<>1 THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
    END LOOP;
    -- Multiple items of a product must preserve the per-call version/balance chain,
    -- not an aggregate exit or duplicated final balance. Later inventory writes are OK.
    FOR chain IN SELECT m.* FROM public.order_stock_settlements s
      JOIN public.product_inventory_movements m ON m.enterprise_id=s.enterprise_id AND m.id=s.movement_id
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.delivery_operation_id=result_event
      ORDER BY m.product_id,m.result_version,m.id LOOP
      IF previous_product IS NOT DISTINCT FROM chain.product_id
         AND (chain.request_expected_version IS DISTINCT FROM previous_version
           OR chain.balance_before IS DISTINCT FROM previous_balance) THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
      previous_product:=chain.product_id; previous_version:=chain.result_version; previous_balance:=chain.balance_after;
    END LOOP;
    RETURN QUERY SELECT 'delivered'::text,result_order,'entregue'::text,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF o.operational_status='entregue' THEN RAISE EXCEPTION 'order_already_delivered' USING ERRCODE='P0001'; END IF;
  IF o.operational_status='cancelado' THEN RAISE EXCEPTION 'order_already_cancelled' USING ERRCODE='P0001'; END IF;
  old_status:=o.operational_status;
  IF old_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo') THEN
    RAISE EXCEPTION 'invalid_order_transition' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id)
     OR EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
       AND x.fulfillment_mode='make_to_order') THEN
    RAISE EXCEPTION 'order_fulfillment_incomplete' USING ERRCODE='P0001';
  END IF;
  -- Collect identities without reservation row locks. Complete product set first,
  -- then complete position set, then reservations. Never interleave these barriers.
  FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock'
    ORDER BY x.product_id LOOP
    PERFORM 1 FROM public.products x WHERE x.enterprise_id=eid AND x.id=product_uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock'
    ORDER BY x.product_id LOOP
    PERFORM 1 FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=product_uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  PERFORM 1 FROM public.order_stock_reservations x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
    ORDER BY x.id FOR UPDATE;
  -- Released cycles from cancellation/reopening remain historical. No reservations
  -- of any state on untracked; no consumed cycle or preexisting settlement anywhere.
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations z
      LEFT JOIN public.order_items x ON x.enterprise_id=z.enterprise_id AND x.order_id=z.order_id AND x.id=z.order_item_id
      WHERE z.enterprise_id=eid AND z.order_id=p_order_id
        AND (x.id IS NULL OR x.fulfillment_mode<>'stock' OR z.product_id IS DISTINCT FROM x.product_id
          OR z.quantity IS DISTINCT FROM x.quantity OR z.state='consumed'))
     OR EXISTS (SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid AND s.order_id=p_order_id) THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid
    AND x.order_id=p_order_id AND x.fulfillment_mode='stock' ORDER BY x.id LOOP
    IF (SELECT count(*) FROM public.order_stock_reservations z WHERE z.enterprise_id=eid
        AND z.order_id=p_order_id AND z.order_item_id=item.id AND z.product_id=item.product_id
        AND z.quantity=item.quantity AND z.state='active'
        AND z.finalized_at IS NULL AND z.finalization_reason IS NULL)<>1 THEN
      RAISE EXCEPTION 'order_fulfillment_incomplete' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- Reconcile ALL company/product active obligations, not just this order. Reserve
  -- enough version capacity for every helper call before the first mutation.
  FOR group_value IN SELECT x.product_id,count(*) AS calls,sum(x.quantity) AS total_quantity
    FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode='stock' GROUP BY x.product_id ORDER BY x.product_id LOOP
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=group_value.product_id;
    IF inv.balance NOT BETWEEN 0 AND 1000000000 OR inv.reserved_balance<0 OR inv.reserved_balance>inv.balance
       OR inv.reserved_balance IS DISTINCT FROM (SELECT coalesce(sum(z.quantity),0)
         FROM public.order_stock_reservations z WHERE z.enterprise_id=eid
           AND z.product_id=group_value.product_id AND z.state='active')
       OR group_value.total_quantity>inv.reserved_balance OR group_value.total_quantity>inv.balance THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    IF inv.version>9007199254740991-group_value.calls THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  -- Persist identity BEFORE consumes/ledger writes. Never insert into bigint id.
  -- The proposal is only needed for immutable event metadata; all downstream
  -- references use the actual RETURNING identity, never an unpersisted UUID.
  -- Any failure below rolls back event, order, consumes, ledger and receipt alike.
  new_event:=pg_catalog.gen_random_uuid();
  INSERT INTO public.order_events(event_uuid,enterprise_id,order_id,actor_id,event_type,
    from_status,to_status,order_version,metadata)
    VALUES(new_event,eid,p_order_id,actor,'delivered',old_status,'entregue',o.version+1,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value,
        'delivery_operation_id',new_event))
    RETURNING event_uuid INTO new_event;
  -- A BEFORE INSERT trigger must not silently substitute a different identity
  -- without maintaining the immutable metadata binding. Fail closed if it does.
  IF new_event IS NULL OR NOT EXISTS (SELECT 1 FROM public.order_events e
    WHERE e.event_uuid=new_event AND e.enterprise_id=eid AND e.order_id=p_order_id
      AND e.actor_id=actor AND e.event_type='delivered' AND e.order_version=o.version+1
      AND e.from_status=old_status AND e.to_status='entregue' AND e.reason IS NULL
      AND e.metadata=pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,
        'payload_hash',hash_value,'delivery_operation_id',new_event)) THEN
    RAISE EXCEPTION 'delivery_event_unavailable' USING ERRCODE='23514';
  END IF;
  FOR r IN SELECT x.* FROM public.order_stock_reservations x WHERE x.enterprise_id=eid
    AND x.order_id=p_order_id AND x.state='active' ORDER BY x.id LOOP
    SELECT x.* INTO STRICT consumed FROM private.finalize_order_item_reservation(eid,p_order_id,r.id,'consume',NULL) x;
    IF consumed.product_id IS DISTINCT FROM r.product_id OR consumed.quantity IS DISTINCT FROM r.quantity THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=consumed.product_id;
    -- A random internal attempt per exit, never reuse the public delivery attempt.
    LOOP
      internal_attempt:=pg_catalog.gen_random_uuid();
      EXIT WHEN internal_attempt<>p_attempt_id AND NOT EXISTS (SELECT 1 FROM public.product_inventory_movements m
        WHERE m.enterprise_id=eid AND m.actor_id=actor AND m.attempt_id=internal_attempt);
    END LOOP;
    INSERT INTO public.product_inventory_movements(
      enterprise_id,inventory_id,product_id,actor_id,movement_type,quantity,balance_before,balance_after,
      reason,attempt_id,request_expected_version,request_quantity,request_counted_balance,result_version)
    VALUES(eid,inv.id,consumed.product_id,actor,'exit',-consumed.quantity,
      consumed.resulting_balance+consumed.quantity,consumed.resulting_balance,
      'Order delivery '||new_event::text,internal_attempt,consumed.inventory_version-1,consumed.quantity,NULL,consumed.inventory_version)
    RETURNING id INTO movement_uuid;
    INSERT INTO public.order_stock_settlements(
      enterprise_id,order_id,order_item_id,reservation_id,movement_id,product_id,quantity,delivery_operation_id)
    VALUES(eid,p_order_id,r.order_item_id,r.id,movement_uuid,consumed.product_id,consumed.quantity,new_event);
  END LOOP;
  UPDATE public.orders x SET operational_status='entregue',delivered_at=pg_catalog.now(),version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  result_value:=pg_catalog.jsonb_build_object('status','delivered','order_id',p_order_id,
    'operational_status','entregue','version',o.version,'event_id',new_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'deliver',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'delivered'::text,p_order_id,'entregue'::text,o.version,new_event;
END $$;

ALTER FUNCTION public.deliver_order(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.deliver_order(uuid,uuid,bigint) SET search_path='';
REVOKE ALL ON FUNCTION public.deliver_order(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.deliver_order(uuid,uuid,bigint) TO authenticated;
COMMIT;

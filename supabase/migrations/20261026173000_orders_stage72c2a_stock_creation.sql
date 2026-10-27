-- M7.2-C.2a: stock-aware creation. REVIEW ONLY / NOT APPLIED BY THIS AGENT.
-- A/B/B.1/C.1 reported manually applied in development; DB tests not passed.
-- No historical migration is modified. Apply/review together with C.2b.
BEGIN;
DO $preflight$
BEGIN
  IF to_regprocedure('public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)') IS NULL
     OR to_regprocedure('private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid)') IS NULL
     OR to_regclass('private.order_stock_reservation_reconciliation') IS NULL THEN
    RAISE EXCEPTION 'orders_c2_dependency_missing';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.create_order(
  p_attempt_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_email text,
  p_buyer_address text,
  p_notes text,
  p_items jsonb,
  p_discount_type text,
  p_discount_input text,
  p_shipping_amount text
)
RETURNS TABLE(status text,order_id uuid,display_number bigint,version bigint,
              subtotal numeric,discount_amount numeric,shipping_amount numeric,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; plan record;
  payload jsonb; receipt private.order_operation_receipts%ROWTYPE;
  order_uuid uuid:=pg_catalog.gen_random_uuid(); number_value bigint; counter_row public.order_number_counters%ROWTYPE;
  item jsonb; line_no integer:=0;
  normalized public.order_items%ROWTYPE;
  item_values public.order_items[]:='{}'::public.order_items[];
  item_index integer; inv public.product_inventory%ROWTYPE; group_quantity numeric;
  physical_products uuid[]:='{}'::uuid[]; shortage_products uuid[]:='{}'::uuid[];
  product_row public.products%ROWTYPE; product_ids uuid[]:='{}'::uuid[];
  subtotal_value numeric:=0; discount_value numeric; discount_input_value numeric;
  shipping_value numeric; total_value numeric; line_value numeric; unit_value numeric;
  quantity_value bigint; item_name text; item_description text; origin_value text;
  item_product uuid; mode_value text;
  result_value jsonb; hash_value text;
BEGIN
  IF p_attempt_id IS NULL OR p_buyer_name IS NULL OR pg_catalog.btrim(p_buyer_name)<>p_buyer_name
     OR pg_catalog.length(p_buyer_name) NOT BETWEEN 1 AND 255
     OR (p_buyer_phone IS NOT NULL AND pg_catalog.length(p_buyer_phone)>50)
     OR (p_buyer_email IS NOT NULL AND pg_catalog.length(p_buyer_email)>320)
     OR (p_buyer_address IS NOT NULL AND pg_catalog.length(p_buyer_address)>2000)
     OR (p_notes IS NOT NULL AND pg_catalog.length(p_notes)>5000)
     OR p_items IS NULL OR pg_catalog.jsonb_typeof(p_items)<>'array'
     OR (pg_catalog.jsonb_typeof(p_items)='array' AND pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 100)
     OR p_discount_type IS NULL OR p_discount_type NOT IN ('fixed','percent') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  shipping_value:=private.orders_c1_decimal(p_shipping_amount,999999999999.99,2);
  discount_input_value:=private.orders_c1_decimal(p_discount_input,999999999999.99,2);
  IF p_discount_type='percent' AND discount_input_value>100 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;

  -- Take the same enterprise-management mutex as identity/plan changes before
  -- the context helper takes identity and membership row locks.
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
  -- Existing context helper acquires the global enterprise-management lock and
  -- identity/membership locks. Serialize plan state with the established plan row.
  -- The global enterprise-management lock serializes plan mutations, including
  -- creation of a previously absent plan row, before context/identity locks.
  -- Plan mutations use the same global management lock, retained before identity.
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='free' AND NOT (plan.access_state IN ('free','expired','cancelled')) THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  IF plan.effective_plan='intermediate' AND plan.access_state<>'paid' THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  IF plan.effective_plan NOT IN ('free','intermediate','advanced') THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  payload:=pg_catalog.jsonb_build_object(
    'buyer_name',p_buyer_name,'buyer_phone',p_buyer_phone,'buyer_email',p_buyer_email,
    'buyer_address',p_buyer_address,'notes',p_notes,'items',p_items,
    'discount_type',p_discount_type,'discount_input',p_discount_input,
    'shipping_amount',p_shipping_amount);
  hash_value:=private.orders_c1_payload_hash(payload);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('orders:quota:'||eid::text,0));
  -- A free-plan historical quota is serialized with all creates in this tenant.
  -- Advisory key serializes simultaneous first-use attempts before the receipt row exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:create:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r
   WHERE r.enterprise_id=eid AND r.actor_id=actor AND r.command_name='create' AND r.attempt_id=p_attempt_id
   FOR UPDATE;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'create' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR NOT private.orders_c1_receipt_result_valid(receipt.result,receipt.enterprise_id,receipt.actor_id,receipt.command_name,receipt.attempt_id,receipt.order_id) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT receipt.result->>'status',(receipt.result->>'order_id')::uuid,
      (receipt.result->>'display_number')::bigint,(receipt.result->>'version')::bigint,
      (receipt.result->>'subtotal')::numeric,(receipt.result->>'discount_amount')::numeric,
      (receipt.result->>'shipping_amount')::numeric,(receipt.result->>'total_amount')::numeric;
    RETURN;
  END IF;

  -- Order IDs and products are validated before acquiring deterministic product locks.
  FOR item IN SELECT x.value FROM pg_catalog.jsonb_array_elements(p_items) WITH ORDINALITY AS x(value,ordinality) ORDER BY x.ordinality
  LOOP
    IF pg_catalog.jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    line_no:=line_no+1;
    IF item->>'fulfillment_mode' IS NULL OR item->>'fulfillment_mode' NOT IN ('untracked','stock','make_to_order') THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    origin_value:=item->>'origin'; mode_value:=item->>'fulfillment_mode';
    IF (item ? 'product_id' AND item->'product_id'<>'null'::jsonb AND pg_catalog.jsonb_typeof(item->'product_id')<>'string')
       OR (item ? 'fulfillment_mode' AND pg_catalog.jsonb_typeof(item->'fulfillment_mode')<>'string')
       OR (item ? 'origin' AND pg_catalog.jsonb_typeof(item->'origin')<>'string')
       OR (item ? 'name' AND pg_catalog.jsonb_typeof(item->'name')<>'string')
       OR (item ? 'description' AND item->'description'<>'null'::jsonb AND pg_catalog.jsonb_typeof(item->'description')<>'string') THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    item_product:=CASE WHEN item ? 'product_id' AND item->'product_id'<>'null'::jsonb
                       THEN private.orders_c1_safe_uuid(item->>'product_id') ELSE NULL END;
    IF origin_value IS NULL OR origin_value NOT IN ('catalog','custom') OR (origin_value='catalog' AND item_product IS NULL) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    IF mode_value<>'untracked' THEN
      IF plan.effective_plan IS DISTINCT FROM 'intermediate' OR plan.access_state IS DISTINCT FROM 'paid' THEN
        RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
      END IF;
      IF item_product IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
      physical_products:=pg_catalog.array_append(physical_products,item_product);
    END IF;
    quantity_value:=private.orders_c1_safe_quantity(item->>'quantity');
    unit_value:=private.orders_c1_decimal(item->>'unit_price',1000000,2);
    item_name:=item->>'name'; item_description:=item->>'description';
    IF item_name IS NULL OR pg_catalog.btrim(item_name)<>item_name OR pg_catalog.length(item_name) NOT BETWEEN 1 AND 255
       OR (item_description IS NOT NULL AND pg_catalog.length(item_description)>3000) THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    IF item_product IS NOT NULL THEN product_ids:=array_append(product_ids,item_product); END IF;
    line_value:=quantity_value::numeric*unit_value;
    IF line_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    subtotal_value:=subtotal_value+line_value;
    IF subtotal_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    -- Typed transaction-local rows: no JSON conversions remain in the write phase.
    normalized.id:=pg_catalog.gen_random_uuid(); normalized.enterprise_id:=eid;
    normalized.order_id:=order_uuid; normalized.line_number:=line_no;
    normalized.origin:=origin_value; normalized.product_id:=item_product;
    normalized.product_name_snapshot:=item_name; normalized.product_description_snapshot:=item_description;
    normalized.quantity:=quantity_value; normalized.unit_price:=unit_value;
    normalized.line_subtotal:=line_value; normalized.fulfillment_mode:=mode_value;
    item_values:=pg_catalog.array_append(item_values,normalized);
  END LOOP;

  -- Lock distinct products in UUID order; catalog snapshots come from locked rows.
  -- Creation keeps its quota/attempt mutexes before this product-lock phase.
  -- Allocation has no quota path and locks its existing order before products.
  FOR item_product IN SELECT DISTINCT u.product_id FROM pg_catalog.unnest(product_ids) AS u(product_id) WHERE u.product_id IS NOT NULL ORDER BY u.product_id LOOP
    SELECT p.* INTO product_row FROM public.products p
     WHERE p.enterprise_id=eid AND p.id=item_product FOR UPDATE;
    IF NOT FOUND OR NOT product_row.active OR product_row.deleted_at IS NOT NULL
       OR NOT private.stage6b_product_visible(eid,item_product) THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Product locks are all held before the first position lock. Missing positions
  -- mean zero availability; do not fabricate inventory rows for demand.
  FOR item_product IN SELECT DISTINCT u.id FROM pg_catalog.unnest(physical_products) AS u(id) ORDER BY u.id LOOP
    SELECT x.* INTO inv FROM public.product_inventory x
      WHERE x.enterprise_id=eid AND x.product_id=item_product FOR UPDATE;
    IF FOUND AND (inv.reserved_balance<0 OR inv.reserved_balance>inv.balance
       OR inv.reserved_balance IS DISTINCT FROM (SELECT COALESCE(sum(r.quantity),0)
         FROM public.order_stock_reservations r WHERE r.enterprise_id=eid
           AND r.product_id=item_product AND r.state='active')) THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='P0001';
    END IF;
    IF NOT FOUND AND EXISTS(SELECT 1 FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.product_id=item_product AND r.state='active') THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='P0001';
    END IF;
    SELECT COALESCE(sum(x.quantity),0) INTO group_quantity
      FROM pg_catalog.unnest(item_values) AS x
      WHERE x.product_id=item_product AND x.fulfillment_mode='stock';
    IF group_quantity>COALESCE(inv.balance-inv.reserved_balance,0) THEN
      shortage_products:=pg_catalog.array_append(shortage_products,item_product);
    END IF;
  END LOOP;
  -- Finalize snapshots only after product locks. Explicit make_to_order stays demand;
  -- stock lines are all-or-none per product (not a line-order priority policy).
  FOR item_index IN 1..pg_catalog.array_length(item_values,1) LOOP
    normalized:=item_values[item_index];
    IF normalized.origin='catalog' THEN
      SELECT p.* INTO product_row FROM public.products p
        WHERE p.enterprise_id=eid AND p.id=normalized.product_id;
      normalized.product_name_snapshot:=product_row.name;
      normalized.product_description_snapshot:=product_row.description;
    END IF;
    IF normalized.product_name_snapshot IS NULL
       OR pg_catalog.btrim(normalized.product_name_snapshot)<>normalized.product_name_snapshot
       OR pg_catalog.length(normalized.product_name_snapshot) NOT BETWEEN 1 AND 255
       OR pg_catalog.length(normalized.product_description_snapshot)>3000 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    IF normalized.fulfillment_mode='stock' AND normalized.product_id=ANY(shortage_products) THEN
      normalized.fulfillment_mode:='make_to_order';
    END IF;
    item_values[item_index]:=normalized;
  END LOOP;
  discount_value:=CASE WHEN p_discount_type='fixed' THEN LEAST(discount_input_value,subtotal_value)
                       ELSE pg_catalog.round(subtotal_value*discount_input_value/100,2) END;
  total_value:=subtotal_value-discount_value+shipping_value;
  IF total_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;

  -- Re-resolve plan after waiting; global plan-management lock remains held.
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='free' AND NOT (plan.access_state IN ('free','expired','cancelled')) THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  ELSIF plan.effective_plan='intermediate' AND plan.access_state<>'paid' THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  IF plan.effective_plan='free' THEN
    IF (SELECT count(*) FROM public.orders o WHERE o.enterprise_id=eid)>=3 THEN
      RAISE EXCEPTION 'plan_limit_reached' USING ERRCODE='P0001';
    END IF;
  ELSIF plan.effective_plan NOT IN ('intermediate','advanced') THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;

  -- Lock the pre-provisioned tenant counter. C.1 never derives a number from
  -- MAX()+1; a missing counter requires explicit reviewed bootstrap.
  SELECT counter_entry.* INTO counter_row FROM public.order_number_counters counter_entry
   WHERE counter_entry.enterprise_id=eid FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.orders o WHERE o.enterprise_id=eid) THEN
      RAISE EXCEPTION 'order_number_counter_bootstrap_required' USING ERRCODE='P0001';
    END IF;
    INSERT INTO public.order_number_counters(enterprise_id,next_number) VALUES(eid,1)
      ON CONFLICT(enterprise_id) DO NOTHING;
    SELECT counter_entry.* INTO counter_row FROM public.order_number_counters counter_entry WHERE counter_entry.enterprise_id=eid FOR UPDATE;
  END IF;
  number_value:=counter_row.next_number;
  IF number_value IS NULL OR number_value>9007199254740991
     OR EXISTS(SELECT 1 FROM public.orders o WHERE o.enterprise_id=eid AND o.display_number=number_value) THEN
    RAISE EXCEPTION 'order_number_counter_drift' USING ERRCODE='P0001';
  END IF;
  IF number_value<9007199254740991 THEN
    UPDATE public.order_number_counters counter_entry SET next_number=number_value+1
     WHERE counter_entry.enterprise_id=eid;
  END IF;

  INSERT INTO public.orders(id,enterprise_id,display_number,created_by,buyer_name,buyer_phone,buyer_email,
      buyer_address,notes,subtotal,discount_type,discount_input,discount_base,discount_amount,
      shipping_amount,total_amount,version)
  VALUES(order_uuid,eid,number_value,actor,p_buyer_name,p_buyer_phone,p_buyer_email,p_buyer_address,
      p_notes,subtotal_value,p_discount_type,discount_input_value,subtotal_value,discount_value,
      shipping_value,total_value,0);

  -- Fresh order/item UUIDs are transaction-private until commit. No existing order
  -- lock is acquired after product locks; allocation locks its existing order first.
  FOREACH normalized IN ARRAY item_values LOOP
    INSERT INTO public.order_items(id,enterprise_id,order_id,line_number,origin,product_id,
      product_name_snapshot,product_description_snapshot,quantity,unit_price,line_subtotal,fulfillment_mode)
    VALUES(normalized.id,eid,order_uuid,normalized.line_number,normalized.origin,normalized.product_id,
      normalized.product_name_snapshot,normalized.product_description_snapshot,normalized.quantity,
      normalized.unit_price,normalized.line_subtotal,normalized.fulfillment_mode);
  END LOOP;
  -- Every required product/position lock is already held. One full reservation per
  -- stock item; B increments inventory version per item, never physical balance.
  FOREACH normalized IN ARRAY item_values LOOP
    IF normalized.fulfillment_mode='stock' THEN
      PERFORM private.reserve_order_item_stock(eid,order_uuid,normalized.id,normalized.product_id,normalized.quantity);
    END IF;
  END LOOP;

  INSERT INTO public.order_events(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,metadata)
  VALUES(eid,order_uuid,actor,'created',NULL,'em_conversao',0,
    pg_catalog.jsonb_build_object('item_count',pg_catalog.jsonb_array_length(p_items)));
  result_value:=pg_catalog.jsonb_build_object('status','created','order_id',order_uuid,
    'display_number',number_value,'version',0,'subtotal',subtotal_value,'discount_amount',discount_value,
    'shipping_amount',shipping_value,'total_amount',total_value);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
  VALUES(eid,actor,'create',p_attempt_id,hash_value,order_uuid,result_value);
  RETURN QUERY SELECT 'created',order_uuid,number_value,0::bigint,subtotal_value,discount_value,shipping_value,total_value;
END $$;

ALTER FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) SET search_path='';
REVOKE ALL ON FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) TO authenticated;
COMMIT;

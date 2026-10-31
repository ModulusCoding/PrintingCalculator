-- M7.2-C.2c: block full replacement of persisted physical items. REVIEW ONLY.
-- Incremental replacement of update_order only; C.1 remains unchanged.
-- Replay precedes plan/state/version/history/mode checks for a new mutation.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'orders_c2_dependency_missing';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.update_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
  p_buyer_name text,p_buyer_phone text,p_buyer_email text,p_buyer_address text,p_notes text,
  p_items jsonb,p_discount_type text,p_discount_input text,p_shipping_amount text
)
RETURNS TABLE(status text,order_id uuid,display_number bigint,version bigint,
              subtotal numeric,discount_amount numeric,shipping_amount numeric,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; plan record; order_row public.orders%ROWTYPE; receipt private.order_operation_receipts%ROWTYPE;
  payload jsonb; hash_value text; item jsonb; subtotal_value numeric:=0;
  discount_input_value numeric; discount_value numeric; shipping_value numeric; total_value numeric;
  quantity_value bigint; unit_value numeric; line_value numeric; line_no integer:=0;
  origin_value text; item_product uuid; mode_value text; item_name text; item_description text;
  product_ids uuid[]:='{}'::uuid[]; product_row public.products%ROWTYPE; result_value jsonb;
  item_reservation record; item_values jsonb[]:='{}'::jsonb[];
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0
     OR p_buyer_name IS NULL OR pg_catalog.btrim(p_buyer_name)<>p_buyer_name
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
  IF p_discount_type='percent' AND discount_input_value>100 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL OR c.user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR NOT private.can_access_enterprise(eid,'sales.write') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;

  payload:=pg_catalog.jsonb_build_object('order_id',p_order_id,'expected_version',p_expected_version,
    'buyer_name',p_buyer_name,'buyer_phone',p_buyer_phone,'buyer_email',p_buyer_email,
    'buyer_address',p_buyer_address,'notes',p_notes,'items',p_items,
    'discount_type',p_discount_type,'discount_input',p_discount_input,'shipping_amount',p_shipping_amount);
  hash_value:=private.orders_c1_payload_hash(payload);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:update:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=actor AND r.command_name='update' AND r.attempt_id=p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'update' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id
       OR NOT private.orders_c1_receipt_result_valid(receipt.result,receipt.enterprise_id,receipt.actor_id,receipt.command_name,receipt.attempt_id,receipt.order_id) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT receipt.result->>'status',(receipt.result->>'order_id')::uuid,
      (receipt.result->>'display_number')::bigint,(receipt.result->>'version')::bigint,
      (receipt.result->>'subtotal')::numeric,(receipt.result->>'discount_amount')::numeric,
      (receipt.result->>'shipping_amount')::numeric,(receipt.result->>'total_amount')::numeric;
    RETURN;
  END IF;
  -- Plan mutations use the same global management lock, retained before identity.
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='free' AND NOT (plan.access_state IN ('free','expired','cancelled')) THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='intermediate' AND plan.access_state<>'paid' THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan NOT IN ('free','intermediate','advanced') THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  SELECT o.* INTO order_row FROM public.orders o WHERE o.enterprise_id=eid AND o.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF order_row.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF order_row.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF order_row.operational_status IN ('entregue','cancelado') THEN RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001'; END IF;
  -- Reject history before the physical-mode guard, retaining reservation errors.
  -- The order lock serializes item/reservation writers. This rejection-only query
  -- acquires no reservation row lock before products/positions (global protocol).
  -- No stock writer can pass this branch or erase its historical item references.
  FOR item_reservation IN SELECT r.id,r.state FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id
  LOOP
    IF item_reservation.state='active' THEN
      RAISE EXCEPTION 'active_reservation_edit_unsupported' USING ERRCODE='P0001';
    END IF;
    RAISE EXCEPTION 'reservation_history_edit_unsupported' USING ERRCODE='P0001';
  END LOOP;

  -- Inspect persisted modes, never the replacement payload, under the order lock.
  IF EXISTS(SELECT 1 FROM public.order_items oi
    WHERE oi.enterprise_id=eid AND oi.order_id=p_order_id
      AND oi.fulfillment_mode IN ('stock','make_to_order')) THEN
    RAISE EXCEPTION 'physical_order_edit_unsupported' USING ERRCODE='P0001';
  END IF;

  FOR item IN SELECT x.value FROM pg_catalog.jsonb_array_elements(p_items) WITH ORDINALITY AS x(value,ordinality) ORDER BY x.ordinality LOOP
    IF pg_catalog.jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    IF item->>'fulfillment_mode' IS DISTINCT FROM 'untracked' THEN RAISE EXCEPTION 'stock_integration_unavailable' USING ERRCODE='P0001'; END IF;
    origin_value:=item->>'origin';
    IF (item ? 'product_id' AND item->'product_id'<>'null'::jsonb AND pg_catalog.jsonb_typeof(item->'product_id')<>'string')
       OR (item ? 'origin' AND pg_catalog.jsonb_typeof(item->'origin')<>'string')
       OR (item ? 'name' AND pg_catalog.jsonb_typeof(item->'name')<>'string')
       OR (item ? 'description' AND item->'description'<>'null'::jsonb AND pg_catalog.jsonb_typeof(item->'description')<>'string') THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    item_product:=CASE WHEN item ? 'product_id' AND item->'product_id'<>'null'::jsonb
                       THEN private.orders_c1_safe_uuid(item->>'product_id') ELSE NULL END;
    IF origin_value IS NULL OR origin_value NOT IN ('catalog','custom') OR (origin_value='catalog' AND item_product IS NULL) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    quantity_value:=private.orders_c1_safe_quantity(item->>'quantity');
    unit_value:=private.orders_c1_decimal(item->>'unit_price',1000000,2);
    item_name:=item->>'name'; item_description:=item->>'description';
    IF item_name IS NULL OR pg_catalog.btrim(item_name)<>item_name OR pg_catalog.length(item_name) NOT BETWEEN 1 AND 255
       OR (item_description IS NOT NULL AND pg_catalog.length(item_description)>3000) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    IF item_product IS NOT NULL THEN product_ids:=array_append(product_ids,item_product); END IF;
    line_value:=quantity_value::numeric*unit_value;
    IF line_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    subtotal_value:=subtotal_value+line_value;
    IF subtotal_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
    item_values:=pg_catalog.array_append(item_values,pg_catalog.jsonb_build_object(
      'origin',origin_value,'product_id',item_product,'name',item_name,'description',item_description,
      'quantity',quantity_value,'unit_price',unit_value,'line_subtotal',line_value,'fulfillment_mode','untracked'));
  END LOOP;
  FOR item_product IN SELECT DISTINCT u.product_id FROM pg_catalog.unnest(product_ids) AS u(product_id) WHERE u.product_id IS NOT NULL ORDER BY u.product_id LOOP
    SELECT p.* INTO product_row FROM public.products p WHERE p.enterprise_id=eid AND p.id=item_product FOR UPDATE;
    IF NOT FOUND OR NOT product_row.active OR product_row.deleted_at IS NOT NULL OR NOT private.stage6b_product_visible(eid,item_product) THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  discount_value:=CASE WHEN p_discount_type='fixed' THEN LEAST(discount_input_value,subtotal_value)
                       ELSE pg_catalog.round(subtotal_value*discount_input_value/100,2) END;
  total_value:=subtotal_value-discount_value+shipping_value;
  IF total_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;

  -- Reservation rows of any state were rejected above, so item replacement is safe.
  -- Never delete reservations or rely on cascading FK behavior.
  DELETE FROM public.order_items oi WHERE oi.enterprise_id=eid AND oi.order_id=p_order_id;
  line_no:=0;
  FOREACH item IN ARRAY item_values LOOP
    line_no:=line_no+1;
    origin_value:=item->>'origin'; item_product:=NULLIF(item->>'product_id','')::uuid;
    quantity_value:=(item->>'quantity')::bigint; unit_value:=(item->>'unit_price')::numeric;
    line_value:=(item->>'line_subtotal')::numeric;
    item_name:=item->>'name'; item_description:=item->>'description';
    IF item_product IS NOT NULL AND origin_value='catalog' THEN
      SELECT p.* INTO product_row FROM public.products p WHERE p.enterprise_id=eid AND p.id=item_product FOR UPDATE;
      item_name:=product_row.name; item_description:=product_row.description;
    END IF;
    INSERT INTO public.order_items(enterprise_id,order_id,line_number,origin,product_id,product_name_snapshot,
      product_description_snapshot,quantity,unit_price,line_subtotal,fulfillment_mode)
    VALUES(eid,p_order_id,line_no,origin_value,item_product,item_name,item_description,quantity_value,unit_value,
      line_value,'untracked');
  END LOOP;
  UPDATE public.orders o SET buyer_name=p_buyer_name,buyer_phone=p_buyer_phone,buyer_email=p_buyer_email,
    buyer_address=p_buyer_address,notes=p_notes,subtotal=subtotal_value,discount_type=p_discount_type,
    discount_input=discount_input_value,discount_base=subtotal_value,discount_amount=discount_value,
    shipping_amount=shipping_value,total_amount=total_value,version=o.version+1
    WHERE o.enterprise_id=eid AND o.id=p_order_id RETURNING * INTO order_row;
  INSERT INTO public.order_events(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,metadata)
  VALUES(eid,p_order_id,actor,'updated',order_row.operational_status,order_row.operational_status,
    order_row.version,pg_catalog.jsonb_build_object('item_count',pg_catalog.jsonb_array_length(p_items)));
  result_value:=pg_catalog.jsonb_build_object('status','updated','order_id',p_order_id,
    'display_number',order_row.display_number,'version',order_row.version,'subtotal',subtotal_value,
    'discount_amount',discount_value,'shipping_amount',shipping_value,'total_amount',total_value);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
  VALUES(eid,actor,'update',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'updated',p_order_id,order_row.display_number,order_row.version,
    subtotal_value,discount_value,shipping_value,total_value;
END $$;

ALTER FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) SET search_path='';
REVOKE ALL ON FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) TO authenticated;
COMMIT;

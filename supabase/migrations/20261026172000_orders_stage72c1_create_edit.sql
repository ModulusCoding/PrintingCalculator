-- M7.2-C.1: transactional order creation and commercial editing.
-- NOT APPLIED. Reservation/stock integration is intentionally disabled here:
-- target B/B.1 catalog and concurrent product-lock protocol are not independently
-- verified. This candidate accepts only fulfillment_mode='untracked'.
-- The project document "Modulus — Documento de Projeto | 2026" was not present in
-- this workspace; explicit C.1 requirements are treated as the limited decisions
-- approved for this stage. Operational transitions/payments remain out of scope.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_events') IS NULL
     OR to_regclass('public.order_number_counters') IS NULL
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regclass('public.enterprise_plan_access') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.resolve_enterprise_plan(uuid)') IS NULL
     OR to_regprocedure('public.order_events_forbid_mutation()') IS NULL
     OR to_regprocedure('public.orders_set_updated_at()') IS NULL
     OR to_regprocedure('public.order_reservations_validate_transition()') IS NULL
     OR to_regprocedure('private.stage6b_product_visible(uuid,uuid)') IS NULL
     OR to_regprocedure('private.orders_c1_safe_uuid(text)') IS NOT NULL
     OR to_regprocedure('private.orders_c1_safe_quantity(text)') IS NOT NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NOT NULL
     OR to_regprocedure('private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'orders_c1_dependencies_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.enterprise_plan_access'::regclass
      AND attname='effective_plan' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.orders'::regclass AND attname='archived_at' AND NOT attisdropped)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.order_items'::regclass AND attname='fulfillment_mode' AND atttypid='text'::regtype AND NOT attisdropped)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.orders'::regclass AND attname='version' AND atttypid='bigint'::regtype AND NOT attisdropped)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='private.order_operation_receipts'::regclass AND attname='payload_hash' AND atttypid='text'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'orders_c1_schema_mismatch';
  END IF;
END;
$preflight$;

-- Exact decimal parser: accepts canonical decimal strings, rejects exponent,
-- whitespace, NaN/infinity, negative values, excess scale and out-of-contract range.
CREATE FUNCTION private.orders_c1_decimal(p_text text,p_max numeric,p_scale integer DEFAULT 2)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE n numeric;
BEGIN
  IF p_text IS NULL OR p_max IS NULL OR p_scale NOT BETWEEN 0 AND 2
     OR p_text !~ ('^(0|[1-9][0-9]*)(\.[0-9]{1,' || p_scale::text || '})?$') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  n:=p_text::numeric;
  IF n<0 OR n>p_max OR pg_catalog.scale(n)>p_scale THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  RETURN n;
EXCEPTION WHEN numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;

CREATE FUNCTION private.orders_c1_safe_uuid(p_text text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v uuid;
BEGIN
  IF p_text IS NULL OR p_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  v:=p_text::uuid;
  RETURN v;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;

CREATE FUNCTION private.orders_c1_safe_quantity(p_text text)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v bigint;
BEGIN
  IF p_text IS NULL OR p_text !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  v:=p_text::bigint;
  IF v NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  RETURN v;
EXCEPTION WHEN numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
END $$;

CREATE FUNCTION private.orders_c1_receipt_result_valid(
  p_result jsonb,p_enterprise_id uuid,p_actor_id uuid,p_command text,p_attempt_id uuid,p_order_id uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order_id uuid; v_status text; v_number bigint; v_version bigint;
        v_subtotal numeric; v_discount numeric; v_shipping numeric; v_total numeric; v_order public.orders%ROWTYPE;
BEGIN
  IF p_result IS NULL OR pg_catalog.jsonb_typeof(p_result)<>'object' OR p_order_id IS NULL
     OR p_enterprise_id IS NULL OR p_actor_id IS NULL OR p_command IS NULL OR p_command NOT IN ('create','update') OR p_attempt_id IS NULL
     OR NOT (p_result ?& ARRAY['status','order_id','display_number','version','subtotal','discount_amount','shipping_amount','total_amount']) THEN RETURN false; END IF;
  IF pg_catalog.jsonb_typeof(p_result->'status')<>'string' OR pg_catalog.jsonb_typeof(p_result->'order_id')<>'string'
     OR pg_catalog.jsonb_typeof(p_result->'display_number') NOT IN ('number','string')
     OR pg_catalog.jsonb_typeof(p_result->'version') NOT IN ('number','string')
     OR pg_catalog.jsonb_typeof(p_result->'subtotal') NOT IN ('number','string')
     OR pg_catalog.jsonb_typeof(p_result->'discount_amount') NOT IN ('number','string')
     OR pg_catalog.jsonb_typeof(p_result->'shipping_amount') NOT IN ('number','string')
     OR pg_catalog.jsonb_typeof(p_result->'total_amount') NOT IN ('number','string') THEN RETURN false; END IF;
  BEGIN
    v_order_id:=(p_result->>'order_id')::uuid; v_status:=p_result->>'status';
    v_number:=(p_result->>'display_number')::bigint; v_version:=(p_result->>'version')::bigint;
    v_subtotal:=(p_result->>'subtotal')::numeric; v_discount:=(p_result->>'discount_amount')::numeric;
    v_shipping:=(p_result->>'shipping_amount')::numeric; v_total:=(p_result->>'total_amount')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false; END;
  IF v_order_id IS DISTINCT FROM p_order_id
     OR v_status IS DISTINCT FROM (CASE WHEN p_command = 'create' THEN 'created' ELSE 'updated' END) THEN
    RETURN false;
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.enterprise_id=p_enterprise_id AND o.id=p_order_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Replays retain the historical financial snapshot even after later edits.
  -- Check snapshot arithmetic, not equality against today's order totals.
  IF (p_command='create' AND (v_order.created_by IS DISTINCT FROM p_actor_id OR v_version<>0))
     OR v_order.display_number IS DISTINCT FROM v_number
     OR v_version IS NULL OR v_version<0 OR v_version>v_order.version
     OR v_number IS NULL OR v_number<1
     OR v_subtotal IS NULL OR v_discount IS NULL OR v_shipping IS NULL OR v_total IS NULL
     OR v_subtotal<0 OR v_discount<0 OR v_shipping<0 OR v_total<0
     OR v_subtotal>999999999999.99 OR v_discount>999999999999.99
     OR v_shipping>999999999999.99 OR v_total>999999999999.99
     OR v_discount>v_subtotal
     OR v_total<>(v_subtotal-v_discount+v_shipping)
     OR pg_catalog.scale(v_subtotal)>2 OR pg_catalog.scale(v_discount)>2
     OR pg_catalog.scale(v_shipping)>2 OR pg_catalog.scale(v_total)>2 THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION private.orders_c1_payload_hash(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),'hex')
$$;

CREATE FUNCTION public.create_order(
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
  item_values jsonb[]:='{}'::jsonb[];
  product_row public.products%ROWTYPE; product_ids uuid[]:='{}'::uuid[];
  subtotal_value numeric:=0; discount_value numeric; discount_input_value numeric;
  shipping_value numeric; total_value numeric; line_value numeric; unit_value numeric;
  quantity_value bigint; item_name text; item_description text; origin_value text;
  item_product uuid; mode_value text;
  result_value jsonb; hash_value text; receipt_replay boolean:=false;
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
    IF item->>'fulfillment_mode' IS DISTINCT FROM 'untracked' THEN
      RAISE EXCEPTION 'stock_integration_unavailable' USING ERRCODE='P0001';
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
    item_values:=pg_catalog.array_append(item_values,pg_catalog.jsonb_build_object(
      'origin',origin_value,'product_id',item_product,'name',item_name,'description',item_description,
      'quantity',quantity_value,'unit_price',unit_value,'line_subtotal',line_value,'fulfillment_mode','untracked'));
  END LOOP;

  -- Lock distinct products in UUID order; catalog snapshots come from locked rows.
  -- All later C commands must acquire quota before this product-lock phase.
  FOR item_product IN SELECT DISTINCT u.product_id FROM pg_catalog.unnest(product_ids) AS u(product_id) WHERE u.product_id IS NOT NULL ORDER BY u.product_id LOOP
    SELECT p.* INTO product_row FROM public.products p
     WHERE p.enterprise_id=eid AND p.id=item_product FOR UPDATE;
    IF NOT FOUND OR NOT product_row.active OR product_row.deleted_at IS NOT NULL
       OR NOT private.stage6b_product_visible(eid,item_product) THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
  END LOOP;

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
  SELECT c.* INTO counter_row FROM public.order_number_counters c
   WHERE c.enterprise_id=eid FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.orders o WHERE o.enterprise_id=eid) THEN
      RAISE EXCEPTION 'order_number_counter_bootstrap_required' USING ERRCODE='P0001';
    END IF;
    INSERT INTO public.order_number_counters(enterprise_id,next_number) VALUES(eid,1)
      ON CONFLICT(enterprise_id) DO NOTHING;
    SELECT c.* INTO counter_row FROM public.order_number_counters c WHERE c.enterprise_id=eid FOR UPDATE;
  END IF;
  number_value:=counter_row.next_number;
  IF number_value IS NULL OR number_value>9007199254740991
     OR EXISTS(SELECT 1 FROM public.orders o WHERE o.enterprise_id=eid AND o.display_number=number_value) THEN
    RAISE EXCEPTION 'order_number_counter_drift' USING ERRCODE='P0001';
  END IF;
  IF number_value<9007199254740991 THEN
    UPDATE public.order_number_counters c SET next_number=number_value+1
     WHERE c.enterprise_id=eid;
  END IF;

  discount_value:=CASE WHEN p_discount_type='fixed' THEN LEAST(discount_input_value,subtotal_value)
                       ELSE pg_catalog.round(subtotal_value*discount_input_value/100,2) END;
  total_value:=subtotal_value-discount_value+shipping_value;
  IF total_value>999999999999.99 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;

  INSERT INTO public.orders(id,enterprise_id,display_number,created_by,buyer_name,buyer_phone,buyer_email,
      buyer_address,notes,subtotal,discount_type,discount_input,discount_base,discount_amount,
      shipping_amount,total_amount,version)
  VALUES(order_uuid,eid,number_value,actor,p_buyer_name,p_buyer_phone,p_buyer_email,p_buyer_address,
      p_notes,subtotal_value,p_discount_type,discount_input_value,subtotal_value,discount_value,
      shipping_value,total_value,0);

  line_no:=0;
  FOREACH item IN ARRAY item_values LOOP
    line_no:=line_no+1;
    origin_value:=item->>'origin';
    item_product:=NULLIF(item->>'product_id','')::uuid;
    quantity_value:=(item->>'quantity')::bigint;
    unit_value:=(item->>'unit_price')::numeric;
    line_value:=(item->>'line_subtotal')::numeric;
    item_name:=item->>'name'; item_description:=item->>'description'; mode_value:=item->>'fulfillment_mode';
    IF item_product IS NOT NULL AND origin_value='catalog' THEN
      SELECT p.* INTO product_row FROM public.products p WHERE p.enterprise_id=eid AND p.id=item_product;
      item_name:=product_row.name; item_description:=product_row.description;
    END IF;
    INSERT INTO public.order_items(enterprise_id,order_id,line_number,origin,product_id,
      product_name_snapshot,product_description_snapshot,quantity,unit_price,line_subtotal,fulfillment_mode)
    VALUES(eid,order_uuid,line_no,origin_value,item_product,item_name,item_description,
      quantity_value,unit_value,line_value,mode_value);
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

CREATE FUNCTION public.update_order(
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
  SELECT o.* INTO order_row FROM public.orders o WHERE o.enterprise_id=eid AND o.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  -- Plan mutations use the same global management lock, retained before identity.
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='free' AND NOT (plan.access_state IN ('free','expired','cancelled')) THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan='intermediate' AND plan.access_state<>'paid' THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  IF plan.effective_plan NOT IN ('free','intermediate','advanced') THEN RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501'; END IF;
  IF order_row.operational_status IN ('entregue','cancelado') THEN RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001'; END IF;
  IF order_row.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF order_row.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  -- Preserve every historical reservation FK to its order_item_id. Until C.2
  -- defines in-place line matching/update semantics, refuse any order with history.
  -- Lock reservation rows after order lock; historical item FKs remain stable.
  FOR item_reservation IN SELECT r.id,r.state FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id FOR UPDATE
  LOOP
    IF item_reservation.state='active' THEN
      RAISE EXCEPTION 'active_reservation_edit_unsupported' USING ERRCODE='P0001';
    END IF;
    RAISE EXCEPTION 'reservation_history_edit_unsupported' USING ERRCODE='P0001';
  END LOOP;

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

ALTER FUNCTION private.orders_c1_decimal(text,numeric,integer) OWNER TO postgres;
ALTER FUNCTION private.orders_c1_decimal(text,numeric,integer) SET search_path='';
ALTER FUNCTION private.orders_c1_safe_uuid(text) OWNER TO postgres;
ALTER FUNCTION private.orders_c1_safe_uuid(text) SET search_path='';
ALTER FUNCTION private.orders_c1_safe_quantity(text) OWNER TO postgres;
ALTER FUNCTION private.orders_c1_safe_quantity(text) SET search_path='';
ALTER FUNCTION private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid) SET search_path='';
ALTER FUNCTION private.orders_c1_payload_hash(jsonb) OWNER TO postgres;
ALTER FUNCTION private.orders_c1_payload_hash(jsonb) SET search_path='';
ALTER FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) SET search_path='';
ALTER FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) SET search_path='';
REVOKE ALL ON FUNCTION private.orders_c1_decimal(text,numeric,integer), private.orders_c1_safe_uuid(text), private.orders_c1_safe_quantity(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.orders_c1_payload_hash(jsonb), private.orders_c1_receipt_result_valid(jsonb,uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text) TO authenticated;

COMMIT;

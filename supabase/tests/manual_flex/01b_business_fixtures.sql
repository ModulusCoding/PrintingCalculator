-- Run AFTER 01_fixture_setup.sql, once, in the same verified disposable project.
-- SQL editor ADMIN connection; stop on first error; run the WHOLE transaction.
-- Replace explicit run/project tokens. No service_role, application DML or mocks.
-- Registry payloads contain the EXACT raw p_* arguments passed to each RPC;
-- generated attempts are retained so later tests can replay the very same call.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT flex_manual_test.assert_true(NOT EXISTS(SELECT 1 FROM flex_manual_test.objects),
  'business fixtures already exist: do not rerun or clear the registry');
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;

DO $products$
DECLARE label_value text; args jsonb; answer jsonb; run_value uuid;
BEGIN
  SELECT run_id INTO STRICT run_value FROM flex_manual_test.config;
  PERFORM flex_manual_test.assert_true(
    (SELECT state='business_ready' AND role='owner' FROM public.get_my_access_context()),'A owner business context');
  PERFORM flex_manual_test.assert_true(
    (SELECT effective_plan='intermediate' AND access_state='paid' FROM public.get_my_plan_access()),'A paid intermediate');
  FOREACH label_value IN ARRAY ARRAY['stock_product','plain_product'] LOOP
    args:=jsonb_build_object('p_attempt_id',gen_random_uuid(),
      'p_name','FLEX '||run_value||' '||label_value,
      'p_description','Fictitious disposable manual fixture','p_price',10,'p_images','[]'::jsonb);
    SELECT to_jsonb(r) INTO STRICT answer FROM public.create_internal_product(
      (args->>'p_attempt_id')::uuid,args->>'p_name',args->>'p_description',
      (args->>'p_price')::numeric,args->'p_images') r;
    PERFORM flex_manual_test.assert_true(answer->>'status'='success' AND answer->>'product_id' IS NOT NULL,'create '||label_value);
    INSERT INTO flex_manual_test.objects VALUES(label_value,(answer->>'product_id')::uuid);
    INSERT INTO flex_manual_test.calls VALUES('create_'||label_value,'create_internal_product',args,answer);
  END LOOP;
  -- Fresh product has no inventory position: expected inventory version is zero.
  -- 100 units covers every reserved fixture, including duplicate product lines.
  args:=jsonb_build_object('p_attempt_id',gen_random_uuid(),
    'p_product_id',(SELECT id FROM flex_manual_test.objects WHERE label='stock_product'),
    'p_expected_version',0,'p_movement_type','entry','p_quantity',100,
    'p_counted_balance',NULL,'p_reason','FLEX manual opening stock '||run_value);
  SELECT to_jsonb(r) INTO STRICT answer FROM public.move_product_inventory(
    (args->>'p_attempt_id')::uuid,(args->>'p_product_id')::uuid,
    (args->>'p_expected_version')::bigint,args->>'p_movement_type',
    (args->>'p_quantity')::numeric,(args->>'p_counted_balance')::numeric,args->>'p_reason') r;
  PERFORM flex_manual_test.assert_true(answer->>'balance'='100','opening balance 100');
  INSERT INTO flex_manual_test.calls VALUES('opening_stock','move_product_inventory',args,answer);
  INSERT INTO flex_manual_test.objects VALUES('opening_stock_movement',(answer->>'movement_id')::uuid);
END $products$;

DO $orders$
DECLARE label_value text; stock_id uuid; plain_id uuid; lines jsonb; stock_line jsonb;
  custom_line jsonb; args jsonb; answer jsonb; run_value uuid;
BEGIN
  SELECT run_id INTO STRICT run_value FROM flex_manual_test.config;
  SELECT id INTO STRICT stock_id FROM flex_manual_test.objects WHERE label='stock_product';
  SELECT id INTO STRICT plain_id FROM flex_manual_test.objects WHERE label='plain_product';
  stock_line:=jsonb_build_object('origin','catalog','product_id',stock_id,
    'name','FLEX stock snapshot','description',NULL,'quantity',2,'unit_price','10.00','fulfillment_mode','stock');
  custom_line:=jsonb_build_object('origin','custom','product_id',NULL,
    'name','FLEX custom untracked','description',NULL,'quantity',1,'unit_price','7.00','fulfillment_mode','untracked');
  FOREACH label_value IN ARRAY ARRAY['cycle_a','cycle_b','mixed','untracked','reserved_cancel','transition','mto','finance'] LOOP
    lines:=CASE label_value
      WHEN 'mixed' THEN jsonb_build_array(stock_line,stock_line||jsonb_build_object('quantity',3),custom_line)
      WHEN 'untracked' THEN jsonb_build_array(jsonb_build_object('origin','catalog','product_id',plain_id,
        'name','FLEX plain snapshot','quantity',1,'unit_price','10.00','fulfillment_mode','untracked'))
      WHEN 'mto' THEN jsonb_build_array(stock_line||jsonb_build_object('fulfillment_mode','make_to_order'))
      WHEN 'finance' THEN jsonb_build_array(custom_line)
      ELSE jsonb_build_array(stock_line) END;
    args:=jsonb_build_object('p_attempt_id',gen_random_uuid(),
      'p_buyer_name','FLEX '||run_value||' '||label_value,
      'p_buyer_phone',NULL,'p_buyer_email',NULL,'p_buyer_address',NULL,
      'p_notes','Fictitious manual fixture: '||label_value,'p_items',lines,
      'p_discount_type','fixed','p_discount_input','0.00','p_shipping_amount','0.00');
    SELECT to_jsonb(r) INTO STRICT answer FROM public.create_order(
      (args->>'p_attempt_id')::uuid,args->>'p_buyer_name',args->>'p_buyer_phone',
      args->>'p_buyer_email',args->>'p_buyer_address',args->>'p_notes',args->'p_items',
      args->>'p_discount_type',args->>'p_discount_input',args->>'p_shipping_amount') r;
    PERFORM flex_manual_test.assert_true(answer->>'order_id' IS NOT NULL AND (answer->>'version')::bigint>=0,'create '||label_value);
    INSERT INTO flex_manual_test.objects VALUES(label_value,(answer->>'order_id')::uuid);
    INSERT INTO flex_manual_test.calls VALUES('create_'||label_value,'create_order',args,answer);
  END LOOP;
  -- mto remains deliberately uncovered even though stock is available. Later
  -- allocation tests must exercise the real allocate_order_stock RPC on this ID.
END $orders$;

-- No finance mutation here: finance starts unpaid for the financial test script.
-- Capture the official reader output, not an invented financial table snapshot.
INSERT INTO flex_manual_test.checkpoints(label,data)
SELECT 'finance_initial',to_jsonb(s) FROM public.get_order_financial_summary(
  (SELECT id FROM flex_manual_test.objects WHERE label='finance')) s;

RESET ROLE;
-- assert_run must run as admin, before switching to the other authenticated actor.
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT flex_manual_test.set_actor('owner_apprentice');
SET LOCAL ROLE authenticated;
DO $foreign$
DECLARE args jsonb; answer jsonb;
BEGIN
  PERFORM flex_manual_test.assert_true(
    (SELECT state='business_ready' AND role='owner' FROM public.get_my_access_context()),'B owner business context');
  PERFORM flex_manual_test.assert_true(
    (SELECT effective_plan='free' AND access_state='free' FROM public.get_my_plan_access()),'B apprentice is actual free plan');
  args:=jsonb_build_object('p_attempt_id',gen_random_uuid(),
    'p_buyer_name','FLEX foreign tenant fixture','p_buyer_phone',NULL,'p_buyer_email',NULL,
    'p_buyer_address',NULL,'p_notes','B only; A must never mutate/read this order',
    'p_items',jsonb_build_array(jsonb_build_object('origin','custom','product_id',NULL,
      'name','FLEX foreign untracked','quantity',1,'unit_price','10.00','fulfillment_mode','untracked')),
    'p_discount_type','fixed','p_discount_input','0.00','p_shipping_amount','0.00');
  SELECT to_jsonb(r) INTO STRICT answer FROM public.create_order(
    (args->>'p_attempt_id')::uuid,args->>'p_buyer_name',args->>'p_buyer_phone',
    args->>'p_buyer_email',args->>'p_buyer_address',args->>'p_notes',args->'p_items',
    args->>'p_discount_type',args->>'p_discount_input',args->>'p_shipping_amount') r;
  PERFORM flex_manual_test.assert_true(answer->>'order_id' IS NOT NULL,'create foreign B order');
  INSERT INTO flex_manual_test.objects VALUES('foreign_order',(answer->>'order_id')::uuid);
  INSERT INTO flex_manual_test.calls VALUES('create_foreign_order','create_order',args,answer);
END $foreign$;
RESET ROLE;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT flex_manual_test.assert_true((SELECT count(*)=9 FROM flex_manual_test.calls WHERE rpc='create_order'), 'nine real order fixtures');
COMMIT;

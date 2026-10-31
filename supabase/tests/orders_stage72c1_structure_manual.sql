-- M7.2-C.1 structural and compatibility assertions. NOT EXECUTED.
DO $test$
BEGIN
  IF to_regprocedure('public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'orders_c1_rpc_missing';
  END IF;
  IF has_function_privilege('anon','public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('service_role','public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('service_role','public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'orders_c1_unexpected_grants';
  END IF;
  IF NOT has_function_privilege('authenticated','public.create_order(uuid,text,text,text,text,text,jsonb,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.update_order(uuid,uuid,bigint,text,text,text,text,text,jsonb,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'orders_c1_authenticated_grant_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='create_order' AND p.prosecdef AND p.proowner='postgres'::regrole
        AND p.proconfig @> ARRAY['search_path=""'])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='update_order' AND p.prosecdef AND p.proowner='postgres'::regrole
        AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'orders_c1_security_definer_config_invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.order_events'::regclass AND NOT t.tgisinternal
      AND t.tgfoid='public.order_events_forbid_mutation()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.orders'::regclass AND NOT t.tgisinternal
      AND t.tgfoid='public.orders_set_updated_at()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.order_stock_reservations'::regclass AND NOT t.tgisinternal
      AND t.tgfoid='public.order_reservations_validate_transition()'::regprocedure) THEN
    RAISE EXCEPTION 'orders_c1_required_triggers_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.order_items'::regclass
      AND conname='order_items_order_fk' AND confdeltype='r')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.order_stock_reservations'::regclass
      AND conname='order_stock_reservations_order_item_fk' AND confdeltype='r')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.order_stock_reservations'::regclass
      AND conname='order_stock_reservations_item_product_fk' AND confdeltype='r') THEN
    RAISE EXCEPTION 'orders_c1_expected_restrict_fks_missing';
  END IF;
  IF (SELECT typtype FROM pg_catalog.pg_type WHERE oid='public.modulus_plan_code'::regtype)<>'e'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e WHERE e.enumtypid='public.modulus_plan_code'::regtype AND e.enumlabel='advanced')
     OR to_regprocedure('private.resolve_enterprise_plan(uuid)') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.stage6b_product_visible(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'orders_c1_plan_or_auth_contract_mismatch';
  END IF;
END;
$test$;

SELECT p.oid::regprocedure signature,p.proowner::regrole owner,p.proacl,p.proconfig
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('create_order','update_order') ORDER BY p.proname;

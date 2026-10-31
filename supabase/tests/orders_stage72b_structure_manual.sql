-- Static/catalog assertions after applying M7.2-B to a disposable reviewed DB.
-- Read-only; no fixtures or DDL/DML. Not executed in this work session.
DO $assert$
BEGIN
  IF to_regprocedure('private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)') IS NULL
    OR to_regprocedure('private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'reservation helper signature mismatch';
  END IF;
  IF has_function_privilege('anon','private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    OR has_function_privilege('authenticated','private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    OR has_function_privilege('service_role','private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)','EXECUTE')
    OR has_function_privilege('anon','private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)','EXECUTE')
    OR has_function_privilege('service_role','private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'API execute grant present on private helper';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.product_inventory'::regclass
    AND attname='reserved_balance' AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.product_inventory'::regclass
      AND conname='product_inventory_reserved_balance_check' AND contype='c') THEN
    RAISE EXCEPTION 'reserved aggregate missing';
  END IF;
  IF pg_get_viewdef('public.product_inventory_availability'::regclass,true) NOT ILIKE '%balance - reserved_balance%'
    THEN RAISE EXCEPTION 'available balance not derived'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.order_stock_settlements'::regclass
    AND conname='order_stock_settlements_reservation_unique' AND contype='u')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.order_stock_settlements'::regclass
    AND conname='order_stock_settlements_movement_unique' AND contype='u')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.order_stock_settlements'::regclass
    AND conname='order_stock_settlements_reservation_fk' AND contype='f')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.order_stock_settlements'::regclass
    AND conname='order_stock_settlements_movement_fk' AND contype='f') THEN
    RAISE EXCEPTION 'settlement FKs/uniques missing';
  END IF;
  IF has_table_privilege('anon','public.order_stock_settlements','SELECT')
    OR has_table_privilege('authenticated','public.order_stock_settlements','INSERT')
    OR has_table_privilege('service_role','public.order_stock_settlements','INSERT') THEN
    RAISE EXCEPTION 'unexpected settlement table privilege';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.order_stock_settlements'::regclass
    AND tgname='order_stock_settlements_immutable' AND NOT tgisinternal)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.order_items'::regclass
    AND tgname='stage72b_order_item_reservation_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'required triggers missing';
  END IF;
END;
$assert$;

-- Static signature checks for public RPC contract (must match known local contract).
DO $rpc$
BEGIN
  IF to_regprocedure('public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)') IS NULL
    OR to_regprocedure('public.set_internal_product_active(uuid,bigint,boolean)') IS NULL
    OR to_regprocedure('public.delete_internal_product(uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'public RPC signature missing';
  END IF;
END;
$rpc$;

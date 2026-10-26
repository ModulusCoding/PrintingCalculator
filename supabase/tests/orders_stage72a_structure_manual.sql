-- M7.2-A static structural regression assertions for manual review/execution.
-- This script is READ-ONLY: it inspects catalogs and raises on mismatches.
-- It does not apply the migration, create fixtures, or modify database objects/data.
-- Run only AFTER a separately reviewed migration in a disposable/development DB.
-- RLS is verified structurally (enabled, no policies, no API DML grants). This
-- does not prove behavior under authenticated/anon; role-level tests are pending.

DO $orders_stage72a_assertions$
DECLARE
  v_table text;
  v_expected_tables text[] := ARRAY[
    'public.orders',
    'public.order_number_counters',
    'public.order_items',
    'public.order_events',
    'public.order_payments',
    'public.order_stock_reservations',
    'private.order_operation_receipts'
  ];
  v_table_oid regclass;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY v_expected_tables LOOP
    v_table_oid := pg_catalog.to_regclass(v_table);
    IF v_table_oid IS NULL THEN
      RAISE EXCEPTION 'missing expected M7.2-A table: %', v_table;
    END IF;
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_catalog.pg_class c WHERE c.oid = v_table_oid;
    IF NOT v_rls THEN
      RAISE EXCEPTION 'RLS disabled on %', v_table;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname || '.' || p.tablename = v_table) THEN
      RAISE EXCEPTION 'unexpected policy on default-deny table %', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_roles r ON r.rolname IN ('anon', 'authenticated')
    CROSS JOIN LATERAL (VALUES ('SELECT', has_table_privilege(r.oid, c.oid, 'SELECT')),
                               ('INSERT', has_table_privilege(r.oid, c.oid, 'INSERT')),
                               ('UPDATE', has_table_privilege(r.oid, c.oid, 'UPDATE')),
                               ('DELETE', has_table_privilege(r.oid, c.oid, 'DELETE'))) p(privilege_name, granted)
    WHERE n.nspname IN ('public', 'private')
      AND c.relname IN ('orders', 'order_number_counters', 'order_items', 'order_events',
                        'order_payments', 'order_stock_reservations', 'order_operation_receipts')
      AND p.granted
  ) THEN
    RAISE EXCEPTION 'anon/authenticated has direct privilege on an M7.2-A table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.order_items'::regclass
      AND conname = 'order_items_order_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.order_stock_reservations'::regclass
      AND conname = 'order_stock_reservations_order_item_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.order_stock_reservations'::regclass
      AND conname = 'order_stock_reservations_item_product_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.order_payments'::regclass
      AND conname = 'order_payments_reversal_fk' AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'missing required tenant/order/item/product composite FK';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
    WHERE idx.relname = 'order_stock_reservations_one_active_item_idx'
      AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'missing partial unique active-reservation index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_discount_calculation_check') THEN
    RAISE EXCEPTION 'missing discount calculation check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.order_events'::regclass AND tgname = 'order_events_immutable' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.order_payments'::regclass AND tgname = 'order_payments_immutable' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.order_stock_reservations'::regclass AND tgname = 'order_stock_reservations_transition_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'missing append-only or reservation transition guard';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.order_stock_reservations'::regclass
      AND c.contype = 'f'
      AND c.confrelid IN ('public.product_inventory'::regclass,
                          'public.product_inventory_movements'::regclass)
  ) THEN
    RAISE EXCEPTION 'unexpected unverified inventory FK in M7.2-A';
  END IF;
END;
$orders_stage72a_assertions$;

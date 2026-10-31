// Dependency-free source checks ONLY. Not a PostgreSQL parser or execution test.
// Run from repository root: node supabase/tests/orders_stage72c2_source_checks.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
const creation = read('20261026173000_orders_stage72c2a_stock_creation.sql');
const allocation = read('20261026174000_orders_stage72c2b_stock_allocation.sql');
assert.equal((creation.match(/jsonb_array_elements\(p_items\)/g) || []).length, 1);
assert(creation.includes('item_values public.order_items[]'));
const persistence = creation.slice(
  creation.indexOf('  INSERT INTO public.orders'),
  creation.indexOf("  RETURN QUERY SELECT 'created'"),
);
assert(!/orders_c1_safe_|orders_c1_decimal|::uuid|::numeric|::bigint|item->/.test(persistence));
for (const sql of [creation, allocation]) {
  assert(!/UPDATE public.product_inventory|INSERT INTO public.product_inventory_movements|inventory.write/.test(sql));
  assert(sql.includes('sales.write'));
  assert(sql.includes('private.reserve_order_item_stock'));
  assert(sql.includes("SET search_path=''"));
  assert(sql.includes('FROM PUBLIC,anon,authenticated,service_role'));
  assert(sql.includes('TO authenticated'));
}
assert(creation.indexOf('SELECT p.* INTO product_row') < creation.indexOf('SELECT x.* INTO inv'));
assert(creation.indexOf('SELECT x.* INTO inv') < creation.indexOf('INSERT INTO public.orders'));
assert(allocation.indexOf('IF FOUND THEN') < allocation.indexOf('SELECT x.* INTO o'));
assert(allocation.indexOf('SELECT x.* INTO o') < allocation.indexOf('SELECT x.* INTO product'));
assert(allocation.indexOf('SELECT x.* INTO product') < allocation.indexOf('SELECT x.* INTO inv'));
assert(allocation.indexOf('SELECT x.* INTO inv') < allocation.indexOf('FOR reservation IN'));
assert(creation.includes("x.fulfillment_mode='stock'"));
assert(creation.includes('normalized.product_id=ANY(shortage_products)'));
assert(!/order_number_counters c\b/.test(creation));
assert(creation.includes('WHERE counter_entry.enterprise_id=eid'));
assert.equal((creation.match(/counter_entry\.enterprise_id=eid/g) || []).length, 3);
assert(allocation.includes("VALUES(eid,p_order_id,actor,'stock_allocated',NULL,NULL"));
const guard = read('20261026175000_orders_stage72c2c_physical_edit_guard.sql');
const c1 = read('20261026172000_orders_stage72c1_create_edit.sql');
assert.equal((guard.match(/CREATE OR REPLACE FUNCTION /g) || []).length, 1);
assert(guard.includes('CREATE OR REPLACE FUNCTION public.update_order('));
const ordered = [
  "'orders:update:'", 'IF FOUND THEN', 'RETURN QUERY SELECT receipt.result',
  'SELECT * INTO plan', 'SELECT o.* INTO order_row', 'order_row.version<>p_expected_version',
  "order_row.operational_status IN ('entregue','cancelado')", 'FOR item_reservation IN',
  "RAISE EXCEPTION 'active_reservation_edit_unsupported'", "RAISE EXCEPTION 'reservation_history_edit_unsupported'",
  "RAISE EXCEPTION 'physical_order_edit_unsupported'", 'FOR item IN SELECT x.value',
  'DELETE FROM public.order_items', 'INSERT INTO public.order_items', 'INSERT INTO public.order_events',
];
let previous = -1;
for (const marker of ordered) {
  const position = guard.indexOf(marker);
  assert(position > previous, `C2c validation order: ${marker}`);
  previous = position;
}
assert(guard.includes("oi.fulfillment_mode IN ('stock','make_to_order')"));
assert(guard.includes("'physical_order_edit_unsupported' USING ERRCODE='P0001'"));
assert(guard.includes('oi.enterprise_id=eid AND oi.order_id=p_order_id'));
const rejection = guard.slice(guard.indexOf('FOR item_reservation IN'), guard.indexOf('FOR item IN SELECT x.value'));
assert(!rejection.includes('FOR UPDATE'));
// Preserve C1 replay and entire commercial mutation tail byte-for-byte.
const c1Update = c1.slice(c1.indexOf('CREATE FUNCTION public.update_order('));
const replayEnd = (sql) => sql.slice(sql.indexOf('  payload:=pg_catalog.jsonb_build_object(\'order_id\''), sql.indexOf('  END IF;', sql.indexOf('    RETURN;')) + '  END IF;'.length);
assert.equal(replayEnd(guard), replayEnd(c1Update));
const tail = (sql) => sql.slice(sql.indexOf('  FOR item IN SELECT x.value'), sql.indexOf('END $$;', sql.indexOf('  FOR item IN SELECT x.value')));
assert.equal(tail(guard), tail(c1Update));
assert(guard.includes('FROM PUBLIC,anon,authenticated,service_role'));
assert(guard.includes('TO authenticated'));
console.log('PASS: C.2a/b/c targeted source assertions and C1 replay/commercial-tail equality. SQL syntax, execution, permissions and concurrency NOT validated.');

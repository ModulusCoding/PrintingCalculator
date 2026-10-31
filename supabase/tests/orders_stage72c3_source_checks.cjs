// Dependency-free SOURCE assertions only. Does not parse/execute PostgreSQL.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = path.join(__dirname, '../migrations/');
const sql = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/--[^\r\n]*/g, '');
const compat = sql('20261026175500_orders_stage72c3_event_uuid.sql');
assert.match(compat, /ADD COLUMN event_uuid uuid DEFAULT pg_catalog\.gen_random_uuid\(\) NOT NULL/i);
assert.match(compat, /ADD CONSTRAINT order_events_event_uuid_key UNIQUE\s*\(event_uuid\)/i);
assert(!/\b(?:DISABLE\s+TRIGGER|DROP\s+TRIGGER|session_replication_role)\b/i.test(compat), 'compat: immutable trigger must stay enabled');
assert(!/\bUPDATE\s+(?:ONLY\s+)?public\.order_events\b/i.test(compat), 'compat: backfill must be additive DDL, not event UPDATE');
assert(!/\b(?:DROP|ALTER)\s+COLUMN\s+id\b|DROP\s+CONSTRAINT|ADD\s+(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY/i.test(compat), 'compat: preserve bigint identity PK');
console.log('PASS source: additive event_uuid compatibility DDL');
const files = [
  ['20261026180000_orders_stage72c3a_transitions.sql', 'transition_order', 'uuid,uuid,bigint,text,text', 'transition', 'sales.write'],
  ['20261026181000_orders_stage72c3b_cancellation.sql', 'cancel_order', 'uuid,uuid,bigint,text', 'cancel', 'sales.delete'],
  ['20261026182000_orders_stage72c3c_reopening.sql', 'reopen_order', 'uuid,uuid,bigint,text', 'reopen', 'sales.write'],
  ['20261026183000_orders_stage72c3d_delivery.sql', 'deliver_order', 'uuid,uuid,bigint', 'deliver', 'sales.write'],
];
for (const [file, rpc, signature, command, permission] of files) {
  const s = fs.readFileSync(base + file, 'utf8');
  assert(!s.includes('orders_c3_blocked_event_identity_contract'), `${file}: BLOCKED draft; event identity decision required, not a completed implementation`);
  const compact = s.replace(/\s+/g, ' ');
  assert.match(s, new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${rpc}\\(`, 'i'));
  assert.match(compact, /RETURNS TABLE\s*\(\s*status text,\s*order_id uuid,\s*operational_status text,\s*version bigint,\s*event_id uuid\s*\)/i);
  assert.match(compact, /SECURITY DEFINER SET search_path\s*=\s*''/i);
  assert(s.includes(`ALTER FUNCTION public.${rpc}(${signature}) OWNER TO postgres`));
  assert(s.includes(`GRANT EXECUTE ON FUNCTION public.${rpc}(${signature}) TO authenticated`));
  assert.match(s, /REVOKE ALL ON FUNCTION .* FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role/i);
  assert(s.includes(permission));
  for (const marker of ['business_ready', 'modulus:enterprise-management:all-members', 'private.current_internal_user_id()', 'private.can_access_enterprise', 'private.orders_c1_payload_hash', 'private.order_operation_receipts', 'jsonb_typeof', 'idempotency_conflict', 'receipt_result_unavailable', 'version_conflict', 'version_limit_exceeded', 'FOR UPDATE', 'payload_hash', 'attempt_id']) assert(s.includes(marker), `${file}: ${marker}`);
  assert(s.indexOf('modulus:enterprise-management:all-members') < s.indexOf('SELECT * INTO c FROM public.get_my_access_context()'), `${file}: membership lock before runtime access-context lookup`);
  assert(s.indexOf('receipt_result_unavailable') < s.indexOf("RAISE EXCEPTION 'version_conflict'"));
  const body = sql(file);
  assert.match(body, /RETURNING\s+(?:[\w.]+\.)?event_uuid\s+INTO\s+(new_event|result_event)/i, `${file}: return persisted event_uuid`);
  assert.match(body, /\bevent_uuid\s*=\s*result_event\b/i, `${file}: replay must verify persisted event_uuid`);
  assert.match(body, /'event_id'\s*,\s*(?:new_event|result_event)\b/i, `${file}: receipt persists inserted UUID`);
  // Delivery may preallocate a UUID to link settlements, but must INSERT it and
  // read it back via RETURNING event_uuid (asserted above), never return only a synthetic ID.
  assert.match(body, new RegExp(`orders:${command}:.*?eid::text.*?actor::text.*?p_attempt_id::text`, 's'), `${file}: tenant/actor/attempt lock scope`);
  assert.match(body, /FROM public\.orders\s+\w+\s+WHERE[^;]*enterprise_id\s*=\s*eid[^;]*id\s*=\s*p_order_id\s+FOR UPDATE/i, `${file}: tenant-scoped order row lock`);
  assert(body.indexOf(`orders:${command}:`) < body.indexOf('INTO receipt'), `${file}: idempotency lock before receipt read`);
  assert(!/\b(?:DISABLE\s+TRIGGER|UPDATE\s+public\.order_events)\b/i.test(body), `${file}: preserve immutable events`);
  assert(!/UPDATE\s+public\.product_inventory\b/i.test(s), `${file}: duplicate inventory writer`);
  assert(!/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.order_payments\b/i.test(s));
  assert(!/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\b/i.test(s));
  console.log(`PASS source/security markers: ${command}`);
}
const read = i => fs.readFileSync(base + files[i][0], 'utf8');
// Exact textual matrix: reject extra/missing edges, including self/terminal edges.
// This checks source shape, not PostgreSQL evaluation or business authorization.
const transition = sql(files[0][0]);
const matrix = transition.match(/allowed\s*:=\s*CASE old_status([\s\S]*?)ELSE false END/i);
assert(matrix, 'transition: explicit default-deny matrix');
const actualEdges = [];
for (const arm of matrix[1].matchAll(/WHEN '([^']+)' THEN p_target_status\s*(?:=\s*'([^']+)'|IN\s*\(([^)]*)\))/g)) {
  for (const target of arm[2] ? [arm[2]] : [...arm[3].matchAll(/'([^']+)'/g)].map(m => m[1])) actualEdges.push(`${arm[1]}->${target}`);
}
assert.deepEqual(actualEdges.sort(), [
  'em_conversao->orcado', 'orcado->em_conversao', 'orcado->pago', 'orcado->modelando',
  'pago->orcado', 'pago->modelando', 'modelando->pago', 'modelando->orcado',
  'modelando->imprimindo', 'imprimindo->modelando',
].sort(), 'transition: exact approved edges');
const reasons = transition.match(/needs_reason\s*:=\s*\(old_status,p_target_status\) IN\s*\(([\s\S]*?)\);/i);
assert(reasons, 'transition: explicit reason matrix');
assert.deepEqual([...reasons[1].matchAll(/\('([^']+)','([^']+)'\)/g)].map(m => `${m[1]}->${m[2]}`).sort(), [
  'orcado->em_conversao', 'pago->orcado', 'modelando->pago', 'modelando->orcado',
  'imprimindo->modelando', 'orcado->modelando',
].sort(), 'transition: exact reason-required edges');
assert.match(transition, /needs_reason AND reason_value IS NULL/);
assert.match(transition, /reason_value:=pg_catalog\.btrim\(p_reason\)/);
assert.match(transition, /reason_value='' OR pg_catalog\.length\(reason_value\)>1000/);
for (const i of [1, 2]) {
  const source = sql(files[i][0]);
  assert.match(source, /p_reason IS NULL|reason_value IS NULL/, `${files[i][0]}: mandatory reason`);
  assert.match(source, /pg_catalog\.length\(reason_value\) NOT BETWEEN 1 AND 1000/, `${files[i][0]}: bounded trimmed reason`);
  assert.match(source, /pg_catalog\.btrim\(p_reason\)/);
  assert.match(source, /ORDER BY[^;]*FOR UPDATE/i, `${files[i][0]}: deterministic row lock ordering marker`);
}
assert(!read(0).includes('finalize_order_item_reservation'));
assert.match(read(1), /finalize_order_item_reservation\([^;]*'release'/s);
assert(!/INSERT INTO public\.(?:product_inventory_movements|order_stock_settlements)/i.test(read(1)));
assert.match(read(2), /reserve_order_item_stock\(/);
assert(read(2).includes('intermediate') && read(2).includes('paid'));
assert.match(sql(files[3][0]), /ORDER BY[^;]*FOR UPDATE/i, 'delivery: deterministic row lock ordering marker');
assert.match(read(3), /finalize_order_item_reservation\([^;]*'consume'/s);
assert.match(read(3), /INSERT INTO public\.product_inventory_movements/);
assert(read(3).includes('delivery_operation_id'));
const delivery = sql(files[3][0]);
assert.match(delivery, /s\.delivery_operation_id=result_event/);
assert.match(delivery, /z\.state='consumed'/);
assert.match(delivery, /m\.movement_type='exit'/);
assert.match(delivery, /m\.quantity=-s\.quantity/);
assert.match(delivery, /m\.actor_id=actor/);
assert.match(delivery, /m\.result_version=m\.request_expected_version\+1/);
assert(delivery.indexOf('RETURNING event_uuid INTO new_event') < delivery.indexOf("r.id,'consume',NULL"), 'delivery: persisted event identity precedes consumption');
assert.match(delivery, /consumed\.inventory_version-1,consumed\.quantity,NULL,consumed\.inventory_version/);
assert.match(delivery, /internal_attempt:=pg_catalog\.gen_random_uuid\(\)/);
console.log('PASS: C.3 textual assertions only. PostgreSQL syntax, execution, permissions, rollback and concurrency NOT validated.');

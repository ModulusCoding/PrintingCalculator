// SOURCE assertions only; no PostgreSQL parser/connection/application.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = path.join(__dirname, '../migrations');
const candidates = fs.readdirSync(dir).filter(n => /stage72c4.*\.sql$/i.test(n));
assert.deepEqual(candidates, ['20261026184000_orders_stage72c4_payments.sql'], 'exactly one C4 migration');
const raw = fs.readFileSync(path.join(dir, candidates[0]), 'utf8');
const s = raw.replace(/--[^\r\n]*/g, '');
assert.match(s, /^\s*BEGIN;/i);
assert.match(s, /COMMIT;\s*$/i);
assert(!/CREATE\s+TABLE/i.test(s), 'no parallel finance table');
assert(!/(?:DISABLE\s+TRIGGER|session_replication_role)/i.test(s));
assert(!/(?:UPDATE|DELETE FROM)\s+public\.order_payments\b/i.test(s), 'immutable ledger');
assert(!/(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(?:product_inventory|order_stock_reservations|order_stock_settlements)\b/i.test(s), 'no physical writes');
assert(!/SET\s+operational_status\s*=/i.test(s), 'no operational transitions');
assert(!/CREATE OR REPLACE FUNCTION public\.(?:update_order|cancel_order|deliver_order|transition_order|reopen_order)\b/i.test(s));
assert.match(s, /BEFORE UPDATE OF total_amount ON public\.orders/i);
assert.match(s, /CREATE UNIQUE INDEX[\s\S]*?reverses_payment_id[\s\S]*?WHERE[\s\S]*?'refund'/i);
for (const rpc of ['record_order_payment', 'reverse_order_payment', 'get_order_financial_summary', 'get_order_payment_history']) {
  assert.match(s, new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${rpc}\\(`, 'i'));
  assert.match(s, new RegExp(`'public\\.${rpc}\\([^']*\\)'`, 'i'), 'signature listed in security loop');
}
for (const text of ['business_ready', 'modulus:enterprise-management:all-members', 'sales.write', 'sales.delete', 'sales.read', 'private.can_access_enterprise', 'private.current_internal_user_id', 'orders_c1_decimal', 'orders_c1_payload_hash', 'record_payment', 'reverse_payment', 'payment_received', 'payment_refunded', 'receipt_result_unavailable', 'idempotency_conflict', 'version_conflict', 'version_limit_exceeded', 'cancelled_unreversed_amount', 'financial_status', 'RETURNING', 'event_uuid']) assert(s.includes(text), text);
assert.match(s, /SECURITY DEFINER SET search_path\s*=\s*''/i);
assert.match(s, /FOR UPDATE/i);
assert.match(s, /jsonb_typeof/);
// Every added function follows the same explicit definer/search_path/owner/ACL pattern.
const funcs = [...s.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+((?:public|private)\.[a-z0-9_]+)\s*\(/gi)].map(m => m[1]);
assert(funcs.length >= 5, 'four public endpoints plus private integrity/aggregate helpers');
assert.equal((s.match(/SECURITY DEFINER SET search_path\s*=\s*''/gi) || []).length, funcs.length, 'all functions hardened');
for (const name of funcs.filter(n => n.startsWith('private.'))) {
  const escaped = name.replace('.', '\\.');
  assert.match(s, new RegExp(`'${escaped}\\([^']*\\)'`, 'i'), 'private signature listed in security loop');
}
assert.match(s, /format\('ALTER FUNCTION %s OWNER TO postgres',f::regprocedure\)/);
assert.match(s, /format\('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f::regprocedure\)/);
assert.match(s, /IF is_public THEN[\s\S]*?GRANT EXECUTE ON FUNCTION %s TO authenticated/);
assert.match(s, /has_function_privilege\('authenticated',f,'EXECUTE'\) IS DISTINCT FROM is_public/);
assert.match(s, /9007199254740991/);
assert.match(s, /IF NEW\.total_amount<s\.net_received THEN/);
assert.match(s, /IF o\.operational_status='cancelado' THEN/);
assert.match(s, /IF amount_value>s\.pending_amount THEN/);
assert.match(s, /original\.amount IS DISTINCT FROM pay\.amount OR original\.method IS DISTINCT FROM pay\.method/);
assert.match(s, /ev\.metadata IS DISTINCT FROM pg_catalog\.jsonb_build_object/);
assert.match(s, /x\.event_uuid=result_event/);
assert.match(s, /x\.version>=result_version/);
assert.match(s, /'snapshot',result_value/);
assert.match(s, /'note',p_note/); // hash raw reason; ledger normalization must not collapse attempts
assert.match(s, /REVOKE INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE ON TABLE/);
assert.match(s, /has_table_privilege\('service_role',signature,'INSERT,UPDATE,DELETE,TRUNCATE'\)/);
assert.match(s, /RETURNING \* INTO ev/);
assert(s.indexOf('RETURN result_value;') < s.indexOf("RAISE EXCEPTION 'version_conflict'"), 'historical replay before fresh version validation');
assert.match(s, /\(x\.recorded_at,x\.id\)<\(p_before_recorded_at,p_before_payment_id\)/);
assert.match(s, /p_limit NOT BETWEEN 1 AND 100/);
assert.match(s, /CASE WHEN s\.received-s\.refunded=s\.total_amount THEN 'pago'/);
assert(!/\b(?:real|double precision|float[48]?)\b/i.test(s), 'no floating-point financial values');
console.log('PASS C4 source assertions: one migration, boundaries, API/security and financial markers.');
console.log('PostgreSQL syntax, effective ACLs, business flows, rollback and concurrency NOT validated.');

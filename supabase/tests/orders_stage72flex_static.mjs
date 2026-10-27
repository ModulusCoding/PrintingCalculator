// SOURCE-ONLY checks. No SQL parser, PostgreSQL connection, migration application,
// effective-ACL evaluation or business-flow execution. No third-party dependencies.
// Run: node --test supabase/tests/orders_stage72flex_static.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migration = new URL('../migrations/20261027120000_orders_stage72flex_delivery_cycles.sql', import.meta.url);
const bytes = readFileSync(migration); // Missing migration is a failure, never a skip.
const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
test('migration is valid UTF-8 without BOM or invisible formatting controls', () => {
  assert.doesNotMatch(raw, /[\uFEFF\u200B-\u200F\u202A-\u202E\u2060-\u206F]/u);
});
// Preserve literals (including -- inside literals), remove nested block/line comments.
function uncomment(text) {
  let out = '', i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const start = i++;
      while (i < text.length) {
        if (text[i++] === "'") {
          if (text[i] === "'") i++; else break;
        }
      }
      out += text.slice(start, i);
    } else if (text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (text.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2; }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, 'unterminated block comment');
      out += ' ';
    } else out += text[i++];
  }
  return out;
}
const sql = uncomment(raw);

test('ordered regressions and immutable exit evidence are explicit in the source', () => {
  assert.match(sql, /needs_reason\s*:=\s*pg_catalog\.array_position\([\s\S]*?old_status\)\s*>\s*pg_catalog\.array_position\([\s\S]*?p_target_status\)/i);
  assert.match(sql, /FOR exit_record IN SELECT/);
  assert.match(sql, /delivery_exit_inconsistent/);
  assert.match(sql, /record_payment/);
  // Regression guard for a PL/pgSQL record/table-alias collision found in review.
  assert.doesNotMatch(sql, /chain record;\s*u record;/);
  assert.match(sql, /order_operation_receipts_flex_immutable BEFORE UPDATE OR DELETE/);
});
// Deliberately constrained source extractor, not a PostgreSQL grammar. Each body
// is checked independently, so an unrelated helper cannot satisfy an RPC check.
const functions = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public|private)\.[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(RETURNS[\s\S]*?)\bAS\s+(\$[a-z0-9_]*\$)([\s\S]*?)\4\s*;/gi)]
  .map(m => ({ name: m[1].toLowerCase(), args: m[2], header: m[3], body: uncomment(m[5]), source: m[0] }));
const one = name => {
  const matches = functions.filter(f => f.name === name);
  assert.equal(matches.length, 1, `one extracted definition of ${name}`);
  return matches[0];
};
const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tableNames = ['order_delivery_manifest', 'order_delivery_undos', 'order_delivery_compensations'];
function tableDDL(name) {
  const start = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${name}\\s*\\(`, 'i').exec(sql);
  assert.ok(start, `${name} CREATE TABLE`);
  const end = sql.indexOf(';', start.index);
  assert.ok(end > start.index, `${name} terminated DDL`);
  return sql.slice(start.index, end);
}

test('migration is transactional, additive and does not erase physical/financial history', () => {
  assert.match(sql, /^\s*BEGIN\s*;/i);
  assert.match(sql, /COMMIT\s*;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DISABLE\s+TRIGGER|session_replication_role|TRUNCATE\s+(?:TABLE\s+)?public\.)/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.order_payments\b/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE\s+FROM)\s+public\.(?:order_events|order_stock_settlements|product_inventory_movements|order_delivery_manifest|order_delivery_undos|order_delivery_compensations)\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
});

test('FLEX tables have relational constraints, RLS and direct-write revocation', () => {
  for (const name of tableNames) {
    const ddl = tableDDL(name);
    assert.match(ddl, /\benterprise_id\s+uuid\s+NOT\s+NULL/i, name);
    if (name !== 'order_delivery_compensations')
      assert.match(ddl, /\border_id\s+uuid\s+NOT\s+NULL/i, name);
    assert.match(ddl, /\b(?:PRIMARY\s+KEY|UNIQUE)\s*\(/i, `${name} uniqueness`);
    assert.match(ddl, /\b(?:FOREIGN\s+KEY|REFERENCES)\b/i, `${name} relational linkage`);
    assert.match(sql, new RegExp(`ALTER\\s+TABLE\\s+public\\.${name}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
    assert.match(sql, new RegExp(`REVOKE[^;]*\\bON\\s+(?:TABLE\\s+)?[^;]*public\\.${name}[^;]*FROM[^;]*(?:authenticated|PUBLIC)`, 'i'), `${name} ACL revoke`);
  }
});

test('compensations derive order identity through tenant-scoped settlement and undo FKs', () => {
  const ddl = tableDDL('order_delivery_compensations');
  for (const [column, relation, referenced] of [
    ['settlement_id', 'order_stock_settlements', 'id'],
    ['original_movement_id', 'product_inventory_movements', 'id'],
    ['compensation_movement_id', 'product_inventory_movements', 'id'],
    ['undo_event_id', 'order_delivery_undos', 'undo_event_id'],
  ]) {
    assert.match(ddl, new RegExp(`FOREIGN\\s+KEY\\s*\\(enterprise_id,\\s*${column}\\)\\s+REFERENCES\\s+public\\.${relation}\\s*\\(enterprise_id,\\s*${referenced}\\)\\s+ON\\s+DELETE\\s+RESTRICT`, 'i'));
  }
  assert.match(ddl, /PRIMARY\s+KEY\s*\(enterprise_id,\s*settlement_id\)/i);
  for (const column of ['original_movement_id', 'compensation_movement_id'])
    assert.match(ddl, new RegExp(`UNIQUE\\s*\\(enterprise_id,\\s*${column}\\)`, 'i'));
  assert.match(ddl, /CHECK\s*\(original_movement_id\s*<>\s*compensation_movement_id\)/i);
});

test('undo RPC exact input and output contract', () => {
  const f = one('public.undo_order_delivery');
  const args = f.args.split(',').map(a => a.trim().toLowerCase().split(/\s+/));
  assert.deepEqual(args, [
    ['p_attempt_id', 'uuid'], ['p_order_id', 'uuid'], ['p_expected_version', 'bigint'],
    ['p_delivery_event_id', 'uuid'], ['p_target_status', 'text'], ['p_reason', 'text'],
    ['p_classification', 'text'],
  ], 'named argument ordinals matter, especially the three adjacent text arguments');
  assert.match(f.header, /RETURNS\s+TABLE\s*\(\s*status\s+text\s*,\s*order_id\s+uuid\s*,\s*operational_status\s+text\s*,\s*version\s+bigint\s*,\s*event_id\s+uuid\s*,\s*source_delivery_event_id\s+uuid\s*,\s*physical_effect\s+text\s*\)/i);
  for (const value of ['compensated', 'preserved', 'no_physical_movement'])
    assert.match(sql, new RegExp(`'${value}'`), `physical effect ${value}`);
});

test('every defined function has hardened definer header and explicit signature ACL handling', () => {
  assert.ok(functions.length >= 3, 'extract public endpoints and supporting helpers');
  const declared = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public|private)\.[a-z0-9_]+)\s*\(/gi)];
  assert.equal(functions.length, declared.length, 'extractor covers every definition');
  for (const f of functions) {
    assert.match(f.header, /SECURITY\s+DEFINER/i, f.name);
    assert.match(f.header, /SET\s+search_path\s*=\s*''/i, f.name);
    const types = f.args.trim() ? f.args.split(',').map(a => a.trim().split(/\s+/)[1]) : [];
    const signature = `${escaped(f.name)}\\s*\\(${types.map(escaped).join('\\s*,\\s*')}\\)`;
    assert.match(sql, new RegExp(`ALTER\\s+FUNCTION\\s+${signature}\\s+OWNER\\s+TO\\s+postgres\\s*;`, 'i'), `${f.name} exact owner signature`);
    assert.match(sql, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${signature}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated,\\s*service_role\\s*;`, 'i'), `${f.name} exact revoke signature`);
    const grant = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${signature}\\s+TO\\s+authenticated\\s*;`, 'i');
    if (f.name.startsWith('public.')) assert.match(sql, grant, `${f.name} authenticated grant`);
    else assert.doesNotMatch(sql, new RegExp(`GRANT[^;]*ON\\s+FUNCTION\\s+${signature}\\s+TO\\b`, 'i'), `${f.name} helper remains private`);
  }
  assert.match(sql, /has_function_privilege/i);
});

test('undo authorization, serialization, receipt validation and fresh version boundary are local', () => {
  const body = one('public.undo_order_delivery').body;
  for (const marker of ['get_my_access_context', 'business_ready', 'current_internal_user_id',
    'can_access_enterprise', 'sales.write', 'pg_advisory_xact_lock', 'FOR UPDATE',
    'payload_hash', 'idempotency_conflict', 'receipt_result_unavailable',
    'version_conflict', '9007199254740991', 'order_operation_receipts',
    'order_delivery_undos', 'order_events']) assert.ok(body.toLowerCase().includes(marker.toLowerCase()), marker);
  assert.match(body, /NOT\s+private\.can_access_enterprise\(eid,\s*'sales\.write'\)/i);
  assert.doesNotMatch(body, /'sales\.delete'/i, 'undo is a sales.write correction, not cancellation');
  assert.match(one('public.cancel_order').body, /NOT\s+private\.can_access_enterprise\(eid,\s*'sales\.delete'\)/i, 'cancel retains delete authorization');
  const lock = body.indexOf('modulus:enterprise-management:all-members');
  const context = body.indexOf('get_my_access_context');
  assert.ok(lock >= 0 && lock < context, 'identity/plan barrier precedes context');
  const replay = body.indexOf('receipt_result_unavailable');
  const version = body.indexOf("'version_conflict'");
  assert.ok(replay >= 0 && replay < version, 'historical receipt branch before fresh version conflict');
  const positions = [
    ['global barrier', lock], ['access context', context],
    ['permission check', body.indexOf("private.can_access_enterprise(eid,'sales.write')")],
    ['payload hash', body.indexOf('hash_value:=')],
    ['attempt barrier', body.indexOf('orders:undo_delivery:')],
    ['receipt lookup', body.indexOf('INTO receipt')],
    ['payload conflict', body.indexOf("'idempotency_conflict'")],
    ['receipt validation', replay],
    ['historical return', body.indexOf('RETURN QUERY')],
    ['fresh order lock', body.indexOf('FOR UPDATE')],
    ['fresh version check', version],
    ['undo insert', body.search(/INSERT\s+INTO\s+public\.order_delivery_undos/i)],
    ['receipt insert', body.search(/INSERT\s+INTO\s+private\.order_operation_receipts/i)],
  ];
  for (let i = 0; i < positions.length; i++) {
    assert.ok(positions[i][1] >= 0, `${positions[i][0]} exists`);
    if (i) assert.ok(positions[i - 1][1] < positions[i][1], `${positions[i - 1][0]} precedes ${positions[i][0]}`);
  }
  assert.match(body, /jsonb_typeof/i);
  assert.match(body, /INSERT\s+INTO\s+public\.order_delivery_undos/i);
  assert.match(body, /INSERT\s+INTO\s+private\.order_operation_receipts/i);
});

test('physical read endpoint has one UUID argument and authenticated tenant-scoped access', () => {
  const f = one('public.get_order_physical_state');
  assert.match(f.args.trim(), /^[a-z_]+\s+uuid$/i);
  for (const marker of ['get_my_access_context', 'business_ready', 'sales.read', 'can_access_enterprise', 'enterprise_id'])
    assert.ok(f.body.includes(marker), marker);
  assert.doesNotMatch(f.body, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i, 'read endpoint must not mutate');
});

test('delivery persists manifest and lifecycle endpoints remain versioned and authorized', () => {
  const deliver = one('public.deliver_order');
  assert.match(deliver.body, /order_delivery_manifest/i);
  assert.match(deliver.body, /order_operation_receipts/i);
  for (const name of ['transition_order', 'cancel_order', 'reopen_order', 'deliver_order']) {
    const f = one(`public.${name}`);
    for (const marker of ['sales.', 'can_access_enterprise', 'enterprise_id', 'version_conflict', 'order_operation_receipts'])
      assert.ok(f.body.includes(marker), `${name}: ${marker}`);
  }
});

test('source check limitations are explicit', () => {
  console.log('SOURCE ONLY: SQL syntax, installed constraints, effective ACL/RLS, flows, concurrency and rollback NOT validated.');
});

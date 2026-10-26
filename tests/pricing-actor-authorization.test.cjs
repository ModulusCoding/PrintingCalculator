/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS static SQL regression harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n');
const migration = () => read('20261026150000_pricing_actor_authorization.sql');
function definition(sql, name) {
  const start = sql.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  assert.notEqual(start, -1, name);
  const end = sql.indexOf('$$;', sql.indexOf('AS $$', start));
  assert.notEqual(end, -1, name);
  return sql.slice(start, end + 3);
}
function body(sql, name) {
  const d = definition(sql, name);
  return d.slice(d.indexOf('AS $$') + 5, -3).trim();
}

test('shared helper contains the exact previous role/plan predicate, with only identity input substituted', () => {
  const old = body(read('20261026060000_plan_business_regularization.sql'), 'private.can_access_enterprise');
  const current = body(migration(), 'private.can_access_enterprise_for_user');
  // Ignore formatting, but never ignore SQL operators, predicates or role values.
  const compact = sql => sql.replace(/\s+/g, '');
  const expected = old.replaceAll('private.current_internal_user_id()', 'p_user_id');
  assert.equal(compact(current), compact(expected));
});

test('JWT entry delegates only the current identity; pricing actor retains every check and lock', () => {
  const sql = migration();
  assert.match(body(sql, 'private.can_access_enterprise'), /private\.can_access_enterprise_for_user\(\s*private\.current_internal_user_id\(\),\s*p_enterprise_id,\s*p_permission\s*\)/);
  const old = definition(read('20261026020000_stage6bc_pricing_hardening.sql'), 'private.pricing_actor');
  const updated = definition(sql, 'private.pricing_actor');
  assert.equal(updated, old.replace('private.can_access_enterprise(e.id, p_permission)', 'private.can_access_enterprise_for_user(u.id, e.id, p_permission)'));
});

test('manual V3 application changes only identity evaluation, preserving gates, receipts and qualified version', () => {
  const old = definition(read('20261026140000_apply_pricing_price_qualified_version.sql'), 'public.apply_pricing_price');
  assert.equal(definition(migration(), 'public.apply_pricing_price'), old.replace("private.can_access_enterprise(x.enterprise_id, 'products.write')", "private.can_access_enterprise_for_user(x.uid, x.enterprise_id, 'products.write')"));
});

test('no JWT fabrication, role bypass or administrative EXECUTE expansion', () => {
  const sql = migration();
  assert.doesNotMatch(sql, /set_config\s*\(|SET\s+(?:LOCAL\s+)?ROLE|GRANT\s+EXECUTE[^;]*(?:apply_pricing_price|pricing_actor|can_access_enterprise_for_user)[^;]*TO\s+(?:authenticated|anon)/i);
  assert.match(sql, /REVOKE ALL[^;]*private\.can_access_enterprise_for_user\(uuid,\s*uuid,\s*text\)[^;]*FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role/i);
  assert.match(sql, /ALTER FUNCTION private\.can_access_enterprise_for_user\(uuid,\s*uuid,\s*text\) OWNER TO postgres/i);
});

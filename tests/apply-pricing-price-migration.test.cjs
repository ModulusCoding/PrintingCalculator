/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS regression tests, consistent with the existing test harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const original = read('supabase/migrations/20261026110000_manual_v3_application.sql');
const migration = read('supabase/migrations/20261026140000_apply_pricing_price_qualified_version.sql');
const oldUpdate = 'UPDATE public.products SET price = n WHERE id = p.id RETURNING version INTO v;';
const newUpdate = 'UPDATE public.products AS pr\n  SET price = n\n  WHERE pr.id = p.id\n  RETURNING pr.version INTO v;';
const definitionAndAcl = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));

test('incremental apply fix qualifies RETURNING version without changing any other function logic or ACL', () => {
  assert.equal(original.split(oldUpdate).length, 2);
  assert.equal(migration.split(newUpdate).length, 2);
  assert.doesNotMatch(definitionAndAcl(migration), /RETURNING\s+version\b/i);
  assert.equal(definitionAndAcl(migration), definitionAndAcl(original).replace(oldUpdate, newUpdate));
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/);
});

test('V3 SQL Editor suite retains the real apply path, receipt replay and product/history integrity checks', () => {
  // Static guard only: the SQL suite must still be run in Supabase to prove the
  // UPDATE executes without 42702 and the version returned is the persisted one.
  const suite = read('tests/sql/20261026100000_manual_v3_sql_editor.sql');
  for (const label of [
    'apply saved V3', 'apply replay idempotent', 'one price application ledger',
    'apply did not rewrite historical snapshot',
    'replays preserve product price/version/full row',
    'unapplied version conflict', 'all balances and inventory ledgers unchanged',
  ]) assert.ok(suite.includes(label), label);
  assert.match(suite, /public\.apply_pricing_price\(/);
  assert.match(suite, /ROLLBACK;\s*$/);
});

/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real-TypeScript action tests; no network or real tenant session. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const config = { electricity_rate_per_kwh: '0.123456', default_filament_loss_percent: '5.25', version: '7' };
const enterprise = { name: 'Selected session company', created_at: '2026-10-01T00:00:00Z', version: '8' };
const secret = 'PRIVATE COMPANY VALUE';
const diagnosticError = {
  code: 'XX000',
  message: `failed '${secret}' alice@example.com https://private.example.test/path password=hidden-value`,
  details: 'Failing row contains (private-row-value)',
  hint: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
};

function harness(responses = []) {
  const calls = [], logs = [], rethrows = [];
  const queue = [...responses];
  const cache = new Map();
  const navigationSignal = { navigation: true };
  const imports = {
    'server-only': {},
    zod: require('zod'),
    'next/navigation': { unstable_rethrow(error) { rethrows.push(error); if (error === navigationSignal) throw error; } },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (...args) => {
      calls.push(args);
      assert.ok(queue.length, `Unexpected RPC: ${args[0]}`);
      const response = queue.shift();
      if (response instanceof Error || response === navigationSignal) throw response;
      return response;
    } }) },
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const loadedModule = { exports: {} };
    cache.set(relative, loadedModule);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module: loadedModule, exports: loadedModule.exports, crypto, FormData,
      console: Object.fromEntries(['error', 'warn', 'info'].map(level => [level, (...args) => logs.push({ level, args })])),
      require(name) {
        if (Object.hasOwn(imports, name)) return imports[name];
        if (name === '@/lib/general-materials/logger') return load('lib/general-materials/logger.ts');
        if (name === '@/lib/diagnostics/safe-error') return load('lib/diagnostics/safe-error.ts');
        throw new Error(`Unexpected import: ${name}`);
      },
    }, { filename: relative });
    return loadedModule.exports;
  }
  return { actions: load('lib/enterprise/management.ts'), calls, logs, rethrows, navigationSignal, queue };
}
const ok = data => ({ data, error: null });
const row = value => ok([value]);
const plain = value => JSON.parse(JSON.stringify(value));
function form(fields = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ version: '7', ...fields })) if (value !== null) result.set(key, value);
  return result;
}
function assertLog(h, stage, rpc) {
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].level, 'error');
  const text = JSON.stringify(h.logs);
  assert.ok(text.includes(`stage=${stage}`), text);
  assert.ok(text.includes(`rpc=${rpc}`), text);
  for (const sensitive of [secret, 'alice@example.com', 'private.example.test', 'hidden-value', 'private-row-value', 'eyJhbGci']) {
    assert.ok(!text.includes(sensitive), `Diagnostic leaked ${sensitive}: ${text}`);
  }
}

// This only verifies selected-session RPC wiring in mocks, not real tenant isolation or SQL authorization.
test('getCompany uses selected-session singleton RPCs without client-supplied identity, allows independent versions and strips extras', async () => {
  const h = harness([row({ ...config, enterprise_id: secret }), row({ ...enterprise, extra: secret })]);
  assert.deepEqual(plain(await h.actions.getCompany()), {
    ...enterprise, version: 8, electricity_rate_per_kwh: 0.123456, default_filament_loss_percent: 5.25,
  });
  assert.deepEqual(h.calls, [['get_my_enterprise_config'], ['get_my_enterprise']]);
  assert.equal(h.logs.length, 0);
  const nullable = harness([row({ ...config, electricity_rate_per_kwh: null }), row(enterprise)]);
  assert.equal((await nullable.actions.getCompany()).electricity_rate_per_kwh, null);
});

test('getCompany rejects null, missing and multiple rows at either interpretation stage', async () => {
  for (const bad of [null, [], [config, config], { ...config }]) {
    const h = harness([ok(bad)]);
    await assert.rejects(h.actions.getCompany(), /technical/);
    assertLog(h, 'interpretation', 'get_my_enterprise_config');
    assert.equal(h.calls.length, 1);
  }
  for (const bad of [null, [], [enterprise, enterprise], { ...enterprise }]) {
    const h = harness([row(config), ok(bad)]);
    await assert.rejects(h.actions.getCompany(), /technical/);
    assertLog(h, 'interpretation', 'get_my_enterprise');
  }
});

test('getCompany rejects malformed database numerics and unsafe versions instead of coercing them', async () => {
  for (const field of ['electricity_rate_per_kwh', 'default_filament_loss_percent', 'version']) {
    const values = field === 'version'
      ? [null, true, '', ' ', '-1', '1.2', '1e2', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']
      : [true, '', ' ', 'NaN', 'Infinity', '1,25', '1e1', -1, 101, Infinity, NaN, ...(field === 'default_filament_loss_percent' ? [null] : [])];
    for (const value of values) {
      const h = harness([row({ ...config, [field]: value })]);
      await assert.rejects(h.actions.getCompany(), /technical/, `${field}: ${String(value)}`);
      assertLog(h, 'interpretation', 'get_my_enterprise_config');
    }
  }
  for (const version of [null, '', true, '-1', '1.2', '9007199254740992']) {
    const h = harness([row(config), row({ ...enterprise, version })]);
    await assert.rejects(h.actions.getCompany(), /technical/);
    assertLog(h, 'interpretation', 'get_my_enterprise');
  }
});

test('getCompany reports sanitized RPC-stage diagnostics and preserves stable error categories', async () => {
  for (const [code, category] of [['42501', 'permission_denied'], ['22023', 'invalid_input'], ['XX000', 'technical']]) {
    for (const second of [false, true]) {
      const h = harness([...(second ? [row(config)] : []), { data: null, error: { ...diagnosticError, code } }]);
      await assert.rejects(h.actions.getCompany(), new RegExp(category));
      assertLog(h, 'rpc', second ? 'get_my_enterprise' : 'get_my_enterprise_config');
    }
  }
  const h = harness([new Error(diagnosticError.message), row(config), row(enterprise)]);
  await assert.rejects(h.actions.getCompany(), /technical/);
  assertLog(h, 'rpc', 'get_my_enterprise_config');
  assert.equal(h.rethrows.length, 1);
  assert.equal((await h.actions.getCompany()).name, enterprise.name);
});

const mutations = [
  { action: 'updateCompanyName', rpc: 'update_my_enterprise_name', field: 'name', input: `  ${secret}  `, value: secret, arg: 'p_name', output: 'name', updated: { status: 'updated', name: secret, version: '8' } },
  { action: 'updateCompanyRate', rpc: 'update_my_enterprise_config', field: 'electricity_rate_per_kwh', input: '0,123456', value: 0.123456, arg: 'p_rate', output: 'electricity_rate_per_kwh', updated: { status: 'updated', version: '8' } },
  { action: 'updateCompanyLoss', rpc: 'update_my_pricing_loss', field: 'default_filament_loss_percent', input: '5,25', value: 5.25, arg: 'p_loss', output: 'default_filament_loss_percent', updated: { status: 'updated', version: '8' } },
];
for (const m of mutations) {
  test(`${m.action}: exact SQL updated contract and no supplied tenant/user IDs in RPC args`, async () => {
    const h = harness([row(m.updated)]);
    const result = await h.actions[m.action](null, form({ [m.field]: m.input, enterprise_id: 'untrusted-company', user_id: 'untrusted-user', client_id: 'untrusted-client' }));
    assert.deepEqual(plain(result), { status: 'success', [m.output]: m.value, version: 8 });
    assert.deepEqual(plain(h.calls), [[m.rpc, { [m.arg]: m.value, p_expected_version: 7 }]]);
    assert.equal(h.logs.length, 0);
  });
  test(`${m.action}: version_conflict maps to conflict without success payload`, async () => {
    const h = harness([row({ status: 'version_conflict', version: '9', ...(m.action === 'updateCompanyName' ? { name: 'Current name' } : {}) })]);
    assert.deepEqual(plain(await h.actions[m.action](null, form({ [m.field]: m.input }))), { status: 'conflict' });
    assert.equal(h.logs.length, 0);
  });
  test(`${m.action}: malformed SQL responses are technical, logged safely, never false successes`, async () => {
    for (const data of [null, [], [m.updated, m.updated], [null], [{ status: 'success', version: 8, name: secret }], [{ ...m.updated, version: null }], [{ ...m.updated, version: '9007199254740992' }], [{ ...m.updated, version: true }]]) {
      const h = harness([ok(data)]);
      assert.deepEqual(plain(await h.actions[m.action](null, form({ [m.field]: m.input }))), { status: 'technical' });
      assertLog(h, 'interpretation', m.rpc);
    }
  });
  test(`${m.action}: RPC errors and thrown errors remain retryable with sanitized diagnostics`, async () => {
    for (const [code, status] of [['42501', 'permission_denied'], ['22023', 'invalid_input'], ['XX000', 'technical']]) {
      const h = harness([{ data: null, error: { ...diagnosticError, code } }, row(m.updated)]);
      assert.deepEqual(plain(await h.actions[m.action](null, form({ [m.field]: m.input }))), { status });
      assertLog(h, 'rpc', m.rpc);
      assert.equal((await h.actions[m.action](null, form({ [m.field]: m.input }))).status, 'success');
      assert.equal(h.calls.length, 2);
    }
    const h = harness([new Error(diagnosticError.message), row(m.updated)]);
    assert.deepEqual(plain(await h.actions[m.action](null, form({ [m.field]: m.input }))), { status: 'technical' });
    assertLog(h, 'rpc', m.rpc);
    assert.equal(h.rethrows.length, 1);
    assert.equal((await h.actions[m.action](null, form({ [m.field]: m.input }))).status, 'success');
  });
  test(`${m.action}: invalid expected versions never reach RPC`, async () => {
    for (const version of [null, '', ' ', '-1', '1.5', '1e2', '9007199254740992']) {
      const h = harness();
      assert.equal((await h.actions[m.action](null, form({ [m.field]: m.input, version }))).status, 'invalid_input');
      assert.equal(h.calls.length, 0);
    }
  });
}

test('rate regression: comma/point decimals, six-place precision, bounds, blank and absent nullable values', async () => {
  for (const [input, value] of [['0,123456', 0.123456], ['0.123456', 0.123456], [' 1,25 ', 1.25], ['0', 0], ['100', 100], ['100,000000', 100], ['', null], ['   ', null], [null, null]]) {
    const h = harness([row({ status: 'updated', version: 8 })]);
    assert.deepEqual(plain(await h.actions.updateCompanyRate(null, form({ electricity_rate_per_kwh: input }))), { status: 'success', electricity_rate_per_kwh: value, version: 8 }, `input=${String(input)}`);
    assert.equal(h.calls[0][1].p_rate, value);
  }
});

test('rate rejects exponent, grouping, hex, signs, non-finite and excessive precision before RPC', async () => {
  for (const input of ['1e1', '1E-2', '0x10', '1.000,00', '1,000.00', '1 000', '1,2,3', '1.2.3', '.5', ',5', '1.', '1,', '+1', '-1', '100.000001', '0.1234567', '0,1234567', 'NaN', 'Infinity', 'abc']) {
    const h = harness();
    assert.equal((await h.actions.updateCompanyRate(null, form({ electricity_rate_per_kwh: input }))).status, 'invalid_input', input);
    assert.equal(h.calls.length, 0, input);
  }
});

test('rate regression: no_change is success only at the expected version', async () => {
  const h = harness([row({ status: 'no_change', version: '7' })]);
  assert.deepEqual(plain(await h.actions.updateCompanyRate(null, form({ electricity_rate_per_kwh: '0,85' }))), { status: 'success', electricity_rate_per_kwh: 0.85, version: 7 });
  const bad = harness([row({ status: 'no_change', version: 8 })]);
  assert.equal((await bad.actions.updateCompanyRate(null, form({ electricity_rate_per_kwh: '0,85' }))).status, 'technical');
  assertLog(bad, 'interpretation', 'update_my_enterprise_config');
});

test('loss accepts no_change only with the unchanged expected version', async () => {
  const h = harness([row({ status: 'no_change', version: '7' })]);
  assert.deepEqual(plain(await h.actions.updateCompanyLoss(null, form({ default_filament_loss_percent: '5,25' }))), { status: 'success', default_filament_loss_percent: 5.25, version: 7 });
  const bad = harness([row({ status: 'no_change', version: 8 })]);
  assert.equal((await bad.actions.updateCompanyLoss(null, form({ default_filament_loss_percent: '5.25' }))).status, 'technical');
  assertLog(bad, 'interpretation', 'update_my_pricing_loss');
});

test('loss validates two decimal places and inclusive bounds locally', async () => {
  for (const input of ['', ' ', '1e1', '0x10', '1.000,00', '0,001', '-1', '100.01', 'Infinity']) {
    const h = harness();
    assert.equal((await h.actions.updateCompanyLoss(null, form({ default_filament_loss_percent: input }))).status, 'invalid_input', input);
    assert.equal(h.calls.length, 0);
  }
  for (const input of ['0', '100', '5.25', '5,25']) {
    const h = harness([row({ status: 'updated', version: 8 })]);
    assert.equal((await h.actions.updateCompanyLoss(null, form({ default_filament_loss_percent: input }))).status, 'success');
  }
});

test('name handles SQL invalid_input, rejects mismatched updated name and local blank/long input', async () => {
  const h = harness([row({ status: 'invalid_input', name: null, version: null })]);
  assert.deepEqual(plain(await h.actions.updateCompanyName(null, form({ name: secret }))), { status: 'invalid_input' });
  assert.equal(h.logs.length, 0);
  const mismatch = harness([row({ status: 'updated', name: 'Different name', version: 8 })]);
  assert.equal((await mismatch.actions.updateCompanyName(null, form({ name: secret }))).status, 'technical');
  assertLog(mismatch, 'interpretation', 'update_my_enterprise_name');
  for (const name of [null, '', '   ', 'x'.repeat(201)]) {
    const invalid = harness();
    assert.equal((await invalid.actions.updateCompanyName(null, form({ name }))).status, 'invalid_input');
    assert.equal(invalid.calls.length, 0);
  }
});

test('framework navigation signals propagate via unstable_rethrow rather than becoming technical failures', async () => {
  for (const action of ['getCompany', ...mutations.map(m => m.action)]) {
    const h = harness();
    h.queue.push(h.navigationSignal);
    const m = mutations.find(item => item.action === action);
    await assert.rejects(() => m ? h.actions[action](null, form({ [m.field]: m.input })) : h.actions.getCompany(), error => error === h.navigationSignal);
    assert.equal(h.logs.length, 0);
  }
});

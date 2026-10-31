/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TypeScript harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function loadTs(relativePath, imports = {}) {
  const filename = path.join(root, relativePath);
  const moduleObject = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === 'zod') return require('zod');
    throw new Error(`Unexpected dependency in isolated spool harness: ${name}`);
  };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  vm.runInNewContext(output, {
    exports: moduleObject.exports, module: moduleObject, require: localRequire,
  }, { filename });
  return moduleObject.exports;
}
const v = loadTs('lib/spools/validation.ts');
const schemas = loadTs('lib/spools/schemas.ts', { './validation': v });
const id = '11111111-1111-4111-8111-111111111111';
const movementId = '22222222-2222-4222-8222-222222222222';
const base = {
  material_type: '  PLA  ', brand: '  Marca  ', color: '  Azul  ',
  internal_identifier: '  PLA-01  ', original_grams: '1000',
  initial_balance_grams: '750,125', purchase_price: '99,90', attempt_id: id,
};
const movement = { spool_id: id, expected_version: 0, reason: '  Contagem  ', attempt_id: id };
const profile = {
  spool_id: id, expected_version: 0, internal_identifier: ' PLA-01 ',
  material_type: ' PLA ', brand: '', color: '',
};
function valid(schema, payload) { return schema.safeParse(payload).success; }

function actionHarness() {
  const calls = [];
  let response = { data: [], error: null };
  class AuthContextError extends Error {}
  const actions = loadTs('lib/spools/actions.ts', {
    './validation': v,
    './schemas': schemas,
    'next/cache': { revalidatePath: (...args) => calls.push(['revalidate', ...args]) },
    'next/navigation': { unstable_rethrow() {} },
    '@/lib/plans': {
      planErrorCode: () => null, planRpcErrorCode: () => null,
      requirePlanBusinessAccess: async (options) => calls.push(['plan', options]),
    },
    '@/lib/auth/context': {
      AuthContextError,
      requireBusinessContext: async (permission) => { calls.push(['auth', permission]); return {}; },
    },
    '@/lib/supabase/server': {
      createClient: async () => {
        calls.push(['client']);
        return { rpc: async (name, args) => { calls.push(['rpc', name, args]); return response; } };
      },
    },
    '@/lib/deletion/actions': { deleteEntity: async () => { throw new Error('Unexpected deletion'); } },
  });
  return { actions, calls, respond: (data) => { response = { data, error: null }; } };
}

test('creation trims labels, accepts three-place grams and two-place BRL without rounding', () => {
  const result = v.createSpoolSchema.parse({ ...base, original_grams: ' 1000,125 ' });
  assert.equal(result.material_type, 'PLA');
  assert.equal(result.internal_identifier, 'PLA-01');
  assert.equal(result.brand, 'Marca');
  assert.equal(result.color, 'Azul');
  assert.equal(result.original_grams, '1000,125');
  assert.equal(v.pt(result.initial_balance_grams), '750.125');
  assert.equal(v.pt(result.purchase_price), '99.90');
});

test('decimal grammar rejects pasted currency, grouping, exponents and incomplete fractions', () => {
  for (const amount of ['', ' ', '-1', '+1', 'abc', 'NaN', 'Infinity', '1e3', '1.000,50', '1,000.50', 'R$ 12,50', '1 000', '12,', '.5', '0x10']) {
    for (const field of ['original_grams', 'initial_balance_grams', 'purchase_price']) {
      assert.equal(valid(v.createSpoolSchema, { ...base, [field]: amount }), false, `${field}: ${amount}`);
    }
  }
  for (const value of [1, null, undefined, true]) {
    assert.equal(valid(v.grams, value), false);
    assert.equal(valid(v.balance, value), false);
  }
});

test('grams and BRL enforce precision and inclusive numeric limits', () => {
  for (const value of ['0.001', '0,001', '100000', '100000.000']) assert.equal(valid(v.grams, value), true, value);
  for (const value of ['0', '0.000', '0.0001', '1,1234', '100000.001']) assert.equal(valid(v.grams, value), false, value);
  for (const value of ['0', '0,000', '100000']) assert.equal(valid(v.balance, value), true, value);
  assert.equal(valid(v.balance, '100000.001'), false);
  for (const value of ['0', '0,01', '1000000.00']) {
    assert.equal(valid(v.createSpoolSchema, { ...base, purchase_price: value }), true, value);
  }
  for (const value of ['1.001', '1,999', '1000000.01', '-0.01']) {
    assert.equal(valid(v.createSpoolSchema, { ...base, purchase_price: value }), false, value);
  }
});

test('opening balance can be zero or equal to capacity but cannot exceed it', () => {
  for (const initial_balance_grams of ['0', '10.125', '10,125']) {
    assert.equal(valid(v.createSpoolSchema, { ...base, original_grams: '10,125', initial_balance_grams }), true);
  }
  const result = v.createSpoolSchema.safeParse({ ...base, original_grams: '10', initial_balance_grams: '10,001' });
  assert.equal(result.success, false);
  assert.ok(v.fieldErrors(result.error).initial_balance_grams.length);
});

test('optional brand and color become null only from blank strings', () => {
  for (const schema of [v.createSpoolSchema, v.updateProfileSchema]) {
    const input = schema === v.createSpoolSchema ? base : profile;
    const result = schema.parse({ ...input, brand: '  ', color: '\t' });
    assert.equal(result.brand, null);
    assert.equal(result.color, null);
    for (const field of ['brand', 'color']) {
      for (const value of [null, undefined, 123]) assert.equal(valid(schema, { ...input, [field]: value }), false);
    }
  }
});

test('identity and profile text fields enforce trimmed required values and maximum lengths', () => {
  for (const [field, max] of [['material_type', 80], ['internal_identifier', 120], ['brand', 120], ['color', 80]]) {
    assert.equal(valid(v.createSpoolSchema, { ...base, [field]: 'x'.repeat(max) }), true);
    assert.equal(valid(v.createSpoolSchema, { ...base, [field]: 'x'.repeat(max + 1) }), false);
    assert.equal(valid(v.updateProfileSchema, { ...profile, [field]: 'x'.repeat(max + 1) }), false);
  }
  for (const field of ['material_type', 'internal_identifier']) {
    assert.equal(valid(v.createSpoolSchema, { ...base, [field]: '  ' }), false);
  }
  assert.equal(valid(v.updateIdentitySchema, { spool_id: id, expected_version: 0, internal_identifier: '  ' }), false);
});

test('consumption and replenishment require positive three-place quantities and bounded reasons', () => {
  for (const movement_type of ['consumption', 'replenishment']) {
    const input = { ...movement, movement_type, quantity_grams: '0,001' };
    assert.equal(v.createMovementSchema.parse(input).reason, 'Contagem');
    for (const quantity_grams of ['0', '-1', '1.0001', '100000.001']) {
      assert.equal(valid(v.createMovementSchema, { ...input, quantity_grams }), false);
    }
    for (const reason of ['', '  ', 'x'.repeat(501)]) assert.equal(valid(v.createMovementSchema, { ...input, reason }), false);
    assert.equal(valid(v.createMovementSchema, { ...input, reason: 'x'.repeat(500) }), true);
    assert.equal(valid(v.createMovementSchema, { ...input, counted_balance_grams: '0' }), false);
  }
});

test('adjustment uses absolute counted balance, including zero, and rejects quantity/delta fields', () => {
  const input = { ...movement, movement_type: 'adjustment', counted_balance_grams: '0' };
  assert.equal(valid(v.createMovementSchema, input), true);
  assert.equal(valid(v.createMovementSchema, { ...input, counted_balance_grams: '100000' }), true);
  for (const counted_balance_grams of ['-0.001', '0.0001', '100000.001']) {
    assert.equal(valid(v.createMovementSchema, { ...input, counted_balance_grams }), false);
  }
  const missingCount = { ...input };
  delete missingCount.counted_balance_grams;
  assert.equal(valid(v.createMovementSchema, { ...missingCount, quantity_grams: '1' }), false);
  assert.equal(valid(v.createMovementSchema, { ...input, quantity_grams: '1' }), false);
  assert.equal(valid(v.createMovementSchema, { ...input, movement_type: 'opening' }), false);
});

test('versions are strict safe nonnegative integers across all mutation schemas', () => {
  const cases = [
    [v.createMovementSchema, { ...movement, movement_type: 'consumption', quantity_grams: '1' }],
    [v.updateProfileSchema, profile],
    [v.updateIdentitySchema, { spool_id: id, internal_identifier: 'PLA-01' }],
    [v.setActiveSchema, { spool_id: id, active: true }],
    [v.updateThresholdSchema, { threshold: '10' }],
  ];
  for (const [schema, input] of cases) {
    for (const expected_version of [0, Number.MAX_SAFE_INTEGER - 1]) assert.equal(valid(schema, { ...input, expected_version }), true);
    for (const expected_version of ['0', '', null, undefined, true, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.equal(valid(schema, { ...input, expected_version }), false, String(expected_version));
    }
    assert.equal(valid(schema, { ...input, expected_version: 0, unexpected: true }), false);
  }
});

test('threshold includes 0 and 100, supports two decimal places and rejects coercion', () => {
  for (const threshold of ['0', '0,00', '99.99', '100', '100,00']) {
    assert.equal(valid(v.updateThresholdSchema, { threshold, expected_version: 0 }), true, threshold);
  }
  for (const threshold of ['-0.01', '100.01', '0.001', '', '1e2', '50%', 0, 100, null]) {
    assert.equal(valid(v.updateThresholdSchema, { threshold, expected_version: 0 }), false, String(threshold));
  }
  assert.equal(valid(v.setActiveSchema, { spool_id: id, expected_version: 0, active: 'false' }), false);
});

test('creation requires UUID idempotency key and rejects unknown fields', () => {
  for (const attempt_id of ['', 'not-a-uuid', undefined]) assert.equal(valid(v.createSpoolSchema, { ...base, attempt_id }), false);
  assert.equal(valid(v.createSpoolSchema, { ...base, material_id: id }), false);
  assert.equal(valid(v.createMovementSchema, { ...movement, spool_id: 'invalid', movement_type: 'consumption', quantity_grams: '1' }), false);
});

test('invalid actions return field errors before authorization, client creation or RPC', async () => {
  const h = actionHarness();
  const cases = [
    ['createSpool', { ...base, initial_balance_grams: '1000.001' }, 'initial_balance_grams'],
    ['createMovement', { ...movement, movement_type: 'consumption', quantity_grams: '0' }, 'quantity_grams'],
    ['updateSpoolProfile', { ...profile, material_type: '' }, 'material_type'],
    ['updateSpoolIdentity', { spool_id: id, expected_version: '0', internal_identifier: 'PLA' }, 'expected_version'],
    ['setSpoolActive', { spool_id: id, expected_version: 0, active: 'true' }, 'active'],
    ['updateSpoolThreshold', { threshold: '100.01', expected_version: 0 }, 'threshold'],
  ];
  for (const [action, input, field] of cases) {
    const result = await h.actions[action](input);
    assert.equal(result.status, 'invalid_input', action);
    assert.ok(result.fieldErrors[field].length, `${action}: ${field}`);
  }
  assert.equal(h.calls.length, 0);
});

test('create action sends normalized decimal strings and nullable optional labels', async () => {
  const h = actionHarness();
  h.respond([{ status: 'created', spool_id: id, version: 0 }]);
  assert.equal((await h.actions.createSpool({ ...base, brand: ' ', color: '' })).status, 'created');
  const [, name, args] = h.calls.find(([kind]) => kind === 'rpc');
  assert.equal(name, 'create_filament_spool');
  assert.deepEqual(JSON.parse(JSON.stringify(args)), {
    p_attempt_id: id, p_type: 'PLA', p_brand: null, p_color: null,
    p_internal_identifier: 'PLA-01', p_original_grams: '1000',
    p_initial_balance_grams: '750.125', p_purchase_price: '99.90',
  });
  assert.equal(h.calls[0][1], 'spools.write');
});

test('create and profile RPCs persist color and the read schema preserves the saved value', async () => {
  const colors = loadTs('lib/spools/color.ts');
  for (const draft of ['#abc', '#a1b2c3']) {
    const savedColor = colors.normalizeSpoolColor(draft);
    for (const [action, input, rpc, status] of [
      ['createSpool', base, 'create_filament_spool', 'created'],
      ['updateSpoolProfile', profile, 'update_filament_spool_profile', 'updated'],
    ]) {
      const h = actionHarness();
      h.respond([{ status, spool_id: id, version: status === 'created' ? 0 : 1 }]);
      assert.equal((await h.actions[action]({ ...input, color: savedColor })).status, status);
      const [, name, args] = h.calls.find(([kind]) => kind === 'rpc');
      assert.equal(name, rpc);
      assert.equal(args.p_color, savedColor);
      const loaded = schemas.spoolSchema.parse({
        id, material_id: null, material_type: 'PLA', brand: null, color: args.p_color,
        internal_identifier: 'PLA-01', original_filament_grams: '1000', current_balance_grams: '750.125',
        purchase_price: '99.90', active: true, version: 1,
        created_at: '2026-10-29T12:00:00Z', updated_at: '2026-10-29T12:00:00Z',
      });
      assert.equal(loaded.color, savedColor);
      assert.equal(colors.resolveSpoolHex(loaded.color), savedColor);
    }
  }
});

test('movement action keeps quantity and counted balance mutually exclusive, including counted zero', async () => {
  for (const movement_type of ['consumption', 'replenishment', 'adjustment']) {
    const h = actionHarness();
    h.respond([{ status: 'created', spool_id: id, movement_id: movementId, version: 1, balance_grams: 0 }]);
    const adjustment = movement_type === 'adjustment';
    const payload = { ...movement, movement_type, ...(adjustment ? { counted_balance_grams: '0' } : { quantity_grams: '1,125' }) };
    const result = await h.actions.createMovement(payload);
    assert.equal(result.status, 'created');
    assert.equal(result.balance_grams, 0);
    const [, name, args] = h.calls.find(([kind]) => kind === 'rpc');
    assert.equal(name, 'create_filament_spool_movement');
    assert.equal(args.p_quantity_grams, adjustment ? null : '1.125');
    assert.equal(args.p_counted_balance_grams, adjustment ? '0' : null);
    assert.equal(args.p_expected_version, 0);
    assert.equal(args.p_reason, 'Contagem');
  }
});

test('threshold action preserves endpoint values and enforces paid owner-setting gate', async () => {
  for (const threshold of ['0', '100,00']) {
    const h = actionHarness();
    h.respond([{ status: 'updated', version: 1 }]);
    assert.equal((await h.actions.updateSpoolThreshold({ threshold, expected_version: 0 })).status, 'updated');
    assert.equal(h.calls[0][1], 'enterprise.manage');
    assert.equal(h.calls[1][0], 'plan');
    assert.equal(h.calls[1][1].paid, true);
    const [, name, args] = h.calls.find(([kind]) => kind === 'rpc');
    assert.equal(name, 'update_my_spool_threshold');
    assert.equal(args.p_threshold, threshold.replace(',', '.'));
    assert.equal(args.p_expected_version, 0);
  }
});

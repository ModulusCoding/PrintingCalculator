/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS harness executes real TS modules without a Next runtime. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

// Only runtime boundaries are replaced. Relative imports and @/ source aliases
// recursively execute the actual schemas, snapshot validator and pricing engine.
function loader(boundaries, env = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    vm.runInNewContext(code, {
      module: mod, exports: mod.exports, console, URL, crypto: webcrypto,
      process: { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://local.example.test', SUPABASE_AUTH_ISSUER: 'https://local.example.test/auth/v1', ...env } },
      require(name) {
        if (Object.hasOwn(boundaries, name)) return boundaries[name];
        if (name === 'server-only') return {};
        if (name.startsWith('.') || name.startsWith('@/')) {
          const target = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
          return load(`${target}.ts`);
        }
        if (name === 'zod' || name === 'node:crypto') return require(name);
        throw new Error(`Unexpected runtime dependency: ${name}`);
      },
    }, { filename: file });
    return mod.exports;
  }
  return load;
}
const ID = 'a2f9472d-c017-42dd-b0d5-56e4b5650690';
const ATTEMPT = 'b2f9472d-c017-42dd-b0d5-56e4b5650690';
const plain = value => JSON.parse(JSON.stringify(value));
function request() {
  return {
    attemptId: ATTEMPT, productId: ID, productVersion: 7,
    input: {
      quantity: 3, printTimeHours: 1.23456789,
      tariff: { original: null, effective: 0.87654321, adjusted: true }, lossPercent: 2.3456789,
      printer: { name: '  Impressora manual  ', purchasePrice: 2345.67891, lifeHours: 9876.54321, powerWatts: 123.456789, maintenancePerHour: 0.123456789 },
      spoolLines: [{ name: '  PLA azul  ', consumptionGrams: 12.3456789, purchasePrice: 89.1234567, originalFilamentGrams: 999.8765432 }],
      packagingLines: [
        { name: '  Fita  ', mode: 'per_piece', quantity: 0.123456789, suppliedUnit: 'metro', referencePrice: 3.45678912, referenceQuantity: 2.34567891 },
        { name: '  Papel  ', mode: 'per_lot', quantity: 1.23456789, suppliedUnit: 'grama', referencePrice: 2.12345678, referenceQuantity: 4.56789123 },
      ],
      finishing: { manualTimeHours: 0.23456789, laborPerHour: 13.12345678, fixedCost: 0.45678912 },
      packagingPerPiece: 0.123456789, markupPercent: 34.56789123,
    },
  };
}
function harness(options = {}) {
  const events = [];
  // Explicitly mocked Supabase boundaries; these tests do not execute SQL/RLS.
  const boundaryEvents = [];
  const state = { product: { id: ID, name: 'Produto atual', active: true, version: '7', price: '12.34', deleted_at: null }, role: 'owner', planCode: null, lookup: null, lookupError: null, saveError: null, user: { id: ID }, authError: null, contextCode: null, saveRow: { status: 'created', calculation_id: ID }, applyRow: { status: 'applied', product_id: ID, version: '8', applied_price: '23.45' }, applyError: null, ...options };
  class AuthContextError extends Error { constructor(code) { super(code); this.code = code; } }
  class PlanAccessError extends Error { constructor(code) { super(code); this.code = code; } }
  class PlanTechnicalError extends Error {}
  const load = loader({
    '@/lib/auth/context': { AuthContextError, requireBusinessContext: async permission => { events.push(['permission', permission]); if (state.contextCode) throw new AuthContextError(state.contextCode); return { enterpriseId: 'tenant-a', role: state.role }; } },
    '@/lib/plans': {
      PlanAccessError, PlanTechnicalError,
      planRpcErrorCode: error => error.message === 'idempotency_conflict' ? 'idempotency_conflict' : null,
      requirePlanBusinessAccess: async (...args) => { events.push(['plan', ...args]); if (state.planCode) throw new PlanAccessError(state.planCode); return { effective_plan: 'free' }; },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => { events.push(['auth']); boundaryEvents.push(['session', 'getUser']); return { data: { user: state.user }, error: state.authError }; } },
        rpc: async () => { assert.fail('privileged pricing RPC must not use the session client'); },
        from: table => {
          events.push(['from', table]);
          assert.equal(table, 'products', 'manual pricing must never read paid sources');
          const query = {};
          for (const method of ['select', 'eq', 'is']) query[method] = (...args) => { events.push([method, ...args]); return query; };
          query.maybeSingle = async () => { events.push(['maybeSingle']); return { data: state.product, error: null }; };
          return query;
        },
      }),
      createAdminClient: () => {
        boundaryEvents.push(['service', 'createClient']);
        return { rpc: async (name, args) => {
          boundaryEvents.push(['service', name]);
          events.push(['rpc', name, plain(args)]);
          if (name === 'apply_pricing_price') return { data: [state.applyRow], error: state.applyError };
          if (name === 'lookup_pricing_attempt') return { data: [state.lookup ?? { status: 'missing', calculation_id: null }], error: state.lookupError };
          assert.equal(name, 'save_manual_pricing_attempt');
          // Assert the actual RPC payload satisfies the real V3 contract.
          load('lib/pricing/manual-snapshot.ts').manualSnapshotSchema.parse(args.p_snapshot);
          return { data: [state.saveRow], error: state.saveError };
        } };
      },
    },
    'next/navigation': { unstable_rethrow() {} },
  }, options.env);
  return { state, events, boundaryEvents, load, actions: load('lib/pricing/persistence-actions.ts') };
}
function expectedInput(parsed) {
  const i = parsed.input;
  return {
    quantity: i.quantity, printTimeHours: i.printTimeHours, printer: i.printer, energyRate: i.tariff.effective, lossPercent: i.lossPercent,
    spoolLines: i.spoolLines.map(({ consumptionGrams, purchasePrice, originalFilamentGrams }) => ({ consumptionGrams, purchasePrice, originalFilamentGrams })),
    packagingLines: i.packagingLines.map(({ mode, quantity, referenceQuantity, referencePrice }) => ({ mode, quantity, referenceQuantity, referencePrice, conversionFactor: 1 })),
    finishing: i.finishing, packagingPerPiece: i.packagingPerPiece, markupPercent: i.markupPercent,
  };
}
const rpc = (h, name) => h.events.find(e => e[0] === 'rpc' && e[1] === name)?.[2];

test('real manual action preserves fractional inputs, names and units, and saves every result field from runFdm', async () => {
  const h = harness();
  const input = request();
  const parsed = h.load('lib/pricing/manual.ts').manualFdmSchema.parse(input);
  const expected = expectedInput(parsed);
  const calculated = h.load('lib/pricing/persistence.ts').runFdm(expected);
  assert.equal(calculated.ok, true);
  assert.equal((await h.actions.saveManualFdmPricingAction(input)).ok, true);
  const save = rpc(h, 'save_manual_pricing_attempt');
  assert.ok(save, 'a successful response must actually dispatch a save');
  const snapshot = save.p_snapshot;
  assert.deepEqual(snapshot.input, plain(expected));
  assert.deepEqual(snapshot.result, plain(calculated.data));
  assert.equal(Object.keys(snapshot.result).length, 11);
  assert.equal(save.p_suggested_price, calculated.data.suggestedUnitPrice);
  assert.deepEqual(snapshot.manual_input_references, { spool_names: ['PLA azul'], packaging_names: ['Fita', 'Papel'], packaging_units: ['metro', 'grama'] });
  assert.equal(snapshot.input.printer.name, 'Impressora manual');
  assert.deepEqual(snapshot.units, plain(h.load('lib/pricing/manual-snapshot.ts').MANUAL_UNITS));
  assert.deepEqual(snapshot.config_snapshot, { source: 'manual', energyRate: input.input.tariff.effective });
  assert.deepEqual(snapshot.product_snapshot, { id: ID, name: 'Produto atual', active: true, version: 7, price: 12.34 });
  const { canonicalJson, sha256 } = h.load('lib/pricing/persistence.ts');
  assert.equal(save.p_request_hash, sha256(canonicalJson({ ...parsed, source: 'manual' })));
  assert.equal(save.p_snapshot_hash, sha256(JSON.stringify(snapshot)));
  assert.deepEqual(h.events.filter(e => e[0] === 'from'), [['from', 'products']]);
  assert.deepEqual(h.events.filter(e => e[0] === 'plan'), [['plan']]);
});

for (const unit of ['unidade', 'metro', 'centimetro', 'grama', 'quilograma']) test(`manual packaging retains ${unit} with no implicit conversion or rounding`, async () => {
  const h = harness();
  const input = request();
  input.input.packagingLines[0].suppliedUnit = unit;
  assert.equal((await h.actions.saveManualFdmPricingAction(input)).ok, true);
  const snapshot = rpc(h, 'save_manual_pricing_attempt').p_snapshot;
  assert.equal(snapshot.manual_input_references.packaging_units[0], unit);
  assert.equal(snapshot.input.packagingLines[0].conversionFactor, 1);
  assert.equal(snapshot.input.packagingLines[0].quantity, input.input.packagingLines[0].quantity);
});

for (const [label, mutate] of [
  ['top-level result', r => { r.result = { suggestedUnitPrice: 0.01 }; }],
  ['input result', r => { r.input.result = { total: 0.01 }; }],
  ['input total', r => { r.input.total = 0.01; }],
  ['spool total', r => { r.input.spoolLines[0].total = 0.01; }],
  ['packaging total', r => { r.input.packagingLines[0].total = 0.01; }],
  ['printer total', r => { r.input.printer.total = 0.01; }],
  ['finishing total', r => { r.input.finishing.total = 0.01; }],
]) test(`strict real manual schema rejects client ${label} before auth or persistence`, async () => {
  const h = harness();
  const input = request(); mutate(input);
  const result = await h.actions.saveManualFdmPricingAction(input);
  assert.equal(result.ok, false); assert.equal(result.code, 'invalid');
  assert.deepEqual(h.events, []);
});

test('completed retry recovers frozen intent before plan/role/product reload guards', async () => {
  const h = harness();
  const input = request();
  assert.equal((await h.actions.saveManualFdmPricingAction(input)).ok, true);
  const firstHash = rpc(h, 'lookup_pricing_attempt').p_request_hash;
  h.state.lookup = { status: 'found', calculation_id: ID };
  h.state.product = null; h.state.role = 'member'; h.state.planCode = 'selection_required';
  h.events.length = 0;
  const retry = await h.actions.saveManualFdmPricingAction(input);
  assert.equal(retry.ok, true); assert.equal(retry.data.status, 'idempotent');
  assert.equal(rpc(h, 'lookup_pricing_attempt').p_request_hash, firstHash);
  assert.deepEqual(h.events.map(e => e[0]), ['auth', 'rpc']);
});

test('same attempt with changed request has a different real hash and returns lookup conflict without reload/save', async () => {
  const h = harness(); const input = request();
  assert.equal((await h.actions.saveManualFdmPricingAction(input)).ok, true);
  const original = rpc(h, 'lookup_pricing_attempt').p_request_hash;
  h.events.length = 0;
  h.state.lookupError = { code: 'P0001', message: 'idempotency_conflict' };
  input.input.spoolLines[0].consumptionGrams += 0.000001;
  const result = await h.actions.saveManualFdmPricingAction(input);
  assert.equal(result.ok, false); assert.equal(result.code, 'idempotency_conflict');
  assert.notEqual(rpc(h, 'lookup_pricing_attempt').p_request_hash, original);
  assert.deepEqual(h.events.map(e => e[0]), ['auth', 'rpc']);
});

for (const reason of ['different tenant', 'deleted product hidden by RLS', 'outside free-plan window']) test(`${reason}: null product selection cannot dispatch save`, async () => {
  // Supabase/RLS performs visibility filtering; do not fabricate a visible row
  // and pretend that this unit harness implements tenant or plan policies.
  const h = harness({ product: null });
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false); assert.equal(result.code, 'not_found');
  assert.ok(h.events.some(e => e[0] === 'eq' && e[1] === 'enterprise_id' && e[2] === 'tenant-a'));
  assert.ok(h.events.some(e => e[0] === 'eq' && e[1] === 'id' && e[2] === ID));
  assert.ok(h.events.some(e => e[0] === 'maybeSingle'));
  assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
});

for (const code of ['selection_required', 'member_plan_blocked']) test(`new manual attempt with ${code} stops before product selection`, async () => {
  const h = harness({ planCode: code });
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false); assert.equal(result.code, code);
  assert.ok(rpc(h, 'lookup_pricing_attempt'));
  assert.equal(h.events.some(e => e[0] === 'from'), false);
  assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
});

for (const patch of [{ active: false }, { deleted_at: '2026-10-01T00:00:00Z' }, { version: 8 }]) test(`visible product conflict ${JSON.stringify(patch)} prevents save`, async () => {
  const h = harness(); Object.assign(h.state.product, patch);
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false); assert.equal(result.code, 'conflict');
  assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
});

test('invalid V3 snapshot is rejected before the save RPC, not merely by a mocked database', async () => {
  const h = harness(); h.state.product.price = -1;
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false);
  assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
});

for (const [label, options, code] of [
  ['absent user', { user: null }, 'forbidden'],
  ['missing session', { authError: { name: 'AuthSessionMissingError' } }, 'forbidden'],
  ['getUser technical error', { authError: { name: 'AuthRetryableFetchError' } }, 'unavailable'],
]) test(`mocked Supabase ${label} stops real save/apply before service client creation`, async () => {
  for (const action of ['save', 'apply']) {
    const h = harness(options);
    const result = action === 'save'
      ? await h.actions.saveManualFdmPricingAction(request())
      : await h.actions.applyFdmPricingPriceAction(ID, 7);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.deepEqual(h.boundaryEvents, [['session', 'getUser']]);
    assert.equal(h.events.some(e => e[0] === 'rpc' || e[0] === 'from'), false);
  }
});

for (const reason of ['inactive context', 'password change required']) test(`mocked ${reason} blocks new save and apply`, async () => {
  // Both account states are surfaced by requireBusinessContext as this error;
  // this harness tests action handling, not the auth context implementation.
  for (const action of ['save', 'apply']) {
    const h = harness({ contextCode: 'AUTH_ACCESS_BLOCKED' });
    const result = action === 'save'
      ? await h.actions.saveManualFdmPricingAction(request())
      : await h.actions.applyFdmPricingPriceAction(ID, 7);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'forbidden');
    assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
    assert.equal(rpc(h, 'apply_pricing_price'), undefined);
    assert.equal(h.events.some(e => e[0] === 'from'), false);
    assert.equal(Boolean(rpc(h, 'lookup_pricing_attempt')), action === 'save');
  }
});

for (const role of ['operator', 'member']) test(`new manual save rejects ${role} at explicit owner check`, async () => {
  const h = harness({ role });
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'forbidden');
  assert.deepEqual(h.events.filter(e => e[0] === 'permission'), [['permission', 'pricing.write']]);
  assert.ok(rpc(h, 'lookup_pricing_attempt'));
  assert.equal(h.events.some(e => e[0] === 'from'), false);
  assert.equal(rpc(h, 'save_manual_pricing_attempt'), undefined);
});

for (const env of [
  { SUPABASE_AUTH_ISSUER: undefined },
  { SUPABASE_AUTH_ISSUER: 'https://other.example.test/auth/v1' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://user:password@local.example.test' },
]) test(`invalid issuer configuration fails closed: ${JSON.stringify(env)}`, async () => {
  const h = harness({ env });
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unavailable');
  assert.deepEqual(h.boundaryEvents, [['session', 'getUser']]);
});

for (const operation of ['lookup_pricing_attempt', 'save_manual_pricing_attempt', 'apply_pricing_price']) {
  for (const message of ['permission denied for function', 'actor mismatch', 'access blocked']) {
    test(`mocked SQLSTATE 42501 ${operation}: ${message} maps to forbidden`, async () => {
      const key = { lookup_pricing_attempt: 'lookupError', save_manual_pricing_attempt: 'saveError', apply_pricing_price: 'applyError' }[operation];
      const h = harness({ [key]: { code: '42501', message } });
      const result = operation === 'apply_pricing_price'
        ? await h.actions.applyFdmPricingPriceAction(ID, 7)
        : await h.actions.saveManualFdmPricingAction(request());
      assert.equal(result.ok, false);
      assert.equal(result.code, 'forbidden');
      assert.ok(rpc(h, operation));
      if (operation === 'lookup_pricing_attempt') assert.deepEqual(h.events.map(e => e[0]), ['auth', 'rpc']);
    });
  }
}

for (const field of ['p_actor', 'actor', 'p_issuer']) test(`client cannot override backend ${field}`, async () => {
  const h = harness();
  const input = { ...request(), [field]: ID };
  const result = await h.actions.saveManualFdmPricingAction(input);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid');
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.boundaryEvents, []);
});

test('real save and apply/replay use session getUser then service-only RPCs with frozen intent (mocked Supabase)', async () => {
  const h = harness({ user: { id: ATTEMPT } });
  const input = request();
  assert.notEqual(h.state.user.id, input.productId);
  const saved = await h.actions.saveManualFdmPricingAction(input);
  assert.deepEqual(plain(saved), { ok: true, data: { pricingId: ID, status: 'created' } });
  assert.deepEqual(h.boundaryEvents, [
    ['session', 'getUser'], ['service', 'createClient'],
    ['service', 'lookup_pricing_attempt'], ['service', 'save_manual_pricing_attempt'],
  ]);
  const lookup = rpc(h, 'lookup_pricing_attempt');
  const save = rpc(h, 'save_manual_pricing_attempt');
  for (const args of [lookup, save]) {
    assert.equal(args.p_actor, h.state.user.id);
    assert.equal(args.p_issuer, 'https://local.example.test/auth/v1');
    assert.equal(args.p_attempt_id, input.attemptId);
    assert.equal(args.p_request_hash, lookup.p_request_hash);
  }
  for (const status of ['applied', 'idempotent']) {
    h.events.length = 0; h.boundaryEvents.length = 0;
    h.state.applyRow.status = status;
    const result = await h.actions.applyFdmPricingPriceAction(saved.data.pricingId, 7);
    assert.deepEqual(plain(result), { ok: true, data: { productId: ID, version: 8, price: 23.45, status } });
    assert.deepEqual(rpc(h, 'apply_pricing_price'), {
      p_actor: h.state.user.id, p_issuer: 'https://local.example.test/auth/v1',
      p_calculation_id: saved.data.pricingId, p_expected_product_version: 7,
    });
    assert.deepEqual(h.boundaryEvents, [['session', 'getUser'], ['service', 'createClient'], ['service', 'apply_pricing_price']]);
    assert.deepEqual(plain(h.events.filter(e => e[0] === 'plan')), [['plan', { apply: true }]]);
    assert.equal(h.events.some(e => e[0] === 'from'), false);
  }
});

for (const status of ['created', 'idempotent']) test(`mocked save RPC ${status} receipt is parsed by real action`, async () => {
  const h = harness({ saveRow: { status, calculation_id: ID } });
  const result = await h.actions.saveManualFdmPricingAction(request());
  assert.deepEqual(plain(result), { ok: true, data: { pricingId: ID, status } });
});

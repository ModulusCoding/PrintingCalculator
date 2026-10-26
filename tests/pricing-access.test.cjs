/* eslint-disable @typescript-eslint/no-require-imports -- Node CJS harness for isolated server actions without Next runtime. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { z } = require('zod');
function load(file, imports) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: sandboxModule, exports: sandboxModule.exports, require: name => {
    if (name in imports) return imports[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }, console, URL, process });
  return sandboxModule.exports;
}
const safe = load('lib/diagnostics/safe-error.ts', { zod: { z } });
test('preserves SQL code/message without row values, tokens or personal data', () => {
  const result = safe.safeErrorDiagnostic({ code: '42501', message: 'permission denied for table products', details: "Key (email)=(person@example.com) already exists.", hint: "password=secret 'private value'" });
  assert.equal(result.code, '42501');
  assert.match(result.technical_detail, /permission denied/);
  assert.doesNotMatch(result.technical_detail, /person@|secret|private value/);
});
test('Zod diagnostics include paths and issue codes, not values', () => {
  const parsed = z.object({ version: z.number() }).safeParse({ version: 'private' });
  assert.deepEqual(JSON.parse(JSON.stringify(safe.safeErrorDiagnostic(parsed.error))), { code: 'ZOD_PARSE_ERROR', technical_detail: 'version:invalid_type' });
});
function actionHarness({ rows = [], error = null, accessError = null, manual = false } = {}) {
  const events = [], logs = [];
  const request = {};
  for (const method of ['select', 'eq', 'is', 'order', 'ilike']) request[method] = (...args) => { events.push([method, ...args]); return request; };
  request.range = async () => ({ data: rows, count: rows.length, error });
  request.maybeSingle = async () => ({ data: rows[0] ?? null, error });
  class PlanAccessError extends Error { constructor(code) { super(code); this.code = code; } }
  class PlanTechnicalError extends Error {}
  class AuthContextError extends Error {}
  const actions = load('lib/pricing/persistence-actions.ts', {
    zod: { z }, '@/lib/auth/context': { AuthContextError, requireBusinessContext: async permission => { events.push(['permission', permission]); return { enterpriseId: 'enterprise', role: 'owner' }; } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'a2f9472d-c017-42dd-b0d5-56e4b5650690' } }, error: null }) }, from: table => { events.push(['from', table]); return request; } }), createAdminClient: () => ({ rpc: async (name, args) => { events.push(['rpc', name, args]); return name === 'lookup_pricing_attempt' ? { data: [{ status: 'missing', calculation_id: null }], error: null } : { data: [{ status: 'created', calculation_id: 'a2f9472d-c017-42dd-b0d5-56e4b5650690' }], error: null }; } }) },
    './persistence': { canonicalJson: JSON.stringify, sha256: () => 'hash', runFdm: () => ({ ok: true, data: { suggestedUnitPrice: 12 } }) }, '@/lib/spools/schemas': {}, '@/lib/general-materials/schemas': {}, './manual': { manualFdmSchema: { safeParse: input => ({ success: manual, data: input }) } },
    '@/lib/general-materials/logger': { createLogger: () => ({ id: '12345678' }) },
    'next/navigation': { unstable_rethrow: () => {} },
    '@/lib/plans': { PlanAccessError, PlanTechnicalError, requirePlanBusinessAccess: async () => { events.push(['plan']); if (accessError) throw new PlanAccessError(accessError); return { effective_plan: 'free' }; } },
    '@/lib/diagnostics/action-handler': { pricingPlanMessage: code => code, logPricingFailure: (_, error, metadata) => { logs.push({ ...metadata, ...safe.safeErrorDiagnostic(error) }); return '12345678'; } },
  });
  return { actions, events, logs };
}
test('free product lookup resolves authorization first, isolates enterprise, excludes deleted/archived, queries no paid sources', async () => {
  const h = actionHarness({ rows: [{ id: 'a2f9472d-c017-42dd-b0d5-56e4b5650690', name: 'Produto', active: true, version: '1', price: '12.30', deleted_at: null }] });
  const result = await h.actions.searchProductsAction();
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 1);
  assert.equal(h.events[0][0], 'plan');
  assert.deepEqual(h.events.filter(e => e[0] === 'from'), [['from', 'products']]);
  assert.ok(h.events.some(e => e[0] === 'eq' && e[1] === 'enterprise_id' && e[2] === 'enterprise'));
  assert.ok(h.events.some(e => e[0] === 'is' && e[1] === 'deleted_at' && e[2] === null));
});
test('empty accessible products is success, not technical failure', async () => {
  const h = actionHarness();
  const result = await h.actions.searchProductsAction();
  assert.equal(result.ok, true); assert.equal(result.data.items.length, 0); assert.equal(h.logs.length, 0);
});
test('database failure is not an empty list and keeps original code at query stage', async () => {
  const h = actionHarness({ error: { code: '42501', message: 'permission denied for table products' } });
  assert.equal((await h.actions.searchProductsAction()).ok, false);
  assert.equal(h.logs[0].stage, 'query'); assert.equal(h.logs[0].code, '42501'); assert.equal(h.logs[0].operation, 'products.select');
});
test('invalid product response is diagnosed at interpretation, not query', async () => {
  const h = actionHarness({ rows: [{ id: 'invalid' }] });
  assert.equal((await h.actions.searchProductsAction()).ok, false);
  assert.equal(h.logs[0].stage, 'interpretation'); assert.equal(h.logs[0].code, 'ZOD_PARSE_ERROR');
});
test('manual save recalculates V3 on server using products only, never paid sources', async () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, oldIssuer = process.env.SUPABASE_AUTH_ISSUER;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://local.example.test';
  process.env.SUPABASE_AUTH_ISSUER = 'https://local.example.test/auth/v1';
  try {
    const h = actionHarness({ manual: true, rows: [{ id: 'a2f9472d-c017-42dd-b0d5-56e4b5650690', name: 'Produto', active: true, version: 1, price: 10, deleted_at: null }] });
    const response = await h.actions.saveManualFdmPricingAction({ attemptId: 'attempt', productId: 'a2f9472d-c017-42dd-b0d5-56e4b5650690', productVersion: 1, input: { quantity: 1, printTimeHours: 1, printer: {}, tariff: { effective: 1 }, lossPercent: 0, spoolLines: [], packagingLines: [], finishing: {}, packagingPerPiece: 0, markupPercent: 0 } });
    assert.equal(response.ok, true);
    assert.deepEqual(h.events.filter(e => e[0] === 'from'), [['from', 'products']]);
    const save = h.events.find(e => e[0] === 'rpc' && e[1] === 'save_manual_pricing_attempt');
    assert.equal(save[2].p_snapshot.schema_version, '3');
    assert.equal(save[2].p_snapshot.source, 'manual');
    assert.equal(save[2].p_snapshot.result.suggestedUnitPrice, 12);
  } finally {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldIssuer === undefined) delete process.env.SUPABASE_AUTH_ISSUER; else process.env.SUPABASE_AUTH_ISSUER = oldIssuer;
  }
});
for (const code of ['selection_required', 'member_plan_blocked']) test(`${code} stops before product query`, async () => {
  const h = actionHarness({ accessError: code });
  assert.equal((await h.actions.searchProductsAction()).code, code);
  assert.equal(h.events.length, 1); assert.equal(h.logs.length, 0);
});

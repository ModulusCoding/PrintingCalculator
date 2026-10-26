/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { z } = require('zod');
function load(file, imports) {
  const sandbox = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module: sandbox, exports: sandbox.exports, require: name => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
  return sandbox.exports;
}
class PlanTechnicalError extends Error {}
class PlanAccessError extends Error {}
const capabilities = { free: { products: 3, sharedMaterials: 0 }, intermediate: { products: null, sharedMaterials: 15 } };
function capacity(plan, used, error = null) {
  const options = [];
  return { options, api: load('lib/plans/creation-access.ts', {
    'server-only': {}, zod: { z }, 'next/navigation': { unstable_rethrow() {} },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (_name, args) => ({ data: [{ used, capacity_limit: plan === 'free' ? 3 : args.p_resource === 'products' ? null : 15 }], error }) }) },
    '@/lib/general-materials/logger': { createLogger: () => ({ error: () => 'reference' }) },
    '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({ code: 'technical' }) },
    '@/lib/plans': { PLAN_CAPABILITIES: capabilities, PlanTechnicalError, PlanAccessError, planRpcErrorCode: () => null, requirePlanBusinessAccess: async opt => { options.push(opt); return { effective_plan: plan }; } },
  }) };
}
test('paid capability is explicit and never inferred from a route group or quota', () => {
  const { permissionRequiresVisionario } = load('lib/plans/permission-capabilities.ts', {});
  for (const permission of ['products.read', 'products.write', 'products.delete', 'pricing.read', 'pricing.write', 'sales.read']) assert.equal(permissionRequiresVisionario(permission), false, permission);
  for (const permission of ['printers.read', 'spools.write', 'stock.materials.read', 'materials.read']) assert.equal(permissionRequiresVisionario(permission), true, permission);
});
test('three products block only new creation, not paid entitlement', async () => {
  for (const used of [0, 2, 3, 5]) {
    const h = capacity('free', used), result = await h.api.getCreationCapacity('products');
    assert.equal(result.canCreate, used < 3); assert.equal(result.limit, 3); assert.equal(h.options[0].paid, false);
  }
});
test('Visionario unlimited products and shared15 is creation-only', async () => {
  assert.equal((await capacity('intermediate', 100).api.getCreationCapacity('products')).canCreate, true);
  for (const used of [14, 15, 16]) {
    const h = capacity('intermediate', used), result = await h.api.getCreationCapacity('shared_materials');
    assert.equal(result.canCreate, used < 15); assert.equal(h.options[0].paid, true);
  }
});
test('invalid usage and database failure never invent zero or free', async () => {
  await assert.rejects(capacity('free', null).api.getCreationCapacity('products'), PlanTechnicalError);
  await assert.rejects(capacity('intermediate', 1, { code: 'FAIL' }).api.getCreationCapacity('shared_materials'), PlanTechnicalError);
});
test('unknown/inconsistent business plan response is technical, not free or upgrade', async () => {
  for (const row of [
    { status: 'allowed', effective_plan: 'free', access_state: 'unknown' },
    { status: 'allowed', effective_plan: 'free', access_state: 'paid' },
    { status: 'allowed', effective_plan: 'intermediate', access_state: 'expired' },
  ]) {
    const api = load('lib/plans.ts', {
      'server-only': {}, zod: { z }, 'next/navigation': { unstable_rethrow() {} },
      '@/lib/supabase/server': { createClient: async () => ({ rpc: async () => ({ data: [row], error: null }) }) },
      '@/lib/general-materials/logger': { createLogger: () => ({ error: () => 'reference' }) },
      '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({ code: 'parse' }) },
    });
    await assert.rejects(api.requirePlanBusinessAccess({ paid: true }), error => error instanceof api.PlanTechnicalError);
  }
});

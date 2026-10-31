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
  vm.runInNewContext(js, { module: sandbox, exports: sandbox.exports, require: name => {
    if (!(name in imports)) throw new Error(`Unmocked ${name}`);
    return imports[name];
  } });
  return sandbox.exports;
}
class AuthContextError extends Error {}
class PlanAccessError extends Error { constructor(code) { super(code); this.code = code; } }
class PlanTechnicalError extends Error { constructor(reference) { super('private diagnostic'); this.correlationId = reference; } }
const interrupt = new Error('NEXT_REDIRECT');
const access = load('lib/products/access.ts', {
  'server-only': {},
  'next/navigation': { unstable_rethrow(error) { if (error === interrupt) throw error; } },
  '@/lib/auth/context': { AuthContextError },
  '@/lib/plans': { PlanAccessError, PlanTechnicalError },
  '@/lib/plans/creation-access': {},
  '@/lib/general-materials/logger': { createLogger: () => ({ error: () => 'safe-reference' }) },
  '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({ code: 'FAIL' }) },
});
test('product failures preserve semantic access, sanitized reference and Next control flow', () => {
  assert.equal(access.productFailure(new PlanAccessError('selection_required')).status, 'selection_required');
  const failure = access.productFailure(new PlanTechnicalError('plan-ref'));
  assert.equal(failure.status, 'technical');
  assert.equal(failure.reference, 'plan-ref');
  assert.equal(JSON.stringify(failure).includes('private diagnostic'), false);
  assert.throws(() => access.productFailure(interrupt), error => error === interrupt);
});
function actions(response) {
  const query = { select() { return this; }, eq() { return this; }, is() { return this; }, maybeSingle: async () => response };
  return load('lib/products/actions.ts', {
    'next/cache': { revalidatePath() {} }, zod: { z },
    '@/lib/auth/context': { requireBusinessContext: async () => ({ enterpriseId: 'enterprise' }) },
    '@/lib/products/access': access,
    '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
    '@/lib/diagnostics/load-trace': {}, '@/lib/plans': {},
  });
}
const id = '11111111-1111-4111-8111-111111111111';
test('product query error is technical, never unavailable; empty window returns no attributes', async () => {
  const failed = await actions({ data: { name: 'private' }, error: { code: 'FAIL' } }).getInternalProduct(id);
  assert.equal(failed.error, 'technical');
  assert.equal(failed.product, null);
  assert.equal(failed.reference, 'safe-reference');
  const hidden = await actions({ data: null, error: null }).getInternalProduct(id);
  assert.equal(hidden.error, 'product_unavailable');
  assert.equal(hidden.product, null);
});

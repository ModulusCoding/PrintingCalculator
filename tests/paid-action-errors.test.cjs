/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node CJS server action harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
class PlanAccessError extends Error { constructor(code) { super(code); this.code = code; } }
class AuthContextError extends Error {}
const frameworkError = new Error('framework control flow');
let thrown;
let logs = 0;
let clients = 0;
let paidChecks = 0;
let allowDatabase = false;
const stages = [];
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const sandboxModule = { exports: {} }; cache.set(filename, sandboxModule);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const requireMock = (id) => {
    if (id === 'next/navigation') return { unstable_rethrow: e => { if (e === frameworkError) throw e; } };
    if (id === 'next/cache') return { revalidatePath() {} };
    if (id === '@/lib/auth/context') return { AuthContextError, requireBusinessContext: async permission => { if (permission === 'enterprise.manage') return { role: 'owner' }; if (!allowDatabase) throw thrown; return { role: 'owner' }; } };
    if (id === '@/lib/plans') return { planErrorCode: e => e instanceof PlanAccessError ? e.code : null, planRpcErrorCode: () => null, requirePlanBusinessAccess: async options => { assert.equal(options.paid, true); paidChecks++; throw thrown; } };
    if (id === '@/lib/supabase/server') return { createClient: async () => { clients++; if (allowDatabase) return { rpc: async () => ({ data: [{ invalid: 'private value' }], error: null }) }; throw new Error('unexpected database access'); } };
    if (id === '@/lib/deletion/actions') return { deleteEntity() { throw new Error('not in scope'); } };
    if (id === './logger') return { createLogger: () => ({ id: 'test', error: event => { logs++; stages.push(event); return 'test'; }, warn() {} }) };
    if (id.startsWith('@/') || id.startsWith('.')) {
      const target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
      return load(target + '.ts');
    }
    return require(id);
  };
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})', { filename })(requireMock, sandboxModule, sandboxModule.exports);
  return sandboxModule.exports;
}
test('paid action denials, technical failures and threshold paid guard', async () => {
  const general = load(path.join(root, 'lib/general-materials/actions.ts'));
  const spools = load(path.join(root, 'lib/spools/actions.ts'));
  const materials = load(path.join(root, 'lib/materials/actions.ts'));
  const printers = load(path.join(root, 'lib/printers/actions.ts'));
  const inventory = load(path.join(root, 'lib/inventory/actions.ts'));
  const id = '12345678-1234-4234-8234-123456789abc';
  const reads = [() => general.listGeneralMaterials(), () => general.getGeneralMaterial(id), () => spools.listSpools(), () => spools.getSpool(id), () => spools.searchMaterials({}), () => spools.getSpoolConfig(), () => materials.listMaterials(), () => materials.getMaterial(id), () => printers.listPrinters(), () => printers.getPrinter(id), () => inventory.listProductInventory(), () => inventory.getProductInventoryDetail(id)];
  const writes = [
    () => general.setGeneralMaterialActive({ attempt_id: id, material_id: id, expected_version: 0, active: false }),
    () => spools.setSpoolActive({ spool_id: id, expected_version: 0, active: false }),
    () => materials.setMaterialActive(id, 0, false),
    () => printers.setPrinterActive(id, 0, false),
    () => inventory.moveProductInventory({ attemptId: id, productId: id, expectedVersion: 0, movementType: 'entry', quantity: '1', reason: 'Teste' }),
  ];
  for (const code of ['selection_required', 'plan_feature_unavailable', 'member_plan_blocked', 'team_regularization_required', 'plan_limit_reached']) {
    thrown = new PlanAccessError(code);
    logs = 0;
    for (const read of reads) assert.equal((await read()).error, code);
    for (const write of writes) assert.equal((await write()).status, code);
    assert.equal((await spools.updateSpoolThreshold({ threshold: '20', expected_version: 0 })).status, code);
    assert.equal(logs, 0, 'Expected plan denial must not produce technical logs');
    assert.equal(clients, 0, 'Denied actions must stop before database access');
  }
  assert.equal(paidChecks, 5, 'Owner threshold changes must explicitly check paid access');
  thrown = new Error('real technical failure');
  for (const read of reads) assert.equal((await read()).error, 'technical');
  assert.ok(logs > 0, 'Real technical failures must still be logged');
  thrown = frameworkError;
  for (const read of reads) await assert.rejects(read, e => e === frameworkError);
  await assert.rejects(() => spools.updateSpoolThreshold({ threshold: '20', expected_version: 0 }), e => e === frameworkError);
  allowDatabase = true;
  assert.equal((await general.listGeneralMaterials()).error, 'technical');
  assert.equal(stages.at(-1).stage, 'interpretation');
  assert.equal(stages.at(-1).code, 'ZOD_PARSE_ERROR');
  assert.doesNotMatch(JSON.stringify(stages.at(-1)), /private value/);
  console.log('Paid action error contracts: 12 reads, owner threshold guard, technical failures and Next.js rethrow passed.');
});

/* eslint-disable @typescript-eslint/no-require-imports -- Local domain action harness; no network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const id = '11111111-1111-4111-8111-111111111111';
function harness() {
  const calls = [];
  const loaded = { exports: {} };
  const imports = {
    'zod': require('zod'),
    'next/cache': { revalidatePath() {} },
    'next/navigation': { unstable_rethrow() {} },
    '@/lib/plans': { planErrorCode: () => null, planRpcErrorCode: () => null },
    '@/lib/auth/context': { AuthContextError: class extends Error {}, requireBusinessContext: async permission => { calls.push({ permission }); return { enterpriseId: id }; } },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (method, args) => { calls.push({ method, args }); return { data: [{ status: 'success', printer_id: id, version: 1 }], error: null }; } }) },
  };
  const code = ts.transpileModule(fs.readFileSync('lib/printers/actions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: name => { assert.ok(name in imports, name); return imports[name]; } });
  return { actions: loaded.exports, calls };
}
const payload = { name: '  Impressora 01 ', brand: '', model: '', purchasePrice: '1250,50', estimatedLifeHours: '6000', averagePowerWatts: '250,25', maintenanceCostPerHour: '0,1234' };
test('real create action keeps numeric precision, optional fields and domain permission', async () => {
  const h = harness();
  assert.equal((await h.actions.createPrinter(payload)).status, 'success');
  assert.equal(h.calls[0].permission, 'printers.write');
  const rpc = h.calls[1];
  assert.equal(rpc.method, 'create_my_printer');
  assert.equal(rpc.args.p_name, 'Impressora 01');
  assert.equal(rpc.args.p_purchase_price, '1250.50');
  assert.equal(rpc.args.p_maintenance_cost_per_hour, '0.1234');
  assert.equal(rpc.args.p_brand, '', 'existing action contract: SQL normalization risk documented, not changed');
});
test('real actions reject pasted invalid numerics before context or RPC', async () => {
  for (const [field, values] of Object.entries({ purchasePrice: ['-1', 'abc', '1.000,00', '1.50', '1,001', '1000000,01'], estimatedLifeHours: ['0', '1,5', '100001'], averagePowerWatts: ['0', '10000,01', '1,001'], maintenanceCostPerHour: ['-1', '1000,0001', '0,12345'] })) {
    for (const value of values) {
      const h = harness();
      const result = await h.actions.createPrinter({ ...payload, [field]: value });
      assert.equal(result.status, 'invalid_input', `${field}: ${value}`);
      assert.ok(result.fieldErrors[field]);
      assert.equal(h.calls.length, 0);
    }
  }
});
test('update and archive preserve version and distinct permission contracts', async () => {
  const h = harness();
  assert.equal((await h.actions.updatePrinter(id, 7, payload)).status, 'success');
  assert.equal(h.calls[1].args.p_expected_version, 7);
  assert.equal(h.calls[1].method, 'update_my_printer');
  assert.equal((await h.actions.setPrinterActive(id, 8, false)).status, 'success');
  assert.equal(h.calls[2].permission, 'printers.archive');
  assert.equal(h.calls[3].args.p_active, false);
  assert.equal(h.calls[3].args.p_expected_version, 8);
});

/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness, no Next server required. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
class PlanAccessError extends Error { constructor(code) { super(code); this.code = code; } }
function harness(error, state = 'free', lookupError = null) {
  const events = [];
  const imports = {
    'server-only': {},
    'react/jsx-runtime': { jsx: (component, props) => component(props) },
    'next/navigation': { unstable_rethrow: error => { if (error?.nextControl) throw error; } },
    '@/lib/plans/permission-capabilities': { permissionRequiresVisionario: permission => /^(stock\.materials\.|printers\.|materials\.|spools\.|inventory\.)/.test(permission) },
    '@/lib/auth/context': { requireBusinessContext: async permission => { events.push(['authorize', permission]); if (error) throw error; } },
    '@/lib/plans': { PlanAccessError, getMyPlanAccess: async () => { events.push(['plan']); if (lookupError) throw lookupError; return { access_state: state }; } },
    './PaidModuleNotice': { PaidModuleNotice: props => ({ notice: props }) },
    './PlanAccessNotice': { planAccessNotice: error => ({ blocked: error.code ?? 'technical' }) },
  };
  const sandbox = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('components/plans/PaidModuleGate.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: sandbox, exports: sandbox.exports, require: name => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
  return { events, run: () => sandbox.exports.renderPaidModule('generalMaterials', 'stock.materials.read', async () => { events.push(['paid-query']); return 'operational'; }) };
}
test('free module blocks paid loader and renders presentation', async () => {
  const h = harness(new PlanAccessError('plan_feature_unavailable'));
  const result = await h.run();
  assert.equal(result.notice.module, 'generalMaterials'); assert.equal(result.notice.downgraded, false);
  assert.ok(!h.events.some(e => e[0] === 'paid-query'));
});
for (const state of ['expired', 'cancelled']) test(`${state} uses only authorized plan state for preservation message`, async () => {
  const h = harness(new PlanAccessError('plan_feature_unavailable'), state);
  assert.equal((await h.run()).notice.downgraded, true);
  assert.equal(h.events.length, 2);
});
for (const code of ['member_plan_blocked', 'selection_required', 'team_regularization_required', 'AUTH_PERMISSION_DENIED']) test(`${code} never invokes loader or upgrade presentation`, async () => {
  const h = harness(Object.assign(new Error(), { code }));
  assert.equal((await h.run()).blocked, code); assert.equal(h.events.length, 1);
});
test('technical plan lookup failure does not become commercial presentation', async () => {
  const h = harness(new PlanAccessError('plan_feature_unavailable'), 'free', new Error('DB unavailable'));
  assert.equal((await h.run()).blocked, 'technical'); assert.equal(h.events.length, 2);
});
test('authorized Visionario executes operational loader after authorization', async () => {
  const h = harness(null); assert.equal(await h.run(), 'operational');
  assert.deepEqual(h.events, [['authorize', 'stock.materials.read'], ['paid-query']]);
});
test('every paid page gates its operational function, including direct/new/detail/config routes', () => {
  const roots = ['impressoras', 'materiais', 'estoque/carreteis', 'estoque/materiais-gerais', 'estoque/produtos'];
  let count = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'page.tsx') {
        count++;
        const source = fs.readFileSync(path, 'utf8');
        assert.match(source, /return renderPaidModule\(/, path);
        assert.match(source, /\(\) => \w+\(/, path);
        assert.doesNotMatch(source, /generateMetadata/, 'record metadata requires a separate authorization check');
      }
    }
  }
  for (const root of roots) visit(`app/(authenticated)/${root}`);
  assert.equal(count, 15);
  const shell = fs.readFileSync('app/(authenticated)/AuthenticatedShell.tsx', 'utf8');
  assert.match(shell, /href=\{href\}/, 'locked sidebar must still open module presentation');
});
test('Next control flow is preserved', async () => {
  const error = Object.assign(new Error('redirect'), { nextControl: true });
  await assert.rejects(harness(error).run(), value => value === error);
});

/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

for (const [route, formName] of [['carreteis', 'NewSpoolForm'], ['materiais-gerais', 'NewGeneralMaterialForm']]) {
  function load(capacity, blocked = false) {
    const events = [];
    const jsx = (type, props) => ({ type, props });
    const imports = {
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'next/link': { default: 'link' },
      '@/components/spools/SpoolPages.module.css': { default: {} },
      [`@/components/${route === 'carreteis' ? 'spools/SpoolForms' : 'general-materials/GeneralMaterialForms'}`]: { [formName]: formName },
      '@/components/plans/PaidModuleGate': { renderPaidModule: async (module, permission, loader) => { events.push(['gate', module, permission]); return blocked ? 'blocked' : loader(); } },
      '@/components/plans/CreationLimitNotice': { CreationLimitNotice: 'limit-notice' },
      '@/lib/plans/creation-access': { getCreationCapacity: async resource => { events.push(['capacity', resource]); if (capacity instanceof Error) throw capacity; return capacity; } },
    };
    const sandbox = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(`app/(authenticated)/estoque/${route}/novo/page.tsx`, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module: sandbox, exports: sandbox.exports, require: name => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
    return { events, run: sandbox.exports.default };
  }
  test(`${route}: quota is evaluated only after the paid permission gate`, async () => {
    const h = load(new Error('must not query'), true);
    assert.equal(await h.run(), 'blocked');
    assert.equal(h.events.length, 1);
  });
  test(`${route}: shared15 shows creation notice instead of form`, async () => {
    const h = load({ limit: 15, used: 15, canCreate: false });
    const result = await h.run();
    assert.equal(result.type, 'limit-notice');
    assert.equal(result.props.used, 15);
    assert.equal(result.props.limit, 15);
    assert.equal(result.props.backHref, `/estoque/${route}`);
    assert.equal(h.events[1][1], 'shared_materials');
  });
  test(`${route}: below quota keeps form; usage failure propagates`, async () => {
    const result = await load({ limit: 15, used: 14, canCreate: true }).run();
    assert.ok(result.props.children.some(child => child.type === formName));
    const failure = new Error('usage unavailable');
    await assert.rejects(load(failure).run(), error => error === failure);
  });
  test(`${route}: list never queries quota and keeps new link accessible`, () => {
    const source = fs.readFileSync(`app/(authenticated)/estoque/${route}/page.tsx`, 'utf8');
    assert.doesNotMatch(source, /getCreationCapacity|creation-access|canCreate/);
    assert.ok(source.includes(`/estoque/${route}/novo`));
    assert.match(source, /return renderPaidModule\(/);
  });
}

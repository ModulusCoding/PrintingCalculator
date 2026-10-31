/* eslint-disable @typescript-eslint/no-require-imports -- Local VM harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('components/spools/SpoolListFocus.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
test('return from detail focuses only a matching spool UUID fragment', () => {
  for (const hash of ['#spool-11111111-1111-4111-8111-111111111111', '#bad-selector[]', '#spool-not-an-id', '']) {
    const loaded = { exports: {} }; let focused = 0; let queried = 0;
    vm.runInNewContext(code, { exports: loaded.exports, module: loaded, require: () => ({ useEffect: fn => fn() }), window: { location: { hash } }, document: { getElementById: () => { queried++; return { focus: () => focused++ }; } } });
    assert.equal(loaded.exports.SpoolListFocus(), null);
    assert.equal(focused, hash.startsWith('#spool-111') ? 1 : 0);
    assert.equal(queried, focused);
  }
});

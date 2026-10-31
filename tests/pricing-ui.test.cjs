/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, imports) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: sandboxModule, exports: sandboxModule.exports, require: name => imports[name] ?? require(name) });
  return sandboxModule.exports;
}
test('manual V3 history renders stored references with optional legacy units', () => {
  const { PricingSnapshotSources, isManualPricingSnapshot } = load('components/pricing/PricingSnapshotSources.tsx', {});
  const snapshot = { schema_version: '3', source: 'manual', manual_input_references: { spool_names: ['PLA salvo'], packaging_names: ['Caixa salva'] } };
  assert.equal(isManualPricingSnapshot(snapshot), true);
  let html = renderToStaticMarkup(React.createElement(PricingSnapshotSources, { snapshot }));
  assert.match(html, /PLA salvo/);
  assert.match(html, /Caixa salva/);
  snapshot.manual_input_references.packaging_units = ['unidade'];
  html = renderToStaticMarkup(React.createElement(PricingSnapshotSources, { snapshot }));
  assert.match(html, /Caixa salva \(unidade\)/);
});
test('review transport rejection releases lock and allows another review', async () => {
  let calls = 0;
  const { ApplyPricingButton } = load('components/pricing/ApplyPricingButton.tsx', {
    react: { useRef: value => ({ current: value }), useState: value => [value, () => {}] },
    '@/lib/pricing/persistence-actions': { getPricingReviewAction: async () => { calls++; throw new Error('network'); } },
  });
  const tree = ApplyPricingButton({ pricingId: 'saved' });
  const button = tree.props.children[1];
  await button.props.onClick();
  await button.props.onClick();
  assert.equal(calls, 2);
});

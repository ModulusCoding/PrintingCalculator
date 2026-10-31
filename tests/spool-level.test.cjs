/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TS/JSX harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('components/spools/SpoolLevel.tsx', 'utf8');
const css = fs.readFileSync('components/spools/SpoolLevel.module.css', 'utf8');
const loaded = { exports: {} };
const jsx = (type, props) => ({ type, props });
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { module: loaded, exports: loaded.exports, require: name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === './SpoolLevel.module.css') return { default: new Proxy({}, { get: (_, key) => key }) };
  throw new Error(`Unexpected dependency ${name}`);
} });
const render = overrides => loaded.exports.SpoolLevel({ remainingGrams: 500, referenceGrams: 1000, lowThresholdPercent: 20, label: 'PLA 01', ...overrides });
function all(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => all(child, predicate))]; }
const visual = node => all(node, n => n.props?.role)[0];
const arcs = node => all(node, n => n.type === 'circle' && 'strokeDashoffset' in n.props);
const arc = node => arcs(node).at(-1);
const text = node => JSON.stringify(node);
for (const [remaining, expected] of [[1000,100], [750,75], [500,50], [250,25], [1,0.1], [0,0]]) {
  test(`real balance ${remaining} produces ${expected}%`, () => {
    const tree = render({ remainingGrams: remaining });
    assert.equal(visual(tree).props['aria-valuenow'], expected);
    assert.ok(Math.abs(arc(tree).props.strokeDashoffset - 2 * Math.PI * 67 * (1 - expected / 100)) < 1e-9);
    assert.match(text(tree), new RegExp(remaining === 0 ? 'Esgotado' : expected <= 20 ? 'Estoque baixo' : 'Saldo disponível'));
  });
}
test('threshold equality and endpoints follow backend <= rule; empty is distinct', () => {
  assert.match(text(render({ remainingGrams: 200 })), /Estoque baixo/);
  assert.match(text(render({ remainingGrams: 1, lowThresholdPercent: 0 })), /Saldo disponível/);
  assert.match(text(render({ remainingGrams: 1000, lowThresholdPercent: 100 })), /Estoque baixo/);
  assert.match(text(render({ remainingGrams: 0, lowThresholdPercent: 100 })), /Esgotado/);
});
for (const balance of [null, -1, NaN, Infinity, undefined]) test(`invalid balance ${balance} never becomes empty`, () => {
  const tree = render({ remainingGrams: balance });
  assert.equal(visual(tree).props.role, 'img'); assert.equal(arc(tree), undefined);
  assert.match(text(tree), /Saldo indisponível/); assert.doesNotMatch(text(tree), /Esgotado/);
});
for (const reference of [null, 0, -1, Infinity]) test(`invalid reference ${reference} never assumes 1kg`, () => {
  const tree = render({ referenceGrams: reference });
  assert.equal(visual(tree).props.role, 'img'); assert.equal(arc(tree), undefined);
  assert.match(text(tree), /500 g/); assert.match(text(tree), /Percentual indisponível/);
});
test('overcapacity limits only visual/ARIA range and preserves actual weight and ratio', () => {
  const tree = render({ remainingGrams: 1500 });
  assert.equal(visual(tree).props['aria-valuenow'], 100); assert.equal(arc(tree).props.strokeDashoffset, 0);
  assert.match(text(tree), /1.500 g/); assert.match(text(tree), /150%/);
});
test('safe HEX filament colors survive low and empty states; alerts have separate colors', () => {
  for (const color of ['#abc', '#ABCDEF']) assert.equal(arc(render({ filamentColor: color })).props.stroke, color);
  for (const color of ['red', 'url(https://invalid)', '#abcd', '#12345678', 'var(--color)', '']) assert.equal(arc(render({ filamentColor: color })).props.stroke, '#2B00FF');
  for (const [remainingGrams, alertColor] of [[100, '#FF4E26'], [0, '#DC493A']]) {
    const tree = render({ remainingGrams, filamentColor: '#abc' });
    assert.equal(arc(tree).props.stroke, '#abc');
    assert.equal(all(tree, n => n.props?.className === 'statusDot')[0].props.style.backgroundColor, alertColor);
  }
  assert.equal(arc(render({ remainingGrams: 0 })).props.strokeLinecap, 'butt');
});
test('white filament remains visible through a wider contrasting outline at 75% and 25%', () => {
  for (const remainingGrams of [750, 250]) {
    const [outline, filament] = arcs(render({ remainingGrams, filamentColor: '#FFFFFF' }));
    assert.equal(filament.props.stroke, '#FFFFFF');
    assert.notEqual(outline.props.stroke, filament.props.stroke);
    assert.ok(outline.props.strokeWidth > filament.props.strokeWidth);
    assert.equal(outline.props.strokeDashoffset, filament.props.strokeDashoffset);
    assert.equal(outline.props.strokeDasharray, filament.props.strokeDasharray);
  }
});
test('unavailable threshold is not a fabricated alert configuration', () => {
  assert.match(text(render({ lowThresholdPercent: null })), /Alerta indisponível/);
  assert.equal(arc(render({ lowThresholdPercent: null })).props.stroke, '#2B00FF');
});
test('updated real balance changes arc offset with stable structure; CSS transition and reduced motion exist', () => {
  const before = render({ remainingGrams: 500 }); const after = render({ remainingGrams: 250 });
  assert.notEqual(arc(before).props.strokeDashoffset, arc(after).props.strokeDashoffset);
  assert.equal(arc(before).type, arc(after).type);
  assert.match(css, /stroke-dashoffset 650ms/); assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /transition: none/);
  assert.doesNotMatch(css, /infinite|@keyframes/);
});
test('indicator is accessible, decorative SVGs have no duplicate ids or external resources', () => {
  const tree = render();
  assert.equal(visual(tree).props.role, 'progressbar');
  assert.match(visual(tree).props['aria-label'], /PLA 01/);
  assert.match(visual(tree).props['aria-valuetext'], /500 g/);
  assert.equal(all(tree, n => n.type === 'svg')[0].props['aria-hidden'], 'true');
  assert.equal(all(tree, n => n.props?.id).length, 0);
  assert.doesNotMatch(source, /https?:|<image|<img|fetch\(|from ["'](?:framer|motion|gsap)/);
});

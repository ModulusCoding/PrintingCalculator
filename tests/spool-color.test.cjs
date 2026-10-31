/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TypeScript/VM harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const moduleObject = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    module: moduleObject, exports: moduleObject.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`); return imports[name]; },
  }, { filename: file });
  return moduleObject.exports;
}
const color = load('lib/spools/color.ts');
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function one(tree, predicate) {
  const matches = nodes(tree, predicate);
  assert.equal(matches.length, 1);
  return matches[0];
}
const textInput = tree => one(tree, node => node.type === 'input' && node.props.name === 'color');
const picker = tree => one(tree, node => node.type === 'input' && node.props.type === 'color');
const preview = tree => one(tree, node => node.type === 'SpoolLevel2D');
function harness(props = {}) {
  const slots = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const { SpoolColorField } = load('components/spools/SpoolColorField.tsx', {
    react: {
      useId: () => 'color-field',
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/spools/color': color,
    './SpoolLevel2D': { SpoolLevel2D: 'SpoolLevel2D' },
    './SpoolForms.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
  });
  return { render() { cursor = 0; return SpoolColorField({ remainingGrams: 500, referenceGrams: 1000, lowThresholdPercent: 20, ...props }); } };
}

test('real color helpers expand explicit HEX only, preserving empty and legacy text', () => {
  for (const [raw, expected] of [['#abc', '#AABBCC'], [' #a1b2c3 ', '#A1B2C3']]) {
    assert.equal(color.resolveSpoolHex(raw), expected);
    assert.equal(color.normalizeSpoolColor(raw), expected);
  }
  for (const raw of ['', 'Azul', 'red']) {
    assert.equal(color.resolveSpoolHex(raw), null);
    assert.equal(color.normalizeSpoolColor(` ${raw} `), raw);
  }
  for (const raw of ['#', '#12', '#1234', '#12345g', 'abc', 'a1b2c3', 'x'.repeat(81)]) {
    assert.equal(color.normalizeSpoolColor(raw), null, raw);
  }
});

test('real field synchronizes picker and text, expands shorthand on blur and carries preview metrics', () => {
  const h = harness({ defaultValue: '#123456' });
  picker(h.render()).props.onChange({ target: { value: '#a1b2c3' } });
  assert.equal(textInput(h.render()).props.value, '#A1B2C3');
  textInput(h.render()).props.onChange({ target: { value: '#abc' } });
  assert.equal(textInput(h.render()).props.value, '#ABC');
  assert.equal(picker(h.render()).props.value, '#AABBCC');
  textInput(h.render()).props.onBlur();
  const tree = h.render();
  assert.equal(textInput(tree).props.value, '#AABBCC');
  assert.equal(preview(tree).props.filamentColor, '#AABBCC');
  assert.equal(preview(tree).props.remainingGrams, 500);
  assert.equal(preview(tree).props.referenceGrams, 1000);
  assert.equal(preview(tree).props.lowThresholdPercent, 20);
  assert.equal(preview(tree).props.interactive, undefined, '2D previews never request WebGL interaction');
  assert.equal(picker(tree).props.name, undefined, 'Only the text field is submitted');
});

test('invalid drafts stay editable while the picker and preview retain the last valid HEX', () => {
  const h = harness({ defaultValue: '#abc' });
  textInput(h.render()).props.onChange({ target: { value: '#12xz' } });
  const tree = h.render();
  assert.equal(textInput(tree).props.value, '#12xz');
  assert.equal(textInput(tree).props['aria-invalid'], true);
  assert.ok(textInput(tree).props['aria-describedby'].split(' ').includes('color-field-error'));
  one(tree, node => node.type === 'label' && node.props.htmlFor === textInput(tree).props.id);
  one(tree, node => node.props.id === 'color-field-error' && node.props.role === 'alert');
  assert.equal(picker(tree).props.value, '#AABBCC');
  assert.equal(preview(tree).props.filamentColor, '#AABBCC');
  textInput(tree).props.onBlur();
  assert.equal(textInput(h.render()).props.value, '#12xz');
  textInput(h.render()).props.onChange({ target: { value: '#102030' } });
  assert.equal(textInput(h.render()).props['aria-invalid'], false);
  assert.equal(preview(h.render()).props.filamentColor, '#102030');
});

test('blank and legacy values never silently acquire the illustrative picker color', () => {
  for (const defaultValue of ['', 'Preto']) {
    const h = harness({ defaultValue, disabled: true, errors: ['Erro do servidor'] });
    const tree = h.render();
    assert.equal(textInput(tree).props.value, defaultValue);
    assert.equal(textInput(tree).props.disabled, true);
    assert.equal(picker(tree).props.disabled, true);
    assert.equal(picker(tree).props.value, '#2B00FF');
    assert.equal(preview(tree).props.filamentColor, null);
    assert.equal(textInput(tree).props['aria-invalid'], true);
    one(tree, node => node.props.role === 'alert');
  }
  const h = harness({ defaultValue: '#abc' });
  for (const draft of ['Preto', '']) {
    textInput(h.render()).props.onChange({ target: { value: draft } });
    assert.equal(textInput(h.render()).props.value, draft);
    assert.equal(preview(h.render()).props.filamentColor, null);
    assert.equal(textInput(h.render()).props['aria-invalid'], false);
  }
});

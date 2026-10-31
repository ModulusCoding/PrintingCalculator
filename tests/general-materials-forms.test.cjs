/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local TypeScript/VM harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, imports, globals = {}) {
  const loadedModule = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(compiled.outputText, {
    module: loadedModule, exports: loadedModule.exports,
    require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import in ${file}: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename: file });
  return loadedModule.exports;
}
const validation = load('lib/general-materials/validation.ts', { zod: require('zod') });
const planMessages = load('lib/plans/action-messages.ts', {});
const material = {
  id: '11111111-1111-4111-8111-111111111111', version: 7, active: true,
  name: 'Embalagem', control_unit: 'unidade', reference_quantity: 1.123456, reference_price: 12.654321,
};
const validNew = { name: 'Embalagem', control_unit: 'unidade', reference_quantity: '1', reference_price: '12,123456', opening_quantity: '0' };

function harness(overrides = {}) {
  const states = [];
  let cursor = 0;
  let attempts = 0;
  const calls = [];
  const pushes = [];
  let refreshes = 0;
  const actions = Object.fromEntries([
    'createGeneralMaterial', 'moveGeneralMaterial', 'setGeneralMaterialActive',
    'updateGeneralMaterialCostReference', 'updateGeneralMaterialProfile',
  ].map(name => [name, async payload => {
    calls.push({ name, payload });
    return overrides[name] ? overrides[name](payload) : { status: 'updated' };
  }]));
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const components = load('components/general-materials/GeneralMaterialForms.tsx', {
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useRouter: () => ({ push: url => pushes.push(url), refresh: () => { refreshes++; } }) },
    '@/lib/plans/action-messages': planMessages,
    '@/lib/general-materials/actions': actions,
    '@/lib/general-materials/validation': validation,
    './MaterialForms.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
  }, {
    crypto: { randomUUID: () => `22222222-2222-4222-8222-${String(++attempts).padStart(12, '0')}` },
    // This is deliberately not browser constraint validation: onSubmit must validate itself.
    FormData: class {
      constructor(target) { this.target = target; }
      entries() { return Object.entries(this.target)[Symbol.iterator](); }
    },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return {
    calls, pushes,
    get refreshes() { return refreshes; },
    render(name = 'NewGeneralMaterialForm') {
      cursor = 0;
      return expand(components[name](name === 'GeneralMaterialControls' ? { material, canArchive: true } : {}));
    },
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function input(tree, name) {
  const found = nodes(tree, node => node.type === 'input' && node.props.name === name);
  assert.equal(found.length, 1, `Expected one input named ${name}`);
  return found[0];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
function form(tree, heading) {
  const found = nodes(tree, node => node.type === 'form' && text(node).includes(heading));
  assert.equal(found.length, 1, `Expected one form for ${heading}`);
  return found[0];
}
function values(tree, overrides) {
  const result = {};
  for (const node of nodes(tree, node => ['input', 'select'].includes(node.type))) {
    result[node.props.name] = node.props.value ?? node.props.defaultValue ?? '';
  }
  return { ...result, ...overrides };
}
async function submit(tree, payload) {
  let prevented = false;
  tree.props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: payload });
  assert.equal(prevented, true);
  // The real handlers return void; drain their async action continuation before rerendering.
  await new Promise(resolve => setImmediate(resolve));
}
function fieldError(tree, name) {
  const field = input(tree, name);
  assert.equal(field.props['aria-invalid'], true);
  const errorId = `${field.props.id}-error`;
  assert.ok(field.props['aria-describedby'].split(' ').includes(errorId));
  const label = nodes(tree, node => node.type === 'label' && node.props.htmlFor === field.props.id)[0];
  assert.ok(label, 'The input must have its own associated label');
  const errors = nodes(label, node => node.props.id === errorId);
  assert.equal(errors.length, 1, 'Validation message must be next to the invalid field');
  assert.ok(text(errors[0]).length > 0);
}

test('invalid creation submit never calls an action and renders validation beside the field', async () => {
  const h = harness();
  await submit(h.render(), { ...validNew, reference_price: '1,1234567' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.pushes.length, 0);
  const tree = h.render();
  fieldError(tree, 'reference_price');
  assert.equal(input(tree, 'reference_quantity').props['aria-invalid'], false);
  assert.equal(nodes(tree, node => node.type === 'fieldset')[0].props.disabled, false);
  assert.match(text(tree), /Revise os campos/);
});

test('cost editing keeps six-decimal defaults and submits them without rounding', async () => {
  const h = harness();
  const cost = form(h.render('GeneralMaterialControls'), 'Referência de custo');
  assert.equal(input(cost, 'reference_quantity').props.defaultValue, '1,123456');
  assert.equal(input(cost, 'reference_price').props.defaultValue, '12,654321');
  await submit(cost, values(cost));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'updateGeneralMaterialCostReference');
  assert.equal(h.calls[0].payload.reference_quantity, '1,123456');
  assert.equal(h.calls[0].payload.reference_price, '12,654321');
  assert.equal(h.calls[0].payload.expected_version, '7');
  assert.equal(h.refreshes, 1);
});

test('adjustment rerender replaces quantity with counted_balance and sends absolute zero', async () => {
  const h = harness();
  const initial = h.render('GeneralMaterialControls');
  input(initial, 'quantity');
  nodes(initial, node => node.type === 'select' && node.props.name === 'movement_type')[0]
    .props.onChange({ target: { value: 'adjustment' } });
  const move = form(h.render('GeneralMaterialControls'), 'Movimentar estoque');
  assert.equal(nodes(move, node => node.type === 'input' && node.props.name === 'quantity').length, 0);
  input(move, 'counted_balance');
  await submit(move, values(move, { counted_balance: '0', reason: 'Contagem física' }));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'moveGeneralMaterial');
  const payload = h.calls[0].payload;
  assert.equal(payload.movement_type, 'adjustment');
  assert.equal(payload.counted_balance, '0');
  assert.equal(Object.hasOwn(payload, 'quantity'), false);
  assert.equal(payload.material_id, material.id);
  assert.equal(h.refreshes, 1);
});

test('invalid movement blocks its action and attaches the error to quantity', async () => {
  const h = harness();
  const move = form(h.render('GeneralMaterialControls'), 'Movimentar estoque');
  await submit(move, values(move, { quantity: '0', reason: 'Entrada' }));
  assert.equal(h.calls.length, 0);
  fieldError(form(h.render('GeneralMaterialControls'), 'Movimentar estoque'), 'quantity');
});

for (const failure of ['uncertain response', 'transport rejection']) {
  test(`creation retries the identical frozen attempt/payload after ${failure}`, async () => {
    let count = 0;
    const h = harness({ createGeneralMaterial: async () => {
      if (++count === 1) {
        if (failure === 'transport rejection') throw new Error('offline');
        return { status: 'uncertain' };
      }
      return { status: 'idempotent', material_id: material.id };
    } });
    await submit(h.render(), validNew);
    const retry = h.render();
    assert.equal(nodes(retry, node => node.type === 'fieldset')[0].props.disabled, true);
    const button = nodes(retry, node => node.type === 'button')[0];
    assert.equal(button.props.disabled, false);
    assert.equal(text(button), 'Repetir tentativa');
    assert.equal(h.pushes.length, 0);
    await submit(retry, { ...validNew, name: 'Alterado', reference_price: '999' });
    assert.equal(h.calls.length, 2);
    assert.strictEqual(h.calls[1].payload, h.calls[0].payload);
    assert.equal(h.calls[1].payload.name, validNew.name);
    assert.ok(validation.uuid.safeParse(h.calls[1].payload.attempt_id).success);
    assert.deepEqual(h.pushes, [`/estoque/materiais-gerais/${material.id}`]);
  });
}

test('uncertain movement locks other operations and retries the original version and quantity', async () => {
  let count = 0;
  const h = harness({ moveGeneralMaterial: async () => ({ status: ++count === 1 ? 'uncertain' : 'idempotent' }) });
  const first = form(h.render('GeneralMaterialControls'), 'Movimentar estoque');
  await submit(first, values(first, { quantity: '0,123456', reason: 'Recebimento' }));
  const tree = h.render('GeneralMaterialControls');
  const retry = form(tree, 'Movimentar estoque');
  assert.equal(nodes(retry, node => node.type === 'fieldset')[0].props.disabled, true);
  assert.equal(nodes(retry, node => node.type === 'button')[0].props.disabled, false);
  assert.equal(nodes(form(tree, 'Referência de custo'), node => node.type === 'button')[0].props.disabled, true);
  assert.equal(h.refreshes, 0);
  await submit(retry, { movement_type: 'entry', quantity: '999', supplied_unit: 'unidade', reason: 'Alterado' });
  assert.equal(h.calls.length, 2);
  assert.strictEqual(h.calls[1].payload, h.calls[0].payload);
  assert.equal(h.calls[1].payload.quantity, '0,123456');
  assert.equal(h.calls[1].payload.expected_version, '7');
  assert.equal(h.refreshes, 1);
  assert.equal(nodes(form(h.render('GeneralMaterialControls'), 'Movimentar estoque'), node => node.type === 'button')[0].props.disabled, true);
});

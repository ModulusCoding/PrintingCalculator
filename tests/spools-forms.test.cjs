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
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import in ${file}: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename: file });
  return loadedModule.exports;
}
const validation = load('lib/spools/validation.ts', { zod: require('zod') });
const planMessages = load('lib/plans/action-messages.ts', {});
const color = load('lib/spools/color.ts', {});
const spool = {
  id: '11111111-1111-4111-8111-111111111111', version: 7, active: true,
  internal_identifier: 'PLA-01', material_type: 'PLA', brand: null, color: 'Preto',
};
const validNew = {
  material_type: 'PLA', internal_identifier: 'PLA-02', brand: '', color: '',
  original_grams: '1000', initial_balance_grams: '750,125', purchase_price: '89,90',
};
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
function one(tree, predicate) {
  const found = nodes(tree, predicate);
  assert.equal(found.length, 1, 'Expected exactly one matching element');
  return found[0];
}
const input = (tree, name) => one(tree, node => node.type === 'input' && node.props.name === name);
const form = (tree, heading) => one(tree, node => node.type === 'form' && text(node).includes(heading));
const button = tree => one(tree, node => node.type === 'button' && node.props.type === 'submit');
function values(tree, overrides = {}) {
  return { ...Object.fromEntries(nodes(tree, node => ['input', 'select'].includes(node.type))
    .map(node => [node.props.name, node.props.value ?? node.props.defaultValue ?? ''])), ...overrides };
}
async function submit(tree, payload) {
  let prevented = false;
  await tree.props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: payload });
  assert.equal(prevented, true);
  // Movement/profile handlers deliberately return void; drain their action continuations.
  await new Promise(resolve => setImmediate(resolve));
}
function fieldError(tree, name) {
  const field = input(tree, name);
  assert.equal(field.props['aria-invalid'], true);
  assert.ok(field.props['aria-describedby'].split(' ').includes(`${field.props.id}-error`));
  one(tree, node => node.type === 'label' && node.props.htmlFor === field.props.id);
  assert.ok(text(one(tree, node => node.props.id === `${field.props.id}-error`)));
}
function harness(overrides = {}) {
  const slots = [];
  let cursor = 0, attempts = 0, refreshes = 0;
  const calls = [], pushes = [], confirmations = [];
  const actions = Object.fromEntries(['createSpool', 'createMovement', 'updateSpoolProfile', 'setSpoolActive', 'updateSpoolThreshold'].map(name => [name, async payload => {
    calls.push({ name, payload });
    return overrides[name] ? overrides[name](payload) : { status: 'updated' };
  }]));
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const imports = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useId() {
        const index = cursor++;
        if (!(index in slots)) slots[index] = `spool-field-${index}`;
        return slots[index];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/navigation': { useRouter: () => ({ push: url => pushes.push(url), refresh: () => { refreshes++; } }) },
    '@/lib/plans/action-messages': planMessages,
    '@/lib/spools/validation': validation,
    '@/lib/spools/actions': actions,
    '@/lib/spools/color': color,
    './SpoolColorField': { SpoolColorField: ({ defaultValue = '', disabled, errors }) => jsx('div', { children: [
      jsx('label', { htmlFor: 'mock-color', children: 'Cor' }),
      jsx('input', { id: 'mock-color', name: 'color', defaultValue, disabled, 'aria-invalid': !!errors?.length, 'aria-describedby': errors?.length ? 'mock-color-error' : undefined }),
      errors?.length ? jsx('div', { id: 'mock-color-error', children: errors.join(' ') }) : null,
    ] }) },
    './SpoolForms.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
  };
  const globals = {
    crypto: { randomUUID: () => `22222222-2222-4222-8222-${String(++attempts).padStart(12, '0')}` },
    window: { confirm(message) { confirmations.push(message); return overrides.confirm !== false; } },
    // No browser constraint validation: real handlers must validate these raw values.
    FormData: class {
      constructor(target) { this.target = target; }
      entries() { return Object.entries(this.target)[Symbol.iterator](); }
      [Symbol.iterator]() { return this.entries(); }
      get(name) { return this.target[name] ?? null; }
    },
  };
  const components = {
    ...load('components/spools/SpoolForms.tsx', imports, globals),
    ...load('components/spools/ThresholdForm.tsx', imports, globals),
  };
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return {
    calls, pushes, confirmations,
    get refreshes() { return refreshes; },
    render(name = 'NewSpoolForm', props = {}) {
      cursor = 0;
      return expand(components[name]({ spool, config: { version: 4, low_spool_threshold_percent: 20.5 }, ...props }));
    },
  };
}

for (const [name, invalid] of Object.entries({ color: '#12xy34', material_type: '', internal_identifier: '', original_grams: '0', initial_balance_grams: '1000,001', purchase_price: '1,001' })) {
  test(`invalid creation ${name} renders accessible errors without calling an action`, async () => {
    const h = harness();
    assert.equal(h.render().props.noValidate, true);
    await submit(h.render(), { ...validNew, [name]: invalid });
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.pushes, []);
    fieldError(h.render(), name);
    assert.equal(input(h.render(), name).props.disabled, false);
  });
}
for (const failure of ['uncertain', 'throw']) {
  test(`creation ${failure} retries the exact raw payload and attempt`, async () => {
    let count = 0;
    const h = harness({ createSpool: async () => {
      if (++count === 1) {
        if (failure === 'throw') throw new Error('offline');
        return { status: 'uncertain' };
      }
      return { status: 'idempotent', spool_id: spool.id };
    } });
    await submit(h.render(), validNew);
    const retry = h.render();
    assert.equal(input(retry, 'material_type').props.disabled, true);
    assert.equal(button(retry).props.disabled, false);
    assert.equal(text(button(retry)), 'Repetir tentativa');
    assert.equal(h.pushes.length, 0);
    await submit(retry, { ...validNew, internal_identifier: 'CHANGED', purchase_price: '999' });
    assert.equal(h.calls.length, 2);
    assert.strictEqual(h.calls[1].payload, h.calls[0].payload);
    assert.ok(validation.uuid.safeParse(h.calls[0].payload.attempt_id).success);
    assert.equal(h.calls[1].payload.brand, '', 'Do not send schema-transformed null optional text');
    assert.equal(h.calls[1].payload.purchase_price, '89,90');
    assert.deepEqual(h.pushes, [`/estoque/carreteis/${spool.id}?returnTo=${encodeURIComponent('/estoque/carreteis')}`]);
  });
}

test('invalid profile HEX renders an accessible error without calling an action', async () => {
  const h = harness();
  const profile = form(h.render('SpoolControls'), 'Dados do carretel');
  await submit(profile, values(profile, { color: '#12xy34' }));
  assert.equal(h.calls.length, 0);
  assert.equal(h.refreshes, 0);
  fieldError(form(h.render('SpoolControls'), 'Dados do carretel'), 'color');
});

for (const [draft, normalized] of [['#abc', '#AABBCC'], ['#a1b2c3', '#A1B2C3']]) {
  test(`creation and profile persist normalized ${draft} and reopen the saved color`, async () => {
    const creation = harness({ createSpool: async () => ({ status: 'created', spool_id: spool.id }) });
    await submit(creation.render(), { ...validNew, color: draft });
    assert.equal(creation.calls.length, 1);
    assert.equal(creation.calls[0].payload.color, normalized);
    const editing = harness();
    const profile = form(editing.render('SpoolControls'), 'Dados do carretel');
    await submit(profile, values(profile, { color: draft }));
    assert.equal(editing.calls.length, 1);
    assert.equal(editing.calls[0].name, 'updateSpoolProfile');
    assert.equal(editing.calls[0].payload.color, normalized);
    const reopened = harness().render('SpoolControls', { spool: { ...spool, version: 8, color: editing.calls[0].payload.color } });
    assert.equal(input(form(reopened, 'Dados do carretel'), 'color').props.defaultValue, normalized);
  });
}

test('adjustment replaces quantity with absolute counted zero and requires confirmation', async () => {
  for (const confirmed of [false, true]) {
    const h = harness({ confirm: confirmed });
    one(h.render('SpoolControls'), node => node.type === 'select').props.onChange({ target: { value: 'adjustment' } });
    const move = form(h.render('SpoolControls'), 'Movimentar carretel');
    assert.equal(nodes(move, node => node.props.name === 'quantity_grams').length, 0);
    await submit(move, values(move, { counted_balance_grams: '0', reason: 'Contagem física' }));
    assert.equal(h.confirmations.length, 1);
    assert.match(h.confirmations[0], /Confirma esta movimentação/);
    assert.equal(h.calls.length, confirmed ? 1 : 0);
    if (confirmed) {
      const { name, payload } = h.calls[0];
      assert.equal(name, 'createMovement');
      assert.equal(payload.counted_balance_grams, '0');
      assert.equal(Object.hasOwn(payload, 'quantity_grams'), false);
      assert.equal(payload.spool_id, spool.id);
      assert.equal(payload.expected_version, 7);
      assert.equal(h.refreshes, 1);
    }
  }
});

test('invalid movement never confirms or invokes an action', async () => {
  const h = harness();
  const move = form(h.render('SpoolControls'), 'Movimentar carretel');
  await submit(move, values(move, { quantity_grams: '0', reason: 'Consumo' }));
  assert.equal(h.calls.length, 0);
  assert.equal(h.confirmations.length, 0);
  fieldError(h.render('SpoolControls'), 'quantity_grams');
});

for (const failure of ['uncertain', 'throw']) {
  test(`movement ${failure} blocks other handlers and reuses frozen attempt without reconfirming`, async () => {
    let count = 0;
    const h = harness({ createMovement: async () => {
      if (++count === 1) {
        if (failure === 'throw') throw new Error('offline');
        return { status: 'uncertain' };
      }
      return { status: 'idempotent' };
    } });
    const first = form(h.render('SpoolControls'), 'Movimentar carretel');
    await submit(first, values(first, { quantity_grams: '0,125', reason: 'Impressão' }));
    const tree = h.render('SpoolControls');
    const retry = form(tree, 'Movimentar carretel');
    const profile = form(tree, 'Dados do carretel');
    const archive = one(tree, node => node.type === 'button' && text(node) === 'Arquivar');
    assert.equal(input(retry, 'quantity_grams').props.disabled, true);
    assert.equal(button(retry).props.disabled, false);
    assert.equal(button(profile).props.disabled, true);
    assert.equal(archive.props.disabled, true);
    await submit(profile, values(profile));
    archive.props.onClick();
    assert.equal(h.calls.length, 1, 'Disabled operations must also be guarded in their handlers');
    assert.equal(h.refreshes, 0);
    await submit(retry, { movement_type: 'replenishment', quantity_grams: '999', reason: 'Alterado' });
    assert.equal(h.calls.length, 2);
    assert.strictEqual(h.calls[1].payload, h.calls[0].payload);
    assert.equal(h.calls[1].payload.quantity_grams, '0,125');
    assert.equal(h.calls[1].payload.expected_version, 7);
    assert.ok(validation.uuid.safeParse(h.calls[1].payload.attempt_id).success);
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.refreshes, 1);
    assert.equal(input(h.render('SpoolControls'), 'quantity_grams').props.disabled, true, 'Wait for refreshed version after a successful movement');
  });
}

test('no_change releases profile controls, preserves raw defaults and allows a new movement', async () => {
  const h = harness({ updateSpoolProfile: async () => ({ status: 'no_change' }) });
  const profile = form(h.render('SpoolControls'), 'Dados do carretel');
  assert.equal(input(profile, 'brand').props.defaultValue, '');
  await submit(profile, values(profile));
  assert.equal(h.calls[0].name, 'updateSpoolProfile');
  assert.equal(h.calls[0].payload.expected_version, 7);
  assert.equal(h.calls[0].payload.brand, '');
  assert.equal(h.confirmations.length, 0);
  assert.equal(h.refreshes, 1);
  const tree = h.render('SpoolControls');
  assert.match(text(tree), /Nenhuma alteração necessária/);
  assert.equal(input(tree, 'internal_identifier').props.disabled, false);
  const move = form(tree, 'Movimentar carretel');
  assert.equal(button(move).props.disabled, false);
  await submit(move, values(move, { quantity_grams: '1', reason: 'Teste' }));
  assert.equal(h.calls[1].name, 'createMovement');
});

test('profile validates locally and is available only with archive permission on active spools', async () => {
  const h = harness();
  const profile = form(h.render('SpoolControls'), 'Dados do carretel');
  await submit(profile, values(profile, { material_type: '' }));
  assert.equal(h.calls.length, 0);
  fieldError(form(h.render('SpoolControls'), 'Dados do carretel'), 'material_type');
  for (const props of [{ canArchive: false }, { spool: { ...spool, active: false } }]) {
    const tree = harness().render('SpoolControls', props);
    assert.equal(nodes(tree, node => node.type === 'form' && text(node).includes('Dados do carretel')).length, 0);
  }
  const permitted = harness();
  const tree = permitted.render('SpoolControls', { canWrite: false, canArchive: true });
  assert.equal(nodes(tree, node => node.type === 'form' && text(node).includes('Movimentar carretel')).length, 0);
  const allowed = form(tree, 'Dados do carretel');
  await submit(allowed, values(allowed));
  assert.equal(permitted.calls[0].name, 'updateSpoolProfile');
});

for (const value of ['-1', '100,01', '20,501', '', '1e2', '1.000,00']) {
  test(`threshold rejects ${JSON.stringify(value)} locally`, async () => {
    const h = harness();
    const tree = h.render('ThresholdForm');
    assert.equal(tree.props.noValidate, true);
    assert.equal(input(tree, 'threshold').props.defaultValue, '20,5');
    await submit(tree, { threshold: value });
    assert.equal(h.calls.length, 0);
    fieldError(h.render('ThresholdForm'), 'threshold');
    assert.equal(button(h.render('ThresholdForm')).props.disabled, false);
  });
}
for (const value of ['0', '100', '20,50']) {
  test(`threshold accepts ${value} and sends raw decimal with current version`, async () => {
    const h = harness();
    await submit(h.render('ThresholdForm'), { threshold: value });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'updateSpoolThreshold');
    assert.deepEqual({ ...h.calls[0].payload }, { threshold: value, expected_version: 4 });
    assert.equal(h.refreshes, 1);
    assert.match(text(h.render('ThresholdForm')), /Limite salvo/);
  });
}

test('threshold catch restores controls and a subsequent no_change refreshes successfully', async () => {
  let count = 0;
  const h = harness({ updateSpoolThreshold: async () => {
    if (++count === 1) throw new Error('offline');
    return { status: 'no_change' };
  } });
  await submit(h.render('ThresholdForm'), { threshold: '25' });
  const tree = h.render('ThresholdForm');
  assert.match(text(one(tree, node => node.props.role === 'alert')), /Não foi possível confirmar/);
  assert.equal(input(tree, 'threshold').props.disabled, false);
  assert.equal(button(tree).props.disabled, false);
  assert.equal(tree.props['aria-busy'], false);
  assert.equal(h.refreshes, 0);
  await submit(tree, { threshold: '30' });
  assert.equal(h.calls[1].payload.threshold, '30');
  assert.equal(h.refreshes, 1);
  assert.match(text(one(h.render('ThresholdForm'), node => node.props.role === 'status')), /Nenhuma alteração necessária/);
});

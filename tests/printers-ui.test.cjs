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
const validation = load('components/printers/validation.ts', {});
const printer = {
  id: '11111111-1111-4111-8111-111111111111', version: 7, active: true,
  name: 'Impressora de bancada', brand: 'Marca', model: 'Modelo',
  purchase_price: '1234.56', estimated_life_hours: '12345',
  average_power_watts: '125.75', maintenance_cost_per_hour: '0.1234',
};
const valid = {
  name: 'Impressora nova', brand: '', model: '', purchasePrice: '1000,00',
  estimatedLifeHours: '10000', averagePowerWatts: '150,25', maintenanceCostPerHour: '0,1234',
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
const button = (tree, label) => one(tree, node => node.type === 'button' && text(node) === label);
function harness(props = {}, overrides = {}) {
  const slots = [];
  let cursor = 0;
  let pending = false;
  let refreshes = 0;
  const calls = [], pushes = [], focused = [], confirmations = [], jobs = [], frames = [];
  class HTMLElement {
    constructor(name) { this.name = name; }
    focus() { focused.push(this.name); }
  }
  const actions = Object.fromEntries(['createPrinter', 'updatePrinter', 'setPrinterActive'].map(name => [name, async (...args) => {
    calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : { status: 'success' };
  }]));
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const { PrinterForm } = load('components/printers/PrinterForm.tsx', {
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
      useTransition: () => [pending, callback => {
        pending = true;
        jobs.push(Promise.resolve(callback()).finally(() => { pending = false; }));
      }],
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/link': { default: ({ children, ...rest }) => jsx('a', { ...rest, children }) },
    'next/navigation': { useRouter: () => ({ push: url => pushes.push(url), refresh: () => { refreshes++; } }) },
    'lucide-react': { Printer: properties => jsx('svg', properties) },
    '@/lib/printers/actions': actions,
    '@/lib/plans/action-messages': { planActionMessage: status => status === 'plan_limit_reached' ? 'Limite do plano atingido.' : null },
    './validation': validation,
    './PrinterForm.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
  }, {
    HTMLElement,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    confirm: message => { confirmations.push(message); return overrides.confirm !== false; },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    if (node.props.ref) node.props.ref.current = new HTMLElement(node.props.role || node.type);
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  function render() {
    cursor = 0;
    const tree = expand(PrinterForm({ canWrite: true, canArchive: true, ...props }));
    while (frames.length) frames.shift()();
    return tree;
  }
  return {
    calls, pushes, focused, confirmations, render,
    get refreshes() { return refreshes; },
    fill(values) {
      for (const [name, value] of Object.entries(values)) input(render(), name).props.onChange({ target: { value } });
      return render();
    },
    submit(tree = render()) {
      let prevented = false;
      one(tree, node => node.type === 'form').props.onSubmit({
        preventDefault() { prevented = true; },
        // No browser constraint validation: the real submit handler must reject invalid data.
        currentTarget: { elements: { namedItem: name => new HTMLElement(name) } },
      });
      assert.equal(prevented, true);
    },
    async flush() { await Promise.all(jobs); },
  };
}
function fieldError(tree, name) {
  const field = input(tree, name);
  assert.equal(field.props['aria-invalid'], true);
  assert.ok(field.props['aria-describedby'].split(' ').includes(`printer-${name}-error`));
  one(tree, node => node.type === 'label' && node.props.htmlFor === field.props.id);
  assert.ok(text(one(tree, node => node.props.id === `printer-${name}-error`)));
}

const invalidCases = {
  name: ['', 'A', 'a'.repeat(121)], brand: ['a'.repeat(121)], model: ['a'.repeat(161)],
  purchasePrice: ['', '-1', '1000000,01', '1,001', '1.00', '1.000,00', '1e3'],
  estimatedLifeHours: ['', '0', '100001', '1,5', '1.0'],
  averagePowerWatts: ['', '0', '0,001', '10000,01', '1,234'],
  maintenanceCostPerHour: ['', '-0,0001', '1000,0001', '0,12345', '0.1234'],
};
for (const [name, values] of Object.entries(invalidCases)) {
  test(`local validation blocks invalid ${name} before any action`, () => {
    for (const value of values) {
      const h = harness();
      const tree = h.fill({ ...valid, [name]: value });
      assert.equal(one(tree, node => node.type === 'form').props.noValidate, true);
      h.submit(tree);
      assert.equal(h.calls.length, 0, `${name}=${JSON.stringify(value)}`);
      assert.deepEqual(h.pushes, []);
      assert.deepEqual(h.focused, [name]);
      fieldError(h.render(), name);
    }
  });
}
for (const boundary of ['min', 'max']) {
  test(`numeric ${boundary} boundaries are accepted by the real form`, async () => {
    const h = harness();
    const data = { ...valid };
    for (const [name, spec] of Object.entries(validation.printerFields)) {
      if ('scale' in spec) data[name] = String(spec[boundary]).replace('.', ',');
    }
    h.submit(h.fill(data));
    await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'createPrinter');
    assert.deepEqual({ ...h.calls[0].args[0] }, data);
    assert.deepEqual(h.pushes, ['/impressoras']);
    assert.equal(h.refreshes, 1);
  });
}

test('editing preserves decimal defaults and the exact four-place maintenance payload', async () => {
  const h = harness({ printer, returnTo: '/impressoras?status=active' });
  const tree = h.render();
  const expected = { name: printer.name, brand: printer.brand, model: printer.model, purchasePrice: '1234,56', estimatedLifeHours: '12345', averagePowerWatts: '125,75', maintenanceCostPerHour: '0,1234' };
  for (const [name, value] of Object.entries(expected)) assert.equal(input(tree, name).props.value, value);
  h.submit(tree);
  await h.flush();
  assert.equal(h.calls[0].name, 'updatePrinter');
  assert.deepEqual(h.calls[0].args.slice(0, 2), [printer.id, printer.version]);
  assert.deepEqual({ ...h.calls[0].args[2] }, expected);
  const saved = h.render();
  assert.match(text(one(saved, node => node.props.role === 'status')), /Alteração salva/);
  for (const fieldset of nodes(saved, node => node.type === 'fieldset')) assert.equal(fieldset.props.disabled, true);
  h.submit(saved);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.pushes, ['/impressoras?status=active']);
});

test('permissions and archived records expose no editable inputs or unauthorized archive controls', () => {
  for (const props of [
    { canWrite: false }, { printer, canWrite: false },
    { printer: { ...printer, active: false }, canArchive: false },
  ]) {
    const h = harness(props);
    const tree = h.render();
    assert.equal(nodes(tree, node => ['form', 'input', 'button'].includes(node.type)).length, 0);
    assert.match(text(tree), /somente leitura|não tem permissão/);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ printer, canArchive: false });
  assert.equal(nodes(h.render(), node => node.type === 'button' && /Arquivar/.test(text(node))).length, 0);
});

for (const active of [true, false]) {
  test(`${active ? 'archive' : 'restore'} requires confirmation and submits the original version`, async () => {
    const props = { printer: { ...printer, active }, canWrite: active, canArchive: true };
    const label = active ? 'Arquivar impressora' : 'Restaurar impressora';
    const cancelled = harness(props, { confirm: false });
    button(cancelled.render(), label).props.onClick();
    assert.equal(cancelled.calls.length, 0);
    const h = harness(props);
    const tree = h.render();
    if (!active) {
      assert.equal(nodes(tree, node => node.type === 'input').length, 0);
      assert.match(text(tree), /R\$\s*0,1234\/h/);
    }
    button(tree, label).props.onClick();
    await h.flush();
    assert.deepEqual(h.confirmations, [`${active ? 'Arquivar' : 'Restaurar'} esta impressora?`]);
    assert.deepEqual(h.calls, [{ name: 'setPrinterActive', args: [printer.id, printer.version, !active] }]);
    assert.equal(h.refreshes, 1);
  });
}

for (const [status, message] of [
  ['permission_denied', /não tem permissão/], ['version_conflict', /foi alterada/],
  ['session_expired', /sessão expirou/], ['printer_unavailable', /não está disponível/],
  ['plan_limit_reached', /Limite do plano atingido/], ['unknown_result', /Verifique a lista/],
  ['technical', /Verifique a lista/], ['throw', /Verifique a lista/],
  ['invalid_input', /Revise os campos/],
]) {
  test(`save feedback handles ${status} without navigation and unlocks retry`, async () => {
    const h = harness({}, { createPrinter: async () => {
      if (status === 'throw') throw new Error('offline');
      return { status, fieldErrors: { maintenanceCostPerHour: ['Erro do servidor.'] } };
    } });
    h.submit(h.fill(valid));
    await h.flush();
    const tree = h.render();
    assert.match(text(one(tree, node => node.props.role === 'alert')), message);
    assert.ok(h.focused.includes('alert'));
    assert.deepEqual(h.pushes, []);
    assert.equal(h.refreshes, 0);
    assert.equal(button(tree, 'Salvar').props.disabled, false);
    if (status === 'invalid_input') fieldError(tree, 'maintenanceCostPerHour');
    h.submit(tree);
    await h.flush();
    assert.equal(h.calls.length, 2);
  });
}

for (const operation of ['save', 'archive']) {
  test(`${operation} holds a synchronous lock against double submit and competing actions`, async () => {
    let resolve;
    const deferred = new Promise(done => { resolve = done; });
    const h = harness({ printer }, {
      updatePrinter: () => deferred, setPrinterActive: () => deferred,
    });
    const tree = h.render();
    const archive = button(tree, 'Arquivar impressora');
    if (operation === 'save') h.submit(tree);
    else archive.props.onClick();
    // Invoke stale handlers before rerender: disabled buttons alone cannot prevent this race.
    h.submit(tree);
    archive.props.onClick();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, operation === 'save' ? 'updatePrinter' : 'setPrinterActive');
    const busy = h.render();
    assert.equal(busy.props['aria-busy'], true);
    for (const control of nodes(busy, node => ['fieldset', 'button'].includes(node.type))) assert.equal(control.props.disabled, true);
    resolve({ status: 'success' });
    await h.flush();
    assert.equal(h.refreshes, 1);
  });
}

test('archive failure is announced, releases the lock and never navigates', async () => {
  const h = harness({ printer }, { setPrinterActive: async () => { throw new Error('offline'); } });
  button(h.render(), 'Arquivar impressora').props.onClick();
  await h.flush();
  const tree = h.render();
  assert.match(text(one(tree, node => node.props.role === 'alert')), /Não foi possível confirmar a alteração/);
  assert.deepEqual(h.pushes, []);
  assert.equal(button(tree, 'Arquivar impressora').props.disabled, false);
  button(tree, 'Arquivar impressora').props.onClick();
  await h.flush();
  assert.equal(h.calls.length, 2);
});

test('unsafe return destination falls back to the local printer list', async () => {
  const h = harness({ returnTo: '//example.com/impressoras' });
  h.submit(h.fill(valid));
  await h.flush();
  assert.deepEqual(h.pushes, ['/impressoras']);
});

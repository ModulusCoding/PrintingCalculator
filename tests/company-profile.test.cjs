/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TypeScript/VM React hooks harness; no network or database. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const company = {
  name: 'Oficina Original', created_at: '2026-01-01', version: 7,
  electricity_rate_per_kwh: 0.854321, default_filament_loss_percent: 12.34,
};
const cases = [
  { field: 'name', action: 'updateCompanyName', raw: 'Oficina Renovada', saved: 'Oficina Renovada' },
  { field: 'electricity_rate_per_kwh', action: 'updateCompanyRateAction', raw: '0,654321', saved: 0.654321 },
  { field: 'default_filament_loss_percent', action: 'updateCompanyLossAction', raw: '4,25', saved: 4.25 },
];
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
  assert.equal(found.length, 1, 'Expected exactly one matching rendered element');
  return found[0];
}
const input = (tree, name) => one(tree, node => node.type === 'input' && node.props.name === name);
const formFor = (tree, field) => one(tree, node => node.type === 'form' && nodes(node, child => child.type === 'input' && child.props.name === field).length > 0);
const submitButton = tree => one(tree, node => node.type === 'button' && node.props.type === 'submit');
const value = field => field.props.value ?? field.props.defaultValue ?? '';
function formData(form, overrides = {}) {
  const data = new FormData();
  for (const field of nodes(form, node => ['input', 'textarea', 'select'].includes(node.type) && node.props.name)) {
    data.set(field.props.name, String(value(field)));
  }
  for (const [key, entry] of Object.entries(overrides)) data.set(key, entry);
  return data;
}
function disabled(form) {
  return !!submitButton(form).props.disabled || nodes(form, node => node.type === 'fieldset' && node.props.disabled).length > 0;
}
async function submit(form, data) {
  for (const field of nodes(form, node => node.type === 'input' && typeof node.props.onChange === 'function')) {
    field.props.onChange({ target: { value: data.get(field.props.name) } });
  }
  let prevented = false;
  if (typeof form.props.onSubmit === 'function') {
    const result = form.props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: data });
    if (result && typeof result.then === 'function') await result;
  }
  if (!prevented && typeof form.props.action === 'function') await form.props.action(data);
  await new Promise(resolve => setImmediate(resolve));
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}) {
  const slots = [], calls = [];
  let cursor = 0;
  const slot = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return index;
  };
  const react = {
    useState(initial) {
      const index = slot(initial);
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = slot(() => ({ current: initial })); return slots[index]; },
    useId() { const index = slot(() => `company-field-${cursor}`); return slots[index]; },
    useMemo(fn) { slot(null); return fn(); },
    useCallback(fn) { slot(null); return fn; },
    useActionState(action, initial) {
      const index = slot(() => ({ state: initial, pending: false }));
      const record = slots[index];
      return [record.state, async payload => {
        record.pending = true;
        try { record.state = await action(record.state, payload); }
        finally { record.pending = false; }
      }, record.pending];
    },
    useTransition() {
      const index = slot(false);
      return [slots[index], async callback => {
        slots[index] = true;
        try { await callback(); } finally { slots[index] = false; }
      }];
    },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const actions = Object.fromEntries(cases.map(({ action, field, saved }) => [action, async (...args) => {
    calls.push({ name: action, args });
    return overrides[action] ? overrides[action](...args) : { status: 'success', version: 8, [field]: saved };
  }]));
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/image': { default: props => jsx('img', props) },
    '@/lib/enterprise/actions': actions,
  };
  const filename = 'app/(authenticated)/empresa/CompanyForm.tsx';
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: loaded, exports: loaded.exports, FormData: class extends FormData {
      constructor(target) { super(); if (target) for (const [key, entry] of target.entries()) this.set(key, entry); }
    },
    require(name) {
      if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      assert.ok(Object.hasOwn(imports, name), `Unexpected CompanyForm import: ${name}`);
      return imports[name];
    },
  }, { filename });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return { calls, render(props = {}) {
    cursor = 0;
    return expand(loaded.exports.CompanyForm({ company, ...props }));
  } };
}

for (const canManageEnterprise of [true, false]) {
  test(`${canManageEnterprise ? 'owner' : 'admin'} renders only authorized existing company fields with accessible labels`, () => {
    const tree = harness().render({ canManageEnterprise });
    const expected = canManageEnterprise ? cases.map(item => item.field) : ['default_filament_loss_percent'];
    assert.deepEqual(nodes(tree, node => node.type === 'input' && node.props.type !== 'hidden').map(node => node.props.name).sort(), expected.sort());
    assert.equal(nodes(tree, node => node.type === 'form').length, expected.length);
    for (const name of expected) {
      const field = input(tree, name);
      assert.ok(field.props.id);
      assert.ok(text(one(tree, node => node.type === 'label' && node.props.htmlFor === field.props.id)).trim());
      assert.equal(disabled(formFor(tree, name)), false);
      assert.equal(String(value(input(formFor(tree, name), 'version'))), '7');
    }
    const header = one(tree, node => node.type === 'header');
    assert.ok(nodes(header, node => /^h[1-6]$/.test(node.type)).length);
    assert.match(text(header), canManageEnterprise ? /Oficina Original/ : /empresa/i);
    assert.doesNotMatch(text(tree), /[→↗➜➔]/, 'Profile UI must not contain decorative arrow characters');
    assert.equal(nodes(tree, node => node.type === 'svg' && /arrow/i.test(JSON.stringify(node.props))).length, 0);
  });
}

test('nullable energy renders blank, and decimal initial values use commas', () => {
  const h = harness();
  assert.equal(value(input(h.render(), 'electricity_rate_per_kwh')), '0,854321');
  assert.equal(value(input(h.render(), 'default_filament_loss_percent')), '12,34');
  assert.equal(value(input(harness().render({ company: { ...company, electricity_rate_per_kwh: null } }), 'electricity_rate_per_kwh')), '');
});

for (const entry of cases) {
  test(`${entry.action} retains the exact two-argument action contract and raw FormData; success updates shared version`, async () => {
    const h = harness();
    const form = formFor(h.render(), entry.field);
    const data = formData(form, { [entry.field]: entry.raw });
    await submit(form, data);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, entry.action);
    assert.equal(h.calls[0].args.length, 2);
    assert.equal(h.calls[0].args[0], null);
    assert.equal(h.calls[0].args[1], data, 'Do not replace or normalize the submitted FormData');
    assert.equal(data.get(entry.field), entry.raw);
    assert.equal(data.get('version'), '7');
    const updated = h.render();
    assert.ok(nodes(updated, node => node.props.role === 'status' && /salv|sucesso/i.test(text(node))).length);
    for (const next of cases) assert.equal(String(value(input(formFor(updated, next.field), 'version'))), '8');
    if (entry.field === 'name') {
      const header = one(updated, node => node.type === 'header');
      assert.ok(text(header).includes(entry.saved), 'Saved company name must update the profile header');
      assert.ok(!text(header).includes(company.name));
    }
    const next = cases.find(item => item.field !== entry.field);
    const nextForm = formFor(updated, next.field);
    await submit(nextForm, formData(nextForm, { [next.field]: next.raw }));
    assert.equal(h.calls[1].args[1].get('version'), '8');
  });

  for (const status of ['permission_denied', 'conflict', 'network']) {
    test(`${entry.action} ${status} renders safe accessible feedback and unlocks submission`, async () => {
      const h = harness({ [entry.action]: async () => {
        if (status === 'network') throw new Error('PRIVATE transport password=secret');
        return { status };
      } });
      const form = formFor(h.render(), entry.field);
      await submit(form, formData(form, { [entry.field]: entry.raw }));
      const tree = h.render();
      const alerts = nodes(tree, node => node.props.role === 'alert');
      assert.ok(alerts.length, 'Failure must be announced with role=alert');
      assert.ok(alerts.some(node => text(node).trim().length > 0));
      assert.doesNotMatch(text(tree), /PRIVATE|password=secret/);
      if (status === 'permission_denied') assert.match(alerts.map(text).join(' '), /negad|permiss|autoriz/i);
      if (status === 'conflict') assert.match(alerts.map(text).join(' '), /atualiz|mudou|conflit/i);
      for (const next of cases) {
        const nextForm = formFor(tree, next.field);
        assert.equal(disabled(nextForm), false);
        assert.equal(String(value(input(nextForm, 'version'))), '7');
      }
    });
  }

  test(`${entry.action} globally locks all submits while pending with accessible loading`, async () => {
    const pending = deferred();
    const h = harness({ [entry.action]: () => pending.promise });
    const initial = h.render();
    const form = formFor(initial, entry.field);
    const submission = submit(form, formData(form, { [entry.field]: entry.raw }));
    try {
      const tree = h.render();
      for (const next of cases) {
        assert.equal(disabled(formFor(tree, next.field)), true, `${next.field} must be locked by the shared pending state`);
      }
      assert.ok(nodes(tree, node => node.props['aria-busy'] === true || (node.props.role === 'status' && /salv|aguard|carreg/i.test(text(node)))).length,
        'Pending updates must be exposed with aria-busy or an announced loading status');
      assert.match(text(tree), /salvando|aguarde|carregando/i);
    } finally {
      pending.resolve({ status: 'success', version: 8, [entry.field]: entry.saved });
      await submission;
    }
    for (const next of cases) assert.equal(disabled(formFor(h.render(), next.field)), false);
  });
}

test('blank energy is submitted unchanged and a successful nullable result stays blank', async () => {
  const h = harness({ updateCompanyRateAction: async () => ({ status: 'success', version: 9, electricity_rate_per_kwh: null }) });
  const form = formFor(h.render(), 'electricity_rate_per_kwh');
  await submit(form, formData(form, { electricity_rate_per_kwh: '' }));
  assert.equal(h.calls[0].args[1].get('electricity_rate_per_kwh'), '');
  assert.equal(value(input(h.render(), 'electricity_rate_per_kwh')), '');
});

test('admin loss submission uses its existing action and current version without owner-only inputs', async () => {
  const h = harness();
  const props = { canManageEnterprise: false, company: { ...company, name: 'Empresa' } };
  const form = formFor(h.render(props), 'default_filament_loss_percent');
  const data = formData(form, { default_filament_loss_percent: '2,50' });
  await submit(form, data);
  assert.equal(h.calls[0].name, 'updateCompanyLossAction');
  assert.equal(h.calls[0].args[0], null);
  assert.equal(h.calls[0].args[1], data);
  assert.deepEqual([...data.keys()].sort(), ['default_filament_loss_percent', 'version']);
  assert.equal(String(value(input(h.render(props), 'version'))), '8');
});

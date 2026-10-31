/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

// Execute real TS/TSX modules, replacing only browser/framework and action boundaries.
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file,
      reportDiagnostics: true,
    });
    assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
    vm.runInNewContext(compiled.outputText, {
      module: loadedModule, exports: loadedModule.exports, crypto: { randomUUID }, Event,
      requestAnimationFrame: callback => callback(), ...globals,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name === 'server-only') return {};
        if (name.startsWith('.') || name.startsWith('@/')) {
          const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
          return load(['.ts', '.tsx', '.js'].map(ext => base + ext).find(f => fs.existsSync(f)) ?? base);
        }
        return require(name);
      },
    }, { filename: file });
    return loadedModule.exports;
  }
  return load;
}

test('existing FDM and manual-form TS regressions execute unchanged', () => {
  const load = loader();
  load('lib/pricing/fdm.test.ts');
  load('lib/pricing/manual-form.test.ts');
});

// Stable hook slots survive rerenders; setters also support functional updates.
function hooks() {
  const slots = [];
  let cursor = 0;
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useId() { return `pricing-${cursor++}`; },
    },
    render(component, props) { cursor = 0; return component(props); },
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const button = (tree, label) => {
  const found = nodes(tree, n => n.type === 'button' && text(n) === label);
  assert.equal(found.length, 1, `button ${label}`);
  return found[0];
};
const plain = value => JSON.parse(JSON.stringify(value));
const load = loader();
const { parsePtBr, timeToHours } = load('lib/pricing/parse.ts');
const { numericError, manualRules, manualDecimal, manualPositive } = load('lib/pricing/input.ts');
const { parseManualForm } = load('lib/pricing/manual-form.ts');
const { calculateFdmPricing } = load('lib/pricing/fdm.ts');
const { runFdm } = load('lib/pricing/persistence.ts');
const form = {
  name: 'Impressora', quantity: '2', hours: '2', minutes: '0', purchasePrice: '2.000,00', lifeHours: '10.000', powerWatts: '100', maintenancePerHour: '0,1',
  energyRate: '1', lossPercent: '10', finishingHours: '0', finishingMinutes: '30', laborPerHour: '20', fixedCost: '1', packagingPerPiece: '3', markupPercent: '50',
  spoolLines: [{ name: 'PLA', consumptionGrams: '100', purchasePrice: '100', originalFilamentGrams: '1.000' }, { name: 'PETG', consumptionGrams: '50', purchasePrice: '80', originalFilamentGrams: '1000' }],
  packagingLines: [{ name: 'Caixa', mode: 'per_piece', quantity: '1', suppliedUnit: 'unidade', referencePrice: '20', referenceQuantity: '10' }, { name: 'Fita', mode: 'per_lot', quantity: '5', suppliedUnit: 'metro', referencePrice: '2', referenceQuantity: '1' }],
};

test('parsePtBr accepts complete pt-BR grouping, never decimal dots or partial groups', () => {
  for (const [input, expected] of [['1.000,50', 1000.5], ['12.345.678,123456', 12345678.123456], [' 0,25 ', .25], ['1000', 1000], ['0', 0], ['999.999', 999999]]) assert.equal(parsePtBr(input, 0, 1e12, 6), expected, input);
  for (const input of ['', ' ', '1.5', '1.00', '1.0000', '1234.000', '0.000', '01.000', '1,000.50', '1 000', '1,', ',5', '-1', '+1', '1e3', 'NaN', 'Infinity', '1,1234567']) assert.equal(parsePtBr(input, 0, 1e12, 6), null, input);
  assert.equal(parsePtBr('1.000', 0, 10000, 0), null);
  assert.equal(parsePtBr('1,0', 0, 10000, 0), null);
  assert.equal(parsePtBr('100', 1, 100, 0), 100);
  assert.equal(parsePtBr('101', 1, 100, 0), null);
});

test('numeric rules require explicit zero, positivity, integer bounds and decimal scale', () => {
  assert.match(numericError(' ', manualDecimal), /Informe um valor/);
  assert.equal(numericError('0', manualDecimal), null);
  assert.match(numericError('0', manualPositive), /maior que zero/);
  for (const [key, valid, invalid] of [
    ['quantity', '100000', '100001'], ['hours', '10000', '10001'], ['minutes', '59', '60'],
    ['finishingHours', '0', '1,5'], ['finishingMinutes', '0', '60'], ['energyRate', '100', '100,000001'],
    ['lossPercent', '100', '101'], ['lifeHours', '1.000', '0'], ['powerWatts', '0,000001', '0'],
  ]) { assert.equal(numericError(valid, manualRules[key]), null, key); assert.ok(numericError(invalid, manualRules[key]), key); }
  assert.ok(numericError('1,1234567', manualDecimal));
  assert.match(numericError('1.5', manualDecimal), /milhares completos/);
});

test('time boundaries reject malformed components without clamping or rollover', () => {
  for (const [h, m, expected] of [['0', '0', 0], ['0', '1', 1 / 60], [' 1 ', ' 30 ', 1.5], ['10000', '59', 10000 + 59 / 60]]) assert.equal(timeToHours(h, m), expected);
  for (const [h, m] of [['10001', '0'], ['1', '60'], ['-1', '0'], ['', '0'], [' ', '0'], ['1,5', '0'], ['1.000', '0'], ['1', '1.5'], ['Infinity', '0'], ['9007199254740992', '0']]) assert.equal(timeToHours(h, m), null, `${h}:${m}`);
});

test('manual-form payload preserves lot time, references and packaging; fdm/runFdm regression', () => {
  const input = parseManualForm(form);
  assert.ok(input);
  assert.equal(input.printer.purchasePrice, 2000);
  assert.equal(input.printer.lifeHours, 10000);
  assert.deepEqual(plain(input.tariff), { original: null, effective: 1, adjusted: true });
  assert.deepEqual(plain(input.packagingLines), form.packagingLines.map(line => ({ ...line, quantity: Number(line.quantity), referencePrice: Number(line.referencePrice), referenceQuantity: Number(line.referenceQuantity) })));
  const engineInput = { ...input, energyRate: input.tariff.effective };
  const before = JSON.stringify(engineInput);
  const result = calculateFdmPricing(engineInput);
  for (const [key, expected] of Object.entries({ material: 15.4, energy: .2, depreciation: .4, maintenance: .2, finishing: 11, packaging: 20, total: 47.2, unitCost: 23.6, suggestedLotPrice: 70.8, suggestedUnitPrice: 35.4, markupAmount: 23.6 })) assert.ok(Math.abs(result[key] - expected) < 1e-9, key);
  assert.deepEqual(plain(runFdm(engineInput)), { ok: true, data: plain(result) });
  assert.equal(JSON.stringify(engineInput), before);
  const invalid = runFdm({ ...engineInput, printTimeHours: 0 });
  assert.equal(invalid.ok, false); assert.equal(invalid.code, 'invalid'); assert.match(invalid.error, /printTimeHours/);
  for (const key of Object.keys(form).filter(k => !['name', 'spoolLines', 'packagingLines'].includes(k))) {
    for (const value of ['', ' ', 'NaN', 'Infinity', '-1']) assert.equal(parseManualForm({ ...form, [key]: value }), null, `${key}: ${value}`);
  }
  for (const patch of [{ hours: '0', minutes: '0' }, { minutes: '60' }, { quantity: '1.000' }, { purchasePrice: '1.5' }, { spoolLines: [{ ...form.spoolLines[0], consumptionGrams: '' }] }, { packagingLines: [{ ...form.packagingLines[0], referenceQuantity: '0' }] }]) assert.equal(parseManualForm({ ...form, ...patch }), null);
  assert.ok(parseManualForm({ ...form, packagingLines: [], packagingPerPiece: '0', purchasePrice: '0', maintenancePerHour: '0', energyRate: '0' }));
});

function wizardFixture(options = {}) {
  const state = hooks();
  const frames = [], focused = [], events = [], checked = [];
  const invalid = options.invalid ?? {};
  const sections = Array.from({ length: 6 }, (_, index) => ({
    querySelectorAll: selector => { assert.equal(selector, '[data-pricing-invalid="true"]'); return invalid[index] ? [{ dispatchEvent: event => events.push([index, event.type, event.bubbles]), focus: () => focused.push(index) }] : []; },
    querySelector: () => ({ focus: () => focused.push(index) }),
  }));
  const { PricingWizard } = loader({ react: state.react, 'next/link': 'a' }, { requestAnimationFrame: callback => frames.push(callback) })('components/pricing/PricingWizard.tsx');
  const children = Array.from({ length: 6 }, (_, index) => ({ type: 'input', key: String(index), props: { defaultValue: `retained-${index}` } }));
  let step = options.step ?? 0;
  const props = { mode: 'Teste', summary: null, children, setStep: next => { step = next; }, validateStep: index => { checked.push(index); return index !== options.domainInvalid; }, onCalculate: options.onCalculate, disabled: options.disabled };
  return {
    render() {
      const tree = state.render(PricingWizard, { ...props, step });
      tree.props.ref.current = { querySelector: selector => sections[Number(selector.match(/"(\d+)"/)[1])] };
      nodes(tree, n => n.type === 'h2' && n.props.ref)[0].props.ref.current = { focus: () => focused.push('heading') };
      return tree;
    },
    flush() { frames.splice(0).forEach(callback => callback()); },
    get step() { return step; }, children, invalid, events, checked, focused,
  };
}

test('wizard handlers advance/back, focus heading and keep every keyed panel mounted', () => {
  const fixture = wizardFixture();
  let tree = fixture.render();
  button(tree, 'Continuar').props.onClick();
  assert.equal(fixture.step, 1); assert.deepEqual(fixture.checked, [0]);
  assert.deepEqual(fixture.focused, []); fixture.flush(); assert.deepEqual(fixture.focused, ['heading']);
  tree = fixture.render();
  const panels = nodes(tree, n => n.props['data-pricing-step'] !== undefined);
  assert.equal(panels.length, 6);
  panels.forEach((panel, index) => { assert.equal(panel.props.children, fixture.children[index]); assert.equal(panel.props.hidden, index !== 1); assert.equal(panel.key, String(index)); });
  button(tree, 'Voltar').props.onClick(); fixture.flush();
  assert.equal(fixture.step, 0); assert.deepEqual(fixture.checked, [0]);
  tree = fixture.render();
  assert.equal(button(tree, 'Voltar').props.disabled, true);
  const returnedPanels = nodes(tree, n => n.props['data-pricing-step'] !== undefined);
  returnedPanels.forEach((panel, index) => {
    assert.equal(panel.props.children, fixture.children[index]);
    assert.equal(panel.props.children.props.defaultValue, `retained-${index}`);
    assert.equal(panel.props.hidden, index !== 0);
  });
});

test('wizard has the exact semantic order and intercepts input Enter without navigating or calculating', () => {
  let calculations = 0;
  const fixture = wizardFixture({ step: 4, onCalculate: () => { calculations++; return true; } });
  const tree = fixture.render();
  const nav = nodes(tree, n => n.type === 'nav')[0];
  assert.deepEqual(nodes(nav, n => n.type === 'button').map(n => text(n.props.children[1])), ['Filamento', 'Impressora e energia', 'Lote e acabamento', 'Embalagens', 'Revisão', 'Resultado']);
  nodes(tree, n => n.type === 'button').forEach(n => assert.equal(n.props.type, 'button'));
  let prevented = 0;
  tree.props.onKeyDown({ key: 'Enter', target: { tagName: 'INPUT' }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(fixture.step, 4); assert.equal(calculations, 0); assert.deepEqual(fixture.checked, []);
  tree.props.onKeyDown({ key: 'a', target: { tagName: 'INPUT' }, preventDefault: () => prevented++ });
  tree.props.onKeyDown({ key: 'Enter', target: { tagName: 'BUTTON' }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
});

test('wizard cannot jump past an invalid hidden panel; dispatches invalid and focuses it', () => {
  let calculated = 0;
  const fixture = wizardFixture({ step: 4, invalid: { 1: true }, onCalculate: () => { calculated++; return true; } });
  button(fixture.render(), 'Calcular e ver resultado').props.onClick();
  assert.equal(fixture.step, 1); assert.equal(calculated, 0);
  assert.deepEqual(fixture.checked, [0, 1]);
  assert.deepEqual(fixture.events, [[1, 'invalid', false]]);
  fixture.flush(); assert.deepEqual(fixture.focused, [1]);
  assert.equal(nodes(fixture.render(), n => n.props.role === 'alert').length, 1);
  delete fixture.invalid[1];
  button(fixture.render(), 'Continuar').props.onClick(); fixture.flush();
  assert.equal(fixture.step, 2);
  assert.equal(nodes(fixture.render(), n => n.props.role === 'alert').length, 0);
});

test('wizard domain validation, calculation veto and disabled navigation prevent invalid jumps', () => {
  const domain = wizardFixture({ domainInvalid: 2 });
  nodes(domain.render(), n => n.type === 'nav')[0].props.children.props.children[5].props.children.props.onClick();
  assert.equal(domain.step, 2); assert.deepEqual(domain.checked, [0, 1, 2]); domain.flush(); assert.deepEqual(domain.focused, [2]);
  let calls = 0;
  const veto = wizardFixture({ step: 4, onCalculate: () => { calls++; return false; } });
  button(veto.render(), 'Calcular e ver resultado').props.onClick();
  assert.equal(calls, 1); assert.equal(veto.step, 4); assert.deepEqual(veto.checked, [0, 1, 2, 3, 4]);
  const success = wizardFixture({ step: 4, onCalculate: () => true });
  button(success.render(), 'Calcular e ver resultado').props.onClick(); success.flush(); assert.equal(success.step, 5);
  const disabled = wizardFixture({ step: 3, disabled: true });
  button(disabled.render(), 'Voltar').props.onClick(); button(disabled.render(), 'Continuar').props.onClick();
  assert.equal(disabled.step, 3); assert.deepEqual(disabled.checked, []);
});

test('PricingInput validates on blur/invalid, keeps raw input and accessible error association', () => {
  const state = hooks();
  const { PricingInput } = loader({ react: state.react, 'next/link': 'a' })('components/pricing/PricingWizard.tsx');
  let changed;
  const props = { label: 'Quantidade', value: '', rule: manualRules.quantity, onChange: value => { changed = value; } };
  let tree = state.render(PricingInput, props);
  let input = nodes(tree, n => n.type === 'input')[0];
  assert.equal(input.props['data-pricing-invalid'], 'true'); assert.equal(input.props['aria-invalid'], false);
  assert.equal(input.props.inputMode, 'numeric');
  input.props.onChange({ target: { value: '1.5' } }); assert.equal(changed, '1.5');
  input.props.onInvalid();
  tree = state.render(PricingInput, props); input = nodes(tree, n => n.type === 'input')[0];
  assert.equal(input.props['aria-invalid'], true);
  assert.equal(nodes(tree, n => n.type === 'p')[0].props.id, input.props['aria-describedby']);
  tree = state.render(PricingInput, { ...props, value: '2' });
  input = nodes(tree, n => n.type === 'input')[0]; assert.equal(input.props['aria-invalid'], false); assert.equal(input.props['aria-describedby'], undefined);
  tree = state.render(PricingInput, { ...props, rule: undefined, value: '   ' });
  nodes(tree, n => n.type === 'input')[0].props.onBlur();
  assert.match(text(state.render(PricingInput, { ...props, rule: undefined, value: '   ' })), /Informe um nome/);
  assert.match(text(state.render(PricingInput, { ...props, rule: undefined, value: 'abc', textMax: 2 })), /até 2 caracteres/);
});

const page = items => ({ items, page: 1, totalPages: 1, total: items.length });
const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Produto', version: 3 };
function simulatorFixture(file, exportName, props, actions) {
  const state = hooks();
  const Wizard = function Wizard() {};
  const Input = function Input() {};
  const loadedModule = loader({ react: state.react, 'next/link': 'a', './PricingWizard': { PricingWizard: Wizard, PricingInput: Input }, '@/lib/pricing/persistence-actions': actions, '@/lib/pricing/actions': {} })(file);
  let component = loadedModule[exportName];
  if (exportName === 'PricingSimulator') { const outer = component(props); component = outer.type; props = outer.props; }
  const render = () => state.render(component, props);
  const wizard = () => nodes(render(), n => n.type === Wizard)[0];
  return { render, wizard, field(label, value) { const fields = nodes(render(), n => n.type === Input && n.props.label === label); assert.equal(fields.length, 1, label); fields[0].props.onChange(value); } };
}

function assertSimulatorSteps(fixture) {
  const panels = fixture.wizard().props.children;
  assert.equal(panels.length, 6);
  const hasField = (index, label) => assert.ok(nodes(panels[index], n => n.props.label === label).length, `${label} belongs to step ${index}`);
  assert.match(text(panels[0]), /[Ff]ilamento/);
  assert.match(text(panels[1]), /[Ii]mpressora/);
  hasField(2, 'Quantidade de peças'); hasField(2, 'Impressão total: horas'); hasField(2, 'Acabamento: minutos');
  assert.match(text(panels[3]), /[Ee]mbalage/);
  assert.match(text(panels[4]), /[Rr]evisão/);
  nodes(fixture.render(), n => n.type === 'button').forEach(n => assert.equal(n.props.type, 'button', text(n)));
}
function assertCombinedTimeError(fixture) {
  fixture.field('Impressão total: horas', '0');
  fixture.field('Impressão total: minutos', '0');
  assert.equal(fixture.wizard().props.validateStep(2), false);
  const errors = nodes(fixture.wizard().props.children[2], n => n.type === 'p' && n.props['data-pricing-domain-invalid'] === 'true');
  assert.equal(errors.length, 1, 'combined time domain error is local to Lote e acabamento');
  assert.match(text(errors[0]), /maior que zero/);
}
function assertStaleHidesNumbers(fixture) {
  const result = fixture.wizard().props.children[5];
  assert.equal(nodes(result, n => n.type === 'strong').length, 0, 'stale result must not expose old numeric prices');
  assert.match(text(fixture.render()), /[Dd]esatualizado|recalcule/);
}

test('manual calculate/save handlers reject invalid input, freeze retries and invalidate stale results', async () => {
  const calls = [];
  let fail = true;
  const fixture = simulatorFixture('components/pricing/ManualPricingSimulator.tsx', 'ManualPricingSimulator', { initialProducts: page([product]), canSave: true }, {
    saveManualFdmPricingAction: async payload => { calls.push(payload); if (fail) throw Error('offline'); return { ok: true, data: { pricingId: 'saved' } }; },
  });
  assert.equal(fixture.wizard().props.onCalculate(), false);
  assert.equal(fixture.wizard().props.validateStep(2), false);
  assertSimulatorSteps(fixture);
  assertCombinedTimeError(fixture);
  for (const [label, value] of Object.entries({ 'Nome da impressora': 'Impressora', 'Preço de aquisição (R$)': '2.000', 'Vida útil estimada (h)': '10.000', 'Potência média (W)': '100', 'Tarifa de energia (R$/kWh)': '1', 'Nome do filamento': 'PLA', 'Consumo total do lote (g)': '100', 'Preço do carretel (R$)': '100', 'Peso original do filamento (g)': '1.000', 'Quantidade de peças': '2', 'Impressão total: horas': '2' })) fixture.field(label, value);
  const select = nodes(fixture.render(), n => n.type === 'select' && nodes(n, child => child.type === 'option' && child.props.value === product.id).length)[0];
  select.props.onChange({ target: { value: product.id } });
  assert.equal(fixture.wizard().props.onCalculate(), true);
  await button(fixture.render(), 'Salvar precificação').props.onClick();
  assert.equal(calls.length, 1); assert.equal(calls[0].productVersion, 3); assert.equal(calls[0].input.printTimeHours, 2);
  assert.equal(fixture.wizard().props.disabled, true); assert.equal(fixture.wizard().props.onCalculate(), false);
  fail = false;
  await button(fixture.render(), 'Confirmar mesma tentativa congelada').props.onClick();
  assert.equal(calls.length, 2); assert.equal(calls[0].attemptId, calls[1].attemptId); assert.equal(calls[0].input, calls[1].input);
  assert.equal(button(fixture.render(), 'Salvar precificação').props.disabled, true);
  fixture.field('Quantidade de peças', '3');
  const save = button(fixture.render(), 'Salvar precificação'); assert.equal(save.props.disabled, true);
  await save.props.onClick(); assert.equal(calls.length, 2);
  assert.equal(fixture.wizard().props.onCalculate(), true);
  await button(fixture.render(), 'Salvar precificação').props.onClick();
  assert.equal(calls.length, 3); assert.notEqual(calls[2].attemptId, calls[0].attemptId);
});

test('integrated calculate/save handlers validate selections, preserve versions and reject stale saves', async () => {
  const calls = [];
  const printer = { id: '22222222-2222-4222-8222-222222222222', name: 'Printer', version: 7, purchase_price: 2000, estimated_life_hours: 10000, average_power_watts: 100, maintenance_cost_per_hour: .1 };
  const spool = { id: '33333333-3333-4333-8333-333333333333', internal_identifier: 'PLA', version: 9, purchase_price: 100, original_filament_grams: 1000, current_balance_grams: 500 };
  const fixture = simulatorFixture('components/pricing/PricingSimulator.tsx', 'PricingSimulator', {
    mode: 'integrated', effectivePlan: 'intermediate', initialProducts: page([product]), initialPrinters: page([printer]), initialSpools: page([spool]), electricityRate: 1, configVersion: 4, canSave: true,
  }, { saveFdmPricingAction: async payload => { calls.push(payload); if (calls.length === 1) throw Error('offline'); return { ok: true, data: { pricingId: 'saved' } }; } });
  assert.equal(fixture.wizard().props.validateStep(2), false);
  assertSimulatorSteps(fixture);
  assertCombinedTimeError(fixture);
  button(fixture.render(), 'Printer').props.onClick();
  nodes(fixture.render(), n => n.type === 'button' && text(n).startsWith('PLA '))[0].props.onClick();
  for (const [label, value] of Object.entries({ 'Consumo do lote (g)': '100', 'Quantidade de peças': '2', 'Impressão total: horas': '2', 'Embalagem manual por peça (R$)': '3' })) fixture.field(label, value);
  assert.equal(fixture.wizard().props.onCalculate(), true);
  fixture.field('Quantidade de peças', '3');
  assertStaleHidesNumbers(fixture);
  assert.equal(fixture.wizard().props.onCalculate(), true);
  const missingProduct = button(fixture.render(), 'Salvar precificação');
  assert.equal(missingProduct.props.disabled, true); await missingProduct.props.onClick(); assert.equal(calls.length, 0);
  button(fixture.render(), 'Produto').props.onClick();
  assert.equal(button(fixture.render(), 'Salvar precificação').props.disabled, true);
  assert.equal(fixture.wizard().props.onCalculate(), true);
  await button(fixture.render(), 'Salvar precificação').props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(fixture.wizard().props.disabled, true);
  await button(fixture.render(), 'Confirmar mesma tentativa congelada').props.onClick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
  assert.equal(fixture.wizard().props.disabled, false);
  const payload = calls[0];
  assert.deepEqual(plain(payload.spoolIds), [spool.id]); assert.deepEqual(plain(payload.spoolVersions), [9]);
  assert.equal(payload.printerVersion, 7); assert.equal(payload.productVersion, 3); assert.equal(payload.configVersion, 4);
  assert.equal(payload.input.printTimeHours, 2); assert.equal(payload.input.packagingPerPiece, 3);
  assert.deepEqual(plain(payload.input.tariff), { original: 1, effective: 1, adjusted: false });
  assert.deepEqual(plain(payload.input.spoolConsumptionsGrams), [100]);
  fixture.field('Impressão total: minutos', '60');
  assert.equal(fixture.wizard().props.validateStep(2), false); assert.equal(fixture.wizard().props.onCalculate(), false);
  await button(fixture.render(), 'Salvar precificação').props.onClick(); assert.equal(calls.length, 2);
});

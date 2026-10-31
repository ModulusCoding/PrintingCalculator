/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

// Execute the actual TS/TSX. Only framework and server-action boundaries are mocked.
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const sandboxModule = { exports: {} };
    cache.set(file, sandboxModule);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: file, reportDiagnostics: true,
    });
    assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
    vm.runInNewContext(compiled.outputText, {
      module: sandboxModule, exports: sandboxModule.exports, crypto: { randomUUID }, URL, URLSearchParams, requestAnimationFrame: fn => fn(), ...globals,
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
    return sandboxModule.exports;
  }
  return load;
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
const plain = value => JSON.parse(JSON.stringify(value));
const links = tree => nodes(tree, n => n.type === 'a');
const Archive = function Archive() {};
const Delete = function Delete() {};
const ImageManager = function ImageManager() {};
const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Vaso ativo', description: null, price: '1234.50', active: true, version: 7 };
const archived = { ...product, id: '22222222-2222-4222-8222-222222222222', name: 'Vaso arquivado', price: null, active: false, version: 9 };
async function listFixture(options = {}) {
  const calls = [];
  const result = { products: [product, archived], total: 42, page: 2, search: 'vaso & azul', status: 'all', ...options.result };
  const params = { search: 'vaso & azul', status: 'all', page: '2' };
  const Page = loader({
    'next/link': 'a',
    '@/components/admin/ProductArchiveButton': { ProductArchiveButton: Archive },
    '@/components/admin/ProductDeleteButton': { ProductDeleteButton: Delete },
    '@/lib/products/actions': { listInternalProducts: async input => { calls.push(['list', input]); return result; } },
    '@/lib/products/access': {
      productPermission: async permission => { calls.push(['permission', permission]); return permission === 'products.write' ? options.canWrite !== false : options.canDelete !== false; },
      productCreationCapacity: async () => { calls.push(['capacity']); return options.capacityResult ?? { capacity: { canCreate: true, used: 2, limit: 10 }, failure: null }; },
    },
  })('app/(authenticated)/admin/products/page.tsx').default;
  return { tree: await Page({ searchParams: Promise.resolve(params) }), calls, params };
}

test('SSR products list renders real mobile cards and desktop table with status, prices and permissioned actions', async () => {
  const { tree, calls, params } = await listFixture();
  assert.deepEqual(calls[0], ['list', params]);
  const mobile = nodes(tree, n => n.type === 'div' && n.props.className?.includes('md:hidden'))[0];
  const desktop = nodes(tree, n => n.type === 'table')[0];
  assert.ok(mobile); assert.ok(desktop);
  assert.equal(nodes(mobile, n => n.type === 'article').length, 2);
  assert.equal(nodes(desktop, n => n.type === 'th' && n.props.scope === 'col').length, 4);
  for (const view of [mobile, desktop]) {
    assert.match(text(view), /Vaso ativo/); assert.match(text(view), /Vaso arquivado/);
    assert.match(text(view), /1\.234,50/); assert.match(text(view), /Sob consulta/);
    assert.match(text(view), /Ativo/); assert.match(text(view), /Arquivado/);
    assert.equal(links(view).find(n => n.props.href.endsWith(product.id)).props['aria-label'], 'Editar Vaso ativo');
    assert.equal(links(view).find(n => n.props.href.endsWith(archived.id)).props['aria-label'], 'Visualizar Vaso arquivado');
    const archiveButtons = nodes(view, n => n.type === Archive);
    assert.equal(archiveButtons.length, 2);
    assert.deepEqual(archiveButtons.map(n => [n.props.id, n.props.version, n.props.active]), [[product.id, 7, true], [archived.id, 9, false]]);
    assert.equal(nodes(view, n => n.type === Delete).length, 1);
    assert.equal(nodes(view, n => n.type === Delete)[0].props.id, product.id);
    for (const action of archiveButtons) {
      const url = new URL(action.props.returnTo, 'https://local.test');
      assert.equal(url.searchParams.get('search'), params.search); assert.equal(url.searchParams.get('status'), 'all'); assert.equal(url.searchParams.get('page'), '2');
    }
  }
  assert.equal(links(tree).filter(n => n.props.href === '/admin/products/new').length, 1);
});

test('SSR filters and pagination retain search/status and disable boundary controls', async () => {
  const { tree } = await listFixture();
  const form = nodes(tree, n => n.type === 'form')[0];
  assert.equal(form.props.action, '/admin/products');
  const search = nodes(form, n => n.type === 'input')[0];
  assert.equal(search.props.name, 'search'); assert.equal(search.props.defaultValue, 'vaso & azul'); assert.equal(search.props.maxLength, 200);
  assert.equal(nodes(form, n => n.type === 'select')[0].props.defaultValue, 'all');
  assert.deepEqual(nodes(form, n => n.type === 'option').map(n => n.props.value), ['active', 'archived', 'all']);
  for (const [label, page] of [['Anterior', '1'], ['Próxima', '3']]) {
    const url = new URL(links(tree).find(n => text(n) === label).props.href, 'https://local.test');
    assert.equal(url.searchParams.get('page'), page); assert.equal(url.searchParams.get('search'), 'vaso & azul'); assert.equal(url.searchParams.get('status'), 'all');
  }
  const empty = (await listFixture({ result: { products: [], total: 0, page: 1 } })).tree;
  assert.match(text(empty), /Nenhum produto encontrado/);
  assert.equal(nodes(empty, n => n.props['aria-disabled'] === 'true').length, 2);
  assert.match(text(empty), /Página 1 de 1/);
});

test('SSR read-only and archived products cannot expose edit/delete controls without permissions', async () => {
  const { tree, calls } = await listFixture({ canWrite: false, canDelete: false });
  assert.equal(calls.some(call => call[0] === 'capacity'), false);
  assert.equal(nodes(tree, n => n.type === Archive || n.type === Delete).length, 0);
  assert.equal(links(tree).some(n => n.props.href === '/admin/products/new'), false);
  assert.equal(links(tree).filter(n => n.props['aria-label']?.startsWith('Visualizar ')).length, 4);
  assert.equal(links(tree).some(n => n.props['aria-label']?.startsWith('Editar ')), false);
});

test('SSR capacity blocks creation only, retaining editing and plan comparison', async () => {
  const { tree } = await listFixture({ capacityResult: { capacity: { canCreate: false, used: 10, limit: 10 }, failure: null } });
  assert.equal(links(tree).some(n => n.props.href === '/admin/products/new'), false);
  assert.match(text(nodes(tree, n => n.props.role === 'status')), /10 de 10/);
  assert.ok(links(tree).some(n => n.props.href === '/planos'));
  assert.equal(links(tree).filter(n => n.props['aria-label'] === 'Editar Vaso ativo').length, 2);
});

test('SSR list and capacity failures render actionable errors without a false empty state', async () => {
  for (const error of ['selection_required', 'permission_denied', 'technical']) {
    const { tree, calls } = await listFixture({ result: { error, reference: 'ref-test', products: [], total: 0 } });
    assert.match(text(nodes(tree, n => n.props.role === 'alert')), /Não foi possível carregar os produtos/);
    assert.match(text(tree), /ref-test/);
    assert.doesNotMatch(text(tree), /Nenhum produto encontrado/);
    assert.equal(calls.some(call => call[0] === 'permission' || call[0] === 'capacity'), false);
    assert.equal(links(tree).some(n => text(n) === 'Tentar novamente'), true);
    assert.equal(links(tree).some(n => n.props.href === '/planos'), error === 'selection_required');
  }
  const { tree } = await listFixture({ capacityResult: { capacity: null, failure: { status: 'plan_limit_reached' } } });
  assert.match(text(nodes(tree, n => n.props.role === 'alert')), /limite de produtos/);
  assert.ok(links(tree).some(n => n.props.href === '/planos'));
  assert.equal(links(tree).some(n => n.props.href === '/admin/products/new'), false);
});

function hooks() {
  const slots = [];
  let cursor = 0;
  const pending = [];
  return {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useTransition() { cursor++; return [false, fn => pending.push(Promise.resolve().then(fn))]; },
      useId() { return `product-${cursor++}`; },
    },
    render(Component, props) { cursor = 0; return Component(props); },
    async flush() { await Promise.all(pending.splice(0)); },
  };
}
function formFixture(props = {}, action = async () => ({ status: 'success' })) {
  const state = hooks(), calls = [], navigation = [], focused = [];
  const { ProductForm } = loader({
    react: state.react, 'next/link': 'a',
    'next/navigation': { useRouter: () => ({ push: url => navigation.push(url), refresh: () => navigation.push('refresh') }) },
    '@/components/admin/ProductArchiveButton': { ProductArchiveButton: Archive },
    '@/components/admin/ProductImageManager': { ProductImageManager: ImageManager },
    '@/lib/products/actions': {
      createInternalProduct: async payload => { calls.push(plain(payload)); return action(payload); },
      updateInternalProduct: async (id, version, payload) => { calls.push({ id, version, ...plain(payload) }); return action(payload); },
    },
  })('components/admin/ProductForm.tsx');
  const render = () => {
    const tree = state.render(ProductForm, props);
    tree.props.ref.current = { querySelector: selector => ({ focus: () => focused.push(selector) }) };
    return tree;
  };
  return {
    render, calls, navigation, focused, flush: state.flush,
    field(name) { return nodes(render(), n => n.props.id === `product-${name}`)[0]; },
    change(name, value) { this.field(name).props.onChange({ target: { value } }); },
    submit() { render().props.onSubmit({ preventDefault() {} }); },
  };
}

test('ProductForm validates actual fields, focuses first invalid input, and accepts corrected resubmission', async () => {
  const fixture = formFixture();
  fixture.submit(); await fixture.flush();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.field('name').props['aria-invalid'], true);
  assert.equal(fixture.focused[0], '#product-name');
  const described = fixture.field('name').props['aria-describedby'].split(' ');
  for (const id of described) assert.equal(nodes(fixture.render(), n => n.props.id === id).length, 1);
  fixture.change('name', 'Vaso corrigido'); fixture.change('price', '1.5');
  fixture.submit(); await fixture.flush();
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.field('price').props['aria-invalid'], true);
  fixture.change('price', 'R$ 1.250,50'); fixture.submit(); await fixture.flush();
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.calls[0].name, 'Vaso corrigido');
  assert.equal(fixture.calls[0].price, 'R$ 1.250,50');
  assert.deepEqual(fixture.navigation, ['/admin/products', 'refresh']);
});

test('ProductForm server invalid_input unlocks fields and preserves draft for correction', async () => {
  let invalid = true;
  const fixture = formFixture({}, async () => invalid ? { status: 'invalid_input', fieldErrors: { name: ['Nome rejeitado pelo servidor.'] } } : { status: 'success' });
  fixture.change('name', 'Vaso inicial'); fixture.submit(); await fixture.flush();
  assert.equal(fixture.field('name').props.disabled, false);
  assert.equal(fixture.field('name').props.value, 'Vaso inicial');
  assert.match(text(fixture.render()), /Nome rejeitado/);
  invalid = false; fixture.change('name', 'Vaso corrigido'); fixture.submit(); await fixture.flush();
  assert.equal(fixture.calls.length, 2); assert.equal(fixture.calls[1].name, 'Vaso corrigido');
});

test('ProductForm network uncertainty freezes creation and retries the exact attempt without duplicate submissions', async () => {
  let offline = true;
  const fixture = formFixture({}, async () => { if (offline) throw Error('offline'); return { status: 'success' }; });
  fixture.change('name', 'Vaso preservado'); fixture.change('description', 'Rascunho');
  fixture.submit(); fixture.submit(); await fixture.flush();
  assert.equal(fixture.calls.length, 1);
  for (const key of ['name', 'description', 'price']) assert.equal(fixture.field(key).props.disabled, true);
  assert.match(text(fixture.render()), /conexão/);
  assert.equal(fixture.field('name').props.value, 'Vaso preservado');
  offline = false;
  const retry = nodes(fixture.render(), n => n.type === 'button' && text(n) === 'Tentar confirmar novamente')[0];
  assert.ok(retry); retry.props.onClick(); await fixture.flush();
  assert.equal(fixture.calls.length, 2); assert.deepEqual(fixture.calls[1], fixture.calls[0]);
  assert.match(fixture.calls[0].attempt_id, /^[0-9a-f-]{36}$/);
});

test('ProductForm BRL boundaries preserve raw text and reject malformed paste without zero fallback', async () => {
  for (const value of ['', '0', '0,01', '1,50', '12,99', '1000', '1.000,50', '1.000.000,00']) {
    const fixture = formFixture(); fixture.change('name', 'Produto'); fixture.change('price', value);
    fixture.submit(); await fixture.flush();
    assert.equal(fixture.calls.length, 1, value); assert.equal(fixture.calls[0].price, value);
  }
  for (const value of ['abc', '-1', '+1', '1e3', '1.5', '1,001', '1.00,50', '1.000.000,01']) {
    const fixture = formFixture(); fixture.change('name', 'Produto'); fixture.change('price', value);
    fixture.submit(); await fixture.flush();
    assert.equal(fixture.calls.length, 0, value); assert.equal(fixture.field('price').props.value, value);
    assert.equal(fixture.field('price').props['aria-invalid'], true);
  }
});

test('delete recovers from version conflict after refresh and keeps uncertain retry identity', async () => {
  const state = hooks(); const calls = []; let response = { status: 'version_conflict' };
  const { ProductDeleteButton } = loader({ react: state.react, 'next/link': 'a',
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
    '@/lib/products/actions': { deleteInternalProduct: async (...args) => { calls.push(args); return response; } },
  }, { window: { confirm: () => true } })('components/admin/ProductDeleteButton.tsx');
  let props = { id: product.id, version: 1, returnTo: '/admin/products' };
  const click = async () => { const tree = state.render(ProductDeleteButton, props); nodes(tree, n => n.type === 'button')[0].props.onClick(); await state.flush(); };
  await click(); props = { ...props, version: 2 }; response = { status: 'unknown' }; await click();
  assert.equal(calls[0][1], 1); assert.equal(calls[1][1], 2); assert.notEqual(calls[0][2], calls[1][2]);
  props = { ...props, version: 3 }; await click();
  assert.equal(calls[2][1], 2); assert.equal(calls[2][2], calls[1][2]);
});

test('gallery refresh remounts image state without resetting editable text draft', () => {
  const fixture = formFixture({ product, galleryRefreshKey: 'server-render-A', imageResult: { status: 'success', images: [] } });
  fixture.change('name', 'Rascunho ainda não salvo');
  assert.equal(fixture.field('name').props.value, 'Rascunho ainda não salvo');
  assert.match(String(nodes(fixture.render(), n => n.type === ImageManager)[0].key), /^server-render-A:/);
});

test('inventory unit schema rejects fractions, negatives, excessive values and incompatible adjustment payloads', () => {
  const { parseUnits, movementInputSchema } = loader()('lib/inventory/validation.ts');
  assert.equal(parseUnits('0', true), 0); assert.equal(parseUnits('1000000000', false), 1000000000);
  for (const value of ['0', '-1', '1,5', '1.5', '1000000001', '', '01', '1e3']) assert.equal(parseUnits(value, false), null, value);
  const base = { attemptId: randomUUID(), productId: product.id, expectedVersion: 0, reason: 'Conferência' };
  assert.equal(movementInputSchema.safeParse({ ...base, movementType: 'entry', quantity: '1' }).success, true);
  assert.equal(movementInputSchema.safeParse({ ...base, movementType: 'adjustment', countedBalance: '0' }).success, true);
  assert.equal(movementInputSchema.safeParse({ ...base, movementType: 'adjustment', quantity: '1', countedBalance: '0' }).success, false);
  assert.equal(movementInputSchema.safeParse({ ...base, movementType: 'exit', quantity: '1', reason: '' }).success, false);
});

test('inventory reservation guards stay present and read models do not invent available balances', () => {
  const guards = fs.readFileSync('supabase/migrations/20261026171000_orders_stage72b1_reservation_guards.sql', 'utf8');
  assert.match(guards, /product_has_active_reservations/);
  const schemas = loader()('lib/inventory/schemas.ts');
  assert.equal(schemas.productInventorySchema.safeParse({ product_id: product.id, product_name: 'Vaso', balance: -1, inventory_version: 0, product_active: true }).success, false);
});

test('ProductForm archived/read-only records expose consultation only and reject direct submit', async () => {
  for (const props of [{ product: archived }, { product, canWrite: false, canDelete: false }]) {
    const fixture = formFixture(props);
    for (const name of ['name', 'description', 'price']) assert.equal(fixture.field(name).props.readOnly, true);
    assert.equal(nodes(fixture.render(), n => n.type === 'button' && n.props.type === 'submit').length, 0);
    assert.match(text(fixture.render()), /apenas para consulta|acesso de leitura/);
    fixture.submit(); await fixture.flush(); assert.equal(fixture.calls.length, 0);
    assert.ok(links(fixture.render()).some(n => text(n) === 'Voltar para produtos'));
  }
});

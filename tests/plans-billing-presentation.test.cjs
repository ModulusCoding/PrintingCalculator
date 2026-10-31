/* eslint-disable @typescript-eslint/no-require-imports -- Isolated VM SSR regression harness; no SQL or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { z } = require('zod');

function load(file, imports = {}, environment = 'sandbox') {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, URL, Error,
    process: { env: { ASAAS_ENVIRONMENT: environment } },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    require: name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unmocked import: ${name}`);
    },
  });
  return loadedModule.exports;
}
const contracts = load('lib/billing/contracts.ts', { zod: { z } });
function nodes(tree) {
  if (!React.isValidElement(tree)) return [];
  return [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
}
const sandboxUrl = 'https://sandbox.asaas.com/checkoutSession/show/checkout-1';
function harness({ data = { state: 'pending', checkout_url: sandboxUrl, payments: [] }, error = null, reject = false, environment } = {}) {
  const calls = { rpc: [], actions: [] };
  const actions = Object.fromEntries(['startSubscriptionAction', 'refreshSubscriptionAction', 'cancelSubscriptionAction', 'cancelCheckoutAction'].map(name => [name, () => {
    calls.actions.push(name);
    throw new Error('Actions must never execute during presentation');
  }]));
  const { SubscriptionPanel } = load('components/plans/SubscriptionPanel.tsx', {
    'server-only': {}, zod: { z }, '@/lib/billing/contracts': contracts,
    '@/lib/billing/actions': actions,
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (...args) => {
      calls.rpc.push(args);
      if (reject) throw new Error('private provider credential');
      return { data, error };
    } }) },
  }, environment);
  return { calls, actions, SubscriptionPanel, render: async () => {
    const tree = await SubscriptionPanel();
    const html = renderToStaticMarkup(tree);
    assert.deepEqual(calls.rpc, [['get_my_saas_billing']]);
    assert.deepEqual(calls.actions, []);
    return { tree, html, forms: nodes(tree).filter(node => node.type === 'form') };
  } };
}

const states = [
  ['not_configured', 'Sem assinatura de cobrança vinculada', true, false],
  ['review', 'Aguardando revisão financeira', false, true],
  ['pending', 'Aguardando pagamento', true, true],
  ['cancel_unknown', 'Cancelamento em verificação — novas contratações bloqueadas', false, false],
  ['cancelled', 'Assinatura cancelada', true, false],
];
for (const [state, label, start, cancel] of states) {
  test(`actual SubscriptionPanel SSR preserves ${state} and renders actions without invoking them`, async () => {
    const h = harness({ data: { state, checkout_url: sandboxUrl, effective_plan: 'free', payments: [] } });
    const { html, forms } = await h.render();
    assert.ok(html.includes(label));
    assert.match(html, /Acesso efetivo: <strong[^>]*>free<\/strong>/);
    const actionList = forms.map(form => form.props.action);
    assert.equal(actionList.includes(h.actions.startSubscriptionAction), start);
    assert.equal(actionList.includes(h.actions.cancelSubscriptionAction), cancel);
    assert.equal(actionList.includes(h.actions.cancelCheckoutAction), state === 'pending');
    assert.ok(actionList.includes(h.actions.refreshSubscriptionAction));
    assert.equal(forms.length, 1 + Number(start) + Number(cancel) + Number(state === 'pending'));
    assert.match(html, /Verificar pagamento \/ buscar próxima fatura Pix/);
    assert.match(html, /O retorno do checkout não ativa o plano/);
    assert.match(html, /primeira confirmação verificada pelo servidor/);
    assert.match(html, /Cartão: recorrência em checkout hospedado/);
    assert.match(html, /Pix: pagamento manual a cada mês; não é Pix Automático/);
    assert.match(html, /Magnata: R\$ 79,90\/mês, em breve e não contratável/);
    if (start) {
      assert.match(html, /Contratar \/ recuperar contratação/);
      assert.match(html, /Cartão — checkout hospedado e renovação automática/);
      assert.match(html, /Pix — pagar manualmente cada fatura mensal/);
      assert.match(html, /name="attempt" value="11111111-1111-4111-8111-111111111111"/);
      assert.match(html, /name="method" value="CREDIT_CARD"/);
      assert.match(html, /name="method" value="PIX"/);
    }
  });
}

test('safe hosted checkout and invoice links use the actual URL contract and isolated targets', async () => {
  const h = harness({ data: { state: 'review', checkout_url: sandboxUrl, next_due_date: '2026-11-01',
    coverage: [{ paid_from: '2026-10-01', paid_until: '2026-11-01', reversed: true }],
    payments: [{ payment_id: 'pay_1', status: 'RECEIVED', value_cents: 3990, due_date: '2026-11-01', invoice_url: 'https://sandbox.asaas.com/i/invoice-1' }] } });
  const { tree, html } = await h.render();
  const links = nodes(tree).filter(node => node.type === 'a');
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noopener noreferrer');
    assert.equal(contracts.safeAsaasUrl(link.props.href), link.props.href);
  }
  assert.match(html, /Próximo vencimento de fatura: 2026-11-01/);
  assert.match(html, /\(revertida\)/);
  assert.match(html, /39,90/);
  assert.match(html, /RECEIVED/);
});

for (const [environment, url, allowed] of [
  ['sandbox', sandboxUrl, true],
  ['production', 'https://www.asaas.com/i/invoice-1', true],
  ['production', sandboxUrl, false],
  ['sandbox', 'https://asaas.com/i/invoice-1', false],
  ...['javascript:alert(1)', 'http://sandbox.asaas.com/i/x', 'https://sandbox.asaas.com.evil.test/i/x',
    'https://user:secret@sandbox.asaas.com/i/x', 'https://sandbox.asaas.com:444/i/x',
    'https://sandbox.asaas.com/unapproved', '//sandbox.asaas.com/i/x', '', null].map(url => ['sandbox', url, false]),
]) {
  test(`hosted links ${allowed ? 'allow' : 'reject'} ${environment}: ${url}`, async () => {
    const h = harness({ environment, data: { state: 'pending', checkout_url: url, payments: [
      { payment_id: 'pay_1', status: 'PENDING', value_cents: 3990, due_date: '2026-11-01', invoice_url: url },
    ] } });
    const { tree, html } = await h.render();
    assert.equal(nodes(tree).filter(node => node.type === 'a').length, allowed ? 2 : 0);
    if (!allowed) assert.doesNotMatch(html, /Continuar checkout hospedado|Abrir fatura no Asaas/);
  });
}

for (const options of [{ error: { message: 'private credential' } }, { reject: true }, { data: null }, { data: { state: 'active', payments: [] } }, { data: { state: 'pending', payments: [{ due_date: 'invalid' }] } }]) {
  test(`billing failure remains a safe read-only notice: ${JSON.stringify(options)}`, async () => {
    const { html, forms } = await harness(options).render();
    assert.match(html, /role="status"/);
    assert.match(html, /A consulta de cobrança está indisponível/);
    assert.match(html, /Nenhuma cobrança foi iniciada/);
    assert.match(html, /plano e as cotas acima continuam sendo resolvidos pelo servidor/);
    assert.doesNotMatch(html, /private|credential|provider|<form/);
    assert.equal(forms.length, 0);
  });
}

test('pending without checkout retains subscription recovery but does not offer checkout cancellation', async () => {
  const h = harness({ data: { state: 'pending', checkout_url: null, payments: [] } });
  const { forms, html } = await h.render();
  assert.ok(forms.some(form => form.props.action === h.actions.startSubscriptionAction));
  assert.ok(!forms.some(form => form.props.action === h.actions.cancelCheckoutAction));
  assert.match(html, /Nenhuma cobrança registrada/);
});

for (const role of ['admin', 'operator', 'owner']) {
  test(`real meu-plano page gates billing presentation for ${role}`, async () => {
    let reads = 0;
    const h = harness();
    const page = load('app/(plans)/meu-plano/page.tsx', {
      'next/link': { default: props => React.createElement('a', props) }, zod: { z },
      '@/components/plans/SubscriptionPanel': { SubscriptionPanel: h.SubscriptionPanel },
      '@/lib/auth/context': { resolveMinimalIdentity: async () => ({ state: 'business_ready', role }) },
      '@/lib/plans': { getMyPlanAccess: async () => { reads++; return null; }, PLAN_CAPABILITIES: {}, PLAN_LABELS: {} },
      '@/lib/supabase/server': { createClient: async () => ({ rpc: async name => {
        reads++; assert.equal(name, 'get_my_plan_usage');
        return { data: [{ products: 0, shared_materials: 0, operators: 0, printers: 0 }], error: null };
      } }) },
      'next/navigation': { unstable_rethrow: () => {} },
      '@/components/plans/PlanAccessNotice': { planAccessNotice: () => null },
      '@/lib/general-materials/logger': { createLogger: () => ({ error: () => 'reference' }) },
      '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({}) },
    }).default;
    const tree = await page();
    assert.equal(nodes(tree).some(node => node.type === h.SubscriptionPanel), role === 'owner');
    assert.equal(reads, role === 'owner' ? 2 : 0);
    if (role !== 'owner') {
      assert.match(renderToStaticMarkup(tree), /Somente o responsável pela empresa/);
      assert.doesNotMatch(renderToStaticMarkup(tree), /<form/);
    }
    assert.deepEqual(h.calls.rpc, []);
    assert.deepEqual(h.calls.actions, []);
  });
}

for (const [state, destination] of [['unauthenticated', '/admin/login'], ['no_membership', '/conta'], ['business_ready', null]]) {
  test(`actual plans layout handles ${state} without an operational plan guard`, async () => {
    const shellCalls = [];
    const accessCalls = [];
    const layout = load('app/(plans)/layout.tsx', {
      '@/app/(authenticated)/AuthenticatedShell': { AuthenticatedShell: props => { shellCalls.push(props); return React.createElement('main', null, props.children); } },
      '@/components/layout/access': { shellAccessForRole: role => { accessCalls.push(role); return { canManage: true }; } },
      'next/navigation': { redirect: path => { throw new Error(`redirect:${path}`); } },
      '@/lib/auth/context': { resolveMinimalIdentity: async () => ({ state, role: 'owner' }) },
      '@/components/plans/PlanAccessNotice': { planAccessNotice: () => 'Identity unavailable' },
    }).default;
    if (destination) {
      await assert.rejects(layout({ children: 'billing-child' }), { message: `redirect:${destination}` });
      assert.deepEqual(accessCalls, []);
      assert.deepEqual(shellCalls, []);
    } else {
      const html = renderToStaticMarkup(await layout({ children: 'billing-child' }));
      assert.match(html, /billing-child/);
      assert.deepEqual(accessCalls, ['owner']);
      assert.equal(shellCalls.length, 1);
      assert.equal(shellCalls[0].canManage, true);
    }
  });
}

test('plans layout identity failure uses its notice instead of mounting the shell', async () => {
  const error = new Error('private identity diagnostic');
  const layout = load('app/(plans)/layout.tsx', {
    '@/app/(authenticated)/AuthenticatedShell': { AuthenticatedShell: () => { throw new Error('Unexpected shell'); } },
    '@/components/layout/access': { shellAccessForRole: () => { throw new Error('Unexpected access'); } },
    'next/navigation': { redirect: () => { throw new Error('Unexpected redirect'); } },
    '@/lib/auth/context': { resolveMinimalIdentity: async () => { throw error; } },
    '@/components/plans/PlanAccessNotice': { planAccessNotice: received => { assert.equal(received, error); return 'Identity unavailable'; } },
  }).default;
  const html = renderToStaticMarkup(await layout({ children: 'billing-child' }));
  assert.match(html, /Identity unavailable/);
  assert.doesNotMatch(html, /private|billing-child/);
});

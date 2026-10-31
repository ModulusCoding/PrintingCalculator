/* eslint-disable @typescript-eslint/no-require-imports -- Isolated VM SSR/hooks harness; no database or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    Error, module: loaded, exports: loaded.exports, ...globals,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(`Unmocked import in ${file}: ${name}`);
    },
  }, { filename: file });
  return loaded.exports;
}
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
const plans = load('lib/plans.ts', {
  'server-only': {}, zod: require('zod'),
  '@/lib/supabase/server': { createClient: () => { throw new Error('Unexpected database access'); } },
  'next/navigation': { unstable_rethrow() {} },
  '@/lib/general-materials/logger': { createLogger: () => ({ error: () => 'safe-reference' }) },
  '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({}) },
});
const owner = { state: 'business_ready', role: 'owner' };
function access(state = 'selection_required') {
  return {
    enterprise_id: '11111111-1111-4111-8111-111111111111',
    selected_plan: state === 'selection_required' ? null : state === 'free' ? 'free' : 'intermediate',
    effective_plan: state === 'paid' ? 'intermediate' : 'free',
    access_state: state, selection_required: state === 'selection_required',
    paid_until: null, cancelled_at: null, authorization_version: 7,
  };
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
function one(tree, predicate) {
  const found = nodes(tree, predicate);
  assert.equal(found.length, 1, 'Expected exactly one matching rendered element');
  return found[0];
}
function card(tree, label) {
  const candidates = nodes(tree, node => ['article', 'section'].includes(node.type) &&
    nodes(node.props.children, child => child.type === 'h2' && text(child).includes(label)).length === 1);
  assert.ok(candidates.length, `Missing ${label} card with h2 heading`);
  return candidates[candidates.length - 1];
}
function pageHarness({ identity = owner, identityError, plan = access(), planError } = {}) {
  const calls = { identity: 0, access: 0, choices: 0, notices: [] };
  const page = load('app/(plans)/planos/page.tsx', {
    'next/link': link,
    'next/navigation': { unstable_rethrow(error) { if (error?.nextControlFlow) throw error; } },
    '@/lib/auth/context': { resolveMinimalIdentity: async () => {
      calls.identity++;
      if (identityError) throw identityError;
      return identity;
    } },
    '@/lib/plans': { ...plans, getMyPlanAccess: async () => {
      calls.access++;
      if (planError) throw planError;
      return plan;
    } },
    './FreePlanChoice': { FreePlanChoice: () => { calls.choices++; return React.createElement('button', { 'data-free-choice': true }, 'Começar grátis'); } },
    '@/components/plans/PlanAccessNotice': { planAccessNotice: error => {
      calls.notices.push(error);
      return React.createElement('section', { role: 'alert' }, 'Não foi possível validar o acesso');
    } },
  }).default;
  return { calls, async render() {
    const tree = await page();
    return { tree, html: renderToStaticMarkup(tree) };
  } };
}

test('commercial constants retain actual prices, historical shared capacity, and unavailable Magnata', () => {
  assert.equal(plans.PLAN_LABELS.free, 'Aprendiz');
  assert.equal(plans.PLAN_LABELS.intermediate, 'Visionário');
  assert.match(plans.PLAN_LABELS.advanced, /Magnata/);
  assert.equal(plans.PLAN_CAPABILITIES.free.priceCents, 0);
  assert.equal(plans.PLAN_CAPABILITIES.intermediate.priceCents, 3990);
  assert.equal(plans.PLAN_CAPABILITIES.advanced.priceCents, 7990);
  assert.equal(plans.PLAN_CAPABILITIES.intermediate.sharedMaterials, 15);
  assert.equal(plans.PLAN_CAPABILITIES.advanced.available, false);
});

for (const state of ['selection_required', 'free', 'paid', 'expired', 'cancelled']) {
  test(`owner ${state}: real SSR offers initial free choice only before selection and marks effective plan`, async () => {
    const h = pageHarness({ plan: access(state) });
    const { tree, html } = await h.render();
    assert.equal(h.calls.identity, 1);
    assert.equal(h.calls.access, 1);
    assert.equal(h.calls.choices, state === 'selection_required' ? 1 : 0);
    assert.match(html, /Aprendiz/);
    assert.match(html, /Visionário/);
    assert.match(html, /Magnata/);
    const free = text(card(tree, 'Aprendiz'));
    const paid = text(card(tree, 'Visionário'));
    if (state !== 'selection_required') {
      assert.match(state === 'paid' ? paid : free, /plano atual/i);
      assert.doesNotMatch(state === 'paid' ? free : paid, /plano atual/i,
        'An expired/cancelled selected paid plan is not the effective current plan');
    } else {
      assert.doesNotMatch(`${free} ${paid}`, /plano atual/i);
    }
    assert.doesNotMatch(html, /[→↗➜➔]|(?:data-lucide|aria-label)="[^"]*arrow/i);
  });
}

test('initial owner paid offer is an actual Meu plano link, not a disabled or pretend checkout', async () => {
  const { tree } = await pageHarness().render();
  const paid = card(tree, 'Visionário');
  assert.ok(nodes(paid, node => node.props?.href === '/meu-plano').length, 'Paid offer must lead to the existing billing surface');
  assert.equal(nodes(paid, node => node.type === 'button' && !node.props.disabled).length, 0);
  assert.equal(nodes(tree, node => /checkout|stripe|mercadopago/i.test(node.props?.href ?? '')).length, 0);
});

for (const role of ['admin', 'operator']) {
  for (const state of ['selection_required', 'paid', 'expired', 'cancelled']) {
    test(`${role} ${state}: no initial free control or billing link leaks into comparison`, async () => {
      const h = pageHarness({ identity: { ...owner, role }, plan: access(state) });
      const { tree, html } = await h.render();
      assert.equal(h.calls.choices, 0);
      assert.equal(nodes(tree, node => node.props?.href === '/meu-plano').length, 0);
      assert.match(html, /proprietário|responsável/i);
      assert.doesNotMatch(html, /data-free-choice/);
    });
  }
}

for (const state of ['unauthenticated', 'no_membership', 'membership_inactive', 'enterprise_inactive']) {
  test(`identity ${state} does not read plan authority or offer actions`, async () => {
    const h = pageHarness({ identity: { state } });
    const { html } = await h.render();
    assert.equal(h.calls.access, 0);
    assert.equal(h.calls.choices, 0);
    assert.doesNotMatch(html, /data-free-choice|href="\/meu-plano"/);
  });
}

test('plan technical failure uses safe notice without actionable plan cards', async () => {
  const error = new Error('PRIVATE SQL password=secret');
  const h = pageHarness({ planError: error });
  const { html } = await h.render();
  assert.equal(h.calls.notices.length, 1);
  assert.equal(h.calls.notices[0], error);
  assert.equal(h.calls.choices, 0);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /PRIVATE|SQL|secret|data-free-choice/);
});

test('missing authoritative plan renders unavailable feedback, never an initial choice', async () => {
  const h = pageHarness({ plan: null });
  const { html } = await h.render();
  assert.equal(h.calls.choices, 0);
  assert.match(html, /role="alert"/);
  assert.match(html, /não foi encontrado|indisponível|não.*validar/i);
});

test('visible comparison preserves shared 15 clarification, real pricing, and no speculative Magnata list', async () => {
  const { tree } = await pageHarness().render();
  const free = text(card(tree, 'Aprendiz'));
  const paid = text(card(tree, 'Visionário'));
  const magnata = card(tree, 'Magnata');
  assert.match(free, /gr[aá]tis|gratuito|0,00/i);
  assert.match(free, /3 produtos e 3 pedidos no histórico total da empresa/);
  assert.match(free, /Não são limites mensais ou simultâneos/);
  const categories = plan => nodes(plan, node => node.type === 'dt').map(text);
  assert.deepEqual(categories(card(tree, 'Aprendiz')), categories(card(tree, 'Visionário')));
  assert.equal(categories(card(tree, 'Aprendiz')).length, 5);
  assert.match(paid, /39,90/);
  assert.match(paid, /15.*compartilhad|compartilhad.*15/i);
  assert.match(paid, /carretéis/);
  assert.match(paid, /materiais gerais/i);
  assert.match(paid, /não são\s+15\s+de cada/i);
  assert.match(text(magnata), /79,90/);
  assert.match(text(magnata), /em breve|indisponível/i);
  assert.equal(nodes(magnata, node => node.type === 'ul' || node.type === 'ol').length, 0, 'Unavailable Magnata must not advertise speculative capabilities');
  assert.equal(nodes(magnata, node => node.props?.href || (node.type === 'button' && !node.props.disabled)).length, 0);
});

function choiceHarness(action = async () => ({ status: 'selected', message: 'Escolha registrada com sucesso' })) {
  const slots = [], calls = { actions: 0, refreshes: 0, navigations: [] }, transitions = [];
  let cursor = 0;
  const slot = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return index;
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState(initial) {
      const index = slot(initial);
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useTransition() {
      const index = slot(false);
      return [slots[index], callback => {
        slots[index] = true;
        const transition = (async () => { try { await callback(); } finally { slots[index] = false; } })();
        transitions.push(transition);
      }];
    },
  };
  const { FreePlanChoice } = load('app/(plans)/planos/FreePlanChoice.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/link': { default: props => jsx('a', props) },
    'next/navigation': { useRouter: () => ({ refresh: () => { calls.refreshes++; }, push: url => calls.navigations.push(url), replace: url => calls.navigations.push(url) }) },
    '@/lib/plans/actions': { selectInitialFreePlan: async (...args) => { calls.actions++; assert.equal(args.length, 0); return action(); } },
  });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  return { calls, render() { cursor = 0; return expand(FreePlanChoice()); }, async settle() { await Promise.all(transitions); } };
}
const button = tree => one(tree, node => node.type === 'button');

test('FreePlanChoice render and rerender never mutate, refresh, or navigate', () => {
  const h = choiceHarness();
  for (let i = 0; i < 3; i++) {
    const tree = h.render();
    assert.equal(button(tree).props.disabled, false);
    assert.match(text(tree), /Começar grátis/);
    assert.equal(nodes(tree, node => node.props?.role === 'alert').length, 0);
  }
  assert.deepEqual(h.calls, { actions: 0, refreshes: 0, navigations: [] });
});

for (const status of ['selected', 'no_change', 'conflict', 'error', 'uncertain']) {
  test(`FreePlanChoice ${status}: accessible feedback, success lock, conflict refresh only`, async () => {
    const message = `Safe feedback ${status}`;
    const h = choiceHarness(async () => ({ status, message }));
    button(h.render()).props.onClick();
    await h.settle();
    const tree = h.render();
    const success = ['selected', 'no_change'].includes(status);
    assert.equal(h.calls.actions, 1);
    assert.equal(h.calls.refreshes, status === 'conflict' ? 1 : 0);
    assert.deepEqual(h.calls.navigations, []);
    assert.equal(button(tree).props.disabled, success);
    assert.equal(button(tree).props['aria-busy'], false);
    assert.equal(text(one(tree, node => node.props?.role === (success ? 'status' : 'alert'))), message);
    assert.equal(nodes(tree, node => node.props?.href === '/meu-plano').length, 1);
    assert.equal(nodes(tree, node => node.props?.href === '/home').length, success ? 1 : 0);
    h.render();
    assert.equal(h.calls.actions, 1);
    assert.equal(h.calls.refreshes, status === 'conflict' ? 1 : 0, 'Refresh belongs in the transition, not render');
  });
}

test('FreePlanChoice thrown transport is uncertain, safe, retryable, and never claims rollback', async () => {
  const h = choiceHarness(async () => { throw new Error('PRIVATE password=secret'); });
  button(h.render()).props.onClick();
  await h.settle();
  const tree = h.render();
  assert.equal(button(tree).props.disabled, false);
  assert.match(text(one(tree, node => node.props?.role === 'alert')), /não pôde ser confirmado|não.*confirmar/i);
  assert.doesNotMatch(text(tree), /PRIVATE|password|secret|nenhuma alteração foi feita/i);
  assert.equal(h.calls.refreshes, 0);
  assert.deepEqual(h.calls.navigations, []);
});

test('FreePlanChoice pending transition disables button and exposes accessible progress until resolved', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = choiceHarness(() => pending);
  button(h.render()).props.onClick();
  const tree = h.render();
  assert.equal(button(tree).props.disabled, true);
  assert.equal(button(tree).props['aria-busy'], true);
  assert.match(text(one(tree, node => node.props?.role === 'status')), /registrando|confirmando/i);
  assert.equal(h.calls.actions, 1);
  assert.equal(h.calls.refreshes, 0);
  resolve({ status: 'selected', message: 'Escolha registrada' });
  await h.settle();
  assert.equal(button(h.render()).props['aria-busy'], false);
});

function actionHarness({ identity = owner, identityError, response = { data: [{ status: 'selected' }], error: null }, transportError } = {}) {
  const calls = { identities: 0, clients: 0, rpcs: [], revalidated: [] };
  const { selectInitialFreePlan } = load('lib/plans/actions.ts', {
    zod: require('zod'),
    'next/cache': { revalidatePath: (...args) => calls.revalidated.push(args) },
    '@/lib/auth/context': { resolveMinimalIdentity: async () => {
      calls.identities++;
      if (identityError) throw identityError;
      return identity;
    } },
    '@/lib/supabase/server': { createClient: async () => {
      calls.clients++;
      return { rpc: async (...args) => {
        calls.rpcs.push(args);
        if (transportError) throw transportError;
        return response;
      } };
    } },
  });
  return { calls, run: selectInitialFreePlan };
}

for (const identity of [{ ...owner, role: 'admin' }, { ...owner, role: 'operator' }, { state: 'unauthenticated' }, { state: 'no_membership' }, { state: 'enterprise_inactive' }]) {
  test(`initial free action rejects ${identity.role || identity.state} before client/RPC`, async () => {
    const h = actionHarness({ identity });
    assert.equal((await h.run()).status, 'error');
    assert.equal(h.calls.identities, 1);
    assert.equal(h.calls.clients, 0);
    assert.deepEqual(h.calls.rpcs, []);
    assert.deepEqual(h.calls.revalidated, []);
  });
}

test('initial free action identity failure cannot send an RPC or leak diagnostics', async () => {
  const h = actionHarness({ identityError: new Error('PRIVATE auth secret') });
  const result = await h.run();
  assert.equal(result.status, 'error');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secret/);
  assert.equal(h.calls.clients, 0);
  assert.deepEqual(h.calls.revalidated, []);
});

for (const status of ['selected', 'no_change', 'conflict']) {
  test(`initial free owner action ${status} uses exact parameterless RPC and revalidation contract`, async () => {
    const h = actionHarness({ response: { data: [{ status }], error: null } });
    const result = await h.run();
    assert.equal(result.status, status);
    assert.ok(result.message);
    assert.deepEqual(h.calls.rpcs, [['select_initial_free_plan']]);
    assert.deepEqual(h.calls.revalidated, status === 'conflict' ? [] : [['/', 'layout']]);
  });
}

for (const data of [null, [], {}, [{ status: 'selected' }, { status: 'selected' }], [{ status: 'unknown' }], [{ status: 'selected', private: 'PRIVATE' }]]) {
  test(`initial free malformed response ${JSON.stringify(data)} is uncertain, never success`, async () => {
    const h = actionHarness({ response: { data, error: null } });
    const result = await h.run();
    assert.equal(result.status, 'uncertain');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    assert.deepEqual(h.calls.revalidated, []);
  });
}

for (const code of ['42501', 'P0001', '23505', '22023', '28000', 'PGRST000', '504', undefined]) {
  test(`initial free RPC ${code || 'transport without code'} distinguishes rejection from uncertain commit`, async () => {
    const h = actionHarness({ response: { data: null, error: { code, message: 'PRIVATE SQL secret' } } });
    const result = await h.run();
    assert.equal(result.status, /^(22|23|28|42|P0)/.test(code ?? '') ? 'error' : 'uncertain');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SQL|secret/);
    assert.deepEqual(h.calls.revalidated, []);
  });
}

test('initial free thrown transport preserves uncertain outcome and safe retry message', async () => {
  const h = actionHarness({ transportError: new Error('PRIVATE transport secret') });
  const result = await h.run();
  assert.equal(result.status, 'uncertain');
  assert.match(result.message, /segura|não gera cobrança/i);
  assert.doesNotMatch(result.message, /PRIVATE|secret/);
  assert.deepEqual(h.calls.revalidated, []);
});

// SOURCE CONTRACT only: these checks protect route wiring, not browser/onboarding E2E.
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
test('SOURCE CONTRACT: onboarding completion still returns through home, not plan selection or checkout', () => {
  const completion = source('app/cadastro/concluir/CompletionForm.tsx');
  const onboarding = source('lib/auth/onboarding.ts');
  assert.match(completion, /completePublicOnboardingAction\(form\)/);
  assert.match(completion, /result\.status === "success"\)\s*\{\s*router\.replace\("\/home"\);\s*router\.refresh\(\)/);
  assert.match(onboarding, /export async function completePublicOnboardingAction/);
  assert.match(onboarding, /admin\.rpc\("complete_public_onboarding"/);
  assert.match(onboarding, /status: "success", createdNew: row\.data\[0\]\.created_new/);
  for (const content of [completion, onboarding]) {
    assert.doesNotMatch(content, /selectInitialFreePlan|select_initial_free_plan|requirePlanBusinessAccess|\/planos|\/meu-plano|checkout/);
  }
  assert.ok(fs.existsSync(path.join(root, 'app/(authenticated)/home/page.tsx')), 'Home remains in the operational layout');
});

test('SOURCE CONTRACT: operational layout redirects missing/selection-required authority to plans before shell', () => {
  const operational = source('app/(authenticated)/layout.tsx');
  assert.match(operational, /await getMyPlanAccess\(\)/);
  assert.match(operational, /if\s*\(!plan\s*\|\|\s*plan\.selection_required\)\s*redirect\("\/planos"\)/);
  assert.ok(operational.indexOf('redirect("/planos")') < operational.indexOf('<AuthenticatedShell'));
});

test('SOURCE CONTRACT: plans layout uses identity and presentation only, never the operational plan guard', () => {
  const layout = source('app/(plans)/layout.tsx');
  assert.match(layout, /await resolveMinimalIdentity\(\)/);
  assert.match(layout, /identity\.state !== "business_ready"\) redirect\("\/conta"\)/);
  assert.match(layout, /<AuthenticatedShell/);
  assert.match(layout, /\{children\}/);
  assert.doesNotMatch(layout, /requirePlanBusinessAccess|getMyPlanAccess|selection_required|from ["'][^"']*lib\/plans["']|redirect\(["']\/planos/);
});

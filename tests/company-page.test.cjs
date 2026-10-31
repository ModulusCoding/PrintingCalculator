/* eslint-disable @typescript-eslint/no-require-imports -- Isolated VM harness; no database or remote calls. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { Error, module: loadedModule, exports: loadedModule.exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unmocked import: ${name}`);
  } });
  return loadedModule.exports;
}

class AuthContextError extends Error {
  constructor(code, options = {}) {
    super('Private identity diagnostic');
    this.code = code;
    this.state = options.state;
  }
}
const denied = () => new AuthContextError('AUTH_PERMISSION_DENIED');
const company = { name: 'Original company', created_at: '2026-01-01', version: 7, electricity_rate_per_kwh: 0.987654, default_filament_loss_percent: 12.34 };
const config = { version: 8, electricity_rate_per_kwh: 1.25, default_filament_loss_percent: 4.5, enterprise_id: 'private-tenant' };
function harness({ authorize = async () => ({}), readCompany = async () => company, readConfig = async () => config, mutate = async () => ({ status: 'success' }) } = {}) {
  const calls = { permissions: [], company: 0, config: 0, forms: [], mutations: [], revalidated: [], diagnostics: [], rethrows: [] };
  const auth = { AuthContextError, requireBusinessContext: async permission => {
    calls.permissions.push(permission);
    return authorize(permission);
  } };
  const navigation = { unstable_rethrow: error => {
    calls.rethrows.push(error);
    if (error?.nextControlFlow) throw error;
  } };
  const diagnostics = { diagnoseCompany: (...args) => calls.diagnostics.push(args) };
  const page = load('app/(authenticated)/empresa/page.tsx', {
    '@/lib/auth/context': auth, 'next/navigation': navigation,
    '@/lib/enterprise/diagnostics': diagnostics,
    '@/lib/enterprise/management': { getCompany: async () => { calls.company++; return readCompany(); } },
    '@/lib/enterprise/config': { getConfig: async () => { calls.config++; return readConfig(); } },
    './CompanyForm': { CompanyForm: props => { calls.forms.push(props); return null; } },
  }).default;
  const mutation = kind => async (...args) => { calls.mutations.push([kind, ...args]); return mutate(kind, ...args); };
  const actions = load('lib/enterprise/actions.ts', {
    '@/lib/auth/context': auth, 'next/navigation': navigation, './diagnostics': diagnostics,
    'next/cache': { revalidatePath: path => calls.revalidated.push(path) },
    './management': { updateCompanyName: mutation('name'), updateCompanyRate: mutation('rate'), updateCompanyLoss: mutation('loss'), mutateMember: mutation('member') },
  });
  return { calls, actions, page: async () => renderToStaticMarkup(await page()) };
}
function noReadsOrForms(calls) {
  assert.equal(calls.company, 0);
  assert.equal(calls.config, 0);
  assert.equal(calls.forms.length, 0);
}

test('owner receives the unchanged company object and full management form', async () => {
  const h = harness();
  await h.page(); // Profile heading is rendered by the real client form, mocked here.
  assert.deepEqual(h.calls.permissions, ['enterprise.manage']);
  assert.equal(h.calls.company, 1);
  assert.equal(h.calls.config, 0);
  assert.equal(h.calls.forms.length, 1);
  assert.equal(h.calls.forms[0].company, company);
  assert.equal(h.calls.forms[0].canManageEnterprise, true);
  assert.equal(h.calls.diagnostics.length, 0);
});

test('only role denial opens the admin config-only loss branch, never the company read', async () => {
  const h = harness({ authorize: async permission => { if (permission === 'enterprise.manage') throw denied(); } });
  await h.page(); // Profile heading is rendered by the real client form, mocked here.
  assert.deepEqual(h.calls.permissions, ['enterprise.manage', 'enterprise.pricing_loss.write']);
  assert.equal(h.calls.company, 0);
  assert.equal(h.calls.config, 1);
  const props = h.calls.forms[0];
  assert.equal(props.canManageEnterprise, false);
  assert.deepEqual(JSON.parse(JSON.stringify(props.company)), {
    name: 'Empresa', created_at: '', version: config.version,
    electricity_rate_per_kwh: config.electricity_rate_per_kwh,
    default_filament_loss_percent: config.default_filament_loss_percent,
  });
  assert.ok(!Object.hasOwn(props.company, 'enterprise_id'));
});

test('operator denied by both permissions cannot read either source or render a form', async () => {
  const h = harness({ authorize: async () => { throw denied(); } });
  assert.match(await h.page(), /Acesso indisponível/);
  assert.deepEqual(h.calls.permissions, ['enterprise.manage', 'enterprise.pricing_loss.write']);
  noReadsOrForms(h.calls);
  assert.equal(h.calls.diagnostics[0][1], 'context');
});

for (const state of ['enterprise_inactive', 'membership_inactive', 'no_membership']) {
  test(`blocked identity ${state} stops before fallback and all reads`, async () => {
    const error = new AuthContextError('AUTH_ACCESS_BLOCKED', { state });
    const h = harness({ authorize: async () => { throw error; } });
    assert.match(await h.page(), /Acesso indisponível/);
    assert.deepEqual(h.calls.permissions, ['enterprise.manage']);
    noReadsOrForms(h.calls);
    assert.equal(h.calls.diagnostics[0][2], error);
  });
}

for (const error of [new AuthContextError('AUTH_TECHNICAL_FAILURE'), new AuthContextError('AUTH_CONTEXT_INVALID_RESPONSE'), new Error('private SDK details')]) {
  test(`technical identity ${error.code || 'unexpected'} is not role denial or fallback`, async () => {
    const h = harness({ authorize: async () => { throw error; } });
    const html = await h.page();
    assert.match(html, /Erro técnico/);
    assert.doesNotMatch(html, /private|Private|SDK/);
    assert.deepEqual(h.calls.permissions, ['enterprise.manage']);
    noReadsOrForms(h.calls);
  });
}

test('expired session stops reads without permission fallback', async () => {
  const h = harness({ authorize: async () => { throw new AuthContextError('AUTH_UNAUTHENTICATED'); } });
  assert.match(await h.page(), /Acesso indisponível/);
  assert.deepEqual(h.calls.permissions, ['enterprise.manage']);
  noReadsOrForms(h.calls);
});

for (const branch of ['owner', 'admin']) {
  test(`${branch} RPC failure renders a friendly technical alert, not raw diagnostics`, async () => {
    const error = new Error('private SQL row password=secret');
    const h = harness({
      authorize: async permission => { if (branch === 'admin' && permission === 'enterprise.manage') throw denied(); },
      readCompany: async () => { throw error; }, readConfig: async () => { throw error; },
    });
    const html = await h.page();
    assert.match(html, /role="alert"/);
    assert.match(html, /Erro técnico/);
    assert.match(html, /Tente novamente/);
    assert.match(html, /href="\/empresa"/);
    assert.match(html, /Tentar novamente/);
    assert.doesNotMatch(html, /private|SQL|password|secret/);
    assert.equal(h.calls.forms.length, 0);
    assert.equal(h.calls.company, branch === 'owner' ? 1 : 0);
    assert.equal(h.calls.config, branch === 'admin' ? 1 : 0);
    assert.equal(h.calls.diagnostics[0][1], 'rpc');
    assert.equal(h.calls.diagnostics[0][2], error);
  });
}

for (const branch of ['owner', 'admin']) {
  test(`${branch} read authorization denial is unavailable access, not a technical failure`, async () => {
    const h = harness({
      authorize: async permission => { if (branch === 'admin' && permission === 'enterprise.manage') throw denied(); },
      readCompany: async () => { throw new Error('permission_denied'); },
      readConfig: async () => { throw new Error('permission_denied'); },
    });
    const html = await h.page();
    assert.match(html, /Acesso indisponível/);
    assert.doesNotMatch(html, /Erro técnico/);
    assert.equal(h.calls.forms.length, 0);
  });
}

for (const stage of ['primary context', 'fallback context', 'company RPC', 'config RPC']) {
  test(`Next control flow at ${stage} is rethrown before diagnostic/UI handling`, async () => {
    const signal = { nextControlFlow: true, digest: 'NEXT_REDIRECT' };
    const h = harness({
      authorize: async permission => {
        if (stage === 'primary context') throw signal;
        if (stage === 'fallback context' || stage === 'config RPC') {
          if (permission === 'enterprise.manage') throw denied();
          if (stage === 'fallback context') throw signal;
        }
      },
      readCompany: async () => { throw signal; }, readConfig: async () => { throw signal; },
    });
    await assert.rejects(h.page(), error => error === signal);
    assert.equal(h.calls.forms.length, 0);
    assert.equal(h.calls.diagnostics.length, 0);
  });
}

const actionCases = [
  ['updateCompanyName', 'name', 'enterprise.manage'],
  ['updateCompanyRateAction', 'rate', 'enterprise.manage'],
  ['updateCompanyLossAction', 'loss', 'enterprise.pricing_loss.write'],
];
for (const [action, kind, permission] of actionCases) {
  for (const [code, status] of [
    ['AUTH_PERMISSION_DENIED', 'permission_denied'], ['AUTH_ACCESS_BLOCKED', 'permission_denied'],
    ['AUTH_UNAUTHENTICATED', 'session_expired'], ['AUTH_TECHNICAL_FAILURE', 'technical'],
    ['AUTH_CONTEXT_INVALID_RESPONSE', 'technical'], [null, 'technical'],
  ]) {
    test(`${action}: ${code || 'unexpected error'} maps to ${status} without mutation`, async () => {
      const error = code ? new AuthContextError(code) : new Error('private details');
      const h = harness({ authorize: async () => { throw error; } });
      const result = await h.actions[action](null, new FormData());
      assert.equal(result.status, status);
      assert.deepEqual(h.calls.permissions, [permission]);
      assert.equal(h.calls.mutations.length, 0);
      assert.deepEqual(h.calls.revalidated, []);
      assert.equal(h.calls.diagnostics[0][2], error);
      assert.doesNotMatch(JSON.stringify(result), /private|Private/);
    });
  }
  for (const status of ['success', 'conflict', 'invalid_input', 'unknown']) {
    test(`${action}: forwards original inputs/result (${status}) and preserves revalidation contract`, async () => {
      const result = { status, version: 9, name: 'Updated', electricity_rate_per_kwh: 0.5, default_filament_loss_percent: 2 };
      const previous = { status: 'idle' };
      const form = new FormData();
      form.set('version', '7');
      const h = harness({ mutate: async () => result });
      assert.equal(await h.actions[action](previous, form), result);
      assert.deepEqual(h.calls.permissions, [permission]);
      assert.equal(h.calls.mutations.length, 1);
      assert.equal(h.calls.mutations[0][0], kind);
      assert.equal(h.calls.mutations[0][1], previous);
      assert.equal(h.calls.mutations[0][2], form);
      assert.deepEqual(h.calls.revalidated, kind === 'loss' && status === 'success' ? ['/empresa'] : []);
      assert.equal(h.calls.diagnostics.length, 0);
    });
  }
  test(`${action}: Next context control flow is never mapped into an action error`, async () => {
    const signal = { nextControlFlow: true, digest: 'NEXT_REDIRECT' };
    const h = harness({ authorize: async () => { throw signal; } });
    await assert.rejects(h.actions[action](null, new FormData()), error => error === signal);
    assert.equal(h.calls.mutations.length, 0);
    assert.equal(h.calls.diagnostics.length, 0);
    assert.deepEqual(h.calls.revalidated, []);
  });
}

test('actual company diagnostics logs only safe diagnostic fields, never raw payloads', () => {
  const { z } = require('zod');
  const safe = load('lib/diagnostics/safe-error.ts', { zod: { z } });
  const logs = [];
  const { diagnoseCompany } = load('lib/enterprise/diagnostics.ts', {
    'server-only': {}, '@/lib/diagnostics/safe-error': safe,
    '@/lib/general-materials/logger': { createLogger: (...scope) => ({ error: value => logs.push({ scope, value }) }) },
  });
  const error = {
    code: '42501', message: "Denied 'Private Company' person@example.com Bearer eyJabc.def.ghi https://private.example/path password=hunter2",
    details: 'Failing row contains (private row data)', hint: 'tenant 11111111-1111-4111-8111-111111111111',
    rows: [{ name: 'RAW_ROW' }], token: 'RAW_TOKEN', form: { name: 'RAW_FORM' },
  };
  diagnoseCompany('CompanyPage', 'rpc', error);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].scope, ['enterprise', 'CompanyPage']);
  assert.deepEqual(Object.keys(logs[0].value).sort(), ['code', 'stage', 'technical_detail']);
  assert.equal(logs[0].value.code, '42501');
  assert.equal(logs[0].value.stage, 'rpc');
  assert.doesNotMatch(JSON.stringify(logs), /Private Company|person@example|eyJabc|private\.example|hunter2|private row data|11111111|RAW_ROW|RAW_TOKEN|RAW_FORM/);
  assert.match(logs[0].value.technical_detail, /\[email\]/);
});

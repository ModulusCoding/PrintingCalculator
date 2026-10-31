/* eslint-disable @typescript-eslint/no-require-imports -- Local VM and explicitly labelled source-contract regressions; no PostgreSQL or network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function load(file, imports) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, FormData, console, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unmocked import ${name} in ${file}`);
    return imports[name];
  } }, { filename: file });
  return loadedModule.exports;
}
const capabilities = load('lib/plans/permission-capabilities.ts', {});
const auth = load('lib/auth/context.ts', {
  'server-only': {}, zod: require('zod'), '@/lib/supabase/server': {},
  '@/lib/diagnostics/load-trace': {}, '@/lib/plans/permission-capabilities': capabilities,
});
const row = { electricity_rate_per_kwh: 0.85, default_filament_loss_percent: 5, version: 7 };
const plain = value => JSON.parse(JSON.stringify(value));
function harness(file, { denied = false, planDenied = false, contextDenied = false } = {}) {
  const events = [];
  const imports = {
    'server-only': {}, zod: require('zod'),
    'next/navigation': { unstable_rethrow() {} },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (...args) => {
      events.push(['rpc', ...args]);
      if (denied) return { data: null, error: { code: '42501' } };
      return { data: [args[0] === 'get_my_enterprise' ? { name: 'Company', created_at: '2026-10-01T00:00:00Z', version: 9 } : row], error: null };
    } }) },
    '@/lib/auth/context': { requireBusinessContext: async permission => {
      events.push(['permission', permission]);
      if (contextDenied) throw new Error('blocked context');
      return { enterpriseId: 'selected-company', role: 'owner' };
    } },
    '@/lib/plans': { requirePlanBusinessAccess: async options => {
      events.push(['plan', options]);
      if (planDenied) throw new Error('blocked plan');
    } },
    '@/lib/general-materials/logger': { createLogger: () => ({ error() {}, id: 'test-id' }) },
    '@/lib/diagnostics/action-handler': { logPricingFailure: () => 'test-id', pricingContextFailure: () => ({ ok: false, code: 'forbidden' }) },
    '@/lib/diagnostics/safe-error': { safeErrorDiagnostic: () => ({}) },
  };
  // Real management parser/diagnostics are loaded; only their logging sink is mocked.
  if (file === 'lib/enterprise/management.ts') {
    imports['@/lib/enterprise/diagnostics'] = load('lib/enterprise/diagnostics.ts', imports);
  }
  return { actions: load(file, imports), events };
}

test('reference read matrix uses actual ROLE_PERMISSIONS and permissionRequiresVisionario (not PostgreSQL execution)', () => {
  // This models only ordinary active/business-ready tenants with unblocked plans.
  // SQL helper identity, membership, selection and team-limit checks are NOT simulated.
  const allowed = (role, plan, permission) => auth.ROLE_PERMISSIONS[role].includes(permission)
    && (!capabilities.permissionRequiresVisionario(permission) || plan === 'visionario');
  for (const [role, plan, expected] of [
    ['owner', 'aprendiz', true], ['owner', 'visionario', true],
    ['admin', 'aprendiz', false], ['admin', 'visionario', true],
    ['operator', 'aprendiz', false], ['operator', 'visionario', true],
  ]) {
    assert.equal(allowed(role, plan, 'printers.read') || allowed(role, plan, 'enterprise.manage'), expected, `${role}/${plan}`);
    assert.equal(allowed(role, plan, 'pricing.read'), true, 'historical pricing remains a separate free permission');
    assert.equal(allowed(role, plan, 'enterprise.manage'), role === 'owner');
    assert.equal(allowed(role, plan, 'enterprise.pricing_loss.write'), role !== 'operator');
  }
});

test('actual config and management readers use selected-session RPCs with no identity arguments', async () => {
  const config = harness('lib/enterprise/config.ts');
  assert.deepEqual(plain(await config.actions.getConfig()), row);
  assert.deepEqual(config.events, [['rpc', 'get_my_enterprise_config']]);
  const company = harness('lib/enterprise/management.ts');
  assert.equal((await company.actions.getCompany()).name, 'Company');
  assert.deepEqual(company.events, [['rpc', 'get_my_enterprise_config'], ['rpc', 'get_my_enterprise']]);
});

test('actual direct readers do not turn SQL permission denial into data', async () => {
  for (const [file, action] of [['lib/enterprise/config.ts', 'getConfig'], ['lib/enterprise/management.ts', 'getCompany']]) {
    const h = harness(file, { denied: true });
    await assert.rejects(h.actions[action](), /permission_denied/);
    assert.deepEqual(h.events, [['rpc', 'get_my_enterprise_config']]);
  }
});

test('actual pricing config consumer preserves paid/printers.read gates before RPC, never enterprise.manage', async () => {
  const h = harness('lib/pricing/actions.ts');
  assert.deepEqual(plain(await h.actions.fetchElectricityConfigAction()), { ok: true, data: { rate: 0.85, defaultLoss: 5, version: 7 } });
  assert.deepEqual(plain(h.events), [['plan', { paid: true }], ['permission', 'printers.read'], ['rpc', 'get_my_enterprise_config']]);
  for (const options of [{ planDenied: true }, { contextDenied: true }, { denied: true }]) {
    const blocked = harness('lib/pricing/actions.ts', options);
    assert.equal((await blocked.actions.fetchElectricityConfigAction()).ok, false);
    if (!options.denied) assert.equal(blocked.events.some(e => e[0] === 'rpc'), false);
  }
});

test('actual config writer ignores supplied identity and preserves permission_denied', async () => {
  const h = harness('lib/enterprise/config.ts', { denied: true });
  const form = new FormData();
  for (const [key, value] of Object.entries({ electricity_rate_per_kwh: '0.85', version: '7', enterprise_id: 'foreign', user_id: 'foreign' })) form.set(key, value);
  assert.equal((await h.actions.updateConfig(null, form)).status, 'permission_denied');
  assert.deepEqual(plain(h.events), [['rpc', 'update_my_enterprise_config', { p_rate: 0.85, p_expected_version: 7 }]]);
});

test('SOURCE CONTRACT: integrated persistence retains paid/owner/pricing.write gates and selected-tenant config RPC', () => {
  const sql = source('lib/pricing/persistence-actions.ts');
  const start = sql.indexOf('export async function saveFdmPricingAction');
  const read = sql.indexOf('client.rpc("get_my_enterprise_config")', start);
  assert.ok(read > start);
  const before = sql.slice(start, read);
  assert.match(before, /await requirePlanBusinessAccess\(\{ paid: true \}\)/);
  assert.match(before, /await requireBusinessContext\("pricing.write"\)/);
  assert.match(before, /ctx\.role !== "owner"/);
  assert.match(before, /await requireBusinessContext\("products.read"\)/);
  assert.equal((before.match(/\.eq\("enterprise_id", ctx.enterpriseId\)/g) || []).length, 5);
  assert.doesNotMatch(before, /requireBusinessContext\("enterprise.manage"\)/);
  // Historical reads must not acquire paid printer permission merely because this RPC has another read path.
  const historyStart = sql.indexOf('export async function listPricingHistoryAction');
  assert.ok(historyStart > 0);
  const history = sql.slice(historyStart, sql.indexOf('\nexport async function', historyStart + 1));
  assert.match(history, /requireBusinessContext\("pricing.read"\)/);
  assert.doesNotMatch(history, /paid: true|requireBusinessContext\("(?:enterprise.manage|printers.read)"\)/);
});

test('SOURCE CONTRACT: indirect printers page stays paid; integrated pricing gates printers.read before config', () => {
  const printers = source('app/(authenticated)/impressoras/page.tsx');
  assert.match(printers, /renderPaidModule\("printers", "printers.read",/);
  const pricing = source('app/(authenticated)/precificadora/page.tsx');
  assert.match(pricing, /requirePlanBusinessAccess\(\)/);
  assert.match(pricing, /requireBusinessContext\("printers.read"\)/);
  assert.ok(pricing.indexOf('requireBusinessContext("printers.read")') < pricing.indexOf('fetchElectricityConfigAction()'));
  const company = source('app/(authenticated)/empresa/page.tsx');
  assert.match(company, /requireBusinessContext\("enterprise.manage"\)/);
  assert.match(company, /requireBusinessContext\("enterprise.pricing_loss.write"\)/);
  assert.match(company, /error.code !== "AUTH_PERMISSION_DENIED"/);
  assert.match(company, /const config = await getConfig\(\)/);
});

test('SOURCE CONTRACT ONLY: SQL reader fails closed and scopes to context, with separate writer permissions', () => {
  const sql = source('supabase/migrations/20261029100000_enterprise_config_company_read.sql');
  assert.match(sql, /FROM public.get_my_access_context\(\) AS ctx/);
  assert.match(sql, /IF NOT FOUND THEN/);
  assert.match(sql, /v_context.state IS DISTINCT FROM 'business_ready'/);
  assert.match(sql, /'printers.read'\s*\) IS DISTINCT FROM TRUE\s*AND private.can_access_enterprise\(\s*v_context.enterprise_id,\s*'enterprise.manage'\s*\) IS DISTINCT FROM TRUE/);
  assert.match(sql, /WHERE e.id = v_context.enterprise_id\s+AND e.status = 'active'/);
  // Static checks are not evidence of blocked identities or cross-tenant isolation in PostgreSQL.
  const context = source('lib/auth/context.ts');
  assert.match(context, /context.state !== "business_ready"/);
  assert.match(context, /AUTH_ACCESS_BLOCKED/);
  const helpers = source('supabase/migrations/20261026150000_pricing_actor_authorization.sql');
  assert.match(helpers, /can_access_enterprise_for_user\(private.current_internal_user_id\(\),p_enterprise_id,p_permission\)/);
  assert.match(helpers, /count\(\*\)=1 FROM public.enterprise_members/);
  assert.match(helpers, /em.enterprise_id=p_enterprise_id AND em.user_id=p_user_id/);
  assert.match(helpers, /em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active'/);
  assert.match(helpers, /private.plan_permission_allowed\(p_enterprise_id,em.role,p_permission\)/);
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql'));
  const definitions = migrations.map(f => source(`supabase/migrations/${f}`)).join('\n');
  for (const [rpc, permission] of [['update_my_enterprise_config', 'enterprise.manage'], ['update_my_enterprise_name', 'enterprise.manage'], ['update_my_pricing_loss', 'enterprise.pricing_loss.write']]) {
    const matches = [...definitions.matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${rpc}\\([\\s\\S]*?\\$\\$;`, 'gi'))];
    assert.ok(matches.length, rpc);
    assert.ok(matches.at(-1)[0].includes(`'${permission}'`), `${rpc} final definition requires ${permission}`);
  }
});

/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness; no database or remote calls. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { z } = require('zod');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const loadedModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (['react/jsx-runtime', 'react'].includes(name)) return require(name);
    throw new Error(`Unmocked import: ${name}`);
  } });
  return loadedModule.exports;
}
const operation = load('lib/orders/operation-schema.ts', { zod: { z } });
const schemas = load('lib/dashboard/schema.ts', { zod: { z }, '@/lib/orders/operation-schema': operation });
const format = load('lib/dashboard/format.ts');
const eid = '11111111-1111-4111-8111-111111111111';
function emptyDashboard() {
  return {
    enterprise_id: eid, as_of: '2026-10-28T12:00:00Z', current_month: '2026-10',
    sales_cents: '0', receipts_cents: '0', pending_cents: '0', month_orders_count: 0, active_orders_count: 0,
    months: ['05', '06', '07', '08', '09', '10'].map(month => ({ month: `2026-${month}`, sales_cents: '0', receipts_cents: '0', orders_count: 0 })),
    recent_orders: [],
  };
}

test('schemas accept a genuine empty read and exact huge/negative money strings', () => {
  assert.equal(schemas.dashboardSchema.safeParse(emptyDashboard()).success, true);
  const data = emptyDashboard();
  data.sales_cents = data.months[5].sales_cents = '900719925474099312345';
  data.receipts_cents = data.months[5].receipts_cents = '-12345';
  assert.equal(schemas.dashboardSchema.parse(data).sales_cents, '900719925474099312345');
  assert.equal(schemas.inventorySchema.safeParse({ enterprise_id: eid, available_units: '9007199254740993', reserved_units: '0', stocked_products: 0 }).success, true);
  assert.equal(schemas.spoolsSchema.safeParse({ enterprise_id: eid, low_count: 0, empty_count: 0, threshold_percent: 20 }).success, true);
});

test('schemas reject absent, malformed, unsafe and inconsistent payloads instead of fabricating zero', () => {
  for (const input of [null, undefined, {}, [], { ...emptyDashboard(), extra: true }]) assert.equal(schemas.dashboardSchema.safeParse(input).success, false);
  // Invalid strings must not parse; the BigInt refinement may itself throw.
  for (const value of ['01', '-0', '+1', '1.00', '1e3', '', 'NaN', 100, null]) assert.throws(() => schemas.centsSchema.parse(value), undefined, String(value));
  for (const patch of [
    { sales_cents: '-1' }, { pending_cents: '-1' }, { active_orders_count: -1 },
    { month_orders_count: Number.MAX_SAFE_INTEGER + 1 }, { active_orders_count: 0.5 },
    { enterprise_id: 'other-tenant' }, { as_of: 'yesterday' }, { receipts_cents: '1' },
    { months: [] }, { recent_orders: [{ id: eid }] },
  ]) assert.throws(() => schemas.dashboardSchema.parse({ ...emptyDashboard(), ...patch }), undefined, JSON.stringify(patch));
  const duplicate = emptyDashboard();
  duplicate.months[0].month = duplicate.months[1].month;
  assert.equal(schemas.dashboardSchema.safeParse(duplicate).success, false);
  const recent = { id: eid, display_number: '9007199254740993', buyer_name: 'Cliente', operational_status: 'pago', total_cents: '100', created_at: '2026-10-01T00:00:00-03:00' };
  assert.equal(schemas.dashboardSchema.safeParse({ ...emptyDashboard(), recent_orders: [recent] }).success, true);
  for (const rows of [Array(6).fill(recent), [{ ...recent, operational_status: 'unknown' }], [{ ...recent, total_cents: '-1' }]]) assert.equal(schemas.dashboardSchema.safeParse({ ...emptyDashboard(), recent_orders: rows }).success, false);
  assert.equal(schemas.inventorySchema.safeParse({ enterprise_id: eid, available_units: '-1', reserved_units: '0', stocked_products: 0 }).success, false);
  for (const threshold_percent of [-1, 101, null]) assert.equal(schemas.spoolsSchema.safeParse({ enterprise_id: eid, low_count: 0, empty_count: 0, threshold_percent }).success, false);
});

test('formatting keeps BigInt cents precise, rounds the average and uses São Paulo dates', () => {
  assert.equal(format.formatCents('900719925474099312345'), 'R$ 9.007.199.254.740.993.123,45');
  assert.equal(format.formatCents('-1'), '−R$ 0,01');
  assert.equal(format.formatCents('0'), 'R$ 0,00');
  assert.equal(format.averageCents('900719925474099312345', 3), '300239975158033104115');
  assert.equal(format.averageCents('101', 2), '51');
  assert.equal(format.averageCents('0', 0), null);
  assert.equal(format.dateLabel('2026-11-01T02:59:59Z'), '31/10/2026');
  assert.equal(format.dateLabel('2026-11-01T03:00:00Z'), '01/11/2026');
  assert.match(format.monthLabel('2026-01', true), /janeiro.*2026/);
});

// Independent business-reference arithmetic ONLY. These fixtures do not execute or
// establish correctness of PostgreSQL; SQL contracts below are inspected as text.
function referenceTotals(orders, payments, tenant, month, anchor = '2026-12-01T03:00:00Z') {
  const monthOf = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date(value));
  const own = orders.filter(o => o.tenant === tenant);
  const ledger = payments.filter(p => p.tenant === tenant);
  const net = list => list.reduce((sum, p) => sum + (p.kind === 'receipt' ? p.cents : -p.cents), 0n);
  const sales = own.filter(o => o.status !== 'cancelado' && monthOf(o.created) === month);
  return {
    sales: sales.reduce((sum, o) => sum + o.total, 0n), count: sales.length,
    receipts: net(ledger.filter(p => monthOf(p.effective) === month && Date.parse(p.effective) <= Date.parse(anchor))),
    pending: own.filter(o => o.status !== 'cancelado').reduce((sum, o) => sum + o.total - net(ledger.filter(p => p.order === o.id)), 0n),
    active: own.filter(o => !['entregue', 'cancelado'].includes(o.status)).length,
  };
}
test('financial reference: sales, effective receipts/refunds, lifetime pending, cancellation and tenant isolation differ', () => {
  const orders = [
    { id: 'old', tenant: eid, status: 'entregue', created: '2026-09-01T12:00:00Z', total: 10000n },
    { id: 'paid-status-only', tenant: eid, status: 'pago', created: '2026-10-01T03:00:00Z', total: 20000n },
    { id: 'cancel', tenant: eid, status: 'cancelado', created: '2026-10-02T12:00:00Z', total: 9000n },
    { id: 'boundary', tenant: eid, status: 'orcado', created: '2026-11-01T02:59:59Z', total: 3000n },
    { id: 'other', tenant: 'other', status: 'orcado', created: '2026-10-02T12:00:00Z', total: 999999n },
  ];
  const payments = [
    { order: 'old', tenant: eid, kind: 'receipt', cents: 4000n, effective: '2026-10-03T12:00:00Z' },
    { order: 'old', tenant: eid, kind: 'refund', cents: 1000n, effective: '2026-11-01T03:00:00Z' },
    { order: 'cancel', tenant: eid, kind: 'receipt', cents: 9000n, effective: '2026-09-02T12:00:00Z' },
    { order: 'cancel', tenant: eid, kind: 'refund', cents: 9000n, effective: '2026-10-03T12:00:00Z' },
    { order: 'other', tenant: 'other', kind: 'receipt', cents: 999999n, effective: '2026-10-03T12:00:00Z' },
  ];
  assert.deepEqual(referenceTotals(orders, payments, eid, '2026-10'), { sales: 23000n, count: 2, receipts: -5000n, pending: 30000n, active: 2 });
  assert.equal(referenceTotals(orders, payments, eid, '2026-11').receipts, -1000n);
  assert.deepEqual(referenceTotals([], [], eid, '2026-10'), { sales: 0n, count: 0, receipts: 0n, pending: 0n, active: 0 });
});

test('reference effective-time cutoff includes anchor, excludes future receipt/refund and preserves complete-ledger pending', () => {
  const anchor = '2026-10-28T15:00:00Z';
  const orders = [{ id: 'one', tenant: eid, status: 'orcado', created: '2026-10-01T03:00:00Z', total: 10000n }];
  const payments = [
    { order: 'one', tenant: eid, kind: 'receipt', cents: 1000n, effective: '2026-10-28T14:59:59.999Z' },
    { order: 'one', tenant: eid, kind: 'receipt', cents: 2000n, effective: anchor },
    { order: 'one', tenant: eid, kind: 'receipt', cents: 4000n, effective: '2026-10-28T15:00:00.001Z' },
    { order: 'one', tenant: eid, kind: 'refund', cents: 1000n, effective: '2026-10-29T15:00:00Z' },
  ];
  assert.equal(referenceTotals(orders, payments, eid, '2026-10', anchor).receipts, 3000n);
  assert.equal(referenceTotals(orders, payments, eid, '2026-10', anchor).pending, 4000n);
  assert.equal(referenceTotals(orders, payments, eid, '2026-10', '2026-10-29T15:00:00Z').receipts, 6000n);
  assert.equal(referenceTotals(orders, [{ ...payments[0], effective: '2026-11-01T03:00:00Z' }], eid, '2026-11', '2026-11-01T02:59:59.999Z').receipts, 0n);
});

const originalSql = fs.readFileSync('supabase/migrations/20261028140000_home_dashboard_reads.sql', 'utf8');
const correctionSql = fs.readFileSync('supabase/migrations/20261028150000_home_dashboard_coalesce_fix.sql', 'utf8');
// Text-only checks: never send migrations to a database. Normalize formatting and
// ordinary pg_catalog functions, but check COALESCE on the untouched correction.
function normalizeSql(source) {
  return source.replace(/--[^\r\n]*/g, '').replace(/\bpg_catalog\./gi, '')
    .replace(/\bcoalesce\b/gi, 'coalesce')
    .replace(/\bAS\s+([a-z])\b/g, '$1').replace(/\s+/g, ' ')
    .replace(/\s*([,=<>])\s*/g, '$1')
    .replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')').trim();
}
const sql = normalizeSql(correctionSql);
const inventoryStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_home_inventory()');
assert.ok(inventoryStart > 0, 'inventory function must be present');
const dashboardSql = sql.slice(0, inventoryStart);
const inventorySql = sql.slice(inventoryStart);

test('SQL regression: corrective migration uses unqualified COALESCE and preserves the original contracts', () => {
  assert.doesNotMatch(correctionSql, /\bpg_catalog\s*\.\s*coalesce\s*\(/i);
  assert.match(correctionSql, /\bcoalesce\s*\(/i);
  assert.equal(normalizeSql(originalSql), sql, 'correction must only fix qualification/formatting, not business logic');
  assert.doesNotMatch(sql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
});
test('SQL static contract: no caller tenant, authenticated definer functions, existing authorization and no billing source', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_home_dashboard\(\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_home_inventory\(\)/);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path=''/g) || []).length, 2);
  assert.match(dashboardSql, /eid :=private\.orders_c4_reader\(\)/);
  for (const contract of [/pg_advisory_xact_lock/, /get_my_access_context\(\)/, /c\.state IS DISTINCT FROM 'business_ready'/, /c\.enterprise_id IS NULL/, /c\.user_id IS NULL/, /c\.role IS NULL/, /current_internal_user_id\(\) IS DISTINCT FROM c\.user_id/, /can_access_enterprise\(c\.enterprise_id,'inventory.read'\)/, /ERRCODE='42501'/]) assert.match(inventorySql, contract);
  assert.match(inventorySql, /private\.can_access_enterprise\(c\.enterprise_id,'inventory.read'\) IS DISTINCT FROM TRUE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[^;]+FROM PUBLIC,anon,authenticated,service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[^;]+TO authenticated;/);
  assert.equal((sql.match(/OWNER TO postgres/g) || []).length, 2);
  assert.doesNotMatch(sql, /\b(?:asaas|subscriptions|billing_payments|subscription_payments)\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i);
  assert.match(dashboardSql, /FROM public\.orders o WHERE o\.enterprise_id=eid/g);
  assert.match(dashboardSql, /FROM public\.order_payments p WHERE p\.enterprise_id=eid/);
  assert.match(inventorySql, /FROM public\.product_inventory i WHERE i\.enterprise_id=eid/);
});

test('SQL static contract: six local months, effective ledger, shared balance helper and lossless cents', () => {
  assert.match(dashboardSql, /statement_timestamp\(\)/);
  assert.match(dashboardSql, /p\.effective_at<=anchor/);
  assert.match(dashboardSql, /'as_of',anchor/);
  assert.match(dashboardSql, /generate_series\(-5,0\)/);
  assert.match(dashboardSql, /date_trunc\('month',o\.created_at AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.match(dashboardSql, /date_trunc\('month',p\.effective_at AT TIME ZONE 'America\/Sao_Paulo'\)/);
  for (const column of ['o.created_at', 'p.effective_at']) {
    assert.ok(dashboardSql.includes(`${column}>=((first_month - INTERVAL '5 months') AT TIME ZONE 'America/Sao_Paulo')`));
    assert.ok(dashboardSql.includes(`${column}<((first_month + INTERVAL '1 month') AT TIME ZONE 'America/Sao_Paulo')`));
  }
  assert.match(dashboardSql, /CASE WHEN p\.entry_type='receipt' THEN p\.amount ELSE -p\.amount END/);
  assert.doesNotMatch(dashboardSql, /p\.recorded_at|operational_status\s*=\s*'pago'/);
  const pending = dashboardSql.slice(dashboardSql.indexOf('SELECT coalesce(sum(f.pending_amount)'), dashboardSql.indexOf('WITH periods'));
  assert.match(pending, /FILTER\(WHERE o\.operational_status<>'cancelado'\)/);
  assert.match(pending, /CROSS JOIN LATERAL private\.orders_c4_financial\(eid,o\.id\) f/);
  assert.match(pending, /WHERE o\.enterprise_id=eid/);
  assert.doesNotMatch(pending, /created_at|effective_at|first_month/);
  assert.match(dashboardSql, /operational_status NOT IN\('entregue','cancelado'\)/);
  assert.match(dashboardSql, /LEFT JOIN sales s USING\(month\) LEFT JOIN receipts r USING\(month\)/);
  assert.match(dashboardSql, /ORDER BY o\.created_at DESC,o\.id DESC LIMIT 5/);
  assert.match(dashboardSql, /numeric\(100,0\)::text/);
  assert.match(inventorySql, /sum\(i\.balance::numeric\s*-\s*i\.reserved_balance::numeric\)/);
  assert.match(inventorySql, /sum\(i\.reserved_balance::numeric\)/);
  assert.doesNotMatch(inventorySql, /JOIN public\.products|deleted_at IS NULL|archived_at IS NULL/);
});

test('C4 source contract: singleton-or-exception, no silent empty ledger, cancellation only filters aggregate', () => {
  const source = fs.readFileSync('supabase/migrations/20261026184000_orders_stage72c4_payments.sql', 'utf8');
  const helper = source.slice(source.indexOf('CREATE FUNCTION private.orders_c4_financial('), source.indexOf('DO $data_preflight$'));
  assert.match(helper, /GROUP BY o\.id,o\.version,o\.operational_status,o\.total_amount/);
  assert.match(helper, /IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable'/);
  assert.match(helper, /RAISE EXCEPTION 'payment_balance_inconsistent'/);
  assert.equal((helper.match(/RETURN QUERY SELECT/g) || []).length, 1);
  assert.doesNotMatch(helper, /RETURN NEXT|RETURN QUERY SELECT[^;]+\bFROM\b|RETURN;/);
  const pending = dashboardSql.slice(dashboardSql.indexOf('SELECT coalesce(sum(f.pending_amount)'), dashboardSql.indexOf('WITH periods'));
  assert.match(pending, /FILTER\(WHERE o\.operational_status<>'cancelado'\)/);
  assert.match(pending, /WHERE o\.enterprise_id=eid;/);
  // Cancellation is not pushed into the input WHERE, so every ledger is evaluated.
  assert.doesNotMatch(pending, /WHERE o\.enterprise_id=eid\s+AND/);
  assert.match(inventorySql, /'stocked_products',count\(\*\) FILTER\(WHERE i\.balance>0\)/);
});

test('SQL source dependencies: shared lock order, plan permissions and existing order indexes', () => {
  const c4 = fs.readFileSync('supabase/migrations/20261026184000_orders_stage72c4_payments.sql', 'utf8');
  const reader = c4.slice(c4.indexOf('CREATE FUNCTION private.orders_c4_reader()'), c4.indexOf('CREATE FUNCTION public.get_order_financial_summary'));
  const globalKey = "hashtextextended('modulus:enterprise-management:all-members',0)";
  assert.ok(reader.includes(globalKey));
  assert.ok(inventorySql.includes(globalKey));
  assert.ok(reader.indexOf('pg_advisory_xact_lock') < reader.indexOf('get_my_access_context()'));
  assert.ok(inventorySql.indexOf('pg_advisory_xact_lock') < inventorySql.indexOf('get_my_access_context()'));
  assert.match(reader, /can_access_enterprise\(c\.enterprise_id,'sales.read'\)/);
  const authorization = fs.readFileSync('supabase/migrations/20261026150000_pricing_actor_authorization.sql', 'utf8');
  assert.match(authorization, /private\.plan_permission_allowed/);
  const plans = fs.readFileSync('supabase/migrations/20261026060000_plan_business_regularization.sql', 'utf8');
  assert.match(plans, /IF r\.effective_plan='free' THEN/);
  assert.match(plans, /'sales.read','sales.write','sales.delete'/);
  assert.match(plans, /r\.effective_plan<>'intermediate' OR r\.access_state<>'paid'/);
  assert.match(plans, /RETURN operators<=1/);
  const structure = fs.readFileSync('supabase/migrations/20261026160000_orders_stage72a_schema.sql', 'utf8');
  assert.match(structure, /orders_enterprise_status_created_idx/);
  assert.match(structure, /orders_enterprise_created_idx/);
  assert.doesNotMatch(sql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
});

const { SalesChart } = load('components/dashboard/SalesChart.tsx', { '@/lib/dashboard/format': format });
const Icon = () => null;
const icons = Object.fromEntries(['ArrowDownLeft', 'ArrowRight', 'Banknote', 'Calculator', 'CircleDollarSign', 'ClipboardList', 'Package', 'ScrollText', 'ShoppingBag'].map(name => [name, Icon]));
const { HomeDashboard } = load('components/dashboard/HomeDashboard.tsx', {
  '@/lib/dashboard/format': format, './SalesChart': { SalesChart }, 'lucide-react': icons,
  '@/components/plans/PaidModuleNotice': { PaidModuleNotice: ({ module }) => React.createElement('p', null, `paid-module-notice:${module}`) },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
});
function render(finance, stock = { status: 'free' }) {
  return renderToStaticMarkup(React.createElement(HomeDashboard, { finance, stock }));
}
test('dashboard distinguishes empty, error and free/unauthorized stock without fake zero reads', () => {
  const empty = render({ status: 'ready', data: emptyDashboard() });
  assert.match(empty, /Ainda não há pedidos/);
  assert.match(empty, /Sem pedidos no mês/);
  assert.match(empty, /Sem vendas ou movimentação financeira/);
  assert.match(empty, /paid-module-notice:inventory/);
  assert.doesNotMatch(empty, /href="\/estoque\//);
  const error = render({ status: 'error', message: 'Falha financeira' }, { status: 'unavailable' });
  assert.match(error, /role="alert"/);
  assert.match(error, /Falha financeira/);
  assert.match(error, /Nenhum valor foi substituído por zero/);
  assert.doesNotMatch(error, /R\$ 0,00|Ainda não há pedidos/);
  assert.match(error, /Não foi possível autorizar a leitura do estoque/);
});

test('dashboard preserves independent paid read failures and chart exposes negative refunds and exact values', () => {
  const html = render({ status: 'ready', data: emptyDashboard() }, { status: 'paid', inventory: { status: 'error', message: 'Inventário indisponível' }, spools: { status: 'ready', data: { enterprise_id: eid, low_count: 3, empty_count: 2, threshold_percent: 15 } } });
  assert.match(html, /Inventário indisponível/);
  assert.match(html, /Limite configurado: 15%/);
  assert.match(html, /href="\/estoque\/produtos"/);
  const months = emptyDashboard().months;
  months[5].receipts_cents = '-9007199254740993';
  const chart = renderToStaticMarkup(React.createElement(SalesChart, { months }));
  assert.match(chart, /Líquido negativo/);
  assert.match(chart, /−R\$ 90\.071\.992\.547\.409,93/);
  assert.match(chart, /Consultar valores mensais/);
  assert.doesNotMatch(chart, /NaN|Infinity/);
});

function readerHarness({ responses = {}, gate = async () => ({ enterpriseId: eid }) } = {}) {
  const events = [];
  const logs = [];
  const defaults = {
    get_home_dashboard: emptyDashboard(),
    get_home_inventory: { enterprise_id: eid, available_units: '0', reserved_units: '0', stocked_products: 0 },
    count_filament_spools: '0',
    get_my_spool_config: [{ low_spool_threshold_percent: '20', version: '1' }],
  };
  const api = load('lib/dashboard/reader.ts', {
    '@/lib/general-materials/logger': { createLogger: (scope, operation) => ({ error: payload => { logs.push({ scope, operation, ...payload }); return 'test-ref'; } }) },
    '@/lib/diagnostics/safe-error': load('lib/diagnostics/safe-error.ts', { zod: { z } }),
    'server-only': {}, 'next/navigation': { unstable_rethrow() {} }, zod: { z }, './schema': schemas,
    '@/lib/auth/context': { requireBusinessContext: async permission => {
      events.push(`gate:${permission}`);
      const context = await gate(permission);
      events.push(`allowed:${permission}`);
      return context;
    } },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (name, args) => {
      events.push(`rpc:${name}`);
      assert.deepEqual(Object.keys(args), name === 'count_filament_spools' ? ['p_search', 'p_status'] : []);
      const data = Object.hasOwn(responses, name) ? responses[name] : defaults[name];
      if (data instanceof Error) throw data;
      if (data && data.rpcError) return { data: null, error: data.rpcError === true ? { code: 'FAIL' } : data.rpcError };
      return { data, error: null };
    } }) },
  });
  return { events, logs, run: plan => api.loadHomeDashboard(plan) };
}
test('SQL-shaped JSON fixture accepts native timestamptz offsets/microseconds and textual cents', async () => {
  // Manually derived from jsonb_build_object expressions, not generated by Zod.
  // Synthetic fixture, NOT a captured database execution.
  const payload = JSON.parse(fs.readFileSync('tests/fixtures/home-dashboard-postgres-json.json', 'utf8'));
  const h = readerHarness({ responses: { get_home_dashboard: payload } });
  const result = await h.run({ effective_plan: 'free', access_state: 'free' });
  assert.equal(result.finance.status, 'ready');
  assert.equal(result.finance.data.receipts_cents, '-1000');
  assert.equal(h.logs.length, 0);
});

test('safe server diagnostics distinguish PostgREST, PostgreSQL and schema failure without leaking payloads', async () => {
  for (const [code, message] of [['PGRST202', 'Could not find function public.get_home_dashboard'], ['42883', 'function pg_catalog.coalesce(numeric, integer) does not exist'], ['42501', 'unauthorized']]) {
    const h = readerHarness({ responses: { get_home_dashboard: { rpcError: { code, message } } } });
    const result = await h.run({ effective_plan: 'free', access_state: 'free' });
    assert.equal(result.finance.status, 'error');
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].operation, 'get_home_dashboard');
    assert.equal(h.logs[0].stage, 'rpc');
    assert.equal(h.logs[0].code, code);
    assert.ok(h.logs[0].technical_detail.includes(message));
    assert.equal(JSON.stringify(result).includes(code), false);
    assert.equal(JSON.stringify(result).includes(message), false);
  }
  const payload = { ...emptyDashboard(), sales_cents: 42, buyer_secret: 'cliente@example.com' };
  const h = readerHarness({ responses: { get_home_dashboard: payload } });
  const result = await h.run({ effective_plan: 'free', access_state: 'free' });
  assert.equal(result.finance.status, 'error');
  assert.equal(h.logs[0].stage, 'interpretation');
  assert.equal(h.logs[0].code, 'ZOD_PARSE_ERROR');
  assert.match(h.logs[0].technical_detail, /sales_cents:invalid_type/);
  assert.doesNotMatch(JSON.stringify(h.logs), /cliente@example.com|buyer_secret/);
});

test('no session and denied authorization log context and never invoke RPC', async () => {
  for (const code of ['AUTH_UNAUTHENTICATED', 'AUTH_PERMISSION_DENIED']) {
    const h = readerHarness({ gate: async () => { throw Object.assign(new Error(code), { code }); } });
    await assert.rejects(h.run({ effective_plan: 'free', access_state: 'free' }));
    assert.equal(h.logs[0].stage, 'context');
    assert.equal(h.logs[0].code, code);
    assert.equal(h.events.some(e => e.startsWith('rpc:')), false);
  }
});

const freePlan = { effective_plan: 'free', access_state: 'free' };
const paidPlan = { effective_plan: 'intermediate', access_state: 'paid' };

test('reader Aprendiz and non-paid states never authorize or query physical stock', async () => {
  for (const plan of [freePlan, { effective_plan: 'intermediate', access_state: 'expired' }, { effective_plan: 'free', access_state: 'paid' }]) {
    const h = readerHarness();
    const result = await h.run(plan);
    assert.equal(result.finance.status, 'ready');
    assert.equal(result.stock.status, 'free');
    assert.deepEqual(h.events, ['gate:sales.read', 'allowed:sales.read', 'rpc:get_home_dashboard']);
  }
});

test('reader Visionário awaits each permission before stock queries and accepts real empty balances', async () => {
  const h = readerHarness();
  const result = await h.run(paidPlan);
  assert.equal(result.finance.status, 'ready');
  assert.equal(result.stock.status, 'paid');
  assert.equal(result.stock.inventory.status, 'ready');
  assert.equal(result.stock.inventory.data.available_units, '0');
  assert.equal(result.stock.spools.status, 'ready');
  assert.equal(result.stock.spools.data.low_count, 0);
  for (const [permission, rpc] of [['inventory.read', 'get_home_inventory'], ['spools.read', 'count_filament_spools'], ['spools.read', 'get_my_spool_config']]) {
    assert.ok(h.events.indexOf(`allowed:${permission}`) < h.events.indexOf(`rpc:${rpc}`));
  }
});

test('reader denied or cross-tenant stock gates make no stock RPC, financial access denial propagates', async () => {
  for (const mismatch of [false, true]) {
    const h = readerHarness({ gate: async permission => {
      if (permission === 'sales.read') return { enterpriseId: eid };
      if (mismatch) return { enterpriseId: '22222222-2222-4222-8222-222222222222' };
      throw new Error('denied');
    } });
    const result = await h.run(paidPlan);
    assert.equal(result.finance.status, 'ready');
    assert.equal(result.stock.inventory.status, 'error');
    assert.equal(result.stock.spools.status, 'error');
    assert.deepEqual(h.events.filter(event => event.startsWith('rpc:')), ['rpc:get_home_dashboard']);
  }
  const h = readerHarness({ gate: async () => { throw new Error('sales denied'); } });
  await assert.rejects(h.run(paidPlan), /sales denied/);
  assert.equal(h.events.some(event => event.startsWith('rpc:')), false);
});

test('reader tenant mismatch and RPC/schema failures remain errors, never successful invented zero', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  for (const response of [null, {}, [], { ...emptyDashboard(), enterprise_id: other }, { rpcError: true }, new Error('transport')]) {
    const result = await readerHarness({ responses: { get_home_dashboard: response } }).run(freePlan);
    assert.equal(result.finance.status, 'error');
    assert.equal('data' in result.finance, false);
  }
  for (const response of [{ enterprise_id: other, available_units: '0', reserved_units: '0', stocked_products: 0 }, null, { rpcError: true }]) {
    const result = await readerHarness({ responses: { get_home_inventory: response } }).run(paidPlan);
    assert.equal(result.stock.inventory.status, 'error');
    assert.equal('data' in result.stock.inventory, false);
    assert.equal(result.stock.spools.status, 'ready');
    assert.equal(result.finance.status, 'ready');
  }
  for (const responses of [{ count_filament_spools: null }, { count_filament_spools: '9007199254740993' }, { get_my_spool_config: [] }, { get_my_spool_config: { rpcError: true } }]) {
    const result = await readerHarness({ responses }).run(paidPlan);
    assert.equal(result.stock.spools.status, 'error');
    assert.equal('data' in result.stock.spools, false);
    assert.equal(result.stock.inventory.status, 'ready');
  }
});

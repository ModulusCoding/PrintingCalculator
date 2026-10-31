/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local mocks, no network. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const zod = require('zod');
function load(path, imports = {}, env = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => {
    if (name === 'server-only') return {};
    if (name === 'zod') return zod;
    if (name === 'node:crypto') return require(name);
    if (name in imports) return imports[name];
    throw new Error(`Unmocked import: ${name}`);
  }, process: { env }, URL, Buffer, Response, Request, AbortSignal, fetch: () => { throw new Error('Live HTTP forbidden'); } });
  return mod.exports;
}
const contracts = load('lib/billing/contracts.ts');
const env = { ASAAS_API_KEY: 'fake-unit-key' };
function api(transport, config = env) { return load('lib/billing/asaas.ts', { './contracts': contracts }, config); }
for (const url of ['http://sandbox.asaas.com/i/a', 'https://sandbox.asaas.com.evil.com/i/a', 'https://user@sandbox.asaas.com/i/a', 'https://sandbox.asaas.com:444/i/a', 'javascript:alert(1)', 'https://asaas.com/i/a']) test(`reject unsafe invoice ${url}`, () => assert.equal(contracts.safeAsaasUrl(url), null));
test('environment-specific links validated', () => {
  assert.equal(contracts.safeAsaasUrl('https://sandbox.asaas.com/i/pay_x'), 'https://sandbox.asaas.com/i/pay_x');
  assert.equal(contracts.safeAsaasUrl('https://www.asaas.com/i/pay_x', true), 'https://www.asaas.com/i/pay_x');
});
for (const status of ['CONFIRMED', 'RECEIVED']) test(`${status} does not invent coverage`, () => assert.equal(contracts.financialState({ value: 39.9, billingType: 'PIX', status }), 'confirmed'));
for (const status of ['RECEIVED_IN_CASH', 'PENDING', 'AWAITING_RISK_ANALYSIS', 'OVERDUE']) test(`${status} cannot activate`, () => assert.equal(contracts.financialState({ value: 39.9, billingType: 'PIX', status }), 'pending'));
for (const status of ['REFUNDED', 'CHARGEBACK_REQUESTED']) test(`${status} revoked`, () => assert.equal(contracts.financialState({ value: 39.9, billingType: 'PIX', status }), 'revoked'));
test('wrong amount and unsupported method require review', () => {
  assert.equal(contracts.financialState({ value: 79.9, billingType: 'PIX', status: 'RECEIVED' }), 'review');
  assert.equal(contracts.financialState({ value: 39.9, billingType: 'BOLETO', status: 'RECEIVED' }), 'review');
});
test('sandbox default, fixed header/path, sanitized output', async () => {
  const { AsaasClient } = api(); let called;
  const client = new AsaasClient(async (url, init) => { called = { url, init }; return Response.json({ id: 'pay_a', customer: 'cus_a', value: 39.9, billingType: 'PIX', status: 'PENDING', dueDate: '2026-10-27', creditCard: { creditCardToken: 'must-not-retain' } }); });
  const payment = await client.payment('pay_a');
  assert.equal(called.url, 'https://api-sandbox.asaas.com/v3/payments/pay_a');
  assert.equal(called.init.headers.access_token, 'fake-unit-key');
  assert.equal(called.init.body, undefined); assert.equal(called.init.redirect, 'error');
  assert.equal(payment.creditCard, undefined);
});
test('production requires explicit gate', () => assert.throws(() => api(null, { ...env, ASAAS_ENVIRONMENT: 'production' }).billingConfig(), /unavailable/));
test('invalid environment fails closed', () => assert.throws(() => api(null, { ...env, ASAAS_ENVIRONMENT: 'other' }).billingConfig(), /unavailable/));
test('transport timeout is unknown, never retried', async () => {
  let calls = 0; const { AsaasClient } = api();
  await assert.rejects(new AsaasClient(async () => { calls++; throw Error('fake sensitive response'); }).deleteSubscription('sub_a'), /remote_unknown/);
  assert.equal(calls, 1);
});
test('provider errors sanitized', async () => {
  const { AsaasClient } = api();
  await assert.rejects(new AsaasClient(async () => new Response('secret provider body', { status: 400 })).payment('pay_a'), e => e.message === 'remote_rejected');
});
test('path injection and malformed remote response rejected', async () => {
  const { AsaasClient } = api();
  assert.throws(() => new AsaasClient().payment('../customers'));
  await assert.rejects(new AsaasClient(async () => Response.json({ status: 'RECEIVED' })).payment('pay_a'), /invalid_response/);
});
function webhook(failure = false) {
  const calls = []; const token = 'x'.repeat(32);
  const mod = load('lib/billing/webhook.ts', { './contracts': contracts, './admin': { billingAdmin: () => ({ rpc: async (...args) => { calls.push(args); if (failure) throw Error('db'); } }) } }, { ASAAS_WEBHOOK_TOKEN: token });
  const run = (payload, supplied = token) => mod.receiveWebhook(new Request('https://unit.test', { method: 'POST', headers: { 'asaas-access-token': supplied }, body: JSON.stringify(payload) }));
  return { calls, run, token };
}
test('webhook auth before persistence', async () => { const h = webhook(); assert.equal((await h.run({}, 'bad')).status, 401); assert.equal(h.calls.length, 0); });
test('persist allowlisted envelope BEFORE 200; duplicate uses same receipt identity', async () => {
  const h = webhook(); const event = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_a', creditCard: 'never persisted' } };
  assert.equal((await h.run(event)).status, 200); assert.equal((await h.run(event)).status, 200);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0][1].p_id, 'evt_1');
  assert.ok(!JSON.stringify(h.calls).includes('creditCard'));
});
test('durable storage failure is 503 not false acknowledgment', async () => { const h = webhook(true); assert.equal((await h.run({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_a' } })).status, 503); });
test('malformed event rejected', async () => { const h = webhook(); assert.equal((await h.run({ id: '', event: 'bad' })).status, 400); assert.equal(h.calls.length, 0); });
function commands(receipt, deleteFailure = false) {
  const calls = [];
  const { BillingError } = api();
  const mod = load('lib/billing/commands.ts', {
    './asaas': { BillingError, AsaasClient: class { async deleteSubscription(id) { calls.push(['delete', id]); if (deleteFailure) throw Error('timeout'); } } },
    './document': { validBillingDocument: () => true }, './contracts': contracts,
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async name => { calls.push([name]); return receipt; } }) },
    './admin': { billingAdmin: () => ({ rpc: async name => { calls.push([name]); } }) },
  });
  return { calls, mod };
}
const uuid = '00000000-0000-4000-8000-000000000001';
test('invalid checkout input rejected before ANY external side effect', async () => { const h = commands(); await assert.rejects(h.mod.startCheckout(), /Invalid input/); assert.equal(h.calls.length, 0); });
test('cancel remote confirmed THEN immediate SQL downgrade', async () => {
  const h = commands({ data: { state: 'reserved', subscription_id: 'sub_a' } });
  await h.mod.cancelMySubscription(uuid);
  assert.deepEqual(h.calls.map(x => x[0]), ['m8_reserve_my_cancellation', 'delete', 'm8_confirm_my_cancellation']);
});
test('unknown cancellation never resends DELETE', async () => {
  const h = commands({ data: { state: 'unknown', subscription_id: 'sub_a' } });
  await assert.rejects(h.mod.cancelMySubscription(uuid), /remote_unknown/); assert.equal(h.calls.length, 1);
});
test('timeout cannot downgrade or clear unknown reservation', async () => {
  const h = commands({ data: { state: 'reserved', subscription_id: 'sub_a' } }, true);
  await assert.rejects(h.mod.cancelMySubscription(uuid), /remote_unknown/); assert.equal(h.calls.length, 2);
});
test('RPC owner rejection prevents outbound cancellation', async () => {
  const h = commands({ error: { message: 'unauthorized' } });
  await assert.rejects(h.mod.cancelMySubscription(uuid), /unavailable/); assert.equal(h.calls.length, 1);
});
test('SQL proposal preserves resolver expiration, privilege boundaries and data', () => {
  const sql = fs.readFileSync('supabase/migrations/20261027130000_m8_saas_billing_foundation.sql', 'utf8');
  assert.match(sql, /a\.paid_until<=statement_timestamp\(\)/);
  assert.match(sql, /a\.paid_from<=statement_timestamp\(\)/);
  assert.match(sql, /paid_from < paid_until/);
  assert.match(sql, /lease_token=p_token AND sync_version=p_version AND lease_until>statement_timestamp\(\)/);
  assert.match(sql, /m8_cycle_origin_fk/);
  assert.match(sql, /authorization_id=a.authorization_id/);
  assert.match(sql, /CREATE TRIGGER m8_invalidate_cancel_lease/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public.m8_observe_billing_payment.* FROM service_role/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION private.resolve_enterprise_plan/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.m8_confirm_my_cancellation\(uuid,text\) TO service_role/);
  assert.doesNotMatch(sql, /DELETE FROM (public\.)?(enterprise_members|users|products)/i);
  assert.doesNotMatch(sql, /GRANT .*ON private.saas_billing_.* TO authenticated/i);
});

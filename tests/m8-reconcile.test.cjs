/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const zod = require('zod');
const eid = '00000000-0000-4000-8000-000000000001';
function harness(options = {}) {
  const calls = [];
  const account = { enterprise_id: eid, customer_id: 'cus_a', subscription_id: 'sub_a', checkout_id: null, state: 'review' };
  const payment = { id: 'pay_a', customer: 'cus_a', subscription: 'sub_a', value: 39.9, billingType: 'PIX', status: options.status ?? 'RECEIVED', dueDate: '2026-10-27' };
  const imports = {
    './scan': { scanBillingPages: async () => ({ pages: 0, review: 0 }) }, 'server-only': {}, 'zod': zod, 'node:crypto': require('node:crypto'),
    './contracts': { safeAsaasUrl: () => null, financialState: p => ['CONFIRMED', 'RECEIVED'].includes(p.status) ? 'confirmed' : 'pending' },
    './asaas': { billingConfig: () => ({ production: false }), AsaasClient: class { async subscription(id) { calls.push(['GET_SUB', id]); if (options.notFound) throw Error('remote_rejected'); return { id, customer: 'cus_a', value: 39.9, cycle: 'MONTHLY', deleted: options.deleted === true, status: options.subscriptionStatus ?? 'ACTIVE' }; } async payment(id) { calls.push(['GET', id]); if (options.remoteFailure) throw Error('timeout'); return options.payment ?? payment; } } },
    './admin': { billingAdmin: () => ({ rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'm8_scan_accounts') return [];
      if (name === 'm8_unknown_cancellations') return options.unknown ? [{ enterprise_id: eid, subscription_id: 'sub_a' }] : [];
      if (name === 'm8_claim_billing_account') return options.busy ? null : { version: 1, customer_id: 'cus_a', subscription_id: 'sub_a', state: 'review' };
      if (name === 'm8_billing_work_scoped') return [{ id: 'evt_old', event_type: 'PAYMENT_RECEIVED', resource_kind: options.kind ?? 'payment', resource_id: options.kind === 'subscription' ? 'sub_a' : 'pay_a' }];
      if (name === 'm8_billing_link') return options.unlinked ? [] : [account];
      return null;
    } }) },
  };
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('lib/billing/reconcile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => { if (!(name in imports)) throw Error(`Unmocked ${name}`); return imports[name]; } });
  return { calls, run: mod.exports.reconcileBilling };
}
test('late received event re-fetches current refunded status, never grants', async () => {
  const h = harness({ status: 'REFUNDED' });
  const result = await h.run();
  assert.equal(result.observed, 1);
  assert.equal(h.calls.find(x => x[0] === 'm8_apply_payment_snapshot')[1].p_status, 'REFUNDED');
  assert.ok(!h.calls.some(x => /confirm_enterprise_paid_access/.test(x[0])));
});
test('unlinked payment cannot affect another tenant or history', async () => {
  const h = harness({ unlinked: true }); assert.equal((await h.run()).review, 1);
  assert.ok(!h.calls.some(x => x[0] === 'm8_apply_payment_snapshot'));
  assert.ok(h.calls.some(x => x[0] === 'm8_billing_event_failed'));
});
test('transient remote failure records recoverable failure', async () => {
  const h = harness({ remoteFailure: true }); assert.equal((await h.run()).review, 1);
  assert.ok(h.calls.some(x => x[0] === 'm8_billing_event_failed'));
});
test('subscription event uses authoritative GET after claim', async () => {
  const h = harness({ kind: 'subscription', deleted: true }); await h.run();
  assert.ok(h.calls.findIndex(x => x[0] === 'm8_claim_billing_account') < h.calls.findIndex(x => x[0] === 'GET_SUB'));
  assert.equal(h.calls.find(x => x[0] === 'm8_apply_subscription_snapshot')[1].p_deleted, true);
});
test('unknown cancel recovers INACTIVE without repeating DELETE', async () => {
  const h = harness({ unknown: true, subscriptionStatus: 'INACTIVE' }); await h.run();
  assert.equal(h.calls.find(x => x[0] === 'm8_apply_subscription_snapshot')[1].p_status, 'INACTIVE');
  assert.ok(!h.calls.some(x => /delete/i.test(x[0])));
});
test('404 cannot prove deleted, no subscription confirmation', async () => {
  const h = harness({ unknown: true, notFound: true }); await h.run();
  assert.ok(!h.calls.some(x => x[0] === 'm8_apply_subscription_snapshot'));
});
test('busy lease cannot GET or commit snapshot', async () => {
  const h = harness({ unknown: true, busy: true, kind: 'subscription' }); await h.run();
  assert.ok(!h.calls.some(x => x[0] === 'GET_SUB' || x[0] === 'm8_apply_subscription_snapshot'));
});
test('payment fetched again after lease, stale hint never committed', async () => {
  const h = harness(); await h.run();
  const sequence = h.calls.map(x => x[0]);
  assert.equal(sequence.filter(x => x === 'GET').length, 2);
  const claim = sequence.indexOf('m8_claim_billing_account');
  assert.ok(sequence.lastIndexOf('GET') > claim);
});
test('explicit event ID supports review reprocessing', async () => {
  const h = harness(); await h.run('evt_old');
  assert.equal(h.calls[0][1].p_id, 'evt_old');
});

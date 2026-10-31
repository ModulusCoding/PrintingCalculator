/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node CJS server action harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const id = '12345678-1234-4234-8234-123456789abc';
const enterpriseId = '22345678-1234-4234-8234-123456789abc';
class AuthContextError extends Error { constructor(code) { super(code); this.code = code; } }
function harness(options = {}) {
  const calls = []; const logs = [];
  const missing = { operation_id: id, status: 'auth_account_not_found', auth_user_id: null, user_id: null, auth_identity_id: null, membership_id: null };
  const completed = { operation_id: id, status: 'already_completed', auth_user_id: id, user_id: id, auth_identity_id: id, membership_id: id };
  const start = { operation_id: id, enterprise_id: enterpriseId, email_normalized: 'person@example.com', requested_role: 'operator', status: 'pending' };
  const admin = { rpc: async (name, args) => {
    calls.push([name, args]);
    if (options.throwRpc === name) throw new Error('transport');
    if (name === 'start_employee_provisioning') return options.start ?? { data: [start], error: null };
    if (name === 'resume_employee_provisioning') return options.resume ?? { data: [missing], error: null };
    return options.finish ?? { data: [{ operation_id: id, user_id: id, auth_identity_id: id, membership_id: id, status: 'completed' }], error: null };
  }, auth: { admin: { createUser: async args => { calls.push(['createUser', args]); if (options.authThrow) throw new Error('transport'); return options.auth ?? { data: { user: { id } }, error: null }; }, deleteUser: () => assert.fail('must never delete Auth') } } };
  const requireMock = name => {
    if (name === 'server-only') return {};
    if (name === '@supabase/supabase-js') return { createClient: () => { calls.push(['adminClient']); return admin; } };
    if (name === 'next/headers') return { headers: async () => new Headers() };
    if (name === '@/lib/auth/context') return { AuthContextError, requireBusinessContext: async permission => { calls.push(['permission', permission]); if (options.denied) throw new AuthContextError('AUTH_PERMISSION_DENIED'); return { userId: id, enterpriseId, role: 'owner' }; } };
    if (name === '@/lib/rate-limit') return { rateLimit: () => ({ allowed: true }) };
    if (name === '@/lib/supabase/server') return { createClient: async () => { calls.push(['session']); return { auth: { getUser: async () => ({ data: { user: options.noSession ? null : { id } }, error: null }) } }; } };
    return require(name);
  };
  const filename = path.resolve(__dirname, '../lib/employees/provisioning.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loadedModule = { exports: {} };
  const run = vm.runInNewContext('(function(require,module,exports){' + source + '\n})', { console: { error: (...args) => logs.push(args) }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://test.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only', SUPABASE_AUTH_ISSUER: 'https://test.example/auth/v1' } } });
  run(requireMock, loadedModule, loadedModule.exports);
  return { ...loadedModule.exports, calls, logs, missing, completed, start };
}
function form(role = 'operator') { const f = new FormData(); for (const [k, v] of Object.entries({ fullName: 'Person', email: 'PERSON@example.com', role, temporaryPassword: 'password123', temporaryPasswordConfirmation: 'password123' })) f.set(k, v); return f; }
const idle = { status: 'idle' };
const creations = h => h.calls.filter(c => c[0] === 'createUser').length;
test('admin input denied before session, RPC or Auth creation', async () => {
  const h = harness(); const r = await h.provisionEmployeeAction(idle, form('admin'));
  assert.equal(r.code, 'validation'); assert.ok(r.fieldErrors.role); assert.equal(h.calls.length, 0);
});
test('first success checks recovery before Auth and finishes with operation marker', async () => {
  const h = harness(); const r = await h.provisionEmployeeAction(idle, form());
  assert.equal(r.status, 'success'); assert.equal(r.operationId, id); assert.equal(creations(h), 1);
  assert.deepEqual(h.calls.filter(c => !['session', 'permission', 'adminClient'].includes(c[0])).map(c => c[0]), ['start_employee_provisioning', 'resume_employee_provisioning', 'createUser', 'finish_employee_provisioning']);
  assert.equal(h.calls.find(c => c[0] === 'createUser')[1].app_metadata.modulus_employee_provisioning_operation_id, id);
});
test('quota is a domain error, without Auth creation or technical logging', async () => {
  const h = harness({ start: { error: { code: 'P0001', message: 'team_limit_reached' } } });
  const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.code, 'team_limit_reached'); assert.equal(creations(h), 0); assert.equal(h.logs.length, 0);
});
test('SQL permission and invalid-input guards remain domain failures before Auth', async () => {
  for (const [code, expected] of [['42501', 'permission_denied'], ['22023', 'operation_conflict']]) {
    const h = harness({ start: { error: { code, message: 'guard' } } });
    const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.code, expected); assert.equal(creations(h), 0); assert.equal(h.logs.length, 0);
  }
});
test('malformed or transport start is unknown, not blind-retry technical error', async () => {
  for (const options of [{ start: { data: [], error: null } }, { start: { data: [{ operation_id: id }], error: null } }, { throwRpc: 'start_employee_provisioning' }]) {
    const h = harness(options); const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.status, 'outcome_unknown'); assert.equal(creations(h), 0);
    if (options.start?.data[0]) assert.equal(r.operationId, id);
  }
});
test('known operation retained for all Auth failures and partial finalization', async () => {
  for (const options of [{ authThrow: true }, { auth: { data: { user: null }, error: null } }, { auth: { error: { status: 400, code: 'weak_password' } } }, { auth: { error: { status: 422, code: 'email_exists' } } }, { auth: { error: { status: 503 } } }, { finish: { error: { code: 'P0001', message: 'team_limit_reached' } } }, { finish: { data: [], error: null } }, { throwRpc: 'finish_employee_provisioning' }]) {
    const h = harness(options); const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.operationId, id); assert.notEqual(r.status, 'success'); assert.equal(creations(h), 1);
  }
});
test('repeated start resumes existing Auth instead of creating another account', async () => {
  const base = harness(); const h = harness({ resume: { data: [base.completed], error: null } });
  const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.status, 'success'); assert.equal(r.code, 'already_completed'); assert.equal(creations(h), 0);
});
test('inconsistent, failed, malformed or unknown recovery blocks Auth creation', async () => {
  const base = harness();
  for (const resume of [{ data: [{ ...base.missing, status: 'inconsistent' }] }, { data: [{ ...base.missing, status: 'failed' }] }, { data: [] }, { error: { code: '42501' } }, { data: [{ ...base.completed, membership_id: null }] }]) {
    const h = harness({ resume }); const r = await h.provisionEmployeeAction(idle, form()); assert.equal(r.operationId, id); assert.equal(creations(h), 0); assert.notEqual(r.status, 'success');
  }
});
test('resume is idempotent and never creates Auth; unauthorized requests stop before admin', async () => {
  const base = harness(); const h = harness({ resume: { data: [base.completed], error: null } }); const f = new FormData(); f.set('operationId', id);
  for (let i = 0; i < 2; i++) { const r = await h.resumeProvisioningAction(idle, f); assert.equal(r.code, 'already_completed'); assert.equal(r.operationId, id); }
  assert.equal(creations(h), 0);
  for (const options of [{ denied: true }, { noSession: true }]) {
    const denied = harness(options); const r = await denied.resumeProvisioningAction(idle, f); assert.equal(r.operationId, id); assert.equal(r.status, 'error'); assert.equal(denied.calls.some(c => c[0] === 'adminClient'), false);
    await denied.provisionEmployeeAction(idle, form()); assert.equal(creations(denied), 0);
  }
});
test('new form offers operator only and new-registration URL clears operationId', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/conta/equipe/novo/EmployeeProvisioningForm.tsx'), 'utf8');
  assert.doesNotMatch(source, /option value="admin"|canCreateAdmin/); assert.match(source, /searchParams\.delete\("operationId"\)/);
});

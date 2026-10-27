// PREPARED ONLY, NOT EXECUTED. Optional two-session real Auth/PostgREST test.
// No dependency installation. Never use service_role/secret keys.
import { readFileSync, writeFileSync } from 'node:fs';
const { FLEX_PROJECT_REF: ref, FLEX_RUN_ID: run, FLEX_CONFIRM: confirm,
  FLEX_ANON_KEY: key, FLEX_TOKEN_A: tokenA, FLEX_TOKEN_B: tokenB,
  FLEX_CASE_FILE: path, FLEX_EVIDENCE_FILE: output } = process.env;
if (!ref || !/^[a-z0-9]{15,30}$/.test(ref) || !run ||
    !/^[0-9a-f-]{36}$/i.test(run) || confirm !== `DISPOSABLE:${ref}:${run}` ||
    !key || !tokenA || !tokenB || !path || !output) {
  throw new Error('Fail closed: configure disposable ref/run, exact confirmation, anon key, two USER tokens, case and new evidence file.');
}
function decode(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { throw new Error('Expected user access JWT, not API/service credential'); }
}
for (const token of [tokenA, tokenB]) {
  const claim = decode(token);
  if (claim.role !== 'authenticated' || claim.iss !== `https://${ref}.supabase.co/auth/v1` ||
      !claim.sub || !(claim.exp > Date.now() / 1000)) throw new Error('Unexpected user JWT claims');
}
// Decoding is NOT signature verification. Supabase must authenticate both requests.
if (key.startsWith('sb_secret_') || (key.split('.').length === 3 && decode(key).role !== 'anon')) {
  throw new Error('Only anon/publishable key is allowed');
}
const spec = JSON.parse(readFileSync(path, 'utf8'));
const allowed = new Set(['transition_order','allocate_order_stock','deliver_order',
  'undo_order_delivery','cancel_order','reopen_order','move_product_inventory']);
if (spec.project_ref !== ref || spec.run_id !== run || !Array.isArray(spec.requests) ||
    spec.requests.length !== 2 || spec.requests.some(x => !allowed.has(x.rpc) ||
      !x.payload || typeof x.payload !== 'object' || Array.isArray(x.payload))) {
  throw new Error('Case must bind same project/run and exactly two whitelisted RPC payloads');
}
// Reserve a new local evidence filename BEFORE making requests. Never overwrite user files.
writeFileSync(output, JSON.stringify({ status: 'started', project_ref: ref, run_id: run,
  case_name: spec.name, started_at: new Date().toISOString() }), { flag: 'wx' });
const results = await Promise.allSettled(spec.requests.map(async (request, i) => {
  const started = new Date().toISOString();
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/${request.rpc}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${i === 0 ? tokenA : tokenB}`,
      'Content-Type': 'application/json' }, body: JSON.stringify(request.payload),
    signal: AbortSignal.timeout(30000),
  });
  return { rpc: request.rpc, payload: request.payload, started_at: started,
    completed_at: new Date().toISOString(), http_status: response.status, body: await response.text() };
}));
writeFileSync(output, JSON.stringify({ status: 'observed_not_approved', project_ref: ref,
  run_id: run, case_name: spec.name, completed_at: new Date().toISOString(),
  results: results.map(x => x.status === 'fulfilled' ? x.value : { transport_error: String(x.reason) }) }, null, 2));
console.log('Evidence saved. HTTP timing alone does NOT prove lock overlap, rollback or inventory integrity. Run SQL audits.');

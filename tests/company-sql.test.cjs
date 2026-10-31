/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node harness. */
// Static source regressions only: these do not parse/execute PostgreSQL or prove
// runtime JWT, trigger, concurrency, grant inheritance or migration installation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'supabase', 'migrations');
const readerFile = '20261029100000_enterprise_config_company_read.sql';
const rateFile = '20261029110000_enterprise_config_nullable_rate.sql';
const source = file => fs.readFileSync(path.join(dir, file), 'utf8');
const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
function definitions(file, name) {
  const pattern = new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\s*\\(([^)]*)\\)([\\s\\S]*?)AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'gi');
  return [...source(file).matchAll(pattern)].map(m => ({ file, args: normalize(m[1]), header: normalize(m[2]), body: normalize(m[3]) }));
}
function chain(name, argCount) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .flatMap(f => definitions(f, name))
    .filter(d => (d.args ? d.args.split(',').length : 0) === argCount);
}
const reader = definitions(readerFile, 'get_my_enterprise_config')[0];
const rate = definitions(rateFile, 'update_my_enterprise_config')[0];
const oldFull = definitions('20261023000000_fdm_pricing_spools_materials_v2.sql', 'update_my_enterprise_config').find(d => d.args.split(',').length === 3);

test('replacement chain changes only reader and rate-only overload, leaving three-argument patch authoritative', () => {
  assert.equal(chain('get_my_enterprise_config', 0).at(-1).file, readerFile);
  assert.equal(chain('update_my_enterprise_config', 2).at(-1).file, rateFile);
  assert.deepEqual(chain('update_my_enterprise_config', 3).at(-1), oldFull);
  assert.equal(definitions(rateFile, 'update_my_enterprise_config').length, 1);
  assert.equal(rate.args, 'p_rate numeric, p_expected_version bigint');
  assert.equal(rate.header, "RETURNS TABLE(status text, version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''");
  assert.doesNotMatch(normalize(source(rateFile)), /(?:DROP FUNCTION|CREATE(?: OR REPLACE)? FUNCTION private\.|ALTER TABLE)/i);
});

test('reader retains existing context/result boundary and adds only fail-closed company authority', () => {
  const historic = definitions('20261023010000_pricing_loss_config.sql', 'get_my_enterprise_config').at(-1);
  const oldPredicate = "IF private.can_access_enterprise( v_context.enterprise_id, 'printers.read' ) IS DISTINCT FROM TRUE THEN";
  const newPredicate = "IF private.can_access_enterprise( v_context.enterprise_id, 'printers.read' ) IS DISTINCT FROM TRUE AND private.can_access_enterprise( v_context.enterprise_id, 'enterprise.manage' ) IS DISTINCT FROM TRUE THEN";
  assert.ok(historic.body.includes(oldPredicate));
  assert.equal(reader.body, historic.body.replace(oldPredicate, newPredicate));
  assert.equal(reader.header, historic.header);
  assert.match(reader.body, /IF NOT FOUND THEN/);
  assert.match(reader.body, /state IS DISTINCT FROM 'business_ready'/);
  assert.match(reader.body, /WHERE e.id = v_context.enterprise_id AND e.status = 'active'/);
  // This checks the intended SQL three-valued predicate truth table, not DB execution.
  for (const printer of [true, false, null]) for (const company of [true, false, null]) {
    const denied = printer !== true && company !== true;
    assert.equal(!denied, printer === true || company === true);
  }
});

test('company read exception uses existing owner remediation, not a new role or plan matrix', () => {
  const plan = normalize(source('20261026060000_plan_business_regularization.sql'));
  assert.match(plan, /IF member_role='owner' AND permission IN \('enterprise.manage','members.manage_admins','members.manage_operators','pricing.read','pricing.write'\) THEN RETURN true/);
  assert.match(plan, /IF r.effective_plan='free' THEN IF member_role<>'owner' THEN RETURN false/);
  const auth = normalize(source('20261026150000_pricing_actor_authorization.sql'));
  assert.match(auth, /WHEN 'enterprise.manage' THEN em.role='owner'/);
  assert.match(auth, /WHEN 'printers.read' THEN em.role IN\('owner','admin','operator'\)/);
  assert.match(auth, /private.can_access_enterprise_for_user\(private.current_internal_user_id\(\),p_enterprise_id,p_permission\)/);
});

test('rate-only retains the exact current identity/locking/authorization sequence', () => {
  const protocol = body => body.slice(body.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock'), body.indexOf('IF v_enterprise.version'));
  assert.ok(protocol(rate.body).length > 1000);
  assert.equal(protocol(rate.body), protocol(oldFull.body));
  const markers = [
    'modulus:enterprise-management:all-members', 'public.get_my_access_context()',
    'modulus:employee-provisioning:actor:', 'FROM public.auth_identities AS ai',
    'FROM public.users AS u', 'SELECT em.* INTO v_member',
    'SELECT count(*)', 'SELECT e.* INTO v_enterprise',
    "private.can_access_enterprise(v_enterprise.id, 'enterprise.manage')",
    'IF v_enterprise.version', 'UPDATE public.enterprises',
  ];
  let previous = -1;
  for (const marker of markers) {
    const position = rate.body.indexOf(marker);
    assert.ok(position > previous, `ordered protocol marker: ${marker}`);
    previous = position;
  }
});

test('NULL clears rate, no-op remains updated, stale version wins, and loss is untouched', () => {
  assert.match(rate.body, /IF p_expected_version IS NULL OR p_expected_version < 0 THEN/);
  assert.match(rate.body, /IF p_rate IS NOT NULL THEN IF p_rate < 0 OR p_rate > 100 OR pg_catalog.scale\(p_rate\) > 6/);
  for (const value of ['NaN', 'Infinity', '-Infinity']) assert.ok(rate.body.includes(`p_rate = '${value}'::NUMERIC`));
  assert.match(rate.body, /IF v_enterprise.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict'::text, v_enterprise.version; RETURN; END IF; IF v_enterprise.electricity_rate_per_kwh IS NOT DISTINCT FROM p_rate THEN RETURN QUERY SELECT 'updated'::text, v_enterprise.version; RETURN; END IF;/);
  assert.match(rate.body, /UPDATE public.enterprises SET electricity_rate_per_kwh = p_rate WHERE id = v_enterprise.id;/);
  assert.match(rate.body, /SELECT 'updated'::text, e.version FROM public.enterprises e WHERE e.id = v_enterprise.id/);
  assert.doesNotMatch(rate.body, /COALESCE|default_filament_loss_percent|no_change|public.update_my_enterprise_config\(|SET version|STRICT/i);
  assert.doesNotMatch(rate.header, /STRICT/i);
  // Preserve the separate three-argument patch contract, including its NULL guard.
  assert.match(oldFull.body, /p_electricity_rate_per_kwh IS NULL AND p_default_filament_loss_percent IS NULL/);
  assert.match(oldFull.body, /COALESCE\(p_electricity_rate_per_kwh, v_enterprise.electricity_rate_per_kwh\)/);
});

test('both local migrations retain explicit ownership, authenticated grants and empty search_path', () => {
  for (const [file, signature] of [[readerFile, 'get_my_enterprise_config()'], [rateFile, 'update_my_enterprise_config(numeric, bigint)']]) {
    const sql = normalize(source(file));
    assert.ok(sql.startsWith('BEGIN;'));
    assert.ok(sql.endsWith('COMMIT;'));
    assert.ok(sql.includes(`ALTER FUNCTION public.${signature} OWNER TO postgres;`));
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`));
    assert.ok(sql.includes("SECURITY DEFINER SET search_path = ''"));
    assert.doesNotMatch(sql, /pg_catalog\.coalesce\s*\(/i);
  }
});

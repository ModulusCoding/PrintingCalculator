/* eslint-disable @typescript-eslint/no-require-imports */
// Source/model regression ONLY. This does not parse or execute PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/20261027130000_m8_saas_billing_foundation.sql','utf8');
const grant = sql.split('CREATE FUNCTION private.m8_grant_verified_payment')[1].split('REVOKE ALL ON FUNCTION private.m8_grant_verified_payment')[0];
test('grant never clears start before confirmer and rejects historical replay', () => {
 assert.doesNotMatch(grant,/SET paid_from=NULL/);
 assert.ok(grant.indexOf('confirmation.status') < grant.indexOf('INSERT INTO private.saas_coverage_cycles'));
 assert.match(grant,/confirmation.status IS DISTINCT FROM 'confirmed'/);
 assert.match(grant,/independent_authorization_conflict/);
 assert.ok(grant.indexOf('INSERT INTO private.saas_payment_authorizations') < grant.indexOf('INSERT INTO private.saas_coverage_cycles'));
});
test('renew Feb25 through Feb28 then Mar31 preserves CURRENT cycle after auth substitution; refund is cycle local', () => {
 const cycles = [{id:'old',from:Date.parse('2027-01-31T18:00:00Z'),until:Date.parse('2027-02-28T18:00:00Z')}, {id:'new',from:Date.parse('2027-02-28T18:00:00Z'),until:Date.parse('2027-03-31T18:00:00Z')}];
 const covers=(t,reversed=[])=>cycles.some(c=>c.from<=Date.parse(t)&&Date.parse(t)<c.until&&!reversed.includes(c.id));
 assert.equal(covers('2027-02-25T18:00:00Z'),true);
 assert.equal(covers('2027-02-28T18:00:00Z',['old']),true);
 assert.equal(covers('2027-02-25T18:00:00Z',['old']),false);
 assert.equal(covers('2027-03-31T18:00:00Z'),false);
 assert.match(sql,/ba.authorization_id=a.authorization_id/);
 // Deliberately NOT cy.authorization_id=a.authorization_id: newest receipt must
 // not hide the still-current prepaid predecessor.
 assert.doesNotMatch(sql,/cy.authorization_id=a.authorization_id/);
 assert.match(sql,/NOT EXISTS\(SELECT 1 FROM private.saas_coverage_reversals r WHERE r.payment_id=cy.payment_id\)/);
});
test('generation, cancellation fence and immutable composite provenance', () => {
 for(const marker of ['m8_cycle_payment_fk','m8_cycle_origin_fk','m8_origin_receipt_fk','m8_origins_immutable','generation IS DISTINCT FROM a.generation','a.generation IS DISTINCT FROM r.generation','NEW.generation IS DISTINCT FROM OLD.generation']) assert.ok(sql.includes(marker),marker);
 assert.ok(sql.indexOf('generation uuid NOT NULL DEFAULT gen_random_uuid()') < sql.indexOf('CREATE FUNCTION private.m8_invalidate_cancel_lease'));
 assert.ok(sql.indexOf("BEGIN RAISE EXCEPTION 'immutable_billing_ledger'") < sql.indexOf('CREATE TRIGGER m8_origins_immutable'));
});
test('NULL scan payload/fence cannot bypass three-valued SQL checks', () => {
 for(const marker of ["jsonb_typeof(p_payments) IS DISTINCT FROM 'array'",'p_count IS NULL OR p_more IS NULL','p_token IS NULL OR p_version IS NULL','a.scan_until IS NULL','IS NOT TRUE THEN RAISE EXCEPTION']) assert.ok(sql.includes(marker),marker);
});
test('mutating checkout/cancel paths acquire global lock before row locks and context', () => {
 for(const name of ['m8_reserve_my_checkout','m8_checkout_progress','m8_reserve_my_checkout_cancel','m8_confirm_checkout_cancel','m8_reserve_my_cancellation','m8_confirm_my_cancellation']) {
  const body=sql.split(`CREATE FUNCTION public.${name}(`)[1].split('END $$;')[0];
  assert.ok(body.indexOf('pg_advisory_xact_lock') < body.indexOf('FOR UPDATE'),name);
  if(body.includes('get_my_access_context')) assert.ok(body.indexOf('pg_advisory_xact_lock') < body.indexOf('get_my_access_context'),name);
 }
});
test('SQL calendar preserves fractional wall time; JS Date is not microsecond evidence', () => {
 assert.match(sql,/p_anchor-date_trunc\('day',p_anchor\)/);
 assert.match(sql,/prev.paid_until>=t/);
 assert.match(sql,/cy.paid_from<=statement_timestamp\(\) AND statement_timestamp\(\)<cy.paid_until/);
});

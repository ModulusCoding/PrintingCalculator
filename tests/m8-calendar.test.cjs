/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/billing/calendar.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: mod.exports, module: mod, Date, Intl });
const { calendarMonthEnd: end, projectCycle: cycle } = mod.exports;
for (const [start, offset, expected] of [
 ['2027-01-30T18:23:45.123Z',1,'2027-02-28T18:23:45.123Z'],
 ['2027-01-30T18:23:45.123Z',2,'2027-03-30T18:23:45.123Z'],
 ['2027-01-31T18:23:45.123Z',1,'2027-02-28T18:23:45.123Z'],
 ['2027-01-31T18:23:45.123Z',2,'2027-03-31T18:23:45.123Z'],
 ['2028-01-31T18:23:45.123Z',1,'2028-02-29T18:23:45.123Z'],
 ['2028-02-29T18:23:45.123Z',12,'2029-02-28T18:23:45.123Z'],
 ['2026-12-31T02:00:00.000Z',1,'2027-01-31T02:00:00.000Z'],
]) test(`calendar ${start} + ${offset}`, () => assert.equal(end(new Date(start),offset).toISOString(),expected));
test('early extends from end, retains original 31 anchor', () => {
 const first=cycle(new Date('2027-01-31T18:00:00Z'));
 const next=cycle(new Date('2027-02-10T18:00:00Z'),first);
 assert.equal(next.from.toISOString(),first.until.toISOString());
 assert.equal(next.until.toISOString(),'2027-03-31T18:00:00.000Z');
});
test('late starts new observation without filling gap', () => {
 const first=cycle(new Date('2027-01-31T18:00:00Z'));
 const next=cycle(new Date('2027-03-04T17:00:00Z'),first);
 assert.equal(next.from.toISOString(),'2027-03-04T17:00:00.000Z');
 assert.equal(next.until.toISOString(),'2027-04-04T17:00:00.000Z');
});
test('exact end is continuous renewal but exclusive authorization boundary', () => {
 const first=cycle(new Date('2027-01-31T18:00:00Z'));
 assert.equal(cycle(first.until,first).until.toISOString(),'2027-03-31T18:00:00.000Z');
});
test('candidate ledger has DB-clock, immutability, unique cycle and provenance', () => {
 const sql=fs.readFileSync('supabase/migrations/20261027130000_m8_saas_billing_foundation.sql','utf8');
 for(const token of ['m8_cycles_immutable','m8_reversals_immutable','UNIQUE(enterprise_id,generation,provider_due_date)','statement_timestamp()<cy.paid_until','America/Sao_Paulo','private.m8_check_billing_fence']) assert.ok(sql.includes(token),token);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
});

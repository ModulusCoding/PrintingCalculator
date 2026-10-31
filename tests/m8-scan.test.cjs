/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const zod=require('zod');
function load(path,imports){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>imports[n]});return mod.exports;}
const uuid=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
function harness(options={}){
 const accounts=Array.from({length:25},(_,i)=>({enterprise_id:uuid(i+1),generation:uuid(i+101),customer_id:`cus_${i}`,subscription_id:`sub_${i}`,checkout_id:null,scan_offset:0,scan_version:1,ticket:0}));
 const seen=new Set();const requests=[];let ticket=0;let interrupt=false;
 const db={rpc:async(name,args)=>{
  if(name==='m8_claim_scan_page'){const a=accounts.filter(a=>!args.p_enterprise||a.enterprise_id===args.p_enterprise).sort((a,b)=>a.ticket-b.ticket)[0];a.ticket=++ticket;a.scan_version++;return {...a};}
  if(name==='m8_commit_scan_page'){if(interrupt){interrupt=false;throw Error('crash before atomic commit');}const a=accounts.find(a=>a.enterprise_id===args.p_enterprise);for(const p of args.p_payments)seen.add(p.id);a.scan_offset=args.p_more?args.p_offset+args.p_count:0;}
 }};
 class AsaasClient{async paymentPage(customer,subscription,checkout,offset){requests.push([customer,offset]);const count=Math.min(100,205-offset);return {offset:options.wrongOffset?offset+1:offset,limit:100,hasMore:offset+count<205,data:Array.from({length:count},(_,i)=>({id:`pay_${customer}_${offset+i}`,status:'RECEIVED',customer:options.crossTenant?'cus_other':customer,subscription}))};}}
 const imports={'server-only':{},'node:crypto':require('node:crypto'),zod,'./admin':{billingAdmin:()=>db},'./asaas':{AsaasClient}};
 return {restart:()=>load('lib/billing/scan.ts',imports).scanBillingPages,accounts,seen,requests,crash:()=>{interrupt=true;}};
}
test('25 accounts x 205 invoices: bounded calls resume fairly beyond 20 and first page',async()=>{
 const h=harness();for(let i=0;i<20;i++)await h.restart()(undefined,4);
 assert.equal(h.seen.size,25*205);assert.ok(h.accounts.every(a=>h.requests.filter(r=>r[0]===a.customer_id).some(r=>r[1]===200)));
});
test('interruption before page commit retries unchanged offset across process restart without starving peers',async()=>{
 const h=harness();h.crash();await h.restart()(undefined,1);assert.equal(h.accounts[0].scan_offset,0);
 for(let i=0;i<26;i++)await h.restart()(undefined,1);
 assert.ok(h.requests.filter(r=>r[0]==='cus_0'&&r[1]===0).length===2);assert.ok(h.accounts.slice(1).every(a=>h.requests.some(r=>r[0]===a.customer_id)));assert.equal(h.seen.size,2600);
});
test('invalid offset or cross-tenant page never checkpoints or persists partial hints',async()=>{for(const options of [{wrongOffset:true},{crossTenant:true}]){const h=harness(options);const result=await h.restart()(uuid(1),1);assert.equal(result.review,1);assert.equal(h.seen.size,0);assert.equal(h.accounts[0].scan_offset,0);}});
test('owner scoped scan never selects other enterprise',async()=>{const h=harness();await h.restart()(uuid(25),3);assert.ok(h.requests.every(r=>r[0]==='cus_24'));assert.equal(h.seen.size,205);});
test('SQL page checkpoint and events are atomic, generation-fenced, fair and private',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261027130000_m8_saas_billing_foundation.sql','utf8');
 for(const marker of ['ORDER BY scan_ticket,enterprise_id FOR UPDATE SKIP LOCKED','scan_offset=CASE WHEN p_more THEN p_offset+p_count ELSE 0 END','a.scan_subscription IS DISTINCT FROM a.subscription_id','a.scan_token IS DISTINCT FROM p_token','ORDER BY e.attempts,e.created_at,e.id','m8_commit_scan_page'])assert.ok(sql.includes(marker));
});
const {validBillingDocument:valid}=load('lib/billing/document.ts',{});
test('CPF/CNPJ checksums accept test vectors and reject repeated or corrupt digits',()=>{assert.equal(valid('52998224725'),true);assert.equal(valid('11222333000181'),true);for(const d of ['11111111111','00000000000000','52998224724','11222333000180','abc'])assert.equal(valid(d),false);});

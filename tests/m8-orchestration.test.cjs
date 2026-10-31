/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'); const assert=require('node:assert/strict');
const ts=require('typescript'); const fs=require('node:fs'); const vm=require('node:vm'); const zod=require('zod');
const id='00000000-0000-4000-8000-000000000001';
const input={attempt:id,method:'PIX',name:'Unit Owner',cpfCnpj:'12345678901',email:'unit@example.invalid'};
function harness(options={}) {
 const calls=[];
 class BillingError extends Error { constructor(code){super(code);} }
 class AsaasClient {
  async customers(){calls.push('GET_CUSTOMERS');return {hasMore:false,data:options.customerFound?[{id:'cus_test',externalReference:`m8:${id}`}]:[]};}
  async createCustomer(){calls.push('POST_CUSTOMER');if(options.timeout)throw Error('timeout');return {id:'cus_test',externalReference:`m8:${id}`};}
  async createPixSubscription(){calls.push('POST_SUB');return {id:'sub_test',customer:'cus_test',value:39.9,cycle:'MONTHLY'};}
  async subscriptions(){calls.push('GET_SUBS');return {hasMore:false,data:options.resourceFound?[{id:'sub_test',customer:'cus_test',externalReference:id,value:39.9,cycle:'MONTHLY'}]:[]};}
  async subscription(){calls.push('GET_SUB');return {id:'sub_test',customer:'cus_test',value:39.9,cycle:'MONTHLY'};}
  async createCardCheckout(){calls.push('POST_CHECKOUT');return {id,link:'https://sandbox.asaas.com/checkoutSession/show/'+id};}
 }
 const imports={'server-only':{},zod,'@/lib/supabase/server':{createClient:async()=>({rpc:async()=>({data:{id,enterprise_id:id,generation:id,customer_id:options.linked?'cus_test':null,state:'unknown',phase:options.phase??'customer',fresh:options.fresh??true,method:options.method??'PIX'}})})},'./asaas':{AsaasClient,BillingError},'./document':{validBillingDocument:()=>true},'./contracts':{safeAsaasUrl:v=>v??null},'./admin':{billingAdmin:()=>({rpc:async(name,args)=>{calls.push(args.p_phase);if(options.fenceFail&&args.p_phase==='resource')throw Error('conflict');}})}};
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/billing/commands.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>imports[n],process:{env:{ASAAS_CALLBACK_ORIGIN:'https://app.example.invalid'}},URL,Intl,Date});
 return {run:mod.exports.startCheckout,calls};
}
test('Pix creates customer then durable phase before single monthly subscription',async()=>{
 const h=harness();assert.equal(await h.run(input),null);assert.deepEqual(h.calls,['GET_CUSTOMERS','POST_CUSTOMER','resource','POST_SUB','complete']);
});
test('customer timeout unknown never retries POST on recovery without verified match',async()=>{
 const first=harness({timeout:true});await assert.rejects(first.run(input));
 const next=harness({fresh:false});await assert.rejects(next.run(input));assert.deepEqual(next.calls,['GET_CUSTOMERS']);
});
test('uniquely discovered customer reused without duplicate customer POST',async()=>{
 const h=harness({fresh:false,customerFound:true});await h.run(input);assert.ok(!h.calls.includes('POST_CUSTOMER'));assert.ok(h.calls.includes('POST_SUB'));
});
test('resource unknown no match never blind POSTs',async()=>{
 const h=harness({phase:'resource',linked:true,fresh:false});await assert.rejects(h.run(input));assert.deepEqual(h.calls,['GET_SUBS']);
});
test('Pix resource unknown recovers by list AND GET before persistence',async()=>{
 const h=harness({phase:'resource',linked:true,fresh:false,resourceFound:true});await h.run(input);assert.deepEqual(h.calls,['GET_SUBS','GET_SUB','complete']);
});
test('concurrent phase fence rejects before POST',async()=>{
 const h=harness({linked:true,fenceFail:true});await assert.rejects(h.run(input));assert.ok(!h.calls.includes('POST_SUB'));
});
test('card uses hosted checkout, no card data, same durable fence',async()=>{
 const h=harness({linked:true,method:'CREDIT_CARD'});assert.match(await h.run({...input,method:'CREDIT_CARD'}),/^https:/);assert.deepEqual(h.calls,['resource','POST_CHECKOUT','complete']);
});
test('card resource ambiguity never recreates checkout',async()=>{
 const h=harness({linked:true,method:'CREDIT_CARD',phase:'resource'});await assert.rejects(h.run({...input,method:'CREDIT_CARD'}));assert.deepEqual(h.calls,[]);
});

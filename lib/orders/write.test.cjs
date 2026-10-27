/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test harness. */
// Run: node --test lib/orders/write.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, dependencies = {}) {
  const context = { exports: {}, console, crypto: require('node:crypto').webcrypto, require: name => dependencies[name] ?? require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020},
  }).outputText, context);
  return context.exports;
}
const operationSchema = load('lib/orders/operation-schema.ts');
const operationErrors = load('lib/orders/operation-errors.ts');
const loadTransitions = () => load('lib/orders/transitions.ts', {'./operation-schema':operationSchema});
const schema = load('lib/orders/write-schema.ts');
const uuid = '11111111-1111-4111-8111-111111111111';
const input = () => ({attemptId:uuid, buyerName:'Comprador', buyerPhone:null, buyerEmail:null,
  buyerAddress:null, notes:null, discountType:'fixed', discountInput:'0.00', shippingAmount:'0.00',
  items:[{origin:'custom', product_id:null, name:'Peça', description:null, quantity:'3', unit_price:'0.10', fulfillment_mode:'untracked'}]});
test('BRL normalization and exact cent arithmetic', () => {
  assert.equal(schema.decimalBR('1.234,56'),'1234.56');
  for (const v of ['-1','1.23','NaN','1,234','1e3']) assert.throws(()=>schema.decimalBR(v));
  assert.equal(schema.estimate(input()).total, BigInt(30));
  assert.equal(schema.estimate({...input(),discountType:'percent',discountInput:'5.00'}).discount,BigInt(2));
  assert.equal(schema.estimate({...input(),discountInput:'999.00',shippingAmount:'1.00'}).total,BigInt(100));
});
test('payload validation rejects malformed, out-of-range and missing data without throwing', () => {
  assert.equal(schema.orderInputSchema.safeParse(input()).success,true);
  for (const patch of [{items:[]},{discountInput:'bad'},{shippingAmount:'NaN'},{discountType:'percent',discountInput:'100.01'}, {orderId:uuid}]) {
    assert.equal(schema.orderInputSchema.safeParse({...input(),...patch}).success,false);
  }
  for (const patch of [{quantity:'-1'},{quantity:'0'},{quantity:'1.5'},{quantity:'bad'},{unit_price:'1000000.01'},{origin:'catalog'}]) {
    assert.equal(schema.orderInputSchema.safeParse({...input(),items:[{...input().items[0],...patch}]}).success,false);
  }
});
test('server action authorizes, sends full RPC payload, maps exact errors and revalidates', async () => {
  let calls=[], paths=[], denied=false, response;
  class AuthContextError extends Error { code='AUTH_PERMISSION_DENIED'; }
  class PlanAccessError extends Error {}
  const actions = load('lib/orders/write-actions.ts', {
    './write-schema':schema, './transitions':loadTransitions(), './operation-errors':operationErrors, 'server-only':{},
    'next/cache':{revalidatePath:p=>paths.push(p)}, 'next/navigation':{unstable_rethrow(){}},
    '@/lib/auth/context':{AuthContextError,requireBusinessContext:async p=>{assert.equal(p,'sales.write');if(denied)throw new AuthContextError();}},
    '@/lib/plans':{PlanAccessError},
    '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,params)=>{calls.push({name,params});return response;}})},
  });
  response={data:[{status:'created',order_id:uuid,display_number:1,version:0,subtotal:'0.30',discount_amount:0,shipping_amount:0,total_amount:'0.30'}],error:null};
  let r=await actions.saveOrderAction(input()); assert.equal(r.ok,true);assert.equal(calls[0].name,'create_order');assert.equal(calls[0].params.p_attempt_id,uuid);assert.equal(calls[0].params.p_items.length,1);assert.ok(paths.includes('/admin/orders'));
  await actions.saveOrderAction(input()); assert.equal(calls.at(-1).params.p_attempt_id,calls[0].params.p_attempt_id); assert.equal(JSON.stringify(calls.at(-1).params),JSON.stringify(calls[0].params));
  const invalidCount=calls.length; r=await actions.saveOrderAction({...input(),items:[]}); assert.equal(r.code,'invalid_input'); assert.equal(calls.length,invalidCount);
  response={data:null,error:{code:'40001',message:'version_conflict'}};
  r=await actions.saveOrderAction({...input(),orderId:uuid,expectedVersion:2});assert.equal(r.code,'version_conflict');assert.equal(calls.at(-1).params.p_expected_version,2);
  for(const message of ['active_reservation_edit_unsupported','plan_limit_reached','idempotency_conflict','product_unavailable']) {response={data:null,error:{code:({active_reservation_edit_unsupported:'P0001',plan_limit_reached:'42501',idempotency_conflict:'23505',product_unavailable:'P0001'})[message],message}};r=await actions.saveOrderAction(input());assert.equal(r.code,message);}
  response={data:null,error:{code:'40001',message:'unrecognized'}};r=await actions.saveOrderAction(input());assert.equal(r.code,'technical');assert.equal(r.uncertain,true);
  const transition={attemptId:uuid,orderId:uuid,expectedVersion:4,targetStatus:'orcado',reason:null};
  response={data:[{status:'transitioned',order_id:uuid,operational_status:'orcado',version:5,event_id:uuid}],error:null};
  r=await actions.transitionOrderAction(transition);assert.equal(r.ok,true);assert.equal(calls.at(-1).name,'transition_order');assert.equal(calls.at(-1).params.p_expected_version,4);assert.equal(calls.at(-1).params.p_attempt_id,uuid);
  const command=JSON.stringify(calls.at(-1));await actions.transitionOrderAction(transition);assert.equal(JSON.stringify(calls.at(-1)),command);
  for(const message of ['invalid_order_transition','version_conflict','idempotency_conflict','order_unavailable']){response={data:null,error:{code:({invalid_order_transition:'P0001',version_conflict:'40001',idempotency_conflict:'23505',order_unavailable:'P0002'})[message],message}};r=await actions.transitionOrderAction(transition);assert.equal(r.code,message);assert.ok(!r.uncertain);}
  response={data:null,error:{message:'network'}};r=await actions.transitionOrderAction(transition);assert.equal(r.uncertain,true);
  const before=calls.length;for(const targetStatus of ['entregue','cancelado','bogus']){r=await actions.transitionOrderAction({...transition,targetStatus});assert.equal(r.code,'invalid_input');}assert.equal(calls.length,before);
  const count=calls.length;denied=true;r=await actions.saveOrderAction(input());assert.equal(r.ok,false);assert.equal(calls.length,count);
  r=await actions.transitionOrderAction(transition);assert.equal(r.code,'unauthorized');assert.equal(calls.length,count);
});
// Integrated per-order coordinator and persistence tests now live in operations.test.cjs.
test('FLEX matrix excludes special operations and preserves mandatory reasons',()=>{
  const m=loadTransitions();
  assert.equal(m.dropDestination('em_conversao','orcado',false),'orcado');
  for(const target of [undefined,null,'outside','em_conversao']) assert.equal(m.dropDestination('em_conversao',target,false),null);
  assert.equal(m.dropDestination('em_conversao','orcado',true),null);
  assert.equal(m.canTransition('em_conversao','orcado'),true);
  assert.equal(m.needsReason('orcado','modelando'),false);
  assert.equal(m.needsReason('pago','modelando'),false);
  assert.equal(m.destinations('cancelado').length,0);assert.equal(m.destinations('entregue').length,0);
  for(const from of Object.keys(m.TRANSITIONS)){
    assert.equal(m.canTransition(from,from),false);
    assert.equal(m.canTransition(from,'entregue'),false);assert.equal(m.canTransition(from,'cancelado'),false);
  }
});

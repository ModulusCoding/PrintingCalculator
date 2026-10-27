"use server";
import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { PlanAccessError } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import * as s from "./operation-schema";
import { knownOrderError, orderErrorMessage } from "./operation-errors";
import { transitionOrderAction } from "./write-actions";

type CommandInput = {attemptId:string;orderId:string;expectedVersion:number};
async function command<I extends CommandInput, O extends {order_id:string;version:number}>(input:unknown, schema:z.ZodType<I>, output:z.ZodType<O>, rpc:string, params:(v:I)=>Record<string,unknown>, permission:"sales.write"|"sales.delete", physical:boolean, verify?:(v:I,r:O)=>boolean):Promise<s.OperationResult> {
  let dispatched=false;
  try {
    await requireBusinessContext(permission);
    const parsed=schema.safeParse(input);
    if(!parsed.success)return {ok:false,code:"invalid_input",dispatched:false,message:orderErrorMessage("invalid_input")};
    const v=parsed.data;
    const client=await createClient();
    dispatched=true;
    const {data,error}=await client.rpc(rpc,params(v));
    if(error){
      if(knownOrderError(error))return {ok:false,code:error.message,message:orderErrorMessage(error.message)};
      return {ok:false,code:"technical",uncertain:true,message:"Resultado não confirmado. Consulte os dados ou retransmita exatamente a mesma tentativa."};
    }
    const result=output.array().length(1).parse(data)[0];
    if(result.order_id!==v.orderId || result.version!==v.expectedVersion+1 || (verify && !verify(v,result)))throw new Error("Invalid command response");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${v.orderId}/edit`);
    if(physical){revalidatePath("/estoque/produtos");revalidatePath("/estoque/produtos/[id]","page");}
    return {ok:true,data:result};
  }catch(error){
    unstable_rethrow(error);
    if(error instanceof AuthContextError)return {ok:false,code:"unauthorized",dispatched:false,message:orderErrorMessage("unauthorized")};
    if(error instanceof PlanAccessError)return {ok:false,code:error.code,dispatched,message:orderErrorMessage(error.code)};
    return {ok:false,code:"technical",dispatched,uncertain:dispatched,message:dispatched?"Resultado não confirmado. Preserve a tentativa e consulte os dados.":"Não foi possível iniciar a operação."};
  }
}
const base=(v:CommandInput)=>({p_attempt_id:v.attemptId,p_order_id:v.orderId,p_expected_version:v.expectedVersion});
export async function allocateOrderStockAction(input:unknown){return command(input,s.allocateInputSchema,s.allocateResultSchema,"allocate_order_stock",v=>({...base(v),p_order_item_id:v.orderItemId}),"sales.write",true,(v,r)=>r.order_item_id===v.orderItemId);}
export async function deliverOrderAction(input:unknown){return command(input,s.deliverInputSchema,s.deliverResultSchema,"deliver_order",base,"sales.write",true);}
export async function cancelOrderAction(input:unknown){return command(input,s.cancelInputSchema,s.cancelResultSchema,"cancel_order",v=>({...base(v),p_reason:v.reason}),"sales.delete",true);}
export async function reopenOrderAction(input:unknown){return command(input,s.reopenInputSchema,s.reopenResultSchema,"reopen_order",v=>({...base(v),p_reason:v.reason}),"sales.write",true);}
export async function undoOrderDeliveryAction(input:unknown){return command(input,s.undoInputSchema,s.undoResultSchema,"undo_order_delivery",v=>({...base(v),p_delivery_event_id:v.deliveryEventId,p_target_status:v.targetStatus,p_reason:v.reason,p_classification:v.classification}),"sales.write",true,(v,r)=>r.source_delivery_event_id===v.deliveryEventId && r.operational_status===v.targetStatus && (r.physical_effect==="no_physical_movement" || r.physical_effect===(v.classification==="incorrect_record"?"compensated":"preserved")));}
export async function recordOrderPaymentAction(input:unknown){return command(input,s.recordPaymentInputSchema,s.recordPaymentResultSchema,"record_order_payment",v=>({...base(v),p_amount:v.amount,p_method:v.method,p_effective_at:v.effectiveAt,p_note:v.note}),"sales.write",false);}
export async function reverseOrderPaymentAction(input:unknown){return command(input,s.reversePaymentInputSchema,s.reversePaymentResultSchema,"reverse_order_payment",v=>({...base(v),p_payment_id:v.paymentId,p_effective_at:v.effectiveAt,p_reason:v.reason}),"sales.delete",false);}

// Identity is checked again at the authenticated boundary, including explicit retry.
export async function executeOrderOperationAction(envelope:unknown):Promise<s.OperationResult>{
  const parsed=s.envelopeSchema.safeParse(envelope);
  if(!parsed.success)return {ok:false,code:"invalid_input",dispatched:false,message:orderErrorMessage("invalid_input")};
  try{
    const context=await requireBusinessContext(parsed.data.kind==="cancel" || parsed.data.kind==="reverse"?"sales.delete":"sales.write");
    if(context.userId!==parsed.data.identity.userId || context.enterpriseId!==parsed.data.identity.enterpriseId)return {ok:false,code:"identity_changed",dispatched:false,message:"A identidade ou empresa mudou. Retome somente na sessão original."};
  }catch(error){unstable_rethrow(error);return {ok:false,code:"unauthorized",dispatched:false,message:orderErrorMessage("unauthorized")};}
  const actions={transition:transitionOrderAction,allocate:allocateOrderStockAction,deliver:deliverOrderAction,undo:undoOrderDeliveryAction,cancel:cancelOrderAction,reopen:reopenOrderAction,record:recordOrderPaymentAction,reverse:reverseOrderPaymentAction};
  return actions[parsed.data.kind](parsed.data.input);
}

async function read<T>(rpc:string,params:Record<string,unknown>,schema:z.ZodType<T>):Promise<{ok:true;data:T}|{ok:false;message:string}>{
  try{
    await requireBusinessContext("sales.read");
    const client=await createClient();const {data,error}=await client.rpc(rpc,params);
    if(error)return {ok:false,message:knownOrderError(error)?orderErrorMessage(error.message):"Não foi possível consultar os dados autoritativos."};
    return {ok:true,data:schema.parse(data)};
  }catch(error){unstable_rethrow(error);return {ok:false,message:"Leitura indisponível ou resposta incompatível. Atualize ou solicite revisão."};}
}
export async function getOrderPhysicalStateAction(orderId:unknown){
  const id=z.string().uuid().safeParse(orderId);if(!id.success)return {ok:false as const,message:"Pedido inválido."};
  const result=await read("get_order_physical_state",{p_order_id:id.data},s.physicalRowSchema.array());
  if(result.ok && result.data.some(r=>r.order_id!==id.data))return {ok:false as const,message:"Snapshot físico incompatível."};
  return result;
}
export async function getOrderFinancialSummaryAction(orderId:unknown){
  const id=z.string().uuid().safeParse(orderId);if(!id.success)return {ok:false as const,message:"Pedido inválido."};
  const result=await read("get_order_financial_summary",{p_order_id:id.data},s.financialSummarySchema.array().length(1));
  if(result.ok && result.data[0].order_id!==id.data)return {ok:false as const,message:"Resumo incompatível."};
  return result;
}
export async function getOrderPaymentHistoryAction(input:unknown){
  const p=s.historyInputSchema.safeParse(input);if(!p.success)return {ok:false as const,message:"Cursor ou pedido inválido."};
  const v=p.data;
  const result=await read("get_order_payment_history",{p_order_id:v.orderId,p_limit:v.limit,p_before_recorded_at:v.beforeRecordedAt,p_before_payment_id:v.beforePaymentId},s.paymentRowSchema.array().max(v.limit));
  if(result.ok && result.data.some(r=>r.order_id!==v.orderId))return {ok:false as const,message:"Histórico incompatível."};
  return result;
}

import { z } from "zod";

export const commonStatus = z.enum(["em_conversao", "orcado", "pago", "modelando", "imprimindo"]);
export const operationalStatus = z.enum([...commonStatus.options, "entregue", "cancelado"]);
export const safeInteger = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
export const money = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)]).transform(String);
// PostgreSQL btrim removes ASCII spaces, and length counts Unicode code points.
export const reasonSchema = z.string().transform(s => s.replace(/^ +| +$/g, "")).refine(s => Array.from(s).length >= 1 && Array.from(s).length <= 1000, "Informe de 1 a 1.000 caracteres.");
const base = {attemptId:z.string().uuid(), orderId:z.string().uuid(), expectedVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1)};
export const allocateInputSchema = z.object({...base, orderItemId:z.string().uuid()}).strict();
export const deliverInputSchema = z.object(base).strict();
export const cancelInputSchema = z.object({...base, reason:reasonSchema}).strict();
export const reopenInputSchema = z.object({...base, reason:reasonSchema}).strict();
export const undoInputSchema = z.object({...base, deliveryEventId:z.string().uuid(), targetStatus:commonStatus, reason:reasonSchema, classification:z.enum(["incorrect_record", "actual_delivery"])}).strict();
export const paymentMethod = z.enum(["pix", "card", "cash", "bank_transfer", "other"]);
const timestamp = z.string().datetime({offset:true});
export const recordPaymentInputSchema = z.object({...base, amount:z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).refine(s => Number(s)>=0.01), method:paymentMethod, effectiveAt:timestamp, note:z.string().refine(s=>Array.from(s).length<=1000).nullable()}).strict();
export const reversePaymentInputSchema = z.object({...base, paymentId:z.string().uuid(), effectiveAt:timestamp, reason:reasonSchema}).strict();
export function validFinancialSnapshot(v:{total_amount:string;total_received:string;total_refunded:string;net_received:string;pending_amount:string;financial_status:string;cancelled_unreversed_amount:string}) {
  const cents=(s:string)=>{const [whole,fraction=""]=s.split(".");return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));};
  try {
    const total=cents(v.total_amount),received=cents(v.total_received),refunded=cents(v.total_refunded),net=cents(v.net_received),pending=cents(v.pending_amount),cancelled=cents(v.cancelled_unreversed_amount);
    return net===received-refunded && net<=total && pending===total-net && (cancelled===BigInt(0) || cancelled===net) && v.financial_status===(net===total?"pago":net===BigInt(0)?"pendente":"parcial");
  }catch{return false;}
}
export const financialFields = {total_amount:money,total_received:money,total_refunded:money,net_received:money,pending_amount:money,financial_status:z.enum(["pago","parcial","pendente"]),cancelled_unreversed_amount:money};
const resultBase = {order_id:z.string().uuid(), version:safeInteger};
const eventBase = {...resultBase,event_id:z.string().uuid()};
export const allocateResultSchema = z.object({...resultBase,status:z.literal("allocated"),order_item_id:z.string().uuid(),reservation_id:z.string().uuid()}).strict();
export const deliverResultSchema = z.object({...eventBase,status:z.literal("delivered"),operational_status:z.literal("entregue")}).strict();
export const cancelResultSchema = z.object({...eventBase,status:z.literal("cancelled"),operational_status:z.literal("cancelado")}).strict();
export const reopenResultSchema = z.object({...eventBase,status:z.literal("reopened"),operational_status:z.literal("em_conversao")}).strict();
export const undoResultSchema = z.object({...eventBase,status:z.literal("delivery_undone"),operational_status:commonStatus,source_delivery_event_id:z.string().uuid(),physical_effect:z.enum(["compensated","preserved","no_physical_movement"])}).strict();
export const recordPaymentResultSchema = z.object({...eventBase,...financialFields,status:z.literal("payment_received"),payment_id:z.string().uuid()}).strict().refine(validFinancialSnapshot);
export const reversePaymentResultSchema = z.object({...eventBase,...financialFields,status:z.literal("payment_refunded"),payment_id:z.string().uuid()}).strict().refine(validFinancialSnapshot);
export const physicalRowSchema = z.object({order_id:z.string().uuid(),order_version:safeInteger,order_item_id:z.string().uuid(),product_id:z.string().uuid().nullable(),quantity:safeInteger.refine(n=>n>0 && n<=1000000000),fulfillment_mode:z.enum(["stock","make_to_order","untracked"]),physical_state:z.enum(["untracked","allocated","valid_debit","compensated","allocation_required","reconciliation_required"]),requires_allocation:z.boolean(),active_reservation_id:z.string().uuid().nullable(),settlement_id:z.string().uuid().nullable(),source_delivery_event_id:z.string().uuid().nullable(),current_delivery_event_id:z.string().uuid().nullable(),can_undo_as_incorrect:z.boolean()}).strict();
export type PhysicalRow = z.infer<typeof physicalRowSchema>;
export const financialSummarySchema = z.object({...resultBase,...financialFields,operational_status:operationalStatus}).strict().refine(validFinancialSnapshot);
export const paymentRowSchema = z.object({payment_id:z.string().uuid(),order_id:z.string().uuid(),actor_id:z.string().uuid(),entry_type:z.enum(["receipt","refund"]),amount:money,method:paymentMethod,effective_at:timestamp,recorded_at:timestamp,reverses_payment_id:z.string().uuid().nullable(),note:z.string().nullable()}).strict();
export type PaymentRow = z.infer<typeof paymentRowSchema>;
export const historyInputSchema = z.object({orderId:z.string().uuid(),limit:z.number().int().min(1).max(100).default(20),beforeRecordedAt:timestamp.nullable().default(null),beforePaymentId:z.string().uuid().nullable().default(null)}).strict().refine(v=>(v.beforeRecordedAt===null)===(v.beforePaymentId===null));
export const operationKindSchema = z.enum(["transition","allocate","deliver","undo","cancel","reopen","record","reverse"]);
export type OperationKind = z.infer<typeof operationKindSchema>;
export const identitySchema = z.object({userId:z.string().uuid(),enterpriseId:z.string().uuid()}).strict();
export type OrderIdentity = z.infer<typeof identitySchema>;
export const envelopeSchema = z.object({identity:identitySchema,kind:operationKindSchema,input:z.unknown()}).strict();
export type OperationResult = {ok:true;data:{order_id:string;version:number}} | {ok:false;code:string;message:string;uncertain?:boolean;dispatched?:boolean};

export function coherentPhysical(rows:PhysicalRow[], order:{id:string;version:number;operationalStatus:string}, items:{id:string;productId:string|null;quantity:number;fulfillmentMode:string}[]) {
  return rows.length>0 && rows.length===items.length && new Set(rows.map(r=>r.order_item_id)).size===items.length && rows.every(r=>{
    const item=items.find(i=>i.id===r.order_item_id);
    return item && r.order_id===order.id && r.order_version===order.version && r.product_id===item.productId && r.quantity===item.quantity && r.fulfillment_mode===item.fulfillmentMode &&
      r.requires_allocation===["allocation_required","compensated"].includes(r.physical_state) &&
      (r.physical_state!=="allocated" || (r.active_reservation_id!==null && r.settlement_id===null && r.fulfillment_mode==="stock")) &&
      (r.physical_state!=="valid_debit" || (r.settlement_id!==null && r.source_delivery_event_id!==null && r.active_reservation_id===null && r.fulfillment_mode==="stock")) &&
      (r.physical_state!=="untracked" || (r.fulfillment_mode==="untracked" && r.settlement_id===null && r.active_reservation_id===null)) &&
      (order.operationalStatus==="entregue" ? !!r.current_delivery_event_id && r.current_delivery_event_id===rows[0].current_delivery_event_id : r.current_delivery_event_id===null);
  });
}

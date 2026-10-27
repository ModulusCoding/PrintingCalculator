"use server";

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { PlanAccessError } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { orderInputSchema } from "./write-schema";
import { transitionInputSchema } from "./transitions";
import { knownOrderError } from "./operation-errors";

const messages: Record<string, string> = {
  invalid_order_transition: "Esta transição não é permitida. Atualize os dados para conferir o estado atual.",
  unauthorized: "Sessão inválida ou sem permissão para salvar pedidos.",
  selection_required: "Selecione um plano para continuar.",
  plan_feature_unavailable: "Seu plano não permite esta operação.",
  plan_limit_reached: "O Aprendiz permite três pedidos históricos por empresa, incluindo cancelados.",
  product_unavailable: "Um produto está indisponível, arquivado ou fora da janela do plano. Revise os itens.",
  invalid_input: "Revise os campos e os valores dos itens.",
  order_unavailable: "Pedido indisponível ou não encontrado.",
  version_conflict: "O pedido foi alterado por outra operação. Recarregue os dados antes de editar novamente.",
  order_not_editable: "Pedidos entregues ou cancelados não podem ser editados.",
  active_reservation_edit_unsupported: "Este pedido possui reserva ativa e não permite edição comercial.",
  reservation_history_edit_unsupported: "Este pedido possui histórico de reservas e não permite edição comercial.",
  physical_order_edit_unsupported: "Pedidos com atendimento físico não permitem edição comercial nesta etapa.",
  stock_integration_unavailable: "O modo de atendimento não é permitido nesta operação ou plano.",
  insufficient_stock: "Saldo insuficiente. Atualize os dados do pedido.",
  reservation_balance_inconsistent: "Não foi possível confirmar o estoque. Solicite revisão antes de tentar novamente.",
  total_below_net_received: "O total não pode ser menor que o valor líquido já recebido.",
  payment_balance_inconsistent: "O financeiro precisa de revisão antes de salvar este pedido.",
  idempotency_conflict: "Esta tentativa já foi utilizada com outros dados. Recarregue e confira o pedido.",
  receipt_result_unavailable: "Não foi possível recuperar o resultado da tentativa. Confira a listagem antes de iniciar outra operação.",
  version_limit_exceeded: "O pedido atingiu o limite de versões. Contate o suporte.",
};
const numeric = z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(String);
const resultSchema = z.object({ status: z.enum(["created", "updated"]), order_id: z.string().uuid(),
  display_number: numeric, version: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  subtotal: numeric, discount_amount: numeric, shipping_amount: numeric, total_amount: numeric });
export type SaveOrderResult = { ok: true; data: z.infer<typeof resultSchema> } |
  { ok: false; code: string; message: string; uncertain?: boolean };

const transitionResultSchema = z.object({
  status: z.literal("transitioned"), order_id: z.string().uuid(),
  operational_status: transitionInputSchema.shape.targetStatus,
  version: z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
  event_id: z.string().uuid(),
}).strict();
export type TransitionResult = {ok:true; data:z.infer<typeof transitionResultSchema>} |
  {ok:false; code:string; message:string; uncertain?:boolean; dispatched?:boolean};

export async function transitionOrderAction(input: unknown): Promise<TransitionResult> {
  let dispatched = false;
  try {
    await requireBusinessContext("sales.write");
    const parsed = transitionInputSchema.safeParse(input);
    if (!parsed.success) return {ok:false, code:"invalid_input", dispatched:false, message:"Destino, versão ou motivo inválido (máximo de 1.000 caracteres)."};
    const r = parsed.data;
    const client = await createClient();
    dispatched = true;
    // Never infer source state from client input. C.3 checks the matrix and reason
    // under the order lock; receipt replay must remain possible with the old version.
    const {data,error} = await client.rpc("transition_order", {
      p_attempt_id:r.attemptId, p_order_id:r.orderId, p_expected_version:r.expectedVersion,
      p_target_status:r.targetStatus, p_reason:r.reason,
    });
    if (error) {
      if (knownOrderError(error) && messages[error.message]) return {ok:false, code:error.message,
        message:error.message === "invalid_input" ? "A transição exige um motivo válido ou contém parâmetros inválidos." : messages[error.message]};
      console.error("orders transition RPC failed", {code:error.code});
      return {ok:false, code:"technical", uncertain:true, message:"Resultado não confirmado. Confira os dados ou retransmita a mesma tentativa."};
    }
    const result = transitionResultSchema.array().length(1).parse(data)[0];
    if (result.order_id !== r.orderId || result.operational_status !== r.targetStatus || result.version !== r.expectedVersion + 1) throw new Error("Invalid transition result");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${r.orderId}/edit`);
    return {ok:true,data:result};
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthContextError) {
      const authMessages: Record<string,string> = {
        AUTH_UNAUTHENTICATED:"Sua sessão expirou. Entre novamente.",
        AUTH_PERMISSION_DENIED:"Você não possui permissão para movimentar pedidos.",
        AUTH_ACCESS_BLOCKED:"A conta ou empresa não está disponível para esta operação.",
      };
      return {ok:false,dispatched:false,code:authMessages[error.code] ? "unauthorized" : "technical",
        message:authMessages[error.code] || "Não foi possível validar sua sessão. Tente novamente."};
    }
    if (error instanceof PlanAccessError) return {ok:false, dispatched, code:error.code, message:messages[error.code] || "Regularize o plano e a equipe antes de continuar."};
    console.error("orders transition failed", {dispatched});
    return {ok:false,code:"technical",dispatched,uncertain:dispatched,message:dispatched
      ? "Resultado não confirmado. Atualize os dados ou retransmita a mesma tentativa."
      : "Não foi possível iniciar a transição. Tente novamente."};
  }
}

export async function saveOrderAction(input: unknown): Promise<SaveOrderResult> {
  let dispatched = false;
  try {
    await requireBusinessContext("sales.write");
    const parsed = orderInputSchema.safeParse(input);
    if (!parsed.success) return {ok:false, code:"invalid_input", message:"Revise os campos: " + parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).slice(0,3).join("; ")};
    const r = parsed.data;
    if (r.orderId && r.items.some(i => i.fulfillment_mode !== "untracked")) return {ok:false, code:"physical_order_edit_unsupported", message:messages.physical_order_edit_unsupported};
    const client = await createClient();
    const params = {
      p_attempt_id:r.attemptId, p_buyer_name:r.buyerName, p_buyer_phone:r.buyerPhone,
      p_buyer_email:r.buyerEmail, p_buyer_address:r.buyerAddress, p_notes:r.notes,
      p_items:r.items, p_discount_type:r.discountType, p_discount_input:r.discountInput, p_shipping_amount:r.shippingAmount,
      ...(r.orderId ? {p_order_id:r.orderId, p_expected_version:r.expectedVersion} : {}),
    };
    dispatched = true;
    const {data, error} = await client.rpc(r.orderId ? "update_order" : "create_order", params);
    if (error) {
      if (knownOrderError(error) && messages[error.message]) return {ok:false, code:error.message, message:messages[error.message]};
      console.error("orders write RPC failed", {code:error.code});
      return {ok:false, code:"technical", uncertain:true, message:"Resultado não confirmado. Tente novamente sem alterar os dados para reutilizar a mesma tentativa, ou confira a listagem."};
    }
    const result = resultSchema.array().length(1).parse(data)[0];
    if (result.status !== (r.orderId ? "updated" : "created") || (r.orderId && result.order_id !== r.orderId)) throw new Error("Unexpected write result");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${result.order_id}/edit`);
    if (r.items.some(i => i.fulfillment_mode !== "untracked")) {
      revalidatePath("/estoque/produtos");
      revalidatePath("/estoque/produtos/[id]", "page");
    }
    return {ok:true, data:result};
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthContextError) return {ok:false, code:"unauthorized", message:"Sessão inválida ou acesso indisponível. Entre novamente e confira sua permissão."};
    if (error instanceof PlanAccessError) return {ok:false, code:error.code, message:messages[error.code] || "O plano ou a equipe precisa de regularização."};
    console.error("orders save failed", {dispatched});
    return {ok:false, code:"technical", uncertain:dispatched, message:dispatched
      ? "Resultado não confirmado. Repita sem alterar os dados para reutilizar a tentativa ou confira a listagem."
      : "Não foi possível iniciar o salvamento. Tente novamente."};
  }
}

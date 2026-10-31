import "server-only";

import { createClient } from "@/lib/supabase/server";
import { orderListRowSchema, orderDetailRowSchema, orderItemRowSchema } from "./read-schema";

type Numeric = number | string;
type FinancialRow = {
  total_received: Numeric; total_refunded: Numeric; net_received: Numeric;
  pending_amount: Numeric; financial_status: string; cancelled_unreversed_amount: Numeric;
};
type OrderRow = FinancialRow & {
  id: string; display_number: Numeric; operational_status: string; buyer_name: string;
  buyer_phone: string | null; buyer_email: string | null; currency: string;
  subtotal: Numeric; discount_amount: Numeric; shipping_amount: Numeric; total_amount: Numeric;
  items_count: Numeric; created_at: string; updated_at: string; archived_at: string | null;
  version: Numeric; total_count: Numeric;
};
type DetailRow = Omit<OrderRow, "items_count" | "total_count"> & {
  enterprise_id: string; buyer_address: string | null; discount_type: string;
  discount_input: Numeric; discount_base: Numeric; notes: string | null;
  created_by: string; delivered_at: string | null; cancelled_at: string | null;
};
type ItemRow = {
  id: string; order_id: string; product_id: string | null; origin: string; name: string;
  description: string | null; quantity: Numeric; unit_price: Numeric; line_subtotal: Numeric;
  fulfillment_mode: string; line_number: number;
};

// Do not turn missing/null financial values into zero via Number(null).
function assertFinancialRows(rows: FinancialRow[]) {
  for (const row of rows) {
    if (!row.financial_status || [row.total_received, row.total_refunded, row.net_received,
      row.pending_amount, row.cancelled_unreversed_amount].some(value =>
      value == null || value === "" || !Number.isFinite(Number(value)))) {
      throw new Error("Resumo financeiro inválido.");
    }
  }
}

export type OrdersResult = Awaited<ReturnType<typeof listOrders>>;
export type Order = OrdersResult["orders"][number];
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetails>>["order"]>;
export type OrderItem = Awaited<ReturnType<typeof getOrderDetails>>["items"][number];

export async function listOrders(params: { search?: string; status?: string; page?: string; limit?: string }) {
  const supabase = await createClient();
  const search = params.search?.trim() || null;
  const status = params.status?.trim() || null;
  const limit = Math.min(Math.max(parseInt(params.limit || "20", 10) || 20, 1), 100);
  // PostgREST's SQL integer offset must stay in range, even for a malformed URL.
  const page = Math.min(Math.max(parseInt(params.page || "1", 10) || 1, 1), Math.floor(2147483647 / limit) + 1);
  const offset = (page - 1) * limit;
  const failure = (message: string) => ({ orders: [] as never[], total: 0, search: search || "",
    status: status || "", page, limit, error: message });

  const { data, error } = await supabase.rpc("list_orders", {
    p_search: search,
    p_operational_status: status,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error("list_orders error:", error);
    return failure("Não foi possível carregar os pedidos. Tente novamente.");
  }

  const parsed = orderListRowSchema.array().safeParse(data);
  if (!parsed.success) return failure("Resposta de pedidos incompatível. Atualize ou solicite revisão.");
  const rows = parsed.data as OrderRow[];
  let total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  // Keep the existing set-returning contract: an empty page carries no count.
  // Reuse the same authorized reader rather than introducing a count-only RPC.
  if (rows.length === 0 && offset > 0) {
    const probe = await supabase.rpc("list_orders", {
      p_search: search, p_operational_status: status, p_limit: 1, p_offset: 0,
    });
    if (probe.error) {
      console.error("list_orders count fallback error:", probe.error);
      return failure("Não foi possível consultar a contagem dos pedidos. Tente novamente.");
    }
    const checked = orderListRowSchema.array().safeParse(probe.data);
    if (!checked.success) return failure("Resposta de contagem incompatível.");
    const firstPage = checked.data as OrderRow[];
    total = firstPage.length ? Number(firstPage[0].total_count) : 0;
    try { assertFinancialRows(firstPage); } catch { return failure("Resumo financeiro inválido."); }
  }
  try { assertFinancialRows(rows); } catch { return failure("Resumo financeiro inválido."); }

  return {
    orders: rows.map(r => ({
      id: r.id,
      displayNumber: Number(r.display_number),
      operationalStatus: r.operational_status,
      buyerName: r.buyer_name,
      buyerPhone: r.buyer_phone,
      buyerEmail: r.buyer_email,
      currency: r.currency,
      subtotal: Number(r.subtotal),
      discountAmount: Number(r.discount_amount),
      shippingAmount: Number(r.shipping_amount),
      totalAmount: Number(r.total_amount),
      itemsCount: Number(r.items_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at,
      version: Number(r.version),
      totalReceived: Number(r.total_received),
      totalRefunded: Number(r.total_refunded),
      netReceived: Number(r.net_received),
      pendingAmount: Number(r.pending_amount),
      financialStatus: r.financial_status,
      cancelledUnreversedAmount: Number(r.cancelled_unreversed_amount),
    })),
    total,
    search: search || "",
    status: status || "",
    page,
    limit,
    error: null,
  };
}

export async function getOrderDetails(orderId: string) {
  const supabase = await createClient();
  const [{ data: orderData, error: orderError }, { data: itemsData, error: itemsError }] = await Promise.all([
    supabase.rpc("get_order_details", { p_order_id: orderId }),
    supabase.rpc("get_order_items", { p_order_id: orderId }),
  ]);

  if (orderError) {
    console.error("get_order_details error:", orderError);
    return { order: null, items: [], error: orderError.message === "order_unavailable"
      ? "Pedido indisponível ou não encontrado."
      : "Não foi possível carregar os detalhes do pedido. Tente novamente." };
  }
  if (itemsError) {
    console.error("get_order_items error:", itemsError);
    return { order: null, items: [], error: itemsError.message === "order_unavailable"
      ? "Pedido indisponível ou não encontrado."
      : "Não foi possível carregar os itens do pedido. Tente novamente." };
  }

  const detailParsed = orderDetailRowSchema.array().length(1).safeParse(orderData);
  const itemsParsed = orderItemRowSchema.array().safeParse(itemsData);
  if (!detailParsed.success || !itemsParsed.success || detailParsed.data[0].id !== orderId || itemsParsed.data.some(i=>i.order_id!==orderId) || new Set(itemsParsed.data.map(i=>i.id)).size!==itemsParsed.data.length) {
    return {order:null,items:[],error:"Detalhes ou itens incompatíveis. Atualize ou solicite revisão."};
  }
  const rows = detailParsed.data as DetailRow[];
  if (rows.length !== 1) {
    return { order: null, items: [], error: "Resposta de detalhes inválida. Tente novamente." };
  }
  try { assertFinancialRows(rows); } catch {
    return { order: null, items: [], error: "Resumo financeiro inválido." };
  }

  const r = rows[0];
  const order = {
    id: r.id,
    enterpriseId: r.enterprise_id,
    displayNumber: Number(r.display_number),
    operationalStatus: r.operational_status,
    buyerName: r.buyer_name,
    buyerPhone: r.buyer_phone,
    buyerEmail: r.buyer_email,
    buyerAddress: r.buyer_address,
    currency: r.currency,
    subtotal: Number(r.subtotal),
    discountType: r.discount_type,
    discountInput: Number(r.discount_input),
    discountBase: Number(r.discount_base),
    discountAmount: Number(r.discount_amount),
    shippingAmount: Number(r.shipping_amount),
    totalAmount: Number(r.total_amount),
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at,
    cancelledAt: r.cancelled_at,
    archivedAt: r.archived_at,
    version: Number(r.version),
    totalReceived: Number(r.total_received),
    totalRefunded: Number(r.total_refunded),
    netReceived: Number(r.net_received),
    pendingAmount: Number(r.pending_amount),
    financialStatus: r.financial_status,
    cancelledUnreversedAmount: Number(r.cancelled_unreversed_amount),
  };

  const items = (itemsParsed.data as ItemRow[]).map(i => ({
    id: i.id,
    orderId: i.order_id,
    productId: i.product_id,
    origin: i.origin,
    name: i.name,
    description: i.description,
    quantity: Number(i.quantity),
    unitPrice: Number(i.unit_price),
    lineSubtotal: Number(i.line_subtotal),
    fulfillmentMode: i.fulfillment_mode,
    lineNumber: Number(i.line_number),
  }));

  return { order, items, error: null };
}

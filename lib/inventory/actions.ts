"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { movementInputSchema, parseUnits, fieldErrors, uuid, safeInteger } from "./validation";
import { productInventorySchema, productInventoryDetailSchema, unavailableProductInventoryDetailSchema, movementRecordSchema, countSchema } from "./schemas";
import { parseListQuery } from "./navigation";

export type MutationResult = {
  status: string;
  movement_id?: string | null;
  product_id?: string;
  balance?: number;
  version?: number;
  fieldErrors?: Record<string, string[]>;
};

function failure(e: unknown): string {
  if (e instanceof AuthContextError) {
    if (e.code === "AUTH_UNAUTHENTICATED") return "session_expired";
    if (e.code === "AUTH_ACCESS_BLOCKED") return "denied";
    if (e.code === "AUTH_TECHNICAL_FAILURE" || e.code === "AUTH_CONTEXT_INVALID_RESPONSE") return "technical";
    return "permission_denied";
  }
  return "technical";
}

const known = new Set([
  "unauthorized", "product_unavailable", "version_conflict",
  "insufficient_stock", "balance_limit_exceeded", "version_limit_exceeded",
  "idempotency_conflict", "invalid_input"
]);

const mutationResultSchema = z.object({
  status: z.enum(["created", "idempotent", "no_change"]),
  movement_id: uuid.nullable(),
  product_id: uuid,
  balance: z.number().int().min(0).max(1_000_000_000),
  version: safeInteger,
}).strict().refine(r => (r.status === "no_change") === (r.movement_id === null));

export async function moveProductInventory(payload: unknown): Promise<MutationResult> {
  const parsed = movementInputSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "invalid_input", fieldErrors: fieldErrors(parsed.error) };
  }
  const d = parsed.data;
  let dispatched = false;
  try {
    await requireBusinessContext("inventory.write");
    const client = await createClient();

    let pQty: number | null = null;
    let pCnt: number | null = null;

    if (d.movementType === "adjustment") {
      pCnt = parseUnits(d.countedBalance, true);
      if (pCnt === null) return { status: "invalid_input", fieldErrors: { countedBalance: ["Informe um saldo contado válido entre 0 e 1.000.000.000."] } };
    } else {
      pQty = parseUnits(d.quantity, false);
      if (pQty === null) return { status: "invalid_input", fieldErrors: { quantity: ["Informe uma quantidade válida entre 1 e 1.000.000.000."] } };
    }

    dispatched = true;
    const { data, error } = await client.rpc("move_product_inventory", {
      p_attempt_id: d.attemptId,
      p_product_id: d.productId,
      p_expected_version: d.expectedVersion,
      p_movement_type: d.movementType,
      p_quantity: pQty,
      p_counted_balance: pCnt,
      p_reason: d.reason.trim(),
    });

    if (error) {
      const code = error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");
      if (known.has(code)) return { status: code === "unauthorized" ? "permission_denied" : code };
      return { status: "uncertain" };
    }

    const resParsed = z.array(mutationResultSchema).length(1).safeParse(data);
    if (!resParsed.success) return { status: "uncertain" };
    const r = resParsed.data[0];

    if (r.product_id !== d.productId) return { status: "uncertain" };
    if (r.status !== "idempotent" && r.status !== "no_change" && r.version !== d.expectedVersion + 1) return { status: "uncertain" };

    try {
      revalidatePath("/estoque/produtos", "layout");
    } catch {}

    return {
      status: r.status,
      movement_id: r.movement_id,
      product_id: r.product_id,
      balance: r.balance,
      version: r.version,
    };
  } catch (e) {
    return { status: dispatched ? "uncertain" : failure(e) };
  }
}

export async function listProductInventory(params: Record<string, string | undefined> = {}) {
  const query = parseListQuery(`/estoque/produtos?${new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}`);
  const page = query.page;
  const search = query.search;
  const balanceFilter = query.balanceFilter;
  const productStatus = query.productStatus;

  try {
    await requireBusinessContext("inventory.read");
    const client = await createClient();
    const [list, count] = await Promise.all([
      client.rpc("list_product_inventory", {
        p_search: search,
        p_balance_filter: balanceFilter,
        p_product_status: productStatus,
        p_limit: 20,
        p_offset: (page - 1) * 20,
      }),
      client.rpc("count_product_inventory", {
        p_search: search,
        p_balance_filter: balanceFilter,
        p_product_status: productStatus,
      }),
    ]);

    if (list.error || count.error) throw Error();

    return {
      items: z.array(productInventorySchema).max(20).parse(list.data),
      total: countSchema.parse(count.data),
      page,
      error: null,
    };
  } catch (e) {
    return { items: [], total: 0, page, error: failure(e) };
  }
}

export async function getProductInventoryDetail(productId: string, page = 1) {
  if (!uuid.safeParse(productId).success) {
    return { detail: null, movements: [], total: 0, canWrite: false, error: "product_unavailable" };
  }

  let context: Awaited<ReturnType<typeof requireBusinessContext>>;
  try {
    context = await requireBusinessContext("inventory.read");
  } catch (e) {
    return { detail: null, movements: [], total: 0, canWrite: false, error: failure(e) };
  }

  const parsedPage = Math.min(5001, Math.max(1, Math.floor(page)));
  const offset = (parsedPage - 1) * 20;

  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch {
    return { detail: null, movements: [], total: 0, canWrite: false, error: "technical" };
  }

  let detailRes: Awaited<ReturnType<typeof client.rpc>> | null = null;
  let movRes: Awaited<ReturnType<typeof client.rpc>> | null = null;
  let countRes: Awaited<ReturnType<typeof client.rpc>> | null = null;

  try {
    [detailRes, movRes, countRes] = await Promise.all([
      client.rpc("get_product_inventory_detail", { p_product_id: productId }),
      client.rpc("list_product_inventory_movements", { p_product_id: productId, p_limit: 20, p_offset: offset }),
      client.rpc("count_product_inventory_movements", { p_product_id: productId }),
    ]);
  } catch {
    return { detail: null, movements: [], total: 0, canWrite: false, error: "technical" };
  }

  if (detailRes.error) {
    const code = detailRes.error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");
    if (known.has(code)) return { detail: null, movements: [], total: 0, canWrite: false, error: code === "unauthorized" ? "permission_denied" : code };
    return { detail: null, movements: [], total: 0, canWrite: false, error: "technical" };
  }

  const detailArrayParsed = z.array(z.union([productInventoryDetailSchema, unavailableProductInventoryDetailSchema])).length(1).safeParse(detailRes.data);
  if (!detailArrayParsed.success) {
    return { detail: null, movements: [], total: 0, canWrite: false, error: "technical" };
  }

  const rawDetail = detailArrayParsed.data[0];
  if (rawDetail.product_id === null) {
    return { detail: null, movements: [], total: 0, canWrite: false, error: "product_unavailable" };
  }

  const detail = {
    ...rawDetail,
    userId: context.userId,
  };

  let movements: z.infer<typeof movementRecordSchema>[] = [];
  let total = 0;

  if (movRes && !movRes.error) {
    const movParsed = z.array(movementRecordSchema).max(20).safeParse(movRes.data);
    if (movParsed.success) {
      movements = movParsed.data;
    }
  }

  if (countRes && !countRes.error) {
    const countParsed = countSchema.safeParse(countRes.data);
    if (countParsed.success) {
      total = countParsed.data;
    }
  }

  const canWrite = context.role === "owner" || context.role === "admin" || context.role === "operator";

  return { detail, movements, total, canWrite, error: null };
}

export { parseListQuery };

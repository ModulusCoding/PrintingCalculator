"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadTrace } from "@/lib/diagnostics/load-trace";

export type ProductRecord = {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ProductResult =
  | { status: "success"; productId: string; version: number }
  | { status: "deleted"; productId: string; version: number }
  | { status: "invalid_input"; fieldErrors: Record<string, string[]> }
  | {
      status:
        | "session_expired"
        | "permission_denied"
        | "product_unavailable"
        | "version_conflict"
        | "technical"
        | "unknown";
      message?: string;
      version?: number;
    };

const uuid = z.string().uuid();
const rpcRowSchema = z
  .object({
    status: z.enum([
      "success",
      "deleted",
      "invalid_input",
      "permission_denied",
      "product_unavailable",
      "version_conflict",
    ]),
    product_id: z.string().uuid().nullable(),
    version: z.coerce.number().int().nonnegative().nullable(),
  })
  .strict();

const inputSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().max(3000).nullable(),
  price: z.string(),
});

function contextFailure(error: unknown): ProductResult {
  if (error instanceof AuthContextError) {
    if (error.code === "AUTH_UNAUTHENTICATED") return { status: "session_expired" };
    if (
      error.code === "AUTH_PERMISSION_DENIED" ||
      error.code === "AUTH_ACCESS_BLOCKED"
    )
      return { status: "permission_denied" };
  }
  return { status: "technical", message: "Erro técnico de acesso." };
}

function parsePrice(value: string): { value: string | null } | { error: string } {
  const raw = value.trim();
  if (!raw) return { value: null };
  const withoutCurrency = raw.replace(/^R\$\s*/i, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(withoutCurrency))
    return { error: "Formato inválido." };
  const normalized = withoutCurrency.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return { error: "Formato inválido." };
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)
    return { error: "Valor fora do limite." };
  return { value: normalized };
}

function validate(payload: unknown):
  | { errors: Record<string, string[]> }
  | { data: { name: string; description: string | null; price: string | null } } {
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success)
    return { errors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const price = parsePrice(parsed.data.price);
  if ("error" in price) return { errors: { price: [price.error] } };
  return {
    data: {
      ...parsed.data,
      description: parsed.data.description?.trim() || null,
      price: price.value,
    },
  };
}

function refresh(id?: string) {
  revalidatePath("/admin/products");
  if (id) revalidatePath(`/admin/products/${id}`);
}

function escapeIlike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function listInternalProducts(
  params: { search?: string; status?: string; page?: string } = {}
) {
  const trace = loadTrace("products-list");
  trace.mark("start");
  try {
    const context = await requireBusinessContext("products.read");
    trace.mark("context:end");
    const search = (params.search || "").trim().slice(0, 200);
    const status = ["active", "archived", "all"].includes(params.status || "")
      ? params.status!
      : "active";
    const requested = Math.max(
      1,
      Math.min(10_000, Number.parseInt(params.page || "1", 10) || 1)
    );
    const supabase = await createClient();

    let countQuery = supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("enterprise_id", context.enterpriseId)
      .is("deleted_at", null);
    if (status === "active") countQuery = countQuery.eq("active", true);
    if (status === "archived") countQuery = countQuery.eq("active", false);
    if (search) countQuery = countQuery.ilike("name", `%${escapeIlike(search)}%`);

    trace.mark("count:start");
    const { count, error: countError } = await countQuery;
    trace.mark("count:end");
    if (countError)
      return {
        products: [] as ProductRecord[],
        total: 0,
        page: 1,
        status,
        search,
        error: "technical" as const,
      };

    const total = count || 0;
    const page = Math.min(requested, Math.max(1, Math.ceil(total / 20)));

    let rowsQuery = supabase
      .from("products")
      .select("id,name,description,price,active,version,created_at,updated_at")
      .eq("enterprise_id", context.enterpriseId)
      .is("deleted_at", null);
    if (status === "active") rowsQuery = rowsQuery.eq("active", true);
    if (status === "archived") rowsQuery = rowsQuery.eq("active", false);
    if (search) rowsQuery = rowsQuery.ilike("name", `%${escapeIlike(search)}%`);

    trace.mark("rows:start");
    const { data, error } = await rowsQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);
    trace.mark("rows:end");

    trace.mark(error ? "done:error" : "done");
    return {
      products: (data || []) as ProductRecord[],
      total,
      page,
      status,
      search,
      error: error ? ("technical" as const) : null,
    };
  } catch (error) {
    trace.mark("done:exception");
    return {
      products: [] as ProductRecord[],
      total: 0,
      page: 1,
      status: "active",
      search: "",
      error: contextFailure(error).status,
    };
  }
}

export async function getInternalProduct(id: string) {
  if (!uuid.safeParse(id).success)
    return { product: null, error: "product_unavailable" as const };
  try {
    const context = await requireBusinessContext("products.read");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id,name,description,price,active,version,created_at,updated_at")
      .eq("enterprise_id", context.enterpriseId)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    return {
      product: data as ProductRecord | null,
      error: error || !data ? ("product_unavailable" as const) : null,
    };
  } catch (error) {
    return { product: null, error: contextFailure(error).status };
  }
}

async function callRpc(
  fn: "create_internal_product" | "update_internal_product" | "set_internal_product_active" | "delete_internal_product",
  args: Record<string, unknown>,
  requestedId?: string
): Promise<ProductResult> {
  let begun = false;
  try {
    await requireBusinessContext(
      fn === "set_internal_product_active" || fn === "delete_internal_product" ? "products.delete" : "products.write"
    );
    begun = true;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const code = error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");
      if (code === "version_conflict") return { status: "version_conflict" };
      if (code === "product_unavailable") return { status: "product_unavailable" };
      if (code === "unauthorized") return { status: "permission_denied" };
      if (code === "invalid_input") return { status: "invalid_input", fieldErrors: {} };
      return { status: "unknown" };
    }
    if (!Array.isArray(data) || data.length !== 1) return { status: "unknown" };
    const row = rpcRowSchema.safeParse(data[0]);
    if (!row.success || (requestedId && row.data.product_id !== requestedId))
      return { status: "unknown" };
    if ((row.data.status === "success" || row.data.status === "deleted") && row.data.product_id && row.data.version !== null)
      return { status: row.data.status, productId: row.data.product_id, version: row.data.version };
    if (row.data.status === "invalid_input") return { status: "invalid_input", fieldErrors: {} };
    if (row.data.status === "version_conflict") return { status: "version_conflict", version: row.data.version ?? undefined };
    if (row.data.status === "permission_denied") return { status: "permission_denied" };
    return { status: "product_unavailable" };
  } catch (error) {
    if (begun && error instanceof Error && error.message.includes("timeout")) return { status: "technical" };
    return contextFailure(error);
  }
}

export async function deleteInternalProduct(id: string, version: number, attemptId: string): Promise<ProductResult> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(attemptId).success || !Number.isSafeInteger(version) || version < 0) return { status: "invalid_input", fieldErrors: {} };
  const result = await callRpc("delete_internal_product", { p_attempt_id: attemptId, p_id: id, p_expected_version: version }, id);
  if (result.status === "deleted") refresh(id);
  return result;
}

export async function createInternalProduct(payload: unknown): Promise<ProductResult> {
  const checked = validate(payload);
  if ("errors" in checked) return { status: "invalid_input", fieldErrors: checked.errors };
  const result = await callRpc("create_internal_product", {
    p_name: checked.data.name,
    p_description: checked.data.description,
    p_price: checked.data.price,
    p_images: [],
  });
  if (result.status === "success") refresh(result.productId);
  return result;
}

export async function updateInternalProduct(
  id: string,
  version: number,
  payload: unknown
): Promise<ProductResult> {
  const checked = validate(payload);
  if (!uuid.safeParse(id).success || !Number.isSafeInteger(version) || version < 0)
    return { status: "invalid_input", fieldErrors: {} };
  if ("errors" in checked) return { status: "invalid_input", fieldErrors: checked.errors };
  const result = await callRpc(
    "update_internal_product",
    {
      p_id: id,
      p_expected_version: version,
      p_name: checked.data.name,
      p_description: checked.data.description,
      p_price: checked.data.price,
      p_images: [],
    },
    id
  );
  if (result.status === "success") refresh(id);
  return result;
}

export async function setInternalProductActive(
  id: string,
  version: number,
  active: boolean
): Promise<ProductResult> {
  if (!uuid.safeParse(id).success || !Number.isSafeInteger(version) || version < 0)
    return { status: "invalid_input", fieldErrors: {} };
  const result = await callRpc(
    "set_internal_product_active",
    { p_id: id, p_expected_version: version, p_active: active },
    id
  );
  if (result.status === "success") refresh(id);
  return result;
}

"use server";

import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canonicalJson, pricingRequestSchema, runFdm, sha256, type PricingOutcome } from "./persistence";

const uuid = z.string().uuid();
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)]).transform(Number).pipe(z.number().finite());
const version = numeric.pipe(z.number().int().nonnegative().refine(Number.isSafeInteger));
const productSchema = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, price: z.coerce.number().nullable() }).strict();
export type PricingProduct = z.infer<typeof productSchema>;
const paging = z.object({ query: z.string().trim().max(200).default(""), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(10) }).strict();
const failure = (code: "invalid" | "not_found" | "conflict" | "unavailable" | "forbidden" | "unknown", error: string) => ({ ok: false as const, code, error });

function caught(error: unknown, dispatched = false) {
  if (error instanceof AuthContextError) return failure(
    error.code === "AUTH_TECHNICAL_FAILURE" || error.code === "AUTH_CONTEXT_INVALID_RESPONSE" ? "unavailable" : "forbidden", error.message);
  return failure(dispatched ? "unknown" : "unavailable", dispatched ? "Resultado não confirmado. Tente novamente com a mesma tentativa." : "Serviço indisponível.");
}

function rpcFailure(error: { code?: string }, dispatched = false) {
  if (error.code === "42501") return failure("forbidden", "Acesso negado.");
  if (["23505", "40001"].includes(error.code ?? "")) return failure("conflict", "Cadastro ou tentativa alterado. Recalcule.");
  if (error.code === "22023") return failure("invalid", "Entradas inválidas.");
  return caught(error, dispatched && !/^[0-9A-Z]{5}$/.test(error.code ?? ""));
}

// RETURNS TABLE must always be an array, including single-row results.
function singleRow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return z.array(schema).length(1).parse(data)[0];
}

async function authenticatedActor(client: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await client.auth.getUser();
  if (error) throw new AuthContextError(error.name === "AuthSessionMissingError" ? "AUTH_UNAUTHENTICATED" : "AUTH_TECHNICAL_FAILURE", { cause: error });
  if (!data.user) throw new AuthContextError("AUTH_UNAUTHENTICATED");
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const issuer = process.env.SUPABASE_AUTH_ISSUER;
  if (project.username || project.password || project.search || project.hash || !["https:", "http:"].includes(project.protocol) || issuer !== `${project.origin}${project.pathname.replace(/\/$/, "")}/auth/v1`) throw new Error("Invalid auth issuer configuration");
  return { authUid: uuid.parse(data.user.id), issuer };
}

export async function searchProductsAction(params: { query?: string; page?: number; limit?: number } = {}): Promise<PricingOutcome<{ items: PricingProduct[]; total: number; page: number; totalPages: number }>> {
  try {
    const ctx = await requireBusinessContext("products.read");
    const parsed = paging.safeParse(params); if (!parsed.success) return failure("invalid", "Parâmetros inválidos.");
    const { query, page, limit } = parsed.data;
    const client = await createClient();
    let request = client.from("products").select("id,name,active,version,price", { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).eq("active", true).order("name").order("id");
    if (query) request = request.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, count, error } = await request.range((page - 1) * limit, page * limit - 1);
    if (error) return failure("unavailable", "Erro ao buscar produtos.");
    return { ok: true, data: { items: z.array(productSchema).parse(data), total: count ?? 0, page, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) } };
  } catch (error) { return caught(error); }
}

export async function saveFdmPricingAction(input: unknown): Promise<PricingOutcome<{ pricingId: string; status: string }>> {
  const parsed = pricingRequestSchema.safeParse(input); if (!parsed.success) return failure("invalid", "Entradas inválidas.");
  const r = parsed.data;
  if (new Set(r.materialIds).size !== r.materialIds.length || r.materialIds.length !== r.materialVersions.length || r.materialIds.length !== r.input.materials.length) return failure("invalid", "Materiais inconsistentes.");
  let dispatched = false;
  try {
    const ctx = await requireBusinessContext("pricing.write");
    await requireBusinessContext("products.read");
    const client = await createClient();
    const { authUid, issuer } = await authenticatedActor(client);
    const admin = createAdminClient();
    // Hash only stable client intent. Mutable server configuration and display names do not define attempt identity.
    const intent = Object.fromEntries(Object.entries(r).filter(([key]) => key !== "configVersion"));
    const requestHash = sha256(canonicalJson(intent));
    const lookup = await admin.rpc("lookup_pricing_attempt", { p_actor: authUid, p_issuer: issuer, p_attempt_id: r.attemptId, p_request_hash: requestHash });
    if (lookup.error) return rpcFailure(lookup.error);
    const found = singleRow(z.object({ status: z.enum(["found", "missing"]), calculation_id: uuid.nullable() }), lookup.data);
    if (found.status === "found") {
      if (!found.calculation_id) return failure("unavailable", "Resposta inválida.");
      return { ok: true, data: { pricingId: found.calculation_id, status: "idempotent" } };
    }
    const [product, printer, materials, config] = await Promise.all([
      client.from("products").select("id,name,active,version,price").eq("enterprise_id", ctx.enterpriseId).eq("id", r.productId).maybeSingle(),
      client.from("printers").select("id,name,active,version,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour").eq("enterprise_id", ctx.enterpriseId).eq("id", r.printerId).maybeSingle(),
      client.from("materials").select("id,name,active,version,reference_price,reference_weight_grams").eq("enterprise_id", ctx.enterpriseId).in("id", r.materialIds),
      client.rpc("get_my_enterprise_config"),
    ]);
    if (product.error || printer.error || materials.error || config.error) return failure("unavailable", "Erro ao carregar fontes.");
    if (!product.data || !printer.data || !materials.data || materials.data.length !== r.materialIds.length) return failure("not_found", "Fonte indisponível.");
    const configRow = singleRow(z.object({ version, electricity_rate_per_kwh: z.coerce.number().finite().min(0).max(100).nullable() }), config.data);
    const p = productSchema.parse(product.data);
    const printerRow = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, purchase_price: z.coerce.number().finite().nonnegative(), estimated_life_hours: z.coerce.number().finite().positive(), average_power_watts: z.coerce.number().finite().positive(), maintenance_cost_per_hour: z.coerce.number().finite().nonnegative() }).parse(printer.data);
    const materialRows = z.array(z.object({ id: uuid, name: z.string(), active: z.boolean(), version, reference_price: z.coerce.number().finite().nonnegative(), reference_weight_grams: z.coerce.number().finite().positive() })).parse(materials.data);
    const ordered = r.materialIds.map(id => materialRows.find(m => m.id === id)!);
    if (!p.active || !printerRow.active || ordered.some(m => !m.active) || p.version !== r.productVersion || printerRow.version !== r.printerVersion || ordered.some((m, i) => m.version !== r.materialVersions[i])) return failure("conflict", "Cadastro alterado. Recalcule.");
    
    if (configRow.electricity_rate_per_kwh !== r.input.tariff.original) return failure("conflict", "A tarifa original mudou. Revise explicitamente a simulação.");
    const calcInput = { ...r.input, energyRate: r.input.tariff.effective };
    const res = runFdm(calcInput); if (!res.ok) return res;
    const snapshot = { schema_version: 1, input: calcInput, result: res.data, product_snapshot: p, printers: [{ id: printerRow.id, version: printerRow.version }], printer_snapshot: printerRow, materials: ordered.map(m => ({ id: m.id, version: m.version })), material_snapshots: ordered, config_snapshot: { ...configRow, original: r.input.tariff.original, effective: r.input.tariff.effective } };
    const snapshotText = JSON.stringify(snapshot);
    dispatched = true;
    const save = await admin.rpc("save_pricing_attempt", { p_actor: authUid, p_issuer: issuer, p_attempt_id: r.attemptId, p_request_hash: requestHash, p_snapshot_hash: sha256(snapshotText), p_snapshot: snapshot, p_product_id: p.id, p_product_version: p.version, p_enterprise_version: configRow.version, p_original_rate: r.input.tariff.original, p_used_rate: r.input.tariff.effective, p_suggested_price: res.data.suggestedUnitPrice });
    if (save.error) return rpcFailure(save.error, true);
    const row = singleRow(z.object({ status: z.enum(["created", "idempotent"]), calculation_id: uuid }), save.data);
    return { ok: true, data: { pricingId: row.calculation_id, status: row.status } };
  } catch (error) { return caught(error, dispatched); }
}

export async function applyFdmPricingPriceAction(pricingId: string, expectedProductVersion: number): Promise<PricingOutcome<{ productId: string; version: number; price: number; status: "applied" | "idempotent" }>> {
  if (!uuid.safeParse(pricingId).success || !z.number().int().nonnegative().refine(Number.isSafeInteger).safeParse(expectedProductVersion).success) return failure("invalid", "Parâmetros inválidos.");
  let dispatched = false;
  try {
    await requireBusinessContext("products.write");
    await requireBusinessContext("pricing.read");
    const client = await createClient();
    const { authUid, issuer } = await authenticatedActor(client);
    const admin = createAdminClient();
    dispatched = true;
    const apply = await admin.rpc("apply_pricing_price", { p_actor: authUid, p_issuer: issuer, p_calculation_id: pricingId, p_expected_product_version: expectedProductVersion });
    if (apply.error) return rpcFailure(apply.error, true);
    const row = singleRow(z.discriminatedUnion("status", [
      z.object({ status: z.enum(["applied", "idempotent"]), product_id: uuid, version, applied_price: z.coerce.number().finite().nonnegative() }).strict(),
      z.object({ status: z.literal("not_found"), product_id: z.null(), version: z.null(), applied_price: z.null() }).strict(),
      z.object({ status: z.literal("product_unavailable"), product_id: uuid, version: z.null(), applied_price: z.null() }).strict(),
      z.object({ status: z.literal("product_version_conflict"), product_id: uuid, version, applied_price: z.null() }).strict(),
      z.object({ status: z.literal("price_out_of_bounds"), product_id: uuid, version, applied_price: z.null() }).strict(),
    ]), apply.data);
    if (row.status === "not_found") return failure("not_found", "Precificação não encontrada.");
    if (row.status === "product_unavailable") return failure("unavailable", "O produto não está disponível.");
    if (row.status === "product_version_conflict") return failure("conflict", "O produto foi alterado. Confirme novamente usando a versão atual.");
    if (row.status === "price_out_of_bounds") return failure("invalid", "O preço calculado está fora do limite aceito pelo produto.");
    return { ok: true, data: { productId: row.product_id, version: row.version, price: row.applied_price, status: row.status } };
  } catch (error) { return caught(error, dispatched); }
}

const historySchema = z.object({ id: uuid, product_id: uuid, created_at: z.string().datetime({ offset: true }), snapshot: z.record(z.string(), z.unknown()), price_suggested_unit: z.coerce.number() }).strict();
export type PricingHistoryItem = z.infer<typeof historySchema>;
export async function listPricingHistoryAction(params: { page?: number; limit?: number } = {}): Promise<PricingOutcome<{ items: PricingHistoryItem[]; total: number; page: number; totalPages: number }>> {
  try {
    const ctx = await requireBusinessContext("pricing.read");
    const parsed = paging.safeParse(params); if (!parsed.success) return failure("invalid", "Parâmetros inválidos.");
    const { page, limit } = parsed.data;
    const client = await createClient();
    const { data, count, error } = await client.from("pricing_calculations").select("id,product_id,created_at,snapshot,price_suggested_unit", { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) return failure("unavailable", "Erro ao carregar histórico.");
    return { ok: true, data: { items: z.array(historySchema).parse(data), total: count ?? 0, page, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) } };
  } catch (error) { return caught(error); }
}
export async function fetchPricingDetailAction(id: string): Promise<PricingOutcome<PricingHistoryItem>> {
  if (!uuid.safeParse(id).success) return failure("invalid", "ID inválido.");
  try {
    const ctx = await requireBusinessContext("pricing.read");
    const client = await createClient();
    const { data, error } = await client.from("pricing_calculations").select("id,product_id,created_at,snapshot,price_suggested_unit").eq("enterprise_id", ctx.enterpriseId).eq("id", id).maybeSingle();
    if (error) return failure("unavailable", "Erro ao carregar detalhes.");
    return data ? { ok: true, data: historySchema.parse(data) } : failure("not_found", "Histórico não encontrado.");
  } catch (error) { return caught(error); }
}




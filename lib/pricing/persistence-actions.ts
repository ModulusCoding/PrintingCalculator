"use server";

import { z } from "zod";
import { requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { attestCanonical, pricingRequestSchema, runFdm, type PricingOutcome } from "./persistence";
import { createHash } from "node:crypto";

const uuid = z.string().uuid();
const version = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const productSchema = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, price: z.union([z.string(), z.number()]).nullable() }).strict();
export type PricingProduct = z.infer<typeof productSchema>;
const paging = z.object({ query: z.string().trim().max(200).default(""), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(10) }).strict();
const failure = (code: "invalid" | "not_found" | "conflict" | "unavailable" | "forbidden", error: string) => ({ ok: false as const, code, error });
const saveRow = z.object({ status: z.enum(["created", "idempotent"]), calculation_id: uuid }).strict();

export async function searchProductsAction(params: { query?: string; page?: number; limit?: number } = {}): Promise<PricingOutcome<{ items: PricingProduct[]; total: number; page: number; totalPages: number }>> {
  try {
    const ctx = await requireBusinessContext("products.read");
    const parsed = paging.safeParse(params);
    if (!parsed.success) return failure("invalid", "Parâmetros inválidos.");
    const { query, page, limit } = parsed.data;
    const client = await createClient();
    let request = client.from("products").select("id,name,active,version,price", { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).eq("active", true).order("name").order("id");
    if (query) request = request.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, count, error } = await request.range((page - 1) * limit, page * limit - 1);
    if (error) return failure("unavailable", "Erro ao buscar produtos.");
    return { ok: true, data: { items: z.array(productSchema).parse(data), total: count ?? 0, page, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) } };
  } catch { return failure("forbidden", "Acesso negado ou dados inválidos."); }
}

export async function saveFdmPricingAction(input: unknown): Promise<PricingOutcome<{ pricingId: string; status: string }>> {
  const parsed = pricingRequestSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Entradas inválidas.");
  const r = parsed.data;
  if (new Set(r.materialIds).size !== r.materialIds.length || r.materialIds.length !== r.materialVersions.length || r.materialIds.length !== r.input.materials.length) return failure("invalid", "Materiais inválidos.");
  try {
    const ctx = await requireBusinessContext("pricing.write");
    await requireBusinessContext("products.read");
    await requireBusinessContext("printers.read");
    await requireBusinessContext("materials.read");
    const client = await createClient();
    const [product, printer, materials, config] = await Promise.all([
      client.from("products").select("id,name,active,version,price").eq("enterprise_id", ctx.enterpriseId).eq("id", r.productId).maybeSingle(),
      client.from("printers").select("id,name,active,version,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour").eq("enterprise_id", ctx.enterpriseId).eq("id", r.printerId).maybeSingle(),
      client.from("materials").select("id,name,active,version,reference_price,reference_weight_grams").eq("enterprise_id", ctx.enterpriseId).in("id", r.materialIds),
      client.rpc("get_my_enterprise_config"),
    ]);
    if (product.error || printer.error || materials.error || config.error) return failure("unavailable", "Erro ao carregar fontes.");
    if (!product.data || !printer.data || !materials.data || materials.data.length !== r.materialIds.length) return failure("not_found", "Fonte indisponível.");
    const configRow = z.object({ version, electricity_rate_per_kwh: z.coerce.number().finite().min(0).max(100) }).strict().parse(Array.isArray(config.data) && config.data.length === 1 ? config.data[0] : null);
    const p = productSchema.parse(product.data);
    const printerRow = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, purchase_price: z.coerce.number().finite().nonnegative(), estimated_life_hours: z.coerce.number().finite().positive(), average_power_watts: z.coerce.number().finite().positive(), maintenance_cost_per_hour: z.coerce.number().finite().nonnegative() }).strict().parse(printer.data);
    const materialRows = z.array(z.object({ id: uuid, name: z.string(), active: z.boolean(), version, reference_price: z.coerce.number().finite().nonnegative(), reference_weight_grams: z.coerce.number().finite().positive() }).strict()).parse(materials.data);
    const ordered = r.materialIds.map(id => materialRows.find(m => m.id === id)!);
    if (!p.active || !printerRow.active || ordered.some(m => !m.active) || p.version !== r.productVersion || printerRow.version !== r.printerVersion || configRow.version !== r.configVersion || ordered.some((m, i) => m.version !== r.materialVersions[i])) return failure("conflict", "Fontes alteradas. Atualize a simulação.");
    const calculationInput = { ...r.input, energyRate: configRow.electricity_rate_per_kwh, printer: { purchasePrice: printerRow.purchase_price, lifeHours: printerRow.estimated_life_hours, powerWatts: printerRow.average_power_watts, maintenancePerHour: printerRow.maintenance_cost_per_hour }, materials: ordered.map((m, i) => ({ consumptionGrams: r.input.materials[i].consumptionGrams, referencePrice: m.reference_price, referenceWeightGrams: m.reference_weight_grams })) };
    const result = runFdm(calculationInput);
    if (!result.ok) return result;
    if (result.data.suggestedUnitPrice > 1000000) return failure("invalid", "Preço acima do limite operacional.");
    const payload = { schema_version: 1, attempt_id: r.attemptId, enterprise_id: ctx.enterpriseId, product_id: p.id, product_version: p.version, printer_id: printerRow.id, printer_version: printerRow.version, config_version: configRow.version, input: calculationInput, result: result.data, product_snapshot: p, printer_snapshot: printerRow, material_snapshots: ordered, config_snapshot: configRow };
    const snapshotText = JSON.stringify(payload);
    const canonical = JSON.stringify(["fdm-pricing-v1", r.attemptId, ctx.userId, ctx.enterpriseId, p.id, String(p.version), String(configRow.version), String(configRow.electricity_rate_per_kwh), printerRow.id, String(printerRow.version), String(Math.floor(Date.now() / 1000) + 300), String(result.data.suggestedUnitPrice), ordered.map((m) => `${m.id}:${m.version}`).sort().join(","), createHash("sha256").update(snapshotText).digest("hex")]);
    const keyId = process.env.PRICING_ATTESTATION_KEY_ID;
    if (!keyId) return failure("unavailable", "Atestação não configurada.");
    const { signature } = attestCanonical(canonical);
    const { data, error } = await client.rpc("save_my_pricing", { p_key_id: keyId, p_canonical: canonical, p_signature: signature, p_snapshot_text: snapshotText });
    if (error) {
      if (error.code === "23505" || error.message?.includes("idempotency")) return failure("conflict", "Esta simulação já foi salva.");
      if (error.code === "40001" || error.message?.includes("conflict")) return failure("conflict", "Os dados de cadastro mudaram. Atualize a simulação e recalcule.");
      return failure("unavailable", "Erro ao salvar precificação.");
    }
    const row = saveRow.safeParse(Array.isArray(data) && data.length === 1 ? data[0] : data);
    if (!row.success) return failure("unavailable", "Resposta inválida.");
    return { ok: true, data: { pricingId: row.data.calculation_id, status: row.data.status } };
  } catch { return failure("unavailable", "Não foi possível salvar a precificação."); }
}

export async function applyFdmPricingPriceAction(pricingId: string, expectedProductVersion: number): Promise<PricingOutcome<{ productId: string; version: number; price: number }>> {
  if (!uuid.safeParse(pricingId).success || !z.number().int().nonnegative().safeParse(expectedProductVersion).success) return failure("invalid", "Parâmetros inválidos.");
  try {
    await requireBusinessContext("pricing.read");
    await requireBusinessContext("products.write");
    const client = await createClient();
    const { data, error } = await client.rpc("apply_my_pricing_price", { p_calculation_id: pricingId, p_expected_product_version: expectedProductVersion });
    if (error) return failure("unavailable", "Erro ao aplicar preço.");
    const row = z.object({ status: z.enum(["applied", "idempotent"]), product_id: uuid, version }).strict().safeParse(Array.isArray(data) && data.length === 1 ? data[0] : data);
    if (!row.success) return failure("unavailable", "Resposta inválida.");
    const { data: calculation, error: calculationError } = await client.from("pricing_calculations").select("price").eq("id", pricingId).eq("product_id", row.data.product_id).single();
    if (calculationError || !calculation) return failure("unavailable", "Preço indisponível.");
    const price = z.coerce.number().finite().nonnegative().safeParse(calculation.price);
    if (!price.success) return failure("unavailable", "Preço inválido.");
    return { ok: true, data: { productId: row.data.product_id, version: row.data.version, price: price.data } };
  } catch { return failure("forbidden", "Acesso negado."); }
}

const historySchema = z.object({ id: uuid, product_id: uuid, created_at: z.string().datetime({ offset: true }), snapshot: z.record(z.string(), z.unknown()), price: z.union([z.string(), z.number()]) }).strict();
export type PricingHistoryItem = z.infer<typeof historySchema>;
export async function listPricingHistoryAction(params: { page?: number; limit?: number } = {}): Promise<PricingOutcome<{ items: PricingHistoryItem[]; total: number; page: number; totalPages: number }>> {
  try {
    const ctx = await requireBusinessContext("products.read");
    const parsed = paging.safeParse(params);
    if (!parsed.success) return failure("invalid", "Parâmetros inválidos.");
    const { page, limit } = parsed.data;
    const client = await createClient();
    const { data, count, error } = await client.from("pricing_calculations").select("id,product_id,created_at,snapshot,price", { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
    if (error) return failure("unavailable", "Erro ao carregar histórico.");
    const total = count ?? 0;
    return { ok: true, data: { items: z.array(historySchema).parse(data), total, page, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  } catch { return failure("forbidden", "Acesso negado ou histórico inválido."); }
}
export async function fetchPricingDetailAction(id: string): Promise<PricingOutcome<PricingHistoryItem>> {
  if (!uuid.safeParse(id).success) return failure("invalid", "ID inválido.");
  try {
    const ctx = await requireBusinessContext("products.read");
    const client = await createClient();
    const { data, error } = await client.from("pricing_calculations").select("id,product_id,created_at,snapshot,price").eq("enterprise_id", ctx.enterpriseId).eq("id", id).maybeSingle();
    if (error) return failure("unavailable", "Erro ao carregar histórico.");
    return data ? { ok: true, data: historySchema.parse(data) } : failure("not_found", "Precificação indisponível.");
  } catch { return failure("forbidden", "Acesso negado ou histórico inválido."); }
}

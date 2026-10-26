"use server";

import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canonicalJson, pricingRequestSchema, runFdm, sha256, type PricingOutcome as EnginePricingOutcome } from "./persistence";
import { spoolColumns, spoolSchema } from "@/lib/spools/schemas";
import { materialSchema as generalMaterialSchema } from "@/lib/general-materials/schemas";
import { createLogger } from "@/lib/general-materials/logger";
import { unstable_rethrow } from "next/navigation";
import { requirePlanBusinessAccess, PlanAccessError, PlanTechnicalError, planRpcErrorCode, type PlanErrorCode } from "@/lib/plans";
import { logPricingFailure, pricingPlanMessage } from "@/lib/diagnostics/action-handler";

type PricingOutcome<T> = EnginePricingOutcome<T> | { ok: false; code: PlanErrorCode | "unavailable" | "unknown"; error: string; correlationId?: string };
import { manualFdmSchema } from "./manual";

function logSourceFailure(logger: ReturnType<typeof createLogger>, error: unknown, stage: "context" | "query" | "interpretation" | "validation", operation?: string) {
  unstable_rethrow(error);
  return logPricingFailure(logger, error, { stage, operation });
}

const unitFactors: Record<string, number> = { unidade: 1, metro: 1, centimetro: .01, grama: 1, quilograma: 1000 };
const unitFamily = (unit: string) => unit === "metro" || unit === "centimetro" ? "length" : unit === "grama" || unit === "quilograma" ? "mass" : "count";
function conversionToControl(from: string, to: string): number | null {
  return unitFamily(from) === unitFamily(to) && from in unitFactors && to in unitFactors ? unitFactors[from] / unitFactors[to] : null;
}
const uuid = z.string().uuid();
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)]).transform(Number).pipe(z.number().finite());
const version = numeric.pipe(z.number().int().nonnegative().refine(Number.isSafeInteger));
const productSchema = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, price: z.coerce.number().nullable(), deleted_at: z.string().nullable().optional() }).strict();
export type PricingProduct = z.infer<typeof productSchema>;

const paging = z.object({ query: z.string().trim().max(200).default(""), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(10) }).strict();
const failure = (code: "invalid" | "not_found" | "conflict" | "unavailable" | "forbidden" | "unknown", error: string) => ({ ok: false as const, code, error });

function caught(error: unknown, dispatched = false, logger = createLogger("pricing", "action")) {
  unstable_rethrow(error);
  if (error instanceof PlanAccessError) return { ok: false as const, code: error.code, error: pricingPlanMessage(error.code) };
  if (error instanceof AuthContextError && error.code !== "AUTH_TECHNICAL_FAILURE" && error.code !== "AUTH_CONTEXT_INVALID_RESPONSE") {
    return failure("forbidden", "Acesso negado.");
  }
  const correlationId = error instanceof PlanTechnicalError ? error.correlationId : logPricingFailure(logger, error, { stage: "context" });
  return { ...failure(dispatched ? "unknown" : "unavailable", dispatched ? "Resultado não confirmado. Tente novamente com a mesma tentativa." : "Serviço indisponível."), correlationId };
}

function rpcFailure(error: { code?: string; message?: string }, dispatched = false, operation = "pricing.rpc") {
  const planCode = planRpcErrorCode(error);
  if (planCode) return { ok: false as const, code: planCode, error: pricingPlanMessage(planCode) };
  if (error.code === "42501") return failure("forbidden", "Acesso negado.");
  if (["23505", "40001"].includes(error.code ?? "")) return failure("conflict", "Cadastro ou tentativa alterado. Recalcule.");
  if (error.code === "22023") return failure("invalid", "Entradas inválidas.");
  const logger = createLogger("pricing", operation);
  const correlationId = logPricingFailure(logger, error, { stage: "rpc", operation });
  const uncertain = dispatched && !/^[0-9A-Z]{5}$/.test(error.code ?? "");
  return { ...failure(uncertain ? "unknown" : "unavailable", uncertain ? "Resultado não confirmado. Tente novamente com a mesma tentativa." : "Serviço indisponível."), correlationId };
}

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
  const logger = createLogger("pricing", "searchProducts");
  const ref = () => logger.id;
  try {
    await requirePlanBusinessAccess();
    const ctx = await requireBusinessContext("products.read");
    const parsed = paging.safeParse(params);
    if (!parsed.success) { logSourceFailure(logger, parsed.error, "validation"); return failure("invalid", `Parâmetros inválidos. Referência: ${ref()}.`); }
    const { query, page, limit } = parsed.data;
    const client = await createClient();
    let request = client.from("products").select("id,name,active,version,price,deleted_at", { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).eq("active", true).is("deleted_at", null).order("name").order("id");
    if (query) request = request.ilike("name", `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, count, error } = await request.range((page - 1) * limit, page * limit - 1);
    if (error) { logSourceFailure(logger, error, "query", "products.select"); return failure("unavailable", `Erro ao buscar produtos. Referência: ${ref()}.`); }
    try {
      const items = z.array(productSchema).parse(data).map(p => ({ id: p.id, name: p.name, active: p.active, version: p.version, price: p.price }));
      return { ok: true, data: { items, total: count ?? 0, page, totalPages: Math.max(1, Math.ceil((count ?? 0) / limit)) } };
    } catch (error) { logSourceFailure(logger, error, "interpretation"); return failure("unavailable", `Erro ao interpretar produtos. Referência: ${ref()}.`); }
  } catch (error) { return caught(error, false, logger); }
}

export async function saveFdmPricingAction(input: unknown): Promise<PricingOutcome<{ pricingId: string; status: string }>> {
  const parsed = pricingRequestSchema.safeParse(input); if (!parsed.success) return failure("invalid", "Entradas inválidas.");
  const r = parsed.data;
  if (new Set(r.materialIds).size !== r.materialIds.length || r.materialIds.length !== r.materialVersions.length || r.materialIds.length !== r.input.materials.length) return failure("invalid", "Materiais inconsistentes.");
  if (new Set(r.spoolIds).size !== r.spoolIds.length || r.spoolIds.length !== r.spoolVersions.length || r.spoolIds.length !== r.input.spoolConsumptionsGrams.length) return failure("invalid", "Carretéis inconsistentes.");
  if (new Set(r.generalMaterialIds).size !== r.generalMaterialIds.length || r.generalMaterialIds.length !== r.generalMaterialVersions.length || r.generalMaterialIds.length !== r.input.generalMaterialConsumptions.length) return failure("invalid", "Materiais gerais inconsistentes.");
  let dispatched = false;
  try {
    // Recover an already committed integrated attempt without converting its
    // frozen V2 intent or loading paid sources after a downgrade.
    const client = await createClient();
    const { authUid, issuer } = await authenticatedActor(client);
    const admin = createAdminClient();
    const intent = Object.fromEntries(Object.entries(r).filter(([key]) => key !== "configVersion"));
    const requestHash = sha256(canonicalJson(intent));
    const lookup = await admin.rpc("lookup_pricing_attempt", { p_actor: authUid, p_issuer: issuer, p_attempt_id: r.attemptId, p_request_hash: requestHash });
    if (lookup.error) return rpcFailure(lookup.error, false, "lookup_pricing_attempt");
    const found = singleRow(z.object({ status: z.enum(["found", "missing"]), calculation_id: uuid.nullable() }), lookup.data);
    if (found.status === "found") {
      if (!found.calculation_id) return failure("unavailable", "Resposta inválida.");
      return { ok: true, data: { pricingId: found.calculation_id, status: "idempotent" } };
    }
    await requirePlanBusinessAccess({ paid: true });
    const ctx = await requireBusinessContext("pricing.write");
    if (ctx.role !== "owner") return failure("forbidden", "Apenas o proprietário pode executar esta ação.");
    await requireBusinessContext("products.read");
    const [product, printer, materials, spools, generalMaterials, config] = await Promise.all([
      client.from("products").select("id,name,active,version,price,deleted_at").eq("enterprise_id", ctx.enterpriseId).eq("id", r.productId).maybeSingle(),
      client.from("printers").select("id,name,active,version,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour").eq("enterprise_id", ctx.enterpriseId).eq("id", r.printerId).maybeSingle(),
      client.from("materials").select("id,name,active,version,reference_price,reference_weight_grams").eq("enterprise_id", ctx.enterpriseId).in("id", r.materialIds),
      r.spoolIds.length > 0 ? client.from("filament_spools").select(spoolColumns).eq("enterprise_id", ctx.enterpriseId).eq("active", true).is("deleted_at", null).in("id", r.spoolIds) : Promise.resolve({ data: [], error: null }),
      r.generalMaterialIds.length > 0 ? client.from("general_materials").select("id,name,control_unit,reference_quantity,reference_price,current_balance,active,version,created_at,updated_at").eq("enterprise_id", ctx.enterpriseId).eq("active", true).is("deleted_at", null).in("id", r.generalMaterialIds) : Promise.resolve({ data: [], error: null }),
      client.rpc("get_my_enterprise_config"),
    ]);
    if (product.error || printer.error || materials.error || spools.error || generalMaterials.error || config.error) return failure("unavailable", "Erro ao carregar fontes.");
    if (!product.data || !printer.data || !config.data) return failure("not_found", "Fonte indisponível.");
    const pRaw = productSchema.parse(product.data);
    if (!pRaw.active || pRaw.deleted_at !== null) return failure("conflict", "Produto inativo ou excluído.");
    if (materials.data.length !== r.materialIds.length) return failure("not_found", "Material de referência indisponível.");
    if (r.spoolIds.length > 0 && spools.data.length !== r.spoolIds.length) return failure("not_found", "Carretel indisponível.");
    if (r.generalMaterialIds.length > 0 && generalMaterials.data.length !== r.generalMaterialIds.length) return failure("not_found", "Material geral indisponível.");

    const configRow = singleRow(z.object({ version, electricity_rate_per_kwh: z.coerce.number().finite().min(0).max(100).nullable(), default_filament_loss_percent: z.coerce.number().finite().min(0).max(100).default(0) }), config.data);
    const p = { id: pRaw.id, name: pRaw.name, active: pRaw.active, version: pRaw.version, price: pRaw.price };
    const printerRow = z.object({ id: uuid, name: z.string(), active: z.boolean(), version, purchase_price: z.coerce.number().finite().nonnegative(), estimated_life_hours: z.coerce.number().finite().positive(), average_power_watts: z.coerce.number().finite().positive(), maintenance_cost_per_hour: z.coerce.number().finite().nonnegative() }).parse(printer.data);
    const materialRows = z.array(z.object({ id: uuid, name: z.string(), active: z.boolean(), version, reference_price: z.coerce.number().finite().nonnegative(), reference_weight_grams: z.coerce.number().finite().positive() })).parse(materials.data);
    const orderedMaterials = r.materialIds.map(id => materialRows.find(m => m.id === id)!);
    const spoolRows = r.spoolIds.length > 0 ? z.array(spoolSchema).parse(spools.data) : [];
    const orderedSpools = r.spoolIds.map(id => spoolRows.find(s => s.id === id)!);
    const gmRows = r.generalMaterialIds.length > 0 ? z.array(generalMaterialSchema).parse(generalMaterials.data) : [];
    const orderedGM = r.generalMaterialIds.map(id => gmRows.find(m => m.id === id)!);

    if (!p.active || !printerRow.active || orderedMaterials.some(m => !m.active) || orderedSpools.some(s => !s.active) || orderedGM.some(m => !m.active) || p.version !== r.productVersion || printerRow.version !== r.printerVersion || orderedMaterials.some((m, i) => m.version !== r.materialVersions[i]) || orderedSpools.some((s, i) => s.version !== r.spoolVersions[i]) || orderedGM.some((m, i) => m.version !== r.generalMaterialVersions[i])) return failure("conflict", "Cadastro alterado. Recalcule.");

    if (configRow.electricity_rate_per_kwh !== r.input.tariff.original) return failure("conflict", "A tarifa original mudou. Revise explicitamente a simulação.");

    const lossPercent = r.input.lossPercent ?? configRow.default_filament_loss_percent ?? 0;
    const calcInput = {
      quantity: r.input.quantity, printTimeHours: r.input.printTimeHours,
      printer: { purchasePrice: printerRow.purchase_price, lifeHours: printerRow.estimated_life_hours, powerWatts: printerRow.average_power_watts, maintenancePerHour: printerRow.maintenance_cost_per_hour },
      energyRate: r.input.tariff.effective, lossPercent,
      spoolLines: orderedSpools.map((s, i) => ({ spoolId: s.id, consumptionGrams: r.input.spoolConsumptionsGrams[i], purchasePrice: s.purchase_price, originalFilamentGrams: s.original_filament_grams })),
      packagingLines: orderedGM.map((m, i) => {
        const line = r.input.packagingLines[i] ?? { mode: "per_piece" as const, quantity: r.input.generalMaterialConsumptions[i], suppliedUnit: m.control_unit };
        const conversionFactor = conversionToControl(line.suppliedUnit, m.control_unit);
        if (conversionFactor === null) throw new Error("incompatible_units");
        return { materialId: m.id, mode: line.mode, quantity: line.quantity, suppliedUnit: line.suppliedUnit, conversionFactor, referencePrice: m.reference_price, referenceQuantity: m.reference_quantity };
      }),
      finishing: r.input.finishing, packagingPerPiece: r.input.packagingPerPiece, markupPercent: r.input.markupPercent,
    };
    const res = runFdm(calcInput); if (!res.ok) return res;

    const spoolSnapshots = orderedSpools.map(s => ({ id: s.id, version: s.version, internal_identifier: s.internal_identifier, material_type: s.material_type, brand: s.brand, color: s.color, purchase_price: s.purchase_price, original_filament_grams: s.original_filament_grams }));
    const gmSnapshots = orderedGM.map(m => ({ id: m.id, version: m.version, name: m.name, control_unit: m.control_unit, reference_quantity: m.reference_quantity, reference_price: m.reference_price }));

    const snapshot = {
      schema_version: "2",
      input: calcInput,
      result: res.data,
      product_snapshot: p,
      printers: [{ id: printerRow.id, version: printerRow.version }],
      printer_snapshot: printerRow,
      materials: orderedMaterials.map(m => ({ id: m.id, version: m.version })),
      material_snapshots: orderedMaterials,
      spools: orderedSpools.map(s => ({ id: s.id, version: s.version })),
      spool_snapshots: spoolSnapshots,
      general_materials: orderedGM.map(m => ({ id: m.id, version: m.version })),
      general_material_snapshots: gmSnapshots,
      config_snapshot: { ...configRow, original: r.input.tariff.original, effective: r.input.tariff.effective },
    };
    const snapshotText = JSON.stringify(snapshot);
    dispatched = true;
    const save = await admin.rpc("save_pricing_attempt", { p_actor: authUid, p_issuer: issuer, p_attempt_id: r.attemptId, p_request_hash: requestHash, p_snapshot_hash: sha256(snapshotText), p_snapshot: snapshot, p_product_id: p.id, p_product_version: p.version, p_enterprise_version: configRow.version, p_original_rate: r.input.tariff.original, p_used_rate: r.input.tariff.effective, p_suggested_price: res.data.suggestedUnitPrice });
    if (save.error) return rpcFailure(save.error, true);
    const row = singleRow(z.object({ status: z.enum(["created", "idempotent"]), calculation_id: uuid }), save.data);
    return { ok: true, data: { pricingId: row.calculation_id, status: row.status } };
  } catch (error) { return caught(error, dispatched); }
}

export async function saveManualFdmPricingAction(input: unknown): Promise<PricingOutcome<{ pricingId: string; status: string }>> {
  const parsed = manualFdmSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Entradas manuais inválidas.");
  const r = parsed.data;

  let dispatched = false;
  const logger = createLogger("pricing", "saveManualFdmPricingAction");

  try {
    const client = await createClient();
    const { authUid, issuer } = await authenticatedActor(client);
    const admin = createAdminClient();

    const intent = { ...r, source: "manual" };
    const requestHash = sha256(canonicalJson(intent));

    // Integrated lookup BEFORE paid guard so retry downgrade works no paid queries on receipt
    const lookup = await admin.rpc("lookup_pricing_attempt", { p_actor: authUid, p_issuer: issuer, p_attempt_id: r.attemptId, p_request_hash: requestHash });
    if (lookup.error) return rpcFailure(lookup.error, false, "lookup_pricing_attempt");
    const found = singleRow(z.object({ status: z.enum(["found", "missing"]), calculation_id: uuid.nullable() }), lookup.data);
    if (found.status === "found") {
      if (!found.calculation_id) return failure("unavailable", "Resposta inválida.");
      return { ok: true, data: { pricingId: found.calculation_id, status: "idempotent" } };
    }

    // Receipts can be recovered after a plan change; new operations require
    // actual operational authorization, including an explicit plan selection.
    await requirePlanBusinessAccess();
    const ctx = await requireBusinessContext("pricing.write");
    if (ctx.role !== "owner") return failure("forbidden", "Apenas o proprietário pode executar esta ação.");
    await requireBusinessContext("products.read");

    const { data: product, error: prodError } = await client
      .from("products")
      .select("id,name,active,version,price,deleted_at")
      .eq("enterprise_id", ctx.enterpriseId)
      .eq("id", r.productId)
      .maybeSingle();

    if (prodError) {
      logSourceFailure(logger, prodError, "query", "products.select");
      return { ...failure("unavailable", "Erro ao carregar produto."), correlationId: logger.id };
    }
    if (!product) return failure("not_found", "Produto não encontrado ou fora da janela do plano.");
    const interpreted = productSchema.safeParse(product);
    if (!interpreted.success) {
      logSourceFailure(logger, interpreted.error, "interpretation", "products.select");
      return { ...failure("unavailable", "Erro ao interpretar produto."), correlationId: logger.id };
    }
    const pRaw = interpreted.data;
    if (!pRaw.active || pRaw.deleted_at !== null) return failure("conflict", "Produto inativo ou excluído.");

    // Explicit product version comparison, deleted active
    if (pRaw.version !== r.productVersion) {
      return failure("conflict", "Versão do produto divergente.");
    }

    const p = { id: pRaw.id, name: pRaw.name, active: pRaw.active, version: pRaw.version, price: pRaw.price };

    const calcInput = {
      quantity: r.input.quantity,
      printTimeHours: r.input.printTimeHours,
      printer: r.input.printer,
      energyRate: r.input.tariff.effective,
      lossPercent: r.input.lossPercent,
      spoolLines: r.input.spoolLines.map(s => ({
        consumptionGrams: s.consumptionGrams,
        purchasePrice: s.purchasePrice,
        originalFilamentGrams: s.originalFilamentGrams,
      })),
      packagingLines: r.input.packagingLines.map(p => ({
        mode: p.mode,
        quantity: p.quantity,
        referenceQuantity: p.referenceQuantity,
        referencePrice: p.referencePrice,
        conversionFactor: 1,
      })),
      finishing: r.input.finishing,
      packagingPerPiece: r.input.packagingPerPiece,
      markupPercent: r.input.markupPercent,
    };

    const res = runFdm(calcInput);
    if (!res.ok) return res;

    const snapshot = {
      schema_version: "3",
      source: "manual",
      input: calcInput,
      result: res.data,
      product_snapshot: p,
      units: {
        filament: "g/lot",
        printTime: "h/lot",
        finishing: "lot",
        packagingPerPiece: "BRL/piece",
        quantity: "piece",
      },
      config_snapshot: { source: "manual", energyRate: r.input.tariff.effective },
      manual_input_references: {
        spool_names: r.input.spoolLines.map(s => s.name),
        packaging_names: r.input.packagingLines.map(p => p.name),
      },
    };

    const snapshotText = JSON.stringify(snapshot);
    dispatched = true;

    const save = await admin.rpc("save_manual_pricing_attempt", {
      p_actor: authUid,
      p_issuer: issuer,
      p_attempt_id: r.attemptId,
      p_request_hash: requestHash,
      p_snapshot_hash: sha256(snapshotText),
      p_snapshot: snapshot,
      p_product_id: p.id,
      p_product_version: p.version,
      p_suggested_price: res.data.suggestedUnitPrice,
    });

    if (save.error) return rpcFailure(save.error, true, "save_manual_pricing_attempt");
    const row = singleRow(z.object({ status: z.enum(["created", "idempotent"]), calculation_id: uuid }), save.data);
    return { ok: true, data: { pricingId: row.calculation_id, status: row.status } };
  } catch (error) {
    unstable_rethrow(error);
    return caught(error, dispatched, logger);
  }
}

export async function applyFdmPricingPriceAction(pricingId: string, expectedProductVersion: number): Promise<PricingOutcome<{ productId: string; version: number; price: number; status: "applied" | "idempotent" }>> {
  if (!uuid.safeParse(pricingId).success || !z.number().int().nonnegative().refine(Number.isSafeInteger).safeParse(expectedProductVersion).success) return failure("invalid", "Parâmetros inválidos.");
  let dispatched = false;
  try {
    // Saved snapshot eligibility is enforced by the apply RPC, not a paid-only gate.
    await requirePlanBusinessAccess({ apply: true });
    await requireBusinessContext("pricing.read");
    await requireBusinessContext("products.write");
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

const historySchema = z.object({
  id: uuid,
  product_id: uuid,
  created_at: z.string().datetime({ offset: true }),
  snapshot: z.record(z.string(), z.unknown()),
  price_suggested_unit: z.coerce.number(),
  status: z.enum(["saved", "applied", "reviewed"]).default("saved"),
}).strict();
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

export async function getPricingReviewAction(pricingId: string): Promise<PricingOutcome<{ calculation: PricingHistoryItem; currentProduct: { id: string; version: number; active: boolean; name: string; price: number | null } | null }>> {
  if (!uuid.safeParse(pricingId).success) return failure("invalid", "ID inválido.");
  let dispatched = false;
  try {
    const pricingContext = await requireBusinessContext("pricing.read");
    const productsContext = await requireBusinessContext("products.read");
    const client = await createClient();
    dispatched = true;
    const { data: calc, error: calcError } = await client.from("pricing_calculations").select("id,product_id,created_at,snapshot,price_suggested_unit").eq("enterprise_id", pricingContext.enterpriseId).eq("id", pricingId).maybeSingle();
    if (calcError) return failure("unavailable", "Erro ao carregar cálculo.");
    if (!calc) return failure("not_found", "Precificação não encontrada.");
    const calculation = historySchema.parse(calc);
    const { data: product, error: prodError } = await client.from("products").select("id,name,active,version,price").eq("enterprise_id", productsContext.enterpriseId).eq("id", calculation.product_id).maybeSingle();
    if (prodError) return failure("unavailable", "Erro ao carregar produto.");
    return { ok: true, data: { calculation, currentProduct: product ? productSchema.parse(product) : null } };
  } catch (error) { return caught(error, dispatched); }
}

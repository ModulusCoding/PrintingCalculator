"use server";

import { z } from "zod";
import { requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/general-materials/logger";
import { unstable_rethrow } from "next/navigation";
import { logPricingFailure } from "@/lib/diagnostics/action-handler";


const searchSchema = z.object({ query: z.string().max(200).default(""), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(10) }).strict();
const printerSchema = z.object({ id: z.string().uuid(), name: z.string(), brand: z.string().nullable(), model: z.string().nullable(), purchase_price: z.coerce.number().nonnegative(), estimated_life_hours: z.coerce.number().positive(), average_power_watts: z.coerce.number().positive(), maintenance_cost_per_hour: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strict();
const materialSchema = z.object({ id: z.string().uuid(), name: z.string(), material_type: z.string(), brand: z.string().nullable(), color: z.string().nullable(), reference_weight_grams: z.coerce.number().positive(), reference_price: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strict();
const spoolSchema = z.object({ id: z.string().uuid(), internal_identifier: z.string(), material_type: z.string().nullable(), brand: z.string().nullable(), color: z.string().nullable(), original_filament_grams: z.coerce.number().positive(), current_balance_grams: z.coerce.number().nonnegative(), purchase_price: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strip();
const generalMaterialSchema = z.object({ id: z.string().uuid(), name: z.string(), control_unit: z.enum(["unidade", "metro", "centimetro", "grama", "quilograma"]), reference_quantity: z.coerce.number().positive(), reference_price: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strip();
export type PrinterItem = z.infer<typeof printerSchema>;
export type PricingSpool = z.infer<typeof spoolSchema>;
export type PricingGeneralMaterial = z.infer<typeof generalMaterialSchema>;
export type MaterialItem = z.infer<typeof materialSchema>;
export type PaginatedPrinters = Page<PrinterItem>;
export type PaginatedMaterials = Page<MaterialItem>;
type Page<T> = { items: T[]; total: number; page: number; totalPages: number };
type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: "unavailable" | "invalid" | "forbidden"; correlationId?: string };
type Search = { query?: string; page?: number; limit?: number };
const printerColumns = "id,name,brand,model,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour,active,version";
const materialColumns = "id,name,material_type,brand,color,reference_weight_grams,reference_price,active,version";
async function search<T>(table: "printers" | "materials", columns: string, schema: z.ZodType<T>, params: Search): Promise<Result<Page<T>>> {
  const logger = createLogger("pricing", `search:${table}`);
  const ctx = await requireBusinessContext(table === "printers" ? "printers.read" : "materials.read");
  const parsed = searchSchema.safeParse(params);
  if (!parsed.success) {
    const id = logger.error({ stage: "validation" });
    return { ok: false, error: "Parâmetros inválidos.", code: "invalid", correlationId: id };
  }
  const { query, page, limit } = parsed.data;
  const client = await createClient();
  let request = client.from(table).select(columns, { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).eq("active", true).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (query.trim()) request = request.ilike("name", `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`);
  const { data, count, error } = await request.range((page - 1) * limit, page * limit - 1);
  if (error) {
    const id = logger.error({ stage: "rpc", rpc_name: `from(${table}).select`, code: error.code, message: error.message });
    return { ok: false, error: "Erro ao buscar registros.", code: "unavailable", correlationId: id };
  }
  try {
    return { ok: true, data: { items: z.array(schema).parse(data), total: count ?? 0, page, totalPages: Math.ceil((count ?? 0) / limit) || 1 } };
  } catch (error) {
    unstable_rethrow(error);
    const id = logPricingFailure(logger, error, { stage: "interpretation" });
    return { ok: false, error: "Erro na interpretação dos dados.", code: "unavailable", correlationId: id };
  }
}
async function fetchById<T>(table: "printers" | "materials", columns: string, schema: z.ZodType<T>, id: string): Promise<Result<T | null>> {
  try {
    const ctx = await requireBusinessContext(table === "printers" ? "printers.read" : "materials.read");
    z.string().uuid().parse(id);
    const client = await createClient();
    const { data, error } = await client.from(table).select(columns).eq("enterprise_id", ctx.enterpriseId).eq("id", id).maybeSingle();
    if (error) return { ok: false, error: "Erro ao consultar registro." };
    return { ok: true, data: data ? schema.parse(data) : null };
  } catch { return { ok: false, error: "Acesso negado ou dados inválidos." }; }
}
export async function searchPrintersAction(params: Search): Promise<Result<PaginatedPrinters>> { return search("printers", printerColumns, printerSchema, params); }
export async function searchMaterialsAction(params: Search): Promise<Result<PaginatedMaterials>> { return search("materials", materialColumns, materialSchema, params); }
export async function fetchPrinterByIdAction(id: string): Promise<Result<PrinterItem | null>> { return fetchById("printers", printerColumns, printerSchema, id); }
export async function fetchMaterialByIdAction(id: string): Promise<Result<MaterialItem | null>> { return fetchById("materials", materialColumns, materialSchema, id); }
export async function searchPricingSpoolsAction(params: Search = {}): Promise<Result<Page<z.infer<typeof spoolSchema>>>> {
  const logger = createLogger("pricing", "searchPricingSpools");
  try {
    await requireBusinessContext("spools.read");
    const parsed = searchSchema.safeParse(params);
    if (!parsed.success) { const id = logger.error({ stage: "validation" }); return { ok: false, error: "Parâmetros inválidos.", code: "invalid", correlationId: id }; }
    const { query, page, limit } = parsed.data;
    const client = await createClient();
    const { data, error } = await client.rpc("list_filament_spools", { p_search: query.trim(), p_status: "active", p_limit: limit, p_offset: (page - 1) * limit });
    if (error) { const id = logger.error({ stage: "rpc", rpc_name: "list_filament_spools", code: error.code, message: error.message }); return { ok: false, error: "Erro ao buscar carretéis.", code: "unavailable", correlationId: id }; }
    try {
      const items = z.array(spoolSchema).parse(data);
      return { ok: true, data: { items, total: items.length, page, totalPages: items.length === limit ? page + 1 : page } };
    } catch (e) { const id = logger.error({ stage: "interpretation", code: "ZOD_PARSE_ERROR", technical_detail: e instanceof z.ZodError ? e.issues.map(i => `${i.path.join(".")}:${i.code}:${i.message}`).join(";") : undefined, stack: e instanceof Error ? e.stack : undefined }); return { ok: false, error: "Erro de dados.", code: "unavailable", correlationId: id }; }
  } catch (e) { const id = logger.error({ stage: "context", code: "CONTEXT_ERROR", message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }); return { ok: false, error: "Acesso negado.", code: "forbidden", correlationId: id }; }
}
export async function searchPricingGeneralMaterialsAction(params: Search = {}): Promise<Result<Page<z.infer<typeof generalMaterialSchema>>>> {
  const logger = createLogger("pricing", "searchPricingGM");
  try {
    await requireBusinessContext("stock.materials.read");
    const parsed = searchSchema.safeParse(params);
    if (!parsed.success) { const id = logger.error({ stage: "validation" }); return { ok: false, error: "Parâmetros inválidos.", code: "invalid", correlationId: id }; }
    const { query, page, limit } = parsed.data;
    const client = await createClient();
    const { data, error } = await client.rpc("list_general_materials", { p_search: query.trim(), p_status: "active", p_limit: limit, p_offset: (page - 1) * limit });
    if (error) { const id = logger.error({ stage: "rpc", rpc_name: "list_general_materials", code: error.code, message: error.message }); return { ok: false, error: "Erro ao buscar materiais.", code: "unavailable", correlationId: id }; }
    try {
      const items = z.array(generalMaterialSchema).parse(data);
      return { ok: true, data: { items, total: items.length, page, totalPages: items.length === limit ? page + 1 : page } };
    } catch (e) { const id = logger.error({ stage: "interpretation", code: "ZOD_PARSE_ERROR", technical_detail: e instanceof z.ZodError ? e.issues.map(i => `${i.path.join(".")}:${i.code}:${i.message}`).join(";") : undefined, stack: e instanceof Error ? e.stack : undefined }); return { ok: false, error: "Erro de dados.", code: "unavailable", correlationId: id }; }
  } catch (e) { const id = logger.error({ stage: "context", code: "CONTEXT_ERROR", message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }); return { ok: false, error: "Acesso negado.", code: "forbidden", correlationId: id }; }
}
export async function fetchElectricityConfigAction(): Promise<Result<{ rate: number | null; defaultLoss: number; version: number }>> {
  const logger = createLogger("pricing", "getElectricityConfig");
  try {
    await requireBusinessContext("printers.read");
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_enterprise_config");
    if (error) { const id = logger.error({ stage: "rpc", rpc_name: "get_my_enterprise_config", code: error.code, message: error.message }); return { ok: false, error: "Erro ao carregar.", code: "unavailable", correlationId: id }; }
    try {
       if (!Array.isArray(data) || data.length !== 1) throw new Error("unexpected_response_shape");
       const row = z.object({ electricity_rate_per_kwh: z.coerce.number().nullable(), default_filament_loss_percent: z.coerce.number().min(0).max(100).default(0), version: z.coerce.number().int() }).parse(data[0]);
       return { ok: true, data: { rate: row.electricity_rate_per_kwh == null ? null : z.coerce.number().min(0).max(100).parse(row.electricity_rate_per_kwh), defaultLoss: row.default_filament_loss_percent, version: row.version } };
    } catch (error) { const id = logger.error({ stage: "interpretation", code: error instanceof z.ZodError ? "ZOD_PARSE_ERROR" : "UNEXPECTED_RESPONSE", message: error instanceof z.ZodError ? undefined : error instanceof Error ? error.message : String(error), technical_detail: error instanceof z.ZodError ? error.issues.map(i => `${i.path.join(".")}:${i.code}:${i.message}`).join(";") : undefined, stack: error instanceof Error ? error.stack : undefined }); return { ok: false, error: "Erro de dados.", code: "unavailable", correlationId: id }; }
  } catch (error) { const id = logger.error({ stage: "context", code: "CONTEXT_ERROR", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }); return { ok: false, error: "Acesso negado.", code: "forbidden", correlationId: id }; }
}

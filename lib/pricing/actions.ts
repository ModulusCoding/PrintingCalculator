"use server";

import { z } from "zod";
import { requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

const searchSchema = z.object({ query: z.string().max(200).default(""), page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(50).default(10) }).strict();
const printerSchema = z.object({ id: z.string().uuid(), name: z.string(), brand: z.string().nullable(), model: z.string().nullable(), purchase_price: z.coerce.number().nonnegative(), estimated_life_hours: z.coerce.number().positive(), average_power_watts: z.coerce.number().positive(), maintenance_cost_per_hour: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strict();
const materialSchema = z.object({ id: z.string().uuid(), name: z.string(), material_type: z.string(), brand: z.string().nullable(), color: z.string().nullable(), reference_weight_grams: z.coerce.number().positive(), reference_price: z.coerce.number().nonnegative(), active: z.boolean(), version: z.coerce.number().int().nonnegative() }).strict();
export type PrinterItem = z.infer<typeof printerSchema>;
export type MaterialItem = z.infer<typeof materialSchema>;
export type PaginatedPrinters = Page<PrinterItem>;
export type PaginatedMaterials = Page<MaterialItem>;
type Page<T> = { items: T[]; total: number; page: number; totalPages: number };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Search = { query?: string; page?: number; limit?: number };
const printerColumns = "id,name,brand,model,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour,active,version";
const materialColumns = "id,name,material_type,brand,color,reference_weight_grams,reference_price,active,version";
async function search<T>(table: "printers" | "materials", columns: string, schema: z.ZodType<T>, params: Search): Promise<Result<Page<T>>> {
  try {
    const ctx = await requireBusinessContext(table === "printers" ? "printers.read" : "materials.read");
    const { query, page, limit } = searchSchema.parse(params);
    const client = await createClient();
    let request = client.from(table).select(columns, { count: "exact" }).eq("enterprise_id", ctx.enterpriseId).eq("active", true).order("created_at", { ascending: false }).order("id", { ascending: false });
    if (query.trim()) request = request.ilike("name", `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`);
    const { data, count, error } = await request.range((page - 1) * limit, page * limit - 1);
    if (error) return { ok: false, error: "Erro ao buscar registros." };
    return { ok: true, data: { items: z.array(schema).parse(data), total: count ?? 0, page, totalPages: Math.ceil((count ?? 0) / limit) || 1 } };
  } catch { return { ok: false, error: "Acesso negado ou dados inválidos." }; }
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
export async function fetchElectricityRateAction(): Promise<Result<number | null>> {
  const result = await fetchElectricityConfigAction();
  return result.ok ? { ok: true, data: result.data.rate } : result;
}
export async function fetchElectricityConfigAction(): Promise<Result<{ rate: number | null; version: number }>> {
  try {
    await requireBusinessContext("printers.read");
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_enterprise_config");
    if (error || !Array.isArray(data) || data.length !== 1) return { ok: false, error: "Erro ao obter tarifa de energia." };
    const row = z.object({ electricity_rate_per_kwh: z.coerce.number().nullable(), version: z.coerce.number().int() }).parse(data[0]);
    return { ok: true, data: { rate: row.electricity_rate_per_kwh == null ? null : z.coerce.number().min(0).max(100).parse(row.electricity_rate_per_kwh), version: row.version } };
  } catch { return { ok: false, error: "Acesso negado ou tarifa inválida." }; }
}

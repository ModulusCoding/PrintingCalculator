"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { planErrorCode, planRpcErrorCode, type PlanErrorCode } from "@/lib/plans";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export type PrinterRecord = {
  id: string; name: string; brand: string | null; model: string | null;
  purchase_price: string; estimated_life_hours: string; average_power_watts: string;
  maintenance_cost_per_hour: string; active: boolean; version: number;
  created_at: string; updated_at: string;
};
export type PrinterResult =
  | { status: "success"; printerId: string; version: number }
  | { status: "invalid_input"; fieldErrors: Record<string, string[]> }
  | { status: PlanErrorCode | "session_expired" | "permission_denied" | "printer_unavailable" | "version_conflict" | "technical" | "unknown_result"; message?: string; version?: number };

const input = z.object({ name: z.string().trim().min(2).max(120), brand: z.string().trim().max(120), model: z.string().trim().max(160), purchasePrice: z.string(), estimatedLifeHours: z.string(), averagePowerWatts: z.string(), maintenanceCostPerHour: z.string() }).strict();
const uuid = z.string().uuid();
const numeric = z.union([z.string(), z.number()]);
const recordSchema = z.object({ id: uuid, name: z.string(), brand: z.string().nullable(), model: z.string().nullable(), purchase_price: numeric, estimated_life_hours: numeric, average_power_watts: numeric, maintenance_cost_per_hour: numeric, active: z.boolean(), version: z.number().int().nonnegative(), created_at: z.string(), updated_at: z.string() }).strict();
const rpcRowSchema = z.object({ status: z.enum(["success", "invalid_input", "session_expired", "permission_denied", "printer_unavailable", "version_conflict"]), printer_id: uuid.nullable(), version: z.number().int().nonnegative().nullable() }).strict();
const normalize = (row: z.infer<typeof recordSchema>): PrinterRecord => ({ ...row, purchase_price: String(row.purchase_price), estimated_life_hours: String(row.estimated_life_hours), average_power_watts: String(row.average_power_watts), maintenance_cost_per_hour: String(row.maintenance_cost_per_hour) });

function decimal(value: string, min: number, max: number, scale: number) {
  const v = value.trim();
  if (!v) return { error: "Este campo é obrigatório." };
  const pattern = scale === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:,\\d{1,${scale}})?$`);
  if (!pattern.test(v)) return { error: scale === 0 ? "Use somente dígitos inteiros." : `Use vírgula como separador, com até ${scale} casas decimais.` };
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? { value: v.replace(",", ".") } : { error: "Valor fora do limite." };
}
function validate(payload: unknown) {
  const parsed = input.safeParse(payload); if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const specs = [["purchasePrice", 0, 1000000, 2], ["estimatedLifeHours", 1, 100000, 0], ["averagePowerWatts", 0.01, 10000, 2], ["maintenanceCostPerHour", 0, 1000, 4]] as const;
  const values: Record<string, string> = {};
  for (const [key, min, max, scale] of specs) { const result = decimal(parsed.data[key], min, max, scale); if ("error" in result) return { errors: { [key]: [result.error] } }; values[key] = result.value; }
  return { data: { name: parsed.data.name, brand: parsed.data.brand, model: parsed.data.model, purchasePrice: values.purchasePrice, estimatedLifeHours: values.estimatedLifeHours, averagePowerWatts: values.averagePowerWatts, maintenanceCostPerHour: values.maintenanceCostPerHour } };
}
function failure(error: unknown): PrinterResult {
  unstable_rethrow(error);
  const planCode = planErrorCode(error);
  if (planCode) return { status: planCode };
  if (error instanceof AuthContextError) {
    if (error.code === "AUTH_UNAUTHENTICATED") return { status: "session_expired" };
    if (error.code === "AUTH_ACCESS_BLOCKED" || error.code === "AUTH_PERMISSION_DENIED") return { status: "permission_denied" };
  }
  return { status: "technical", message: "Erro técnico. Tente novamente." };
}
function refresh(id?: string) { try { revalidatePath("/impressoras"); if (id) revalidatePath(`/impressoras/${id}`); } catch (error) { unstable_rethrow(error); /* The committed RPC result remains successful. */ } }

export async function listPrinters(params: Record<string, string | undefined> = {}) {
  try {
    const c = await requireBusinessContext("printers.read"); const search = (params.search || "").trim().slice(0, 200); const status = ["active", "archived", "all"].includes(params.status || "") ? params.status! : "active"; const requested = Math.max(1, Math.min(10000, Number.parseInt(params.page || "1") || 1)); const s = await createClient();
    let countQuery = s.from("printers").select("id", { count: "exact", head: true }).eq("enterprise_id", c.enterpriseId); if (status === "active") countQuery = countQuery.eq("active", true); if (status === "archived") countQuery = countQuery.eq("active", false); const term = search.replace(/[\\%_,().]/g, ""); if (term) countQuery = countQuery.or(`name.ilike.%${term}%,brand.ilike.%${term}%,model.ilike.%${term}%`);
    const { count, error: countError } = await countQuery; if (countError) throw countError; const total = count || 0; const page = Math.min(requested, Math.max(1, Math.ceil(total / 20)));
    let rowsQuery = s.from("printers").select("id,name,brand,model,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour,active,version,created_at,updated_at").eq("enterprise_id", c.enterpriseId); if (status === "active") rowsQuery = rowsQuery.eq("active", true); if (status === "archived") rowsQuery = rowsQuery.eq("active", false); if (term) rowsQuery = rowsQuery.or(`name.ilike.%${term}%,brand.ilike.%${term}%,model.ilike.%${term}%`);
    const { data, error } = await rowsQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 20, page * 20 - 1); if (error) throw error; return { printers: (data || []).map((row: unknown) => normalize(recordSchema.parse(row))), total, page, status, search, error: null };
  } catch (e) { return { printers: [], total: 0, page: 1, status: "active", search: "", error: failure(e).status }; }
}
export async function getPrinter(id: string) { if (!uuid.safeParse(id).success) return { printer: null, error: "printer_unavailable" }; try { const c = await requireBusinessContext("printers.read"); const { data, error } = await (await createClient()).from("printers").select("id,name,brand,model,purchase_price,estimated_life_hours,average_power_watts,maintenance_cost_per_hour,active,version,created_at,updated_at").eq("enterprise_id", c.enterpriseId).eq("id", id).maybeSingle(); if (error || !data) return { printer: null, error: error ? "technical" : "printer_unavailable" }; return { printer: normalize(recordSchema.parse(data)), error: null }; } catch (e) { return { printer: null, error: failure(e).status }; } }
async function mutate(method: string, args: Record<string, unknown>, permission: "printers.write" | "printers.archive", id?: string): Promise<PrinterResult> { try { await requireBusinessContext(permission); const { data, error } = await (await createClient()).rpc(method, args); if (error) return { status: planRpcErrorCode(error) ?? "technical" }; if (!Array.isArray(data) || data.length !== 1) return { status: "unknown_result" }; const parsed = rpcRowSchema.safeParse(data[0]); if (!parsed.success) return { status: "unknown_result" }; const row = parsed.data; if (row.status === "success") { if (row.printer_id === null || row.version === null || (id !== undefined && row.printer_id !== id)) return { status: "unknown_result" }; refresh(row.printer_id); return { status: "success", printerId: row.printer_id, version: row.version }; } if (row.printer_id !== null || row.version !== null) return { status: "unknown_result" }; if (row.status === "invalid_input") return { status: "invalid_input", fieldErrors: {} }; return { status: row.status }; } catch (e) { return failure(e); } }
export async function createPrinter(payload: unknown) { const v = validate(payload); if ("errors" in v) return { status: "invalid_input", fieldErrors: v.errors ?? {} } as PrinterResult; return mutate("create_my_printer", { p_name: v.data.name, p_brand: v.data.brand, p_model: v.data.model, p_purchase_price: v.data.purchasePrice, p_estimated_life_hours: v.data.estimatedLifeHours, p_average_power_watts: v.data.averagePowerWatts, p_maintenance_cost_per_hour: v.data.maintenanceCostPerHour }, "printers.write"); }
export async function updatePrinter(id: string, expectedVersion: number, payload: unknown) { if (!uuid.safeParse(id).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { status: "printer_unavailable" } as PrinterResult; const v = validate(payload); if ("errors" in v) return { status: "invalid_input", fieldErrors: v.errors ?? {} } as PrinterResult; return mutate("update_my_printer", { p_id: id, p_expected_version: expectedVersion, p_name: v.data.name, p_brand: v.data.brand, p_model: v.data.model, p_purchase_price: v.data.purchasePrice, p_estimated_life_hours: v.data.estimatedLifeHours, p_average_power_watts: v.data.averagePowerWatts, p_maintenance_cost_per_hour: v.data.maintenanceCostPerHour }, "printers.write", id); }
export async function setPrinterActive(id: string, expectedVersion: number, active: boolean) { if (!uuid.safeParse(id).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || typeof active !== "boolean") return { status: "printer_unavailable" } as PrinterResult; return mutate("set_my_printer_active", { p_id: id, p_expected_version: expectedVersion, p_active: active }, "printers.archive", id); }

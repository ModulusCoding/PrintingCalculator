"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { planErrorCode, planRpcErrorCode } from "@/lib/plans";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { deleteEntity } from "@/lib/deletion/actions";
import { createMaterialSchema, createMovementSchema, updateProfileSchema, updateCostRefSchema, setActiveSchema, fieldErrors, pt, uuid, version } from "./validation";
import { createLogger } from "./logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";
import { materialSchema, materialListSchema, movementSchema, costHistorySchema, countSchema } from "./schemas";

export type MutationResult = { status: string; material_id?: string; movement_id?: string | null; version?: number; balance?: number; fieldErrors?: Record<string, string[]>; correlation_id?: string };
const known = new Set(["unauthorized", "material_unavailable", "version_conflict", "insufficient_balance", "invalid_input", "idempotency_conflict", "name_conflict", "incompatible_units", "nonrepresentable_conversion", "selection_required", "plan_feature_unavailable", "plan_limit_reached", "member_plan_blocked", "team_regularization_required"]);

function failure(e: unknown, logger: ReturnType<typeof createLogger>) {
  unstable_rethrow(e);
  const planCode = planErrorCode(e);
  if (planCode) return { status: planCode, correlation_id: undefined };
  const code = e instanceof AuthContextError ? (e.code === "AUTH_UNAUTHENTICATED" ? "session_expired" : e.code === "AUTH_TECHNICAL_FAILURE" || e.code === "AUTH_CONTEXT_INVALID_RESPONSE" ? "technical" : "permission_denied") : "technical";
  if (code !== "technical") return { status: code, correlation_id: undefined };
  const stage = e instanceof z.ZodError ? "interpretation" : "context";
  const cid = logger.error({ stage, ...safeErrorDiagnostic(e) });
  return { status: code, correlation_id: cid };
}

const resultSchema = z.object({ status: z.enum(["created", "updated", "idempotent", "no_change", "version_conflict"]), material_id: uuid.optional(), movement_id: uuid.nullable().optional(), version: version.optional(), balance: z.number().optional() }).strict();

async function mutate(name: string, args: Record<string, unknown>, permission: "stock.materials.write" | "stock.materials.archive", expected?: number): Promise<MutationResult> {
  const logger = createLogger("general-materials", name);
  try {
    await requireBusinessContext(permission);
    const client = await createClient();
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const planCode = planRpcErrorCode(error);
      if (planCode) return { status: planCode };
      const code = error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");
      if (!known.has(code)) logger.warn({ stage: "rpc", rpc_name: name, ...safeErrorDiagnostic(error) });
      return { status: known.has(code) ? code : "uncertain", correlation_id: logger.id };
    }
    const parsed = z.array(resultSchema).length(1).safeParse(data);
    if (!parsed.success) {
      logger.error({ stage: "interpretation", message: "Failed parsing RPC response" });
      return { status: "uncertain", correlation_id: logger.id };
    }
    const r = parsed.data[0];
    if (expected !== undefined && !["idempotent", "no_change", "version_conflict"].includes(r.status) && r.version !== expected + 1) {
      logger.warn({ stage: "interpretation", message: "Unexpected version sequence", code: "version_mismatch" });
      return { status: "uncertain", correlation_id: logger.id };
    }
    try { revalidatePath("/estoque/materiais-gerais", "layout"); } catch (e) { unstable_rethrow(e); logger.warn({ stage: "revalidation", message: String(e) }); }
    return { status: r.status, material_id: r.material_id, movement_id: r.movement_id, version: r.version, balance: r.balance };
  } catch (e) {
    return failure(e, logger);
  }
}
export async function listGeneralMaterials(params: Record<string, string | undefined> = {}) {
  const logger = createLogger("general-materials", "listGeneralMaterials");
  const page = Math.min(5001, Math.max(1, Math.floor(Number(params.page) || 1)));
  const search = (params.search || "").trim().slice(0, 120);
  const status = ["active", "archived", "all"].includes(params.status || "") ? params.status : "active";
  try {
    await requireBusinessContext("stock.materials.read");
    const c = await createClient();
    const [list, count] = await Promise.all([
      c.rpc("list_general_materials", { p_search: search, p_status: status, p_limit: 20, p_offset: (page - 1) * 20 }),
      c.rpc("count_general_materials", { p_search: search, p_status: status })
    ]);
    if (list.error || count.error) {
      const cid = logger.error({ stage: "rpc", ...safeErrorDiagnostic(list.error || count.error) });
      return { materials: [], total: 0, page, error: "technical", correlation_id: cid };
    }
    const parsedMaterials = z.array(materialListSchema).max(20).safeParse(list.data);
    if (!parsedMaterials.success) {
      const cid = logger.error({ stage: "interpretation", message: "Failed parsing list_general_materials response", ...safeErrorDiagnostic(parsedMaterials.error) });
      return { materials: [], total: 0, page, error: "technical", correlation_id: cid };
    }
    const parsedCount = countSchema.safeParse(count.data);
    if (!parsedCount.success) {
      const cid = logger.error({ stage: "interpretation", message: "Failed parsing count_general_materials response" });
      return { materials: [], total: 0, page, error: "technical", correlation_id: cid };
    }
    return { materials: parsedMaterials.data, total: parsedCount.data, page, error: null, correlation_id: null };
  } catch (e) {
    const result = failure(e, logger);
    return { materials: [], total: 0, page, error: result.status, correlation_id: result.correlation_id };
  }
}
export async function deleteGeneralMaterial(payload: unknown): Promise<MutationResult> { return deleteEntity("general_material", payload) as Promise<MutationResult>; }
export async function createGeneralMaterial(payload: unknown) {
  const logger = createLogger("general-materials", "createGeneralMaterial");
  const v = createMaterialSchema.safeParse(payload);
  if (!v.success) {
    logger.warn({ stage: "validation", message: "Zod validation failed", code: Object.keys(v.error.flatten().fieldErrors).join(",") || "_form", technical_detail: v.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",") });
    return { status: "invalid_input", fieldErrors: fieldErrors(v.error), correlation_id: logger.id };
  }
  const d = v.data;
  return mutate("create_general_material", { p_attempt_id: d.attempt_id, p_name: d.name, p_unit: d.control_unit, p_reference_quantity: pt(d.reference_quantity), p_reference_price: pt(d.reference_price), p_opening_quantity: pt(d.opening_quantity) }, "stock.materials.write");
}
export async function moveGeneralMaterial(payload: unknown) {
  const logger = createLogger("general-materials", "moveGeneralMaterial");
  const v = createMovementSchema.safeParse(payload);
  if (!v.success) {
    logger.warn({ stage: "validation", message: "Zod validation failed", code: Object.keys(v.error.flatten().fieldErrors).join(",") || "_form", technical_detail: v.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",") });
    return { status: "invalid_input", fieldErrors: fieldErrors(v.error), correlation_id: logger.id };
  }
  const d = v.data;
  return mutate("move_general_material", { p_attempt_id: d.attempt_id, p_material_id: d.material_id, p_expected_version: d.expected_version, p_type: d.movement_type, p_unit: d.supplied_unit, p_quantity: pt("quantity" in d ? d.quantity : d.counted_balance), p_reason: d.reason }, "stock.materials.write", d.expected_version);
}
export async function updateGeneralMaterialProfile(payload: unknown) {
  const logger = createLogger("general-materials", "updateGeneralMaterialProfile");
  const v = updateProfileSchema.safeParse(payload);
  if (!v.success) {
    logger.warn({ stage: "validation", message: "Zod validation failed", code: Object.keys(v.error.flatten().fieldErrors).join(",") || "_form", technical_detail: v.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",") });
    return { status: "invalid_input", fieldErrors: fieldErrors(v.error), correlation_id: logger.id };
  }
  const d = v.data;
  return mutate("update_general_material_profile", { p_attempt_id: d.attempt_id, p_material_id: d.material_id, p_expected_version: d.expected_version, p_name: d.name }, "stock.materials.archive", d.expected_version);
}
export async function updateGeneralMaterialCostReference(payload: unknown) {
  const logger = createLogger("general-materials", "updateGeneralMaterialCostReference");
  const v = updateCostRefSchema.safeParse(payload);
  if (!v.success) {
    logger.warn({ stage: "validation", message: "Zod validation failed", code: Object.keys(v.error.flatten().fieldErrors).join(",") || "_form", technical_detail: v.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",") });
    return { status: "invalid_input", fieldErrors: fieldErrors(v.error), correlation_id: logger.id };
  }
  const d = v.data;
  return mutate("update_general_material_cost_reference", { p_attempt_id: d.attempt_id, p_material_id: d.material_id, p_expected_version: d.expected_version, p_reference_quantity: pt(d.reference_quantity), p_reference_price: pt(d.reference_price) }, "stock.materials.archive", d.expected_version);
}
export async function setGeneralMaterialActive(payload: unknown) {
  const logger = createLogger("general-materials", "setGeneralMaterialActive");
  const v = setActiveSchema.safeParse(payload);
  if (!v.success) {
    logger.warn({ stage: "validation", message: "Zod validation failed", code: Object.keys(v.error.flatten().fieldErrors).join(",") || "_form", technical_detail: v.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",") });
    return { status: "invalid_input", fieldErrors: fieldErrors(v.error), correlation_id: logger.id };
  }
  const d = v.data;
  return mutate("set_general_material_active", { p_attempt_id: d.attempt_id, p_material_id: d.material_id, p_expected_version: d.expected_version, p_active: d.active }, "stock.materials.archive", d.expected_version);
}
export async function getGeneralMaterial(id: string, page = 1) {
  const logger = createLogger("general-materials", "getGeneralMaterial");
  if (!uuid.safeParse(id).success) return { material: null, movements: [], history: [], total: 0, error: "material_unavailable", correlation_id: logger.id };
  try {
    const context = await requireBusinessContext("stock.materials.read");
    const c = await createClient();
    const { data, error } = await c.rpc("get_general_material", { p_material_id: id });
    if (error) {
      logger.error({ stage: "rpc", rpc_name: "get_general_material", ...safeErrorDiagnostic(error) });
      return { material: null, movements: [], history: [], total: 0, error: "technical", correlation_id: logger.id };
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return { material: null, movements: [], history: [], total: 0, error: "material_unavailable", correlation_id: logger.id };
    const parsedMaterial = materialSchema.safeParse(rows[0]);
    if (!parsedMaterial.success) {
      const cid = logger.error({ stage: "interpretation", message: "Failed parsing get_general_material response", ...safeErrorDiagnostic(parsedMaterial.error) });
      return { material: null, movements: [], history: [], total: 0, error: "technical", correlation_id: cid };
    }
    const material = parsedMaterial.data;
    const [mov, hist] = await Promise.all([c.rpc("list_general_material_movements", { p_material_id: id, p_limit: 20, p_offset: (page - 1) * 20 }), c.rpc("list_general_material_cost_history", { p_material_id: id, p_limit: 20, p_offset: 0 })]);
    if (mov.error || hist.error) {
      const cid = logger.error({ stage: "rpc", ...safeErrorDiagnostic(mov.error || hist.error) });
      return { material: null, movements: [], history: [], total: 0, error: "technical", correlation_id: cid };
    }
    const parsedMov = z.array(movementSchema).safeParse(mov.data);
    const parsedHist = z.array(costHistorySchema).safeParse(hist.data);
    if (!parsedMov.success || !parsedHist.success) {
      const cid = logger.error({ stage: "interpretation", message: "Failed parsing movements or cost history response" });
      return { material: null, movements: [], history: [], total: 0, error: "technical", correlation_id: cid };
    }
    return { material, movements: parsedMov.data, history: parsedHist.data, total: 0, context, error: null, correlation_id: null };
  } catch (e) {
    const result = failure(e, logger);
    return { material: null, movements: [], history: [], total: 0, error: result.status, correlation_id: result.correlation_id };
  }
}

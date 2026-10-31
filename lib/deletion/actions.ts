"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { unstable_rethrow } from "next/navigation";
import { planErrorCode, planRpcErrorCode } from "@/lib/plans";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

function deletionLog(operation: string, stage: string, code: string, correlation: string) {
  console.info(JSON.stringify({ operation, stage, code, correlation }));
}

const versionSchema = z.union([z.number(), z.string().regex(/^(0|[1-9]\d*)$/).transform(Number)]).pipe(z.number().int().nonnegative().refine(Number.isSafeInteger));
const inputSchema = z.object({ id: z.string().uuid(), attempt_id: z.string().uuid(), expected_version: versionSchema }).strict();
const entities = {
  product: { rpc: "delete_internal_product", key: "product_id", arg: "p_id", permission: "products.delete" },
  spool: { rpc: "delete_filament_spool", key: "spool_id", arg: "p_spool_id", permission: "spools.delete" },
  general_material: { rpc: "delete_general_material", key: "material_id", arg: "p_material_id", permission: "stock.materials.delete" },
} as const;
export type DeleteEntity = keyof typeof entities;
export type DeleteResult = { status: string };
const known = new Set(["invalid_input", "version_conflict", "balance_not_zero", "idempotency_conflict", "product_unavailable", "spool_unavailable", "material_unavailable", "unauthorized"]);

export async function deleteEntity(entity: DeleteEntity, payload: unknown): Promise<DeleteResult> {
  const correlation = crypto.randomUUID();
  deletionLog("deleteEntity", "start", "attempt", correlation);
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success || !Object.hasOwn(entities, entity)) {
    deletionLog("deleteEntity", "validate", "invalid_input", correlation);
    return { status: "invalid_input" };
  }
  const config = entities[entity];
  let dispatched = false;
  try {
    await requireBusinessContext(config.permission as Parameters<typeof requireBusinessContext>[0]);
    const client = await createClient();
    dispatched = true;
    deletionLog("deleteEntity", "rpc:dispatch", "dispatched", correlation);
    const { data, error } = await client.rpc(config.rpc, { p_attempt_id: parsed.data.attempt_id, [config.arg]: parsed.data.id, p_expected_version: parsed.data.expected_version });
    if (error) {
      const planCode = planRpcErrorCode(error);
      if (planCode) return { status: planCode };
      const code = error.message.replace(/^(?:ERROR: |[A-Z0-9]{5}: )/, "");
      if (known.has(code)) {
        if (code === "unauthorized") {
          deletionLog("deleteEntity", "rpc:response", "permission_denied", correlation);
          return { status: "permission_denied" };
        }
        deletionLog("deleteEntity", "rpc:response", code, correlation);
        return { status: code };
      }
      deletionLog("deleteEntity", "rpc:response", "uncertain", correlation);
      return { status: "uncertain" };
    }
    const result = z.array(z.object({ status: z.literal("deleted"), [config.key]: z.string().uuid(), version: z.coerce.number().int().nonnegative().refine(Number.isSafeInteger) }).strict()).length(1).safeParse(data);
    if (!result.success || result.data[0][config.key] !== parsed.data.id || result.data[0].version !== parsed.data.expected_version + 1) {
      deletionLog("deleteEntity", "rpc:response", "uncertain", correlation);
      return { status: "uncertain" };
    }
    deletionLog("deleteEntity", "rpc:response", "deleted", correlation);
    try {
      for (const path of ["/admin", "/admin/products", "/estoque/carreteis", "/estoque/materiais-gerais", "/estoque/produtos", "/precificadora"]) revalidatePath(path);
    } catch (e) {
      deletionLog("deleteEntity", "revalidate", "failed", correlation);
      unstable_rethrow(e);
    }
    deletionLog("deleteEntity", "complete", "deleted", correlation);
    return { status: "deleted" };
  } catch (error) {
    unstable_rethrow(error);
    const planCode = planErrorCode(error);
    if (planCode) return { status: planCode };
    if (dispatched) {
      deletionLog("deleteEntity", "catch", "uncertain", correlation);
      return { status: "uncertain" };
    }
    if (error instanceof AuthContextError && !["AUTH_TECHNICAL_FAILURE", "AUTH_CONTEXT_INVALID_RESPONSE"].includes(error.code)) {
      return { status: error.code === "AUTH_UNAUTHENTICATED" ? "session_expired" : "permission_denied" };
    }
    createLogger("deletion", "deleteEntity").error({ stage: "context", ...safeErrorDiagnostic(error) });
    return { status: "technical" };
  }
}

export async function getDeletionCounts() {
  try {
    await requireBusinessContext("products.read");
    const { data, error } = await (await createClient()).rpc("get_my_deletion_counts");
    if (error) return { counts: null, error: "technical" };
    const count = z.coerce.number().int().nonnegative().refine(Number.isSafeInteger);
    const parsed = z.array(z.object({ products: count, filament_spools: count, general_materials: count, shared_total: count }).strict()).length(1).safeParse(data);
    return parsed.success ? { counts: parsed.data[0], error: null } : { counts: null, error: "technical" };
  } catch (error) {
    unstable_rethrow(error);
    const planCode = planErrorCode(error);
    if (planCode) return { counts: null, error: planCode };
    if (error instanceof AuthContextError && !["AUTH_TECHNICAL_FAILURE", "AUTH_CONTEXT_INVALID_RESPONSE"].includes(error.code)) return { counts: null, error: "permission_denied" };
    const correlationId = createLogger("deletion", "getDeletionCounts").error({ stage: "context", ...safeErrorDiagnostic(error) });
    return { counts: null, error: "technical", correlationId };
  }
}

import "server-only";

import { z } from "zod";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";
import { PLAN_CAPABILITIES, PlanAccessError, PlanTechnicalError, planRpcErrorCode, requirePlanBusinessAccess } from "@/lib/plans";

const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const capacitySchema = z.array(z.object({ used: count, capacity_limit: count.nullable() }).strict()).length(1);
export type CreationResource = "products" | "shared_materials";

/** Presentation only: transactional quota enforcement remains in SQL. Never
 * infer capacity from a filtered page or from the three-product RLS window.
 * This check is for creation, never a prerequisite for reading/moving records.
 */
export async function getCreationCapacity(resource: CreationResource): Promise<{ limit: number | null; used: number; canCreate: boolean }> {
  const access = await requirePlanBusinessAccess({ paid: resource === "shared_materials" });
  const limit = resource === "products" ? PLAN_CAPABILITIES[access.effective_plan].products : PLAN_CAPABILITIES[access.effective_plan].sharedMaterials;
  try {
    const client = await createClient();
    // Unlike the owner-only plan dashboard, this aggregate endpoint is scoped
    // to the resource's existing write permission (including paid operators).
    const { data, error } = await client.rpc("get_my_creation_capacity", { p_resource: resource });
    if (error) {
      const planCode = planRpcErrorCode(error);
      if (planCode) throw new PlanAccessError(planCode);
      throw error;
    }
    const capacity = capacitySchema.parse(data)[0];
    if (capacity.capacity_limit !== limit) throw new Error("Inconsistent authoritative creation capacity");
    return { limit, used: capacity.used, canCreate: limit === null || capacity.used < limit };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PlanAccessError) throw error;
    const correlationId = createLogger("plans", "creation-capacity").error({ stage: error instanceof z.ZodError ? "interpretation" : "rpc", rpc_name: "get_my_creation_capacity", ...safeErrorDiagnostic(error) });
    throw new PlanTechnicalError(correlationId);
  }
}

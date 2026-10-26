import "server-only";

import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import { requireBusinessContext, type Permission } from "@/lib/auth/context";
import { permissionRequiresVisionario } from "@/lib/plans/permission-capabilities";
import { getMyPlanAccess, PlanAccessError } from "@/lib/plans";
import { PaidModuleNotice, type PaidModule } from "./PaidModuleNotice";
import { planAccessNotice } from "./PlanAccessNotice";

/** Invoke at the page entry, not just in a layout: Next can render children in
 * parallel with layouts. The loader is never invoked on an unauthorized plan.
 * Actions independently revalidate authorization to handle mid-request changes.
 */
export async function renderPaidModule(module: PaidModule, permission: Permission, load: () => Promise<ReactNode> | ReactNode) {
  try {
    await requireBusinessContext(permission);
    return await load();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PlanAccessError && error.code === "plan_feature_unavailable" && permissionRequiresVisionario(permission)) {
      try {
        const access = await getMyPlanAccess();
        if (!access) throw new Error("Missing authoritative plan response");
        if (access.selection_required) throw new PlanAccessError("selection_required");
        return <PaidModuleNotice module={module} downgraded={access.access_state === "expired" || access.access_state === "cancelled"} />;
      } catch (planError) {
        return planAccessNotice(planError);
      }
    }
    return planAccessNotice(error);
  }
}

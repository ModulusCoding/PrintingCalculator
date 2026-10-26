import "server-only";

import { unstable_rethrow } from "next/navigation";
import { AuthContextError, requireBusinessContext, type Permission } from "@/lib/auth/context";
import { PlanAccessError, PlanTechnicalError } from "@/lib/plans";
import { getCreationCapacity } from "@/lib/plans/creation-access";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

export function productFailure(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof PlanAccessError) return { status: error.code };
  if (error instanceof AuthContextError) {
    if (error.code === "AUTH_UNAUTHENTICATED") return { status: "session_expired" as const };
    if (error.code === "AUTH_PERMISSION_DENIED" || error.code === "AUTH_ACCESS_BLOCKED") return { status: "permission_denied" as const };
  }
  const reference = error instanceof PlanTechnicalError ? error.correlationId : createLogger("products", "access").error({ stage: "query", ...safeErrorDiagnostic(error) });
  return { status: "technical" as const, reference };
}

export async function productPermission(permission: Permission) {
  try {
    await requireBusinessContext(permission);
    return true;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && (error.code === "AUTH_PERMISSION_DENIED" || error.code === "AUTH_ACCESS_BLOCKED")) return false;
    throw error;
  }
}

export async function productCreationCapacity() {
  try {
    return { capacity: await getCreationCapacity("products"), failure: null };
  } catch (error) {
    return { capacity: null, failure: productFailure(error) };
  }
}

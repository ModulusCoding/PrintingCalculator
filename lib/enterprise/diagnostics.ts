import "server-only";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

/** No rows, form values, tenant IDs, tokens or raw SDK objects are logged. */
export function diagnoseCompany(operation: string, stage: "context" | "rpc" | "interpretation", error: unknown) {
  return createLogger("enterprise", operation).error({ stage, ...safeErrorDiagnostic(error) });
}

import "server-only";

import { unstable_rethrow } from "next/navigation";
import { safeErrorDiagnostic } from "./safe-error";
import { AuthContextError } from "@/lib/auth/context";
import { createLogger } from "@/lib/general-materials/logger";
import { PlanAccessError, PlanTechnicalError, type PlanErrorCode } from "@/lib/plans";

export function pricingPlanMessage(code: PlanErrorCode): string {
  const messages: Record<PlanErrorCode, string> = {
    selection_required: "Selecione um plano para continuar.",
    member_plan_blocked: "O plano da empresa não permite o acesso de membros. Contate o proprietário.",
    team_regularization_required: "Regularize a equipe para continuar.",
    plan_feature_unavailable: "Este recurso não está disponível no plano atual.",
    plan_limit_reached: "O limite do plano foi atingido.",
    authorization_conflict: "As permissões foram alteradas. Atualize a página e tente novamente.",
    idempotency_conflict: "Esta tentativa já foi utilizada com outros dados. Inicie uma nova tentativa.",
  };
  return messages[code];
}

type Stage = "validation" | "context" | "query" | "rpc" | "interpretation";
type Diagnostic = { stage: Stage; operation?: string };

// Preserve the original database code and sanitized diagnostics, never raw rows or stacks.
export function logPricingFailure(logger: ReturnType<typeof createLogger>, error: unknown, { stage, operation }: Diagnostic): string {
  unstable_rethrow(error);
  if (error instanceof PlanAccessError) return logger.id;
  if (error instanceof PlanTechnicalError) return error.correlationId;
  return logger.error({ stage, rpc_name: operation, ...safeErrorDiagnostic(error) });
}

export function pricingContextFailure(logger: ReturnType<typeof createLogger>, error: unknown) {
  unstable_rethrow(error);
  if (error instanceof PlanAccessError) {
    return { ok: false as const, code: error.code, error: pricingPlanMessage(error.code) };
  }
  const correlationId = logPricingFailure(logger, error, error instanceof AuthContextError ? { stage: "context" } : { stage: "query" });
  return {
    ok: false as const,
    error: error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED" ? "Acesso negado." : "Serviço indisponível.",
    code: error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED" ? "forbidden" as const : "unavailable" as const,
    correlationId,
  };
}

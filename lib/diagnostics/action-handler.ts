import "server-only";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AuthContextError } from "@/lib/auth/context";
import { createLogger } from "@/lib/general-materials/logger";

type Stage = "validation" | "context" | "query" | "rpc" | "interpretation";
type Diagnostic = { stage: Stage; operation?: string };

// Never log exception messages, Zod issue messages/received values, or raw stack headers.
// Paths are derived from schema keys and array positions, but still restrict their alphabet.
export function logPricingFailure(logger: ReturnType<typeof createLogger>, error: unknown, { stage, operation }: Diagnostic): string {
  unstable_rethrow(error);
  const isZod = error instanceof z.ZodError;
  const code = error instanceof AuthContextError ? error.code : isZod ? "ZOD_PARSE_ERROR" : "TECHNICAL_FAILURE";
  const technical_detail = isZod
    ? error.issues.map(issue => `${issue.path.map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)).join(".") || "<root>"}:${issue.code}`).join(";").slice(0, 1000)
    : error instanceof Error && error.stack
      ? error.stack.split("\n").slice(1, 7).map(frame => frame.trim()).filter(frame => /^at (?:[\w.$<>-]+\s+)?\(?[\w./\\:@ ()-]+:\d+:\d+\)?$/.test(frame)).join("\n")
      : undefined;
  return logger.error({ stage, rpc_name: operation, code, technical_detail });
}

export function pricingContextFailure(logger: ReturnType<typeof createLogger>, error: unknown) {
  const correlationId = logPricingFailure(logger, error, error instanceof AuthContextError ? { stage: "context" } : { stage: "query" });
  return {
    ok: false as const,
    error: error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED" ? "Acesso negado." : "Serviço indisponível.",
    code: error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED" ? "forbidden" as const : "unavailable" as const,
    correlationId,
  };
}

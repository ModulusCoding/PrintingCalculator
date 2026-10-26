import { z } from "zod";

// Only diagnostics, never the request/response payload. SQL values and common
// credential/PII formats are removed before any exception text reaches a logger.
function safeText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value
    .replace(/(?:Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+/gi, "[token]")
    .replace(/\b(?:https?:\/\/|postgres(?:ql)?:\/\/)[^\s]+/gi, "[url]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/(?:Failing row contains|Key \().*/gi, "[row details redacted]")
    .replace(/'[^']*'/g, "'[value]'")
    .replace(/"[^"]*"/g, '"[identifier]"')
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 800);
}

export function safeErrorDiagnostic(error: unknown) {
  if (error instanceof z.ZodError) {
    return {
      code: "ZOD_PARSE_ERROR",
      technical_detail: error.issues.map(issue => `${issue.path.map(part => String(part).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)).join(".") || "<root>"}:${issue.code}`).join(";").slice(0, 1000),
    };
  }
  const source = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const code = typeof source.code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(source.code) ? source.code : "TECHNICAL_FAILURE";
  return {
    code,
    technical_detail: [
      safeText(source.message),
      safeText(source.details) && `details=${safeText(source.details)}`,
      safeText(source.hint) && `hint=${safeText(source.hint)}`,
    ].filter(Boolean).join("; ") || "No safe technical detail supplied",
  };
}

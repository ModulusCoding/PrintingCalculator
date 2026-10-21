import "server-only";

type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  correlation_id: string;
  scope: string;
  operation: string;
  stage: "validation" | "context" | "rpc" | "interpretation" | "revalidation" | "navigation";
  rpc_name?: string;
  code?: string;
  message?: string;
  technical_detail?: string;
  stack?: string;
}

export function createLogger(scope: string, operation: string) {
  const correlation_id = crypto.randomUUID().slice(0, 8);
  
  const log = (level: LogLevel, payload: Omit<LogPayload, "correlation_id" | "scope" | "operation">) => {
    const full = { correlation_id, scope, operation, ...payload };
    // In development, Next.js terminal shows console output.
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] [${full.correlation_id}] ${full.scope}:${full.operation} stage=${full.stage}${full.rpc_name ? ` rpc=${full.rpc_name}` : ""}${full.code ? ` code=${full.code}` : ""}${full.message ? ` msg="${full.message}"` : ""}`;
    
    if (level === "error") {
      console.error(entry, full.technical_detail || "", full.stack || "");
    } else if (level === "warn") {
      console.warn(entry);
    } else {
      console.info(entry);
    }
    return correlation_id;
  };

  return {
    id: correlation_id,
    info: (payload: Omit<LogPayload, "correlation_id" | "scope" | "operation" | "level">) => log("info", payload),
    warn: (payload: Omit<LogPayload, "correlation_id" | "scope" | "operation" | "level">) => log("warn", payload),
    error: (payload: Omit<LogPayload, "correlation_id" | "scope" | "operation" | "level">) => log("error", payload),
  };
}

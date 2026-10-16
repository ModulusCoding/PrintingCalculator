import "server-only";

// Temporary development-only timing diagnostics. Do not log inputs, SDK objects or credentials.
export function loadTrace(scope: string) {
  const enabled = process.env.NODE_ENV === "development";
  const id = enabled ? crypto.randomUUID().slice(0, 8) : "";
  const started = performance.now();
  const mark = (stage: string) => {
    if (enabled) console.info(`[load-trace] ${scope} ${id} ${stage} ${Math.round(performance.now() - started)}ms`);
  };
  return { mark };
}

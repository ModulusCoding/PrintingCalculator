import { z } from "zod";
export const MAX_UNITS = 1_000_000_000;
export const MAX_VERSION = Number.MAX_SAFE_INTEGER;
export const uuid = z.uuid();
export const safeInteger = z.number().int().min(0).max(MAX_VERSION);
const unitText = /^(?:0|[1-9]\d*)$/;
export function parseUnits(value: unknown, allowZero: boolean): number | null {
  if (typeof value !== "string" || !unitText.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_UNITS && (allowZero || parsed > 0) ? parsed : null;
}
export const movementInputSchema = z.object({
  attemptId: uuid, productId: uuid, expectedVersion: safeInteger,
  movementType: z.enum(["entry", "exit", "adjustment"]),
  quantity: z.string().optional(), countedBalance: z.string().optional(), reason: z.string(),
}).strict().superRefine((value, ctx) => {
  const reason = value.reason.trim();
  if (!reason || reason.length > 500) ctx.addIssue({ code: "custom", path: ["reason"], message: "Informe um motivo entre 1 e 500 caracteres." });
  if (value.movementType === "adjustment") {
    if (value.quantity !== undefined || parseUnits(value.countedBalance, true) === null) ctx.addIssue({ code: "custom", path: ["countedBalance"], message: "Informe um saldo contado inteiro entre 0 e 1.000.000.000." });
  } else if (value.countedBalance !== undefined || parseUnits(value.quantity, false) === null) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Informe uma quantidade inteira entre 1 e 1.000.000.000." });
});
export function fieldErrors(error: z.ZodError) { return error.flatten().fieldErrors; }

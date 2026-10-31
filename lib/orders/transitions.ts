import { z } from "zod";
import { reasonSchema } from "./operation-schema";

// FLEX: all 20 distinct common pairs; the 10 regressions require a reason.
const stages = ["em_conversao", "orcado", "pago", "modelando", "imprimindo"];
export const TRANSITIONS: Record<string, Record<string, boolean>> = {
  ...Object.fromEntries(stages.map((from,i)=>[from,Object.fromEntries(stages.flatMap((to,j)=>i===j?[]:[[to,j<i]]))])),
  entregue: {}, cancelado: {},
};
export function destinations(from: string): string[] { return Object.keys(TRANSITIONS[from] ?? {}); }
export function canTransition(from: string, to: string): boolean { return Object.hasOwn(TRANSITIONS[from] ?? {}, to); }
export function needsReason(from: string, to: string): boolean { return TRANSITIONS[from]?.[to] === true; }
// No reordering or command when canceled, outside a column, or in the same column.
export function dropDestination(from:string, target:unknown, canceled:boolean): string | null {
  return !canceled && typeof target === "string" && Object.hasOwn(TRANSITIONS,target) && target !== from ? target : null;
}
export const transitionInputSchema = z.object({
  attemptId: z.string().uuid(), orderId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  targetStatus: z.enum(["em_conversao", "orcado", "pago", "modelando", "imprimindo"]),
  reason: reasonSchema.nullable(),
}).strict();
export type TransitionInput = z.infer<typeof transitionInputSchema>;

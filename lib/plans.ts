import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { unstable_rethrow } from "next/navigation";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

/** Commercial display names; technical identifiers remain stable. */
export const PLAN_LABELS = {
  free: "Aprendiz",
  intermediate: "Visionário",
  advanced: "Magnata (em breve)",
} as const;

export const PLAN_CAPABILITIES = {
  free: { priceCents: 0, products: 3, sharedMaterials: 0, orders: 3, customers: 3, operators: 0, integratedPricing: false },
  intermediate: { priceCents: 3990, products: null, sharedMaterials: 15, orders: null, customers: 15, operators: 1, integratedPricing: true },
  advanced: { priceCents: 7990, products: null, sharedMaterials: null, orders: null, customers: null, operators: 3, integratedPricing: true, available: false },
} as const;

const accessSchema = z.object({
  enterprise_id: z.string().uuid(), selected_plan: z.enum(["free", "intermediate", "advanced"]).nullable(),
  effective_plan: z.enum(["free", "intermediate", "advanced"]),
  access_state: z.enum(["selection_required", "free", "paid", "expired", "cancelled"]),
  paid_until: z.string().datetime({ offset: true }).nullable(), cancelled_at: z.string().datetime({ offset: true }).nullable(),
  authorization_version: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)), selection_required: z.boolean(),
}).strict().superRefine((access, ctx) => {
  const selected = !access.selection_required && access.selected_plan !== null;
  const consistent = access.selection_required
    ? access.access_state === "selection_required" && access.selected_plan === null && access.effective_plan === "free"
    : selected && (access.access_state === "paid"
      ? access.selected_plan === "intermediate" && access.effective_plan === "intermediate"
      : ["free", "expired", "cancelled"].includes(access.access_state) && access.effective_plan === "free");
  if (!consistent) ctx.addIssue({ code: "custom", path: ["access_state"], message: "Inconsistent authoritative plan state" });
});
export type PlanAccess = z.infer<typeof accessSchema>;

/** Reads DB authority on every request; never trusts JWT/browser selection. */
export async function getMyPlanAccess(): Promise<PlanAccess | null> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_plan_access");
    if (error) throw error;
    return accessSchema.array().length(1).parse(data)[0];
  } catch (error) {
    unstable_rethrow(error);
    throw planTechnicalFailure("get_my_plan_access", error);
  }
}

export type PlanStatus =
  | "allowed"
  | "selection_required"
  | "member_plan_blocked"
  | "team_regularization_required";

export type PlanAccessState = {
  status: PlanStatus;
  effective_plan: "free" | "intermediate";
  access_state: "selection_required" | "free" | "paid" | "expired" | "cancelled";
};

const businessAccessSchema = z.object({
  status: z.enum(["allowed", "selection_required", "member_plan_blocked", "team_regularization_required"]),
  effective_plan: z.enum(["free", "intermediate"]),
  access_state: z.enum(["selection_required", "free", "paid", "expired", "cancelled"]),
}).strict().superRefine((access, ctx) => {
  const consistent = access.access_state === "paid"
    ? access.effective_plan === "intermediate"
    : access.effective_plan === "free";
  if (!consistent || (access.access_state === "selection_required") !== (access.status === "selection_required")) {
    ctx.addIssue({ code: "custom", path: ["access_state"], message: "Inconsistent authoritative plan state" });
  }
});

/** DB authority combines the owner's plan and team membership; never infer this in UI code. */
export async function requirePlanBusinessAccess(options: { paid?: boolean; apply?: boolean; allowSelection?: boolean } = {}): Promise<PlanAccessState> {
  let access: PlanAccessState;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_plan_business_access");
    if (error) throw error;
    access = businessAccessSchema.array().length(1).parse(data)[0];
  } catch (error) {
    unstable_rethrow(error);
    throw planTechnicalFailure("get_my_plan_business_access", error);
  }
  if (access.status !== "allowed" && !(options.allowSelection && access.status === "selection_required")) throw new PlanAccessError(access.status);
  if (options.paid && (access.effective_plan !== "intermediate" || access.access_state !== "paid")) throw new PlanAccessError("plan_feature_unavailable");
  if (options.apply && access.status !== "allowed") throw new PlanAccessError(access.status as PlanErrorCode);
  return access;
}

export type PlanErrorCode = "selection_required" | "member_plan_blocked" | "team_regularization_required" | "plan_feature_unavailable" | "plan_limit_reached" | "authorization_conflict" | "idempotency_conflict";
export class PlanAccessError extends Error {
  constructor(readonly code: PlanErrorCode) {
    super(code);
    this.name = "PlanAccessError";
  }
}

export class PlanTechnicalError extends Error {
  constructor(readonly correlationId: string) {
    super("PLAN_ACCESS_UNAVAILABLE");
    this.name = "PlanTechnicalError";
  }
}

function planTechnicalFailure(operation: string, error: unknown) {
  const correlationId = createLogger("plans", operation).error({ stage: error instanceof z.ZodError ? "interpretation" : "rpc", rpc_name: operation, ...safeErrorDiagnostic(error) });
  return new PlanTechnicalError(correlationId);
}

export function planErrorCode(error: unknown): PlanErrorCode | null {
  return error instanceof PlanAccessError ? error.code : null;
}

/** Only call at the trusted Postgres RPC boundary, never on arbitrary exceptions. */
export function planRpcErrorCode(error: { code?: string; message?: string }): PlanErrorCode | null {
  const known: PlanErrorCode[] = ["selection_required", "member_plan_blocked", "team_regularization_required", "plan_feature_unavailable", "plan_limit_reached", "authorization_conflict", "idempotency_conflict"];
  return error.code && ["42501", "P0001", "40001", "23505"].includes(error.code) && known.includes(error.message as PlanErrorCode) ? error.message as PlanErrorCode : null;
}

export function parsePlanNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function planBlocksIntegratedModules(access: PlanAccess | null) {
  return !access || access.selection_required || access.effective_plan === "free";
}

import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Commercial names are intentionally provisional; technical identifiers never change. */
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
  authorization_version: z.coerce.number().int().nonnegative(), selection_required: z.boolean(),
}).strict();
export type PlanAccess = z.infer<typeof accessSchema>;

/** Reads DB authority on every request; never trusts JWT/browser selection. */
export async function getMyPlanAccess(): Promise<PlanAccess | null> {
  const client = await createClient();
  const { data, error } = await client.rpc("get_my_plan_access");
  if (error) throw new Error("PLAN_ACCESS_UNAVAILABLE");
  if (!Array.isArray(data) || data.length === 0) return null;
  return accessSchema.array().length(1).parse(data)[0];
}

export type PlanStatus =
  | "allowed"
  | "selection_required"
  | "member_plan_blocked"
  | "team_regularization_required";

export type PlanAccessState = {
  status: PlanStatus;
  effective_plan: "free" | "intermediate";
  access_state: string;
};

const businessAccessSchema = z.object({
  status: z.enum(["allowed", "selection_required", "member_plan_blocked", "team_regularization_required"]),
  effective_plan: z.enum(["free", "intermediate"]),
  access_state: z.string(),
}).strict();

/** DB authority combines the owner's plan and team membership; never infer this in UI code. */
export async function requirePlanBusinessAccess(options: { paid?: boolean; apply?: boolean; allowSelection?: boolean } = {}): Promise<PlanAccessState> {
  const client = await createClient();
  const { data, error } = await client.rpc("get_my_plan_business_access");
  if (error) throw new Error("PLAN_ACCESS_UNAVAILABLE");
  const value = Array.isArray(data) ? data[0] : data;
  const access = businessAccessSchema.parse(value);
  if (access.status !== "allowed" && !(options.allowSelection && access.status === "selection_required")) throw new Error(access.status);
  if (options.paid && access.effective_plan !== "intermediate") throw new Error("plan_feature_unavailable");
  if (options.apply && access.status !== "allowed") throw new Error("pricing_apply_denied");
  return access;
}

export type PlanErrorCode = "selection_required" | "member_plan_blocked" | "team_regularization_required" | "plan_feature_unavailable" | "plan_limit_reached" | "authorization_conflict" | "idempotency_conflict";
export function planErrorCode(error: unknown): PlanErrorCode | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = message.match(/selection_required|member_plan_blocked|team_regularization_required|plan_feature_unavailable|plan_limit_reached|authorization_conflict|idempotency_conflict/)?.[0];
  return (code as PlanErrorCode | undefined) ?? null;
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

import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { calculateFdmPricing, type FdmPricingInput, type FdmPricingResult } from "./fdm";

const finite = z.number().finite();
const tariffSchema = z.object({
  /** Enterprise value observed when the calculation was started; null means no configured tariff. */
  original: finite.min(0).max(100).nullable(),
  /** Value actually used by the calculator, which may be a local adjustment. */
  effective: finite.min(0).max(100),
  adjusted: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.adjusted && value.original !== value.effective) context.addIssue({ code: "custom", message: "Tarifa efetiva inválida." });
});

export const pricingRequestSchema = z.object({
  attemptId: z.string().uuid(), productId: z.string().uuid(), productVersion: z.number().int().nonnegative(),
  printerId: z.string().uuid(), printerVersion: z.number().int().nonnegative(),
  // Legacy material references are accepted only to keep the v1 client contract readable.
  materialIds: z.array(z.string().uuid()).max(10).default([]), materialVersions: z.array(z.number().int().nonnegative()).max(10).default([]),
  spoolIds: z.array(z.string().uuid()).min(1).max(10), spoolVersions: z.array(z.number().int().nonnegative()).max(10),
  generalMaterialIds: z.array(z.string().uuid()).max(10).default([]), generalMaterialVersions: z.array(z.number().int().nonnegative()).max(10).default([]),
  configVersion: z.number().int().nonnegative(), input: z.object({
    quantity: z.number(), printTimeHours: z.number(), tariff: tariffSchema,
    // Technical limit only: 100.00%; business policy may adopt a smaller value.
    lossPercent: finite.min(0).max(100).default(0),
    // Source costs are reloaded from the server before a calculation is persisted.
    printer: z.object({ purchasePrice: z.number(), lifeHours: z.number(), powerWatts: z.number(), maintenancePerHour: z.number() }),
    materials: z.array(z.object({ consumptionGrams: z.number(), referencePrice: z.number(), referenceWeightGrams: z.number() })),
    // v2 line quantities are intentionally separated from server-authoritative prices.
    spoolConsumptionsGrams: z.array(finite.positive()).min(1).max(10),
    packagingLines: z.array(z.object({ mode: z.enum(["per_piece", "per_lot"]), quantity: finite.positive().max(1000000), suppliedUnit: z.enum(["unidade", "metro", "centimetro", "grama", "quilograma"]) }).strict()).max(10).default([]),
    // v1 compatibility: interpreted as per-piece packaging quantities.
    generalMaterialConsumptions: z.array(finite.positive()).max(10).default([]),
    finishing: z.object({ manualTimeHours: z.number(), laborPerHour: z.number(), fixedCost: z.number() }), packagingPerPiece: z.number().default(0), markupPercent: z.number(),
  }).strict(),
}).strict();
export type PricingRequest = z.infer<typeof pricingRequestSchema>;
export type PricingOutcome<T> = { ok: true; data: T } | { ok: false; code: "invalid" | "not_found" | "conflict" | "unavailable" | "forbidden" | "unknown"; error: string };
export const canonicalJson = (value: unknown) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = v[k]; return o; }, {}) : v);
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export function runFdm(input: FdmPricingInput): PricingOutcome<FdmPricingResult> { const result = calculateFdmPricing(input); return Array.isArray(result) ? { ok: false, code: "invalid", error: result.map(e => `${e.field}: ${e.message}`).join("; ") } : { ok: true, data: result }; }

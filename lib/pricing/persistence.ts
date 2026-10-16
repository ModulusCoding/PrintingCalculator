import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { calculateFdmPricing, type FdmPricingInput, type FdmPricingResult } from "./fdm";

export const pricingRequestSchema = z.object({
  attemptId: z.string().uuid(), productId: z.string().uuid(), productVersion: z.number().int().nonnegative(),
  printerId: z.string().uuid(), printerVersion: z.number().int().nonnegative(),
  materialIds: z.array(z.string().uuid()).min(1).max(10), materialVersions: z.array(z.number().int().nonnegative()).max(10),
  configVersion: z.number().int().nonnegative(), input: z.object({
    quantity: z.number(), printTimeHours: z.number(), energyRate: z.number(),
    printer: z.object({ purchasePrice: z.number(), lifeHours: z.number(), powerWatts: z.number(), maintenancePerHour: z.number() }),
    materials: z.array(z.object({ consumptionGrams: z.number(), referencePrice: z.number(), referenceWeightGrams: z.number() })),
    finishing: z.object({ manualTimeHours: z.number(), laborPerHour: z.number(), fixedCost: z.number() }), packagingPerPiece: z.number(), markupPercent: z.number(),
  }),
}).strict();
export type PricingRequest = z.infer<typeof pricingRequestSchema>;
export type PricingOutcome<T> = { ok: true; data: T } | { ok: false; code: "invalid" | "not_found" | "conflict" | "unavailable" | "forbidden"; error: string };
export type PricingRecord = { id: string; attemptId: string; productId: string; productVersion: number; result: FdmPricingResult; payloadHash: string; expiresAt: string; status: string };

function secret(): string { const value = process.env.PRICING_ATTESTATION_SECRET; if (!value) throw new Error("PRICING_ATTESTATION_SECRET is not configured"); return value; }
export function canonicalPayload(value: unknown): string { return JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {} as Record<string, unknown>) : v); }
export function attest(payload: unknown): { hash: string; signature: string } { const canonical = canonicalPayload(payload); return attestCanonical(canonical); }
export function attestCanonical(canonical: string): { hash: string; signature: string } { const hash = createHash("sha256").update(canonical).digest("hex"); return { hash, signature: createHmac("sha256", secret()).update(canonical).digest("hex") }; }
export function verifyAttestation(payload: unknown, hash: string, signature: string): boolean { const expected = attest(payload); return expected.hash === hash && timingSafeEqual(Buffer.from(expected.signature), Buffer.from(signature)); }
export function runFdm(input: FdmPricingInput): PricingOutcome<FdmPricingResult> { const result = calculateFdmPricing(input); return Array.isArray(result) ? { ok: false, code: "invalid", error: result.map(e => `${e.field}: ${e.message}`).join("; ") } : { ok: true, data: result }; }

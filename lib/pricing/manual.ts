import { z } from "zod";

const MAX = 1e12;
const finite = z.number().finite().min(-MAX).max(MAX);
const nonnegative = finite.min(0);
const positive = finite.positive();
const version = z.number().int().nonnegative().refine(Number.isSafeInteger);
const tariff = z.object({ original: nonnegative.max(100).nullable(), effective: nonnegative.max(100), adjusted: z.boolean() }).strict();

export const manualFdmSchema = z.object({
  attemptId: z.string().uuid(), productId: z.string().uuid(), productVersion: version,
  input: z.object({
    quantity: z.number().int().positive().safe().max(MAX), printTimeHours: positive,
    tariff, lossPercent: nonnegative.max(100).default(0),
    printer: z.object({ name: z.string().trim().min(1).max(200), purchasePrice: nonnegative, lifeHours: positive, powerWatts: positive, maintenancePerHour: nonnegative }).strict(),
    spoolLines: z.array(z.object({ name: z.string().trim().min(1).max(200), consumptionGrams: positive, purchasePrice: nonnegative, originalFilamentGrams: positive }).strict()).min(1).max(10),
    packagingLines: z.array(z.object({ name: z.string().trim().min(1).max(200), mode: z.enum(["per_piece", "per_lot"]), quantity: positive, suppliedUnit: z.string().min(1).max(50), referencePrice: nonnegative, referenceQuantity: positive }).strict()).max(10),
    finishing: z.object({ manualTimeHours: nonnegative, laborPerHour: nonnegative, fixedCost: nonnegative }).strict(),
    packagingPerPiece: nonnegative.default(0), markupPercent: nonnegative,
  }).strict(),
}).strict();
export type ManualFdmRequest = z.infer<typeof manualFdmSchema>;

import { z } from "zod";
import { manualFdmSchema, manualPackagingUnitSchema } from "./manual";

export const MANUAL_UNITS = {
  filament: "g/lot", printTime: "h/lot", finishing: "lot", packagingPerPiece: "BRL/piece", quantity: "piece",
} as const;
const resultNumber = z.number().finite().nonnegative().max(Number.MAX_VALUE);
export const fdmResultSchema = z.object({
  material: resultNumber, energy: resultNumber, depreciation: resultNumber, maintenance: resultNumber,
  finishing: resultNumber, packaging: resultNumber, total: resultNumber, unitCost: resultNumber,
  suggestedLotPrice: resultNumber, suggestedUnitPrice: resultNumber.max(1e30), markupAmount: resultNumber,
}).strict();
const input = manualFdmSchema.shape.input;
const spool = input.shape.spoolLines.element.omit({ name: true });
const packaging = input.shape.packagingLines.element.omit({ name: true, suppliedUnit: true }).extend({ conversionFactor: z.literal(1) });

/** New V3 writes are strict. Legacy history reads remain snapshot based and do
 * not require newer descriptive references that older V3 writes did not store.
 */
export const manualSnapshotSchema = z.object({
  schema_version: z.literal("3"), source: z.literal("manual"),
  input: z.object({
    quantity: input.shape.quantity, printTimeHours: input.shape.printTimeHours, printer: input.shape.printer,
    energyRate: z.number().finite().min(0).max(100), lossPercent: z.number().finite().min(0).max(100),
    spoolLines: z.array(spool).min(1).max(10), packagingLines: z.array(packaging).max(10),
    finishing: input.shape.finishing, packagingPerPiece: z.number().finite().min(0).max(1e12), markupPercent: input.shape.markupPercent,
  }).strict(),
  result: fdmResultSchema,
  product_snapshot: z.object({ id: z.string().uuid(), name: z.string(), active: z.literal(true), version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), price: z.number().finite().nonnegative().max(1e6).nullable() }).strict(),
  units: z.object({ filament: z.literal(MANUAL_UNITS.filament), printTime: z.literal(MANUAL_UNITS.printTime), finishing: z.literal(MANUAL_UNITS.finishing), packagingPerPiece: z.literal(MANUAL_UNITS.packagingPerPiece), quantity: z.literal(MANUAL_UNITS.quantity) }).strict(),
  config_snapshot: z.object({ source: z.literal("manual"), energyRate: z.number().finite().min(0).max(100) }).strict(),
  manual_input_references: z.object({ spool_names: z.array(z.string().trim().min(1).max(200)).min(1).max(10), packaging_names: z.array(z.string().trim().min(1).max(200)).max(10), packaging_units: z.array(manualPackagingUnitSchema).max(10) }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.config_snapshot.energyRate !== snapshot.input.energyRate) ctx.addIssue({ code: "custom", path: ["config_snapshot", "energyRate"], message: "Tarifa inconsistente." });
  const refs = snapshot.manual_input_references;
  if (refs.spool_names.length !== snapshot.input.spoolLines.length || refs.packaging_names.length !== snapshot.input.packagingLines.length || refs.packaging_units.length !== snapshot.input.packagingLines.length) ctx.addIssue({ code: "custom", path: ["manual_input_references"], message: "Referências inconsistentes." });
});

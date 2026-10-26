import { manualFdmSchema, type ManualFdmRequest } from "./manual";
import { parsePtBr, timeToHours } from "./parse";

export type ManualLine = { name: string; consumptionGrams: string; purchasePrice: string; originalFilamentGrams: string };
export type ManualPackagingLine = { name: string; mode: "per_piece" | "per_lot"; quantity: string; suppliedUnit: string; referencePrice: string; referenceQuantity: string };
export type ManualForm = {
  name: string; quantity: string; hours: string; minutes: string; purchasePrice: string; lifeHours: string; powerWatts: string; maintenancePerHour: string;
  energyRate: string; lossPercent: string; finishingHours: string; finishingMinutes: string; laborPerHour: string; fixedCost: string; packagingPerPiece: string; markupPercent: string;
  spoolLines: ManualLine[]; packagingLines: ManualPackagingLine[];
};
const number = (value: string, min = 0, max = 1e12, scale = 6) => parsePtBr(value, min, max, scale);
/** Empty fields remain invalid, including optional costs: zero must be explicit. */
export function parseManualForm(form: ManualForm): ManualFdmRequest["input"] | null {
  const parsed = manualFdmSchema.shape.input.safeParse({
    quantity: number(form.quantity, 1, 100000, 0), printTimeHours: timeToHours(form.hours, form.minutes),
    tariff: { original: null, effective: number(form.energyRate, 0, 100), adjusted: true }, lossPercent: number(form.lossPercent, 0, 100),
    printer: { name: form.name, purchasePrice: number(form.purchasePrice), lifeHours: number(form.lifeHours), powerWatts: number(form.powerWatts), maintenancePerHour: number(form.maintenancePerHour) },
    spoolLines: form.spoolLines.map(line => ({ name: line.name, consumptionGrams: number(line.consumptionGrams), purchasePrice: number(line.purchasePrice), originalFilamentGrams: number(line.originalFilamentGrams) })),
    packagingLines: form.packagingLines.map(line => ({ ...line, quantity: number(line.quantity), referencePrice: number(line.referencePrice), referenceQuantity: number(line.referenceQuantity) })),
    finishing: { manualTimeHours: timeToHours(form.finishingHours, form.finishingMinutes), laborPerHour: number(form.laborPerHour), fixedCost: number(form.fixedCost) },
    packagingPerPiece: number(form.packagingPerPiece), markupPercent: number(form.markupPercent),
  });
  return parsed.success ? parsed.data : null;
}

import { calculateFdmPricing } from "./fdm";

const base = {
  printTimeHours: 2,
  printer: { purchasePrice: 2000, lifeHours: 10000, powerWatts: 100, maintenancePerHour: 0.1 },
  energyRate: 1,
  materials: [{ consumptionGrams: 100, referencePrice: 100, referenceWeightGrams: 1000 }],
  finishing: { manualTimeHours: 0.5, laborPerHour: 20, fixedCost: 1 },
  packagingPerPiece: 2,
};
const result = calculateFdmPricing({ ...base, quantity: 2, markupPercent: 50 });
if (Array.isArray(result)) throw new Error("reference case invalid");
const expected = { material: 10, energy: 0.2, depreciation: 0.4, maintenance: 0.2, finishing: 11, packaging: 4, total: 25.8, unitCost: 12.9, suggestedLotPrice: 38.7, suggestedUnitPrice: 19.35 };
for (const [key, value] of Object.entries(expected)) if (Math.abs(result[key as keyof typeof result] - value) > 1e-9) throw new Error(`${key}: ${result[key as keyof typeof result]} != ${value}`);
const second = calculateFdmPricing({ ...base, quantity: 4, markupPercent: 0 });
if (Array.isArray(second) || Math.abs(second.total - 29.8) > 1e-9 || Math.abs(second.unitCost - 7.45) > 1e-9) throw new Error("quantity reference case failed");

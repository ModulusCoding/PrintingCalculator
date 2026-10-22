import { calculateFdmPricing } from "./fdm";

const base = {
  printTimeHours: 2,
  printer: { purchasePrice: 2000, lifeHours: 10000, powerWatts: 100, maintenancePerHour: 0.1 },
  energyRate: 1,
  finishing: { manualTimeHours: 0.5, laborPerHour: 20, fixedCost: 1 },
  markupPercent: 50,
  quantity: 2,
};

// 1. Spool explicit lines and packaging modes (per piece vs per lot)
const explicitTest = calculateFdmPricing({
  ...base,
  spoolLines: [{ consumptionGrams: 100, purchasePrice: 100, originalFilamentGrams: 1000 }],
  packagingLines: [
    { mode: "per_piece", quantity: 1, referenceQuantity: 10, referencePrice: 20, conversionFactor: 1 },
    { mode: "per_lot", quantity: 5, referenceQuantity: 1, referencePrice: 2, conversionFactor: 1 },
  ],
});
if (Array.isArray(explicitTest)) throw new Error("Explicit spool/packaging test failed validation");
// material: 100 * 100 / 1000 = 10
// packaging: (1 * 2 * 20/10) [per piece: qty=1 * pieces=2 * ref=20/10=2 -> 4] + (5 * 1 * 2/1 [per lot: qty=5 * 1 * 2/1 -> 10]) = 14
// energy: 0.1 * 2 * 1 = 0.2
// depreciation: 2000 / 10000 * 2 = 0.4
// maintenance: 0.1 * 2 = 0.2
// finishing: 0.5 * 20 + 1 = 11
// total: 10 + 14 + 0.2 + 0.4 + 0.2 + 11 = 35.8
if (Math.abs(explicitTest.material - 10) > 1e-9 || Math.abs(explicitTest.packaging - 14) > 1e-9 || Math.abs(explicitTest.total - 35.8) > 1e-9) {
  throw new Error(`Explicit calculation mismatch: got total ${explicitTest.total}, packaging ${explicitTest.packaging}`);
}

// 2. Rounding policy
const roundedTest = calculateFdmPricing({
  ...base,
  spoolLines: [{ consumptionGrams: 33.333, purchasePrice: 100, originalFilamentGrams: 1000 }],
  packagingLines: [],
  rounding: { decimals: 2, mode: "half-up" },
});
if (Array.isArray(roundedTest)) throw new Error("Rounding test failed");
if (roundedTest.material !== 3.33) throw new Error(`Rounding policy failed: got ${roundedTest.material}`);

// 3. Legacy compatibility reading
const legacyTest = calculateFdmPricing({
  ...base,
  materials: [{ consumptionGrams: 100, referencePrice: 100, referenceWeightGrams: 1000 }],
  generalMaterials: [{ consumptionQuantity: 2, referencePrice: 12, referenceQuantity: 3 }],
});
if (Array.isArray(legacyTest)) throw new Error("Legacy compatibility test failed");
if (Math.abs(legacyTest.material - 10) > 1e-9 || Math.abs(legacyTest.packaging - 8) > 1e-9) {
  throw new Error("Legacy compatibility calculation mismatch");
}

console.log("All FDM domain engine tests passed successfully.");

import assert from "node:assert/strict";
import { calculateFdmPricing } from "./fdm";
import { parseManualForm, type ManualForm } from "./manual-form";
import { manualFdmSchema } from "./manual";

const form: ManualForm = {
  name: "Impressora", quantity: "2", hours: "2", minutes: "0", purchasePrice: "2000", lifeHours: "10000", powerWatts: "100", maintenancePerHour: "0,1",
  energyRate: "1", lossPercent: "10", finishingHours: "0", finishingMinutes: "30", laborPerHour: "20", fixedCost: "1", packagingPerPiece: "3", markupPercent: "50",
  spoolLines: [{ name: "PLA", consumptionGrams: "100", purchasePrice: "100", originalFilamentGrams: "1000" }, { name: "PETG", consumptionGrams: "50", purchasePrice: "80", originalFilamentGrams: "1000" }],
  packagingLines: [{ name: "Caixa", mode: "per_piece", quantity: "1", suppliedUnit: "unidade", referencePrice: "20", referenceQuantity: "10" }, { name: "Fita", mode: "per_lot", quantity: "5", suppliedUnit: "metro", referencePrice: "2", referenceQuantity: "1" }],
};
const input = parseManualForm(form);
assert.ok(input);
const result = calculateFdmPricing({ ...input, energyRate: input.tariff.effective });
assert.ok(!Array.isArray(result));
assert.equal(result.packaging, 20, "Lines and explicit additional cost must each be counted exactly once");
assert.ok(Math.abs(result.material - 15.4) < 1e-9);
assert.ok(Math.abs(result.total - 47.2) < 1e-9);
assert.equal(result.finishing, 11);
for (const key of ["quantity", "hours", "minutes", "purchasePrice", "lifeHours", "powerWatts", "maintenancePerHour", "energyRate", "lossPercent", "finishingHours", "finishingMinutes", "laborPerHour", "fixedCost", "packagingPerPiece", "markupPercent"] as const) {
  for (const invalid of ["", " ", "NaN", "Infinity", "-1"]) assert.equal(parseManualForm({ ...form, [key]: invalid }), null, `${key}: ${JSON.stringify(invalid)} must not become zero`);
}
assert.equal(parseManualForm({ ...form, quantity: "1,5" }), null);
assert.equal(parseManualForm({ ...form, minutes: "60" }), null);
assert.equal(parseManualForm({ ...form, spoolLines: [{ ...form.spoolLines[0], consumptionGrams: "" }] }), null);
assert.equal(parseManualForm({ ...form, packagingLines: [{ ...form.packagingLines[0], referenceQuantity: "0" }] }), null);
for (const value of [NaN, Infinity, -Infinity]) {
  assert.equal(manualFdmSchema.shape.input.safeParse({ ...input, finishing: { ...input.finishing, laborPerHour: value } }).success, false);
}
assert.ok(parseManualForm({ ...form, packagingLines: [], packagingPerPiece: "0", purchasePrice: "0", maintenancePerHour: "0", energyRate: "0" }), "Explicit zero costs remain valid");
console.log("Manual form and packaging tests passed.");

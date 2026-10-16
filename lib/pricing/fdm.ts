export type FdmPricingInput = {
  quantity: number;
  printTimeHours: number;
  printer: { purchasePrice: number; lifeHours: number; powerWatts: number; maintenancePerHour: number };
  energyRate: number;
  materials: Array<{ consumptionGrams: number; referencePrice: number; referenceWeightGrams: number }>;
  finishing: { manualTimeHours: number; laborPerHour: number; fixedCost: number };
  packagingPerPiece: number;
  markupPercent: number;
};

export type FdmPricingResult = {
  material: number; energy: number; depreciation: number; maintenance: number;
  finishing: number; packaging: number; total: number; unitCost: number;
  suggestedLotPrice: number; suggestedUnitPrice: number; markupAmount: number;
};

export type FdmPricingError = { field: string; message: string };

const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;

export function calculateFdmPricing(input: FdmPricingInput): FdmPricingResult | FdmPricingError[] {
  const errors: FdmPricingError[] = [];
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) errors.push({ field: "quantity", message: "Informe uma quantidade inteira positiva." });
  if (!Number.isFinite(input.printTimeHours) || input.printTimeHours <= 0 || input.printTimeHours > 10000) errors.push({ field: "printTimeHours", message: "O tempo total deve ser maior que zero." });
  if (!finiteNonNegative(input.energyRate) || input.energyRate > 1000000) errors.push({ field: "energyRate", message: "Tarifa inválida." });
  if (!Number.isFinite(input.printer.purchasePrice) || input.printer.purchasePrice < 0) errors.push({ field: "printer", message: "Valor de compra inválido." });
  if (!Number.isFinite(input.printer.lifeHours) || input.printer.lifeHours <= 0) errors.push({ field: "printer", message: "Vida útil deve ser maior que zero." });
  if (!Number.isFinite(input.printer.powerWatts) || input.printer.powerWatts <= 0) errors.push({ field: "printer", message: "Potência deve ser maior que zero." });
  if (!finiteNonNegative(input.printer.maintenancePerHour)) errors.push({ field: "printer", message: "Manutenção inválida." });
  input.materials.forEach((material, index) => {
    if (!Number.isFinite(material.consumptionGrams) || material.consumptionGrams <= 0) errors.push({ field: `material-${index}`, message: "Consumo deve ser maior que zero." });
    if (!Number.isFinite(material.referenceWeightGrams) || material.referenceWeightGrams <= 0) errors.push({ field: `material-${index}`, message: "Peso de referência inválido." });
    if (!finiteNonNegative(material.referencePrice)) errors.push({ field: `material-${index}`, message: "Preço de referência inválido." });
  });
  if (!input.materials.length) errors.push({ field: "materials", message: "Selecione pelo menos um material." });
  if (!finiteNonNegative(input.finishing.manualTimeHours) || !finiteNonNegative(input.finishing.laborPerHour) || !finiteNonNegative(input.finishing.fixedCost)) errors.push({ field: "finishing", message: "Acabamento inválido." });
  if (!finiteNonNegative(input.packagingPerPiece)) errors.push({ field: "packagingPerPiece", message: "Embalagem inválida." });
  if (!finiteNonNegative(input.markupPercent)) errors.push({ field: "markupPercent", message: "Acréscimo inválido." });
  const bounded: Array<[string, number, number]> = [
    ["quantity", input.quantity, 100000], ["energyRate", input.energyRate, 100],
    ["purchasePrice", input.printer.purchasePrice, 1000000], ["lifeHours", input.printer.lifeHours, 100000],
    ["powerWatts", input.printer.powerWatts, 10000], ["maintenancePerHour", input.printer.maintenancePerHour, 1000],
    ["manualTimeHours", input.finishing.manualTimeHours, 10000 + 59 / 60],
    ["laborPerHour", input.finishing.laborPerHour, 100000], ["fixedCost", input.finishing.fixedCost, 1000000],
    ["packagingPerPiece", input.packagingPerPiece, 1000000], ["markupPercent", input.markupPercent, 100000],
  ];
  for (const [field, value, max] of bounded) if (value > max) errors.push({ field, message: "Valor acima do limite operacional." });
  if (input.materials.length > 10) errors.push({ field: "materials", message: "Use no máximo 10 materiais." });
  input.materials.forEach((item, index) => {
    if (item.consumptionGrams > 1000000 || item.referencePrice > 1000000 || item.referenceWeightGrams > 100000 || item.referenceWeightGrams < 0.001) errors.push({ field: `material-${index}`, message: "Valor fora dos limites operacionais." });
  });
  if (errors.length) return errors;

  const material = input.materials.reduce((sum, item) => sum + item.consumptionGrams * item.referencePrice / item.referenceWeightGrams, 0);
  const energy = input.printer.powerWatts / 1000 * input.printTimeHours * input.energyRate;
  const depreciation = input.printer.purchasePrice / input.printer.lifeHours * input.printTimeHours;
  const maintenance = input.printer.maintenancePerHour * input.printTimeHours;
  const finishing = input.finishing.manualTimeHours * input.finishing.laborPerHour + input.finishing.fixedCost;
  const packaging = input.packagingPerPiece * input.quantity;
  const total = material + energy + depreciation + maintenance + finishing + packaging;
  const unitCost = total / input.quantity;
  const suggestedLotPrice = total * (1 + input.markupPercent / 100);
  const suggestedUnitPrice = suggestedLotPrice / input.quantity;
  const markupAmount = suggestedLotPrice - total;
  const result = { material, energy, depreciation, maintenance, finishing, packaging, total, unitCost, suggestedLotPrice, suggestedUnitPrice, markupAmount };
  return Object.values(result).every(Number.isFinite) ? result : [{ field: "result", message: "O resultado não é finito. Revise os valores." }];
}

export type FdmRoundingPolicy = { decimals?: number; mode?: "half-up" | "none" };
export type FdmSpoolLine = { spoolId?: string; consumptionGrams: number; purchasePrice: number; originalFilamentGrams: number };
export type FdmPackagingLine = {
  materialId?: string;
  mode: "per_piece" | "per_lot";
  quantity: number;
  /** Quantity represented by the reference price (in the same control unit). */
  referenceQuantity: number;
  referencePrice: number;
  /** Optional conversion from supplied units to control units. */
  conversionFactor?: number;
};
export type FdmPricingInput = {
  quantity: number; printTimeHours: number;
  printer: { purchasePrice: number; lifeHours: number; powerWatts: number; maintenancePerHour: number };
  energyRate: number; lossPercent?: number;
  /** Authoritative Stage 4 filament lines. */
  spoolLines?: FdmSpoolLine[];
  /** Authoritative packaging lines. */
  packagingLines?: FdmPackagingLine[];
  // v1 compatibility (read only)
  materials?: Array<{ consumptionGrams: number; referencePrice: number; referenceWeightGrams: number }>;
  generalMaterials?: Array<{ consumptionQuantity: number; referencePrice: number; referenceQuantity: number }>;
  finishing: { manualTimeHours: number; laborPerHour: number; fixedCost: number };
  /** Explicit manual packaging cost, kept separate from stock material lines. */
  packagingPerPiece?: number; markupPercent: number; rounding?: FdmRoundingPolicy;
};
export type FdmPricingResult = { material: number; energy: number; depreciation: number; maintenance: number; finishing: number; packaging: number; total: number; unitCost: number; suggestedLotPrice: number; suggestedUnitPrice: number; markupAmount: number };
export type FdmPricingError = { field: string; message: string };
const nn = (v: number) => Number.isFinite(v) && v >= 0;
const round = (v: number, p?: FdmRoundingPolicy) => p?.mode === "none" || p?.decimals === undefined ? v : Math.round((v + Number.EPSILON) * 10 ** p.decimals) / 10 ** p.decimals;
export function calculateFdmPricing(input: FdmPricingInput): FdmPricingResult | FdmPricingError[] {
  const e: FdmPricingError[] = []; const loss = input.lossPercent ?? 0;
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) e.push({ field: "quantity", message: "Quantidade inválida." });
  if (!Number.isFinite(input.printTimeHours) || input.printTimeHours <= 0) e.push({ field: "printTimeHours", message: "Tempo inválido." });
  if (!nn(input.energyRate) || input.energyRate > 1e6) e.push({ field: "energyRate", message: "Tarifa inválida." });
  if (!nn(loss) || loss > 100) e.push({ field: "lossPercent", message: "Perda inválida." });
  const p = input.printer; if (!nn(p.purchasePrice) || !Number.isFinite(p.lifeHours) || p.lifeHours <= 0 || !Number.isFinite(p.powerWatts) || p.powerWatts <= 0 || !nn(p.maintenancePerHour)) e.push({ field: "printer", message: "Impressora inválida." });
  const spools = input.spoolLines ?? (input.materials ?? []).map(x => ({ consumptionGrams: x.consumptionGrams, purchasePrice: x.referencePrice, originalFilamentGrams: x.referenceWeightGrams }));
  if (!spools.length) e.push({ field: "spoolLines", message: "Selecione pelo menos um carretel." });
  spools.forEach((x, i) => { if (!Number.isFinite(x.consumptionGrams) || x.consumptionGrams <= 0 || !nn(x.purchasePrice) || !Number.isFinite(x.originalFilamentGrams) || x.originalFilamentGrams <= 0) e.push({ field: `spool-${i}`, message: "Linha de carretel inválida." }); });
  const packaging: FdmPackagingLine[] = input.packagingLines ?? (input.generalMaterials ?? []).map(x => ({ mode: "per_lot" as const, quantity: x.consumptionQuantity, referenceQuantity: x.referenceQuantity, referencePrice: x.referencePrice, conversionFactor: 1 }));
  packaging.forEach((x, i) => { if (!nn(x.quantity) || x.quantity <= 0 || !nn(x.referencePrice) || !Number.isFinite(x.referenceQuantity) || x.referenceQuantity <= 0 || !nn(x.conversionFactor ?? 1)) e.push({ field: `packaging-${i}`, message: "Linha de embalagem inválida." }); });
  if (input.packagingPerPiece !== undefined && !nn(input.packagingPerPiece)) e.push({ field: "packagingPerPiece", message: "Embalagem inválida." });
  if (!nn(input.markupPercent)) e.push({ field: "markupPercent", message: "Acréscimo inválido." });
  if (e.length) return e;
  const material = spools.reduce((s, x) => s + x.consumptionGrams * x.purchasePrice / x.originalFilamentGrams, 0) * (1 + loss / 100);
  const packagingCost = packaging.reduce((s, x) => s + x.quantity * (x.mode === "per_piece" ? input.quantity : 1) * (x.conversionFactor ?? 1) * x.referencePrice / x.referenceQuantity, 0) + (input.packagingPerPiece ?? 0) * input.quantity;
  const energy = p.powerWatts / 1000 * input.printTimeHours * input.energyRate;
  const depreciation = p.purchasePrice / p.lifeHours * input.printTimeHours;
  const maintenance = p.maintenancePerHour * input.printTimeHours;
  const finishing = input.finishing.manualTimeHours * input.finishing.laborPerHour + input.finishing.fixedCost;
  const total = material + energy + depreciation + maintenance + finishing + packagingCost;
  const raw = { material, energy, depreciation, maintenance, finishing, packaging: packagingCost, total, unitCost: total / input.quantity, suggestedLotPrice: total * (1 + input.markupPercent / 100), suggestedUnitPrice: total * (1 + input.markupPercent / 100) / input.quantity, markupAmount: total * input.markupPercent / 100 };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v, input.rounding)])) as FdmPricingResult;
}

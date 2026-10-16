export function calculateCostPerGram(priceStr: string, weightStr: string): string {
  const price = Number(priceStr);
  const weight = Number(weightStr);
  if (!Number.isFinite(price) || !Number.isFinite(weight) || weight <= 0) return "—";
  const cost = price / weight;
  if (!Number.isFinite(cost)) return "—";
  if (cost === 0) return "0";
  return cost.toLocaleString("pt-BR", { useGrouping: false, maximumSignificantDigits: 12 }).replace(",", ".");
}

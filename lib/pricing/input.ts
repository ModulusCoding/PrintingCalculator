import { parsePtBr } from "./parse";

export type NumericRule = { min: number; max: number; scale: number; integer?: boolean; positive?: boolean };
export function numericError(value: string, rule: NumericRule): string | null {
  if (!value.trim()) return "Informe um valor. Use zero quando não houver custo.";
  const parsed = parsePtBr(value, rule.min, rule.max, rule.integer ? 0 : rule.scale);
  if (parsed === null || (rule.positive && parsed <= 0)) {
    const min = rule.positive && rule.min === 0 ? "maior que zero" : `a partir de ${rule.min.toLocaleString("pt-BR")}`;
    return `Informe ${rule.integer ? "um inteiro" : "um número"} ${min}, até ${rule.max.toLocaleString("pt-BR")}${rule.integer ? "." : `, com até ${rule.scale} casas decimais. Use vírgula decimal e pontos apenas para milhares completos.`}`;
  }
  return null;
}
export const manualRules: Record<string, NumericRule> = {
  quantity: { min: 1, max: 100000, scale: 0, integer: true },
  hours: { min: 0, max: 10000, scale: 0, integer: true },
  minutes: { min: 0, max: 59, scale: 0, integer: true },
  finishingHours: { min: 0, max: 10000, scale: 0, integer: true },
  finishingMinutes: { min: 0, max: 59, scale: 0, integer: true },
  energyRate: { min: 0, max: 100, scale: 6 },
  lossPercent: { min: 0, max: 100, scale: 6 },
  lifeHours: { min: 0, max: 1e12, scale: 6, positive: true },
  powerWatts: { min: 0, max: 1e12, scale: 6, positive: true },
};
export const manualDecimal: NumericRule = { min: 0, max: 1e12, scale: 6 };
export const manualPositive: NumericRule = { ...manualDecimal, positive: true };

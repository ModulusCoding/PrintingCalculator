export function formatCurrencyInput(
  value: string,
  decimalPlaces = 2
): string {
  const numbers = value.replace(/\D/g, "");

  const factor = 10 ** decimalPlaces;

  return (Number(numbers || "0") / factor).toLocaleString("pt-BR", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}
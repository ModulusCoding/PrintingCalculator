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

export function parseCurrencyInput(value: string, decimalPlaces = 2): number {
  const numbers = value.replace(/\D/g, "");
  return Number(numbers || "0") / 10 ** decimalPlaces;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
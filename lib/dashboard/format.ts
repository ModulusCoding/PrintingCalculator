export function formatCents(value: string): string {
  const cents = BigInt(value);
  const negative = cents < BigInt(0);
  const absolute = negative ? -cents : cents;
  const whole = (absolute / BigInt(100)).toLocaleString("pt-BR");
  return `${negative ? "−" : ""}R$ ${whole},${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
export function averageCents(total: string, count: number): string | null {
  if (count <= 0) return null;
  return ((BigInt(total) + BigInt(Math.floor(count / 2))) / BigInt(count)).toString();
}
export function monthLabel(month: string, long = false) {
  return new Intl.DateTimeFormat("pt-BR", { month: long ? "long" : "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(`${month}-15T12:00:00Z`));
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(date));
}

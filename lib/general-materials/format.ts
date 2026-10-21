export function formatQuantity(n: number, unit: string) { return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${unit}`; }
export function formatCurrency(n: number) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
export function formatDate(iso: string) { try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso; } }
export function conversionHint(from: string, to: string) { return `Convertendo de ${from} para ${to}`; }

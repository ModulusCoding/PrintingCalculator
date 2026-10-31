/** Pure presentation math; inventory remains backend-owned. */
export function spoolVisual(remaining: number | null, reference: number | null, threshold: number | null) {
  const validBalance = typeof remaining === "number" && Number.isFinite(remaining) && remaining >= 0;
  const validReference = typeof reference === "number" && Number.isFinite(reference) && reference > 0;
  const ratio = validBalance && validReference ? remaining / reference : null;
  const percentage = ratio !== null && Number.isFinite(ratio * 100) ? ratio * 100 : null;
  const level = percentage === null ? null : Math.min(1, percentage / 100);
  const validThreshold = typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0 && threshold <= 100;
  const empty = validBalance && remaining === 0;
  const low = !empty && percentage !== null && validThreshold && percentage <= threshold;
  const status = !validBalance ? "Saldo indisponível" : empty ? "Esgotado" : percentage === null ? "Percentual indisponível" : low ? "Estoque baixo" : !validThreshold ? "Alerta indisponível" : "Saldo disponível";
  return { percentage, level, empty, low, status, validBalance };
}

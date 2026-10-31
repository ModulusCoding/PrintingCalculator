export function parsePtBr(value: string, min: number, max: number, scale = 2): number | null {
  const text = value.trim();
  // Integer components never accept grouping. Decimal inputs accept only complete
  // pt-BR thousands groups: 1.000,50 is valid; 1.5 is not silently read as 15.
  const pattern = scale === 0 ? /^\d+$/ : new RegExp(`^(?:\\d+|[1-9]\\d{0,2}(?:\\.\\d{3})+)(?:,\\d{1,${scale}})?$`);
  if (!pattern.test(text)) return null;
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function timeToHours(hours: string, minutes: string): number | null {
  hours = hours.trim(); minutes = minutes.trim();
  if (!/^\d+$/.test(hours) || !/^\d+$/.test(minutes)) return null;
  const h = Number(hours); const m = Number(minutes);
  return Number.isSafeInteger(h) && Number.isSafeInteger(m) && h >= 0 && h <= 10000 && m >= 0 && m <= 59 ? h + m / 60 : null;
}

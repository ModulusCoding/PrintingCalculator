export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15);
}

export function formatPhone(value: string): string {
  const digits = normalizePhone(value);

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const national = digits.slice(2);
    const local = national.length === 10
      ? `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`
      : `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
    return `+55 ${local}`;
  }

  return digits;
}
/** Resolve only explicit HEX colors; legacy names are not guessed as CSS colors. */
export function resolveSpoolHex(color: string | null | undefined): string | null {
  const value = color?.trim() ?? "";
  if (/^#[\da-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(value)) return `#${value.slice(1).split("").map(character => character.repeat(2)).join("")}`.toUpperCase();
  return null;
}

/** Empty and legacy text remain supported; HEX-looking values must be explicit and valid. */
export function normalizeSpoolColor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 80) return null;
  const hex = resolveSpoolHex(trimmed);
  if (hex) return hex;
  if (trimmed.startsWith("#") || /^(?:[\da-f]{3}|[\da-f]{6})$/i.test(trimmed)) return null;
  return trimmed;
}

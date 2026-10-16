import { z } from "zod";

export type FieldErrors = Record<string, string[]>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

export function parsePtBrDecimal(value: string, min: number, max: number, scale: number) {
  const text = value.trim();
  if (!text) return { error: "Este campo é obrigatório." } as const;
  const pattern = scale === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:,\\d{1,${scale}})?$`);
  if (!pattern.test(text)) {
    return { error: scale === 0 ? "Use somente dígitos inteiros." : `Use vírgula como separador, com até ${scale} casas decimais.` } as const;
  }
  const normalized = text.replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < min || number > max) return { error: "Valor fora do limite permitido." } as const;
  return { value: normalized } as const;
}

export function escapePostgrestIlike(value: string): string {
  return value.replace(/[\\%_,().*]/g, "\\$&");
}

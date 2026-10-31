import { z } from "zod";

export const uuid = z.uuid();

const versionMessage = "A versão do registro é inválida. Atualize a página.";
const decimalMessage = "Informe uma quantidade válida.";

function numericText(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || !/^\d+(?:[,.]\d+)?$/.test(text)) return undefined;
  return text.replace(",", ".");
}

export const version = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() !== "") return Number(value.trim());
  return value;
}, z.number({ error: versionMessage }).int(versionMessage).min(0, versionMessage).max(Number.MAX_SAFE_INTEGER - 1, versionMessage).refine(Number.isSafeInteger, versionMessage));

export const decimal = (max: number, scale: number, min = 0) => z.preprocess((value) => {
  const text = numericText(value);
  if (text === undefined) return value;
  const [, fraction = ""] = text.split(".");
  if (fraction.length > scale) return value;
  const number = Number(text);
  return Number.isFinite(number) ? text : value;
}, z.string({ error: decimalMessage })
  .regex(new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`), decimalMessage)
  .refine((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max;
  }, `Valor permitido: ${min} a ${max}.`));

export const unitSchema = z.enum(["unidade", "metro", "centimetro", "grama", "quilograma"]);

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  control_unit: unitSchema,
  reference_quantity: decimal(1000000, 6, 0.000001),
  reference_price: decimal(1000000, 6),
  opening_quantity: decimal(1000000, 6),
  attempt_id: uuid
}).strict();

export const createMovementSchema = z.discriminatedUnion("movement_type", [
  z.object({ material_id: uuid, expected_version: version, movement_type: z.literal("entry"), quantity: decimal(1000000, 6, 0.000001), supplied_unit: unitSchema, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
  z.object({ material_id: uuid, expected_version: version, movement_type: z.literal("consumption"), quantity: decimal(1000000, 6, 0.000001), supplied_unit: unitSchema, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
  z.object({ material_id: uuid, expected_version: version, movement_type: z.literal("adjustment"), counted_balance: decimal(1000000, 6), supplied_unit: unitSchema, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
]);

export const updateProfileSchema = z.object({ attempt_id: uuid, material_id: uuid, expected_version: version, name: z.string().trim().min(1).max(120) }).strict();
export const updateCostRefSchema = z.object({ attempt_id: uuid, material_id: uuid, expected_version: version, reference_quantity: decimal(1000000, 6, 0.000001), reference_price: decimal(1000000, 6) }).strict();
export const setActiveSchema = z.object({ attempt_id: uuid, material_id: uuid, expected_version: version, active: z.boolean() }).strict();

export const pt = (value: string) => value.trim().replace(",", ".");

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) (result[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
  return result;
}

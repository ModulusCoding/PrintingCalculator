import { z } from "zod";

export const uuid = z.uuid();
export const version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
export const decimal = (max: number, scale: number, min = 0) => z.string().trim().regex(new RegExp(`^\\d+(?:[,.]\\d{1,${scale}})?$`), "Use um número decimal válido.").refine(v => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) && n >= min && n <= max; }, `Valor permitido: ${min} a ${max}.`);
export const grams = decimal(100000, 3, 0.001);
export const balance = decimal(100000, 3);
const optionalText = (max:number) => z.string().trim().max(max).transform(v => v || null);
export const createSpoolSchema = z.object({ material_type:z.string().trim().min(1).max(80), brand:optionalText(120), color:optionalText(80), internal_identifier: z.string().trim().min(1).max(120), original_grams: grams, initial_balance_grams: balance, purchase_price: decimal(1000000, 2), attempt_id: uuid }).strict().refine(v => Number(v.initial_balance_grams.replace(",", ".")) <= Number(v.original_grams.replace(",", ".")), { path: ["initial_balance_grams"], message: "O saldo não pode exceder o peso original." });
export const createMovementSchema = z.discriminatedUnion("movement_type", [
 z.object({ spool_id: uuid, expected_version: version, movement_type: z.literal("consumption"), quantity_grams: grams, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
 z.object({ spool_id: uuid, expected_version: version, movement_type: z.literal("replenishment"), quantity_grams: grams, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
 z.object({ spool_id: uuid, expected_version: version, movement_type: z.literal("adjustment"), counted_balance_grams: balance, reason: z.string().trim().min(1).max(500), attempt_id: uuid }).strict(),
]);
export const updateProfileSchema=z.object({spool_id:uuid,expected_version:version,internal_identifier:z.string().trim().min(1).max(120),material_type:z.string().trim().min(1).max(80),brand:optionalText(120),color:optionalText(80)}).strict();
export const updateIdentitySchema=z.object({spool_id:uuid,expected_version:version,internal_identifier:z.string().trim().min(1).max(120)}).strict();
export const setActiveSchema=z.object({spool_id:uuid,expected_version:version,active:z.boolean()}).strict();
export const updateThresholdSchema=z.object({threshold:decimal(100,2),expected_version:version}).strict();
export const pt = (value:string) => value.trim().replace(",", ".");
export function fieldErrors(error:z.ZodError):Record<string,string[]> { const result:Record<string,string[]>={}; for(const issue of error.issues)(result[String(issue.path[0]??"_form")]??=[]).push(issue.message); return result; }

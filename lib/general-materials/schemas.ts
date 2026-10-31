import { z } from "zod";
import { uuid, version } from "./validation";

export const numeric = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]).transform(Number).refine(Number.isFinite);
export const nonnegative = numeric.refine(v => v >= 0);
export const countSchema = nonnegative.refine(Number.isSafeInteger);
const timestamp = z.string().datetime({ offset: true });

export const unitEnum = z.enum(["unidade", "metro", "centimetro", "grama", "quilograma"]);

export const materialSchema = z.object({
  id: uuid,
  name: z.string().min(1).max(120),
  control_unit: unitEnum,
  reference_quantity: nonnegative,
  reference_price: nonnegative,
  current_balance: nonnegative,
  active: z.boolean(),
  version,
  created_at: timestamp,
  updated_at: timestamp
}).strip();

// Read RPCs return SETOF table rows. Strip database-only fields before UI code sees them.
export const materialListSchema = materialSchema;

export const movementSchema = z.object({
  id: uuid,
  actor_id: uuid,
  movement_type: z.enum(["opening", "entry", "consumption", "adjustment"]),
  supplied_unit: unitEnum,
  supplied_quantity: numeric,
  quantity_control: numeric,
  balance_before: nonnegative,
  balance_after: nonnegative,
  unit_cost: nonnegative,
  reference_price_snapshot: nonnegative,
  cost_signed: numeric,
  reason: z.string().nullable(),
  created_at: timestamp,
  result_version: version
}).strip();

export const costHistorySchema = z.object({
  id: uuid,
  material_id: uuid,
  old_quantity: nonnegative,
  old_price: nonnegative,
  new_quantity: nonnegative,
  new_price: nonnegative,
  actor_id: uuid,
  created_at: timestamp
}).strip();

export type Material = z.infer<typeof materialSchema>;
export type Movement = z.infer<typeof movementSchema>;
export type CostHistory = z.infer<typeof costHistorySchema>;

export const materialColumns = "id,name,control_unit,reference_quantity,reference_price,current_balance,active,version,created_at,updated_at";
export const movementColumns = "id,actor_id,movement_type,supplied_unit,supplied_quantity,quantity_control,balance_before,balance_after,unit_cost,reference_price_snapshot,cost_signed,reason,created_at,result_version";
export const costHistoryColumns = "id,material_id,old_quantity,old_price,new_quantity,new_price,actor_id,created_at";
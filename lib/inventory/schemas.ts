import { z } from "zod";
import { MAX_UNITS, safeInteger, uuid } from "./validation";

const timestamp = z.string().datetime({ offset: true });
/** PostgreSQL bigint may be serialized as a number or decimal string. */
const integer = z
  .union([z.number(), z.string().regex(/^-?\d+$/)])
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, "Expected a safe integer");
const unit = integer.refine((value) => value >= -MAX_UNITS && value <= MAX_UNITS, "Expected a supported unit count");
const nonnegativeUnit = unit.refine((value) => value >= 0, "Expected a non-negative unit count");

export const countSchema = integer.refine((value) => value >= 0, "Expected a non-negative count");
export const productInventorySchema = z.object({ product_id: uuid, product_name: z.string(), balance: nonnegativeUnit, inventory_version: safeInteger, product_active: z.boolean() }).strict();
export const productInventoryDetailSchema = z.object({ product_id: uuid, product_name: z.string(), product_active: z.boolean(), balance: nonnegativeUnit, inventory_version: safeInteger }).strict();
/** The detail RPC deliberately returns one all-null row when the product is unavailable. */
export const unavailableProductInventoryDetailSchema = z.object({ product_id: z.null(), product_name: z.null(), product_active: z.null(), balance: z.null(), inventory_version: z.null() }).strict();
export const movementRecordSchema = z.object({ movement_id: uuid, movement_at: timestamp, movement_type: z.enum(["entry", "exit", "adjustment"]), quantity: unit, balance_before: nonnegativeUnit, balance_after: nonnegativeUnit, reason: z.string().nullable(), actor_id: uuid, result_version: safeInteger }).strict();

export type ProductInventory = z.infer<typeof productInventorySchema>;
export type ProductInventoryDetail = z.infer<typeof productInventoryDetailSchema>;
export type MovementRecord = z.infer<typeof movementRecordSchema>;

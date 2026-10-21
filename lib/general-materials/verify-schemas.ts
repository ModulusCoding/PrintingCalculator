import { strict as assert } from "node:assert";
import { z } from "zod";
import { materialSchema, materialListSchema, movementSchema, costHistorySchema } from "./schemas";

const id = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-10-21T12:00:00Z";
const material = { id, name: "Fixture", control_unit: "metro", reference_quantity: 1, reference_price: 10, current_balance: 50, active: true, version: 0, created_at: timestamp, updated_at: timestamp };
const extras = { enterprise_id: id, create_actor_id: id, create_attempt_id: id, create_payload: { internal: true } };
assert.deepEqual(materialSchema.parse({ ...material, ...extras }), material);
assert.deepEqual(z.array(materialListSchema).parse([{ ...material, ...extras }]), [material]);
for (const invalid of [{ ...material, id: undefined }, { ...material, control_unit: "litro" }, { ...material, current_balance: -1 }, { ...material, created_at: "invalid" }, { ...material, version: -1 }]) {
  assert.equal(materialSchema.safeParse(invalid).success, false);
}
const movement = { id, actor_id: id, movement_type: "entry", supplied_unit: "metro", supplied_quantity: 1, quantity_control: 1, balance_before: 0, balance_after: 1, unit_cost: 10, reference_price_snapshot: 10, cost_signed: 10, reason: null, created_at: timestamp, result_version: 1 };
assert.deepEqual(movementSchema.parse({ ...movement, enterprise_id: id, material_id: id, attempt_id: id, request_payload: {}, request_expected_version: 0, reference_quantity_snapshot: 1 }), movement);
assert.equal(movementSchema.safeParse({ ...movement, actor_id: "invalid" }).success, false);
const history = { id, material_id: id, old_quantity: 1, old_price: 10, new_quantity: 1, new_price: 12, actor_id: id, created_at: timestamp };
assert.deepEqual(costHistorySchema.parse({ ...history, enterprise_id: id, attempt_id: id, expected_version: 0, result_version: 1 }), history);
assert.equal(costHistorySchema.safeParse({ ...history, new_price: -1 }).success, false);
console.log("Read schema assertions passed: stripping, list, required fields, invalid values and histories.");

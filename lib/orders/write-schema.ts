import { z } from "zod";

// UI accepts BRL notation; RPC receives canonical decimal strings, never floats.
export function decimalBR(value: string): string {
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value)) throw new Error("Use valores como 1.234,56.");
  const [whole, fraction = ""] = value.replaceAll(".", "").split(",");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}
export function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
export function brValue(value: number | string): string { return String(value).replace(".", ","); }
const money = (max: bigint) => z.string().max(15).regex(/^(0|[1-9]\d*)(\.\d{1,2})?$/).pipe(z.string().refine(v => cents(v) <= max, "Valor acima do limite."));
const optional = (max: number) => z.string().max(max).nullable();
export const orderInputSchema = z.object({
  attemptId: z.string().uuid(), orderId: z.string().uuid().optional(),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  buyerName: z.string().trim().min(1).max(255), buyerPhone: optional(50), buyerEmail: optional(320),
  buyerAddress: optional(2000), notes: optional(5000),
  discountType: z.enum(["fixed", "percent"]), discountInput: money(BigInt("99999999999999")), shippingAmount: money(BigInt("99999999999999")),
  items: z.array(z.object({
    origin: z.enum(["catalog", "custom"]), product_id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(255), description: optional(3000),
    quantity: z.string().max(10).regex(/^[1-9]\d*$/).pipe(z.string().refine(v => BigInt(v) <= BigInt(1000000000))),
    unit_price: money(BigInt(100000000)), fulfillment_mode: z.enum(["untracked", "stock", "make_to_order"]),
  }).strict().refine(i => i.origin !== "catalog" || i.product_id !== null)).min(1).max(100),
}).strict().superRefine((r, ctx) => {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(r.discountInput) || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(r.shippingAmount) || r.items.some(i => !/^[1-9]\d*$/.test(i.quantity) || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(i.unit_price))) return;
  if (r.discountType === "percent" && cents(r.discountInput) > BigInt(10000)) ctx.addIssue({code:"custom", message:"Percentual máximo: 100%."});
  if (r.orderId && r.expectedVersion === undefined) ctx.addIssue({code:"custom", message:"Versão obrigatória."});
  const subtotal = r.items.reduce((sum, i) => sum + BigInt(i.quantity) * cents(i.unit_price), BigInt(0));
  if (subtotal > BigInt("99999999999999") || estimate(r).total > BigInt("99999999999999")) ctx.addIssue({code:"custom", message:"Total acima do limite."});
});
export type OrderInput = z.infer<typeof orderInputSchema>;
export function estimate(r: Pick<OrderInput, "items" | "discountType" | "discountInput" | "shippingAmount">) {
  const subtotal = r.items.reduce((sum, i) => sum + BigInt(i.quantity) * cents(i.unit_price), BigInt(0));
  const input = cents(r.discountInput);
  const discount = r.discountType === "fixed" ? (input > subtotal ? subtotal : input) : (subtotal * input + BigInt(5000)) / BigInt(10000);
  const shipping = cents(r.shippingAmount);
  return { subtotal, discount, shipping, total: subtotal - discount + shipping };
}
export function formatCents(value: bigint) { return `R$ ${(value / BigInt(100)).toLocaleString("pt-BR")},${String(value % BigInt(100)).padStart(2, "0")}`; }

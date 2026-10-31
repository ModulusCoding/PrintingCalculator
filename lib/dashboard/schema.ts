import { z } from "zod";
import { operationalStatus } from "@/lib/orders/operation-schema";

// Money is returned as integer cents encoded as text: no JSON floating point conversion.
export const centsSchema = z.string().regex(/^-?\d+$/).refine((value) => /^-?\d+$/.test(value) && BigInt(value).toString() === value);
const nonnegativeCents = centsSchema.refine((value) => /^\d+$/.test(value));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), sales_cents: nonnegativeCents, receipts_cents: centsSchema, orders_count: count }).strict();
export const dashboardSchema = z.object({
  enterprise_id: z.string().uuid(),
  as_of: z.string().datetime({ offset: true }),
  current_month: z.string().regex(/^\d{4}-\d{2}$/),
  sales_cents: nonnegativeCents,
  receipts_cents: centsSchema,
  pending_cents: nonnegativeCents,
  month_orders_count: count,
  active_orders_count: count,
  months: z.array(monthSchema).length(6),
  recent_orders: z.array(z.object({ id: z.string().uuid(), display_number: z.string().regex(/^\d+$/), buyer_name: z.string(), operational_status: operationalStatus, total_cents: nonnegativeCents, created_at: z.string().datetime({ offset: true }) }).strict()).max(5),
}).strict().superRefine((data, ctx) => {
  const current = data.months[5];
  if (!current || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.current_month)) {
    ctx.addIssue({ code: "custom", message: "Invalid dashboard period" });
    return;
  }
  const [year, month] = data.current_month.split("-").map(Number);
  const expected = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(year, month - 6 + i, 1)).toISOString().slice(0, 7));
  if (data.months.some((bucket, i) => bucket.month !== expected[i])) ctx.addIssue({ code: "custom", message: "Nonconsecutive dashboard months" });
  if (current.month !== data.current_month || current.sales_cents !== data.sales_cents || current.receipts_cents !== data.receipts_cents || current.orders_count !== data.month_orders_count || new Set(data.months.map(m => m.month)).size !== 6) ctx.addIssue({ code: "custom", message: "Inconsistent dashboard period" });
});
export type DashboardData = z.infer<typeof dashboardSchema>;

export const inventorySchema = z.object({
  enterprise_id: z.string().uuid(),
  available_units: z.string().regex(/^\d+$/),
  reserved_units: z.string().regex(/^\d+$/),
  stocked_products: count,
}).strict();
export const spoolsSchema = z.object({
  enterprise_id: z.string().uuid(),
  low_count: count,
  empty_count: count,
  threshold_percent: z.number().min(0).max(100),
}).strict();
export type InventoryData = z.infer<typeof inventorySchema>;
export type SpoolsData = z.infer<typeof spoolsSchema>;
export type ReadResult<T> = { status: "ready"; data: T } | { status: "error"; message: string };
export type StockResult = { status: "free" } | { status: "unavailable" } | { status: "paid"; inventory: ReadResult<InventoryData>; spools: ReadResult<SpoolsData> };

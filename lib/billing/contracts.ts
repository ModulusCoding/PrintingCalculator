import { z } from "zod";

export const BILLING_PRICE_CENTS = 3990;
export const BILLING_CURRENCY = "BRL";
// Approved policy: first verified server observation, Sao Paulo calendar month.
export const COVERAGE_POLICY_APPROVED = true;
export const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const paymentSchema = z.object({
  id: providerId, customer: providerId, subscription: providerId.nullish(),
  checkoutSession: z.string().uuid().nullish(), value: z.number().finite(),
  billingType: z.string(), status: z.string(), dueDate: z.iso.date(),
  deleted: z.boolean().optional(), invoiceUrl: z.string().nullish(),
});
export const subscriptionSchema = z.object({
  id: providerId, customer: providerId, checkoutSession: z.string().uuid().nullish(),
  value: z.number().finite(), cycle: z.string(), status: z.string(), deleted: z.boolean().optional(),
});
export const checkoutSchema = z.object({ id: z.string().uuid(), link: z.string().optional() });
export const eventSchema = z.object({
  id: z.string().min(1).max(200), event: z.string().regex(/^[A-Z_]{1,100}$/),
  payment: z.object({ id: providerId }).optional(),
  subscription: z.object({ id: providerId }).optional(),
  checkout: z.object({ id: z.string().uuid() }).optional(),
});
export type BillingEvent = z.infer<typeof eventSchema>;
export function safeAsaasUrl(value: unknown, production = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hosts = production ? ["asaas.com", "www.asaas.com"] : ["sandbox.asaas.com"];
    return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname)
      && /^\/(i\/|checkoutSession\/show)/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function financialState(payment: z.infer<typeof paymentSchema>) {
  if (payment.deleted || payment.value !== BILLING_PRICE_CENTS / 100 || !["PIX", "CREDIT_CARD"].includes(payment.billingType)) return "review";
  if (["CONFIRMED", "RECEIVED"].includes(payment.status)) return "confirmed";
  if (["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"].includes(payment.status)) return "revoked";
  return "pending";
}

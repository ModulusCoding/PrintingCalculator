import "server-only";
import { z } from "zod";
import { COVERAGE_POLICY_APPROVED, checkoutSchema, paymentSchema, providerId, subscriptionSchema } from "./contracts";

export class BillingError extends Error {
  constructor(readonly code: "unavailable" | "remote_unknown" | "remote_rejected" | "invalid_response" | "coverage_policy_required") { super(code); }
}
export function billingConfig() {
  const environment = process.env.ASAAS_ENVIRONMENT ?? "sandbox";
  if (!["sandbox", "production"].includes(environment)) throw new BillingError("unavailable");
  const production = environment === "production";
  if (production && process.env.ASAAS_PRODUCTION_ENABLED !== "true") throw new BillingError("unavailable");
  const key = process.env.ASAAS_API_KEY;
  if (!key || /[\r\n]/.test(key)) throw new BillingError("unavailable");
  return { production, key, base: production ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3" };
}

/** Fixed paths only, no caller-provided URLs, redirects, retries or raw provider errors. */
export class AsaasClient {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const config = billingConfig();
    let response: Response;
    try {
      response = await this.transport(`${config.base}${path}`, {
        method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { access_token: config.key, "Content-Type": "application/json", "User-Agent": "ModulusHub/1.0" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new BillingError("remote_unknown"); }
    if (!response.ok) throw new BillingError(response.status >= 500 || response.status === 429 ? "remote_unknown" : "remote_rejected");
    try { return schema.parse(await response.json()); } catch { throw new BillingError("invalid_response"); }
  }
  payment(id: string) { return this.request("GET", `/payments/${providerId.parse(id)}`, paymentSchema); }
  subscription(id: string) { return this.request("GET", `/subscriptions/${providerId.parse(id)}`, subscriptionSchema); }
  deleteSubscription(id: string) {
    return this.request("DELETE", `/subscriptions/${providerId.parse(id)}`, z.object({ id: z.literal(id), deleted: z.literal(true) }));
  }
  customers(reference: string) {
    return this.request("GET", `/customers?externalReference=${encodeURIComponent(reference)}&limit=100`, z.object({ hasMore: z.boolean(), data: z.array(z.object({ id: providerId, externalReference: z.string().nullish(), deleted: z.boolean().optional() })) }));
  }
  createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }) {
    return this.request("POST", "/customers", z.object({ id: providerId, externalReference: z.string() }), input);
  }
  subscriptions(customer: string, reference?: string) {
    return this.request("GET", `/subscriptions?customer=${providerId.parse(customer)}&limit=100${reference ? `&externalReference=${encodeURIComponent(reference)}` : ""}`, z.object({ hasMore: z.boolean(), data: z.array(subscriptionSchema.extend({ externalReference: z.string().nullish() })) }));
  }
  paymentPage(customer: string, subscription: string | null, checkout: string | null, offset: number) {
    z.number().int().nonnegative().parse(offset);
    if (!subscription && !checkout) throw new BillingError("invalid_response");
    const filter = subscription ? `subscription=${providerId.parse(subscription)}` : `checkoutSession=${z.uuid().parse(checkout)}`;
    return this.request("GET", `/payments?customer=${providerId.parse(customer)}&${filter}&offset=${offset}&limit=100`, z.object({ hasMore: z.boolean(), offset: z.number().int().nonnegative(), limit: z.number().int(), data: z.array(paymentSchema).max(100) }));
  }
  cancelCheckout(id: string) {
    return this.request("POST", `/checkouts/${z.uuid().parse(id)}/cancel`, z.object({ id: z.literal(id), status: z.literal("CANCELED") }), {});
  }
  subscriptionPayments(id: string) {
    return this.request("GET", `/subscriptions/${providerId.parse(id)}/payments?limit=100`, z.object({ hasMore: z.boolean(), data: z.array(paymentSchema) }));
  }
  customerPayments(id: string) {
    return this.request("GET", `/payments?customer=${providerId.parse(id)}&limit=100`, z.object({ hasMore: z.boolean(), data: z.array(paymentSchema) }));
  }
  createPixSubscription(customer: string, reference: string, due: string) {
    return this.request("POST", "/subscriptions", subscriptionSchema, { customer: providerId.parse(customer), externalReference: reference, billingType: "PIX", value: 39.90, nextDueDate: z.iso.date().parse(due), cycle: "MONTHLY", description: "Modulus Visionário mensal — Pix manual" });
  }
  createCardCheckout(input: { attemptId: string; customer: string; callbackOrigin: string; nextDueDate: string }) {
    if (!COVERAGE_POLICY_APPROVED) throw new BillingError("coverage_policy_required");
    const origin = z.url().parse(input.callbackOrigin);
    if (new URL(origin).protocol !== "https:") throw new BillingError("unavailable");
    const callback = new URL("/meu-plano", origin).href;
    return this.request("POST", "/checkouts", checkoutSchema, {
      billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: 60,
      customer: providerId.parse(input.customer), externalReference: z.uuid().parse(input.attemptId),
      callback: { successUrl: callback, cancelUrl: callback, expiredUrl: callback },
      items: [{ name: "Modulus Visionário", description: "Plano mensal sem fidelidade", quantity: 1, value: 39.90,
        imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4R8AAAAASUVORK5CYII=" }],
      subscription: { cycle: "MONTHLY", nextDueDate: z.iso.date().parse(input.nextDueDate) },
    });
  }
}

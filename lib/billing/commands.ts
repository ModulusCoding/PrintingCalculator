import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AsaasClient, BillingError } from "./asaas";
import { safeAsaasUrl } from "./contracts";
import { validBillingDocument } from "./document";
import { billingAdmin } from "./admin";

const startSchema = z.object({ attempt: z.uuid(), method: z.enum(["PIX", "CREDIT_CARD"]), name: z.string().trim().min(3).max(100), cpfCnpj: z.string().regex(/^(?:\d{11}|\d{14})$/), email: z.email().max(254) });
const reservationSchema = z.object({ id: z.uuid().optional(), enterprise_id: z.uuid(), generation: z.uuid(), state: z.string(), phase: z.string().optional(), method: z.string().optional(), customer_id: z.string().nullable(), subscription_id: z.string().nullish(), checkout_url: z.string().nullish(), fresh: z.boolean().optional() });
/** Each POST has a durable unknown phase BEFORE transport. Unknown never re-POSTs. */
export async function startCheckout(input: unknown): Promise<string | null> {
  const data = startSchema.parse(input);
  if (!validBillingDocument(data.cpfCnpj)) throw new BillingError("invalid_response");
  const origin = z.url().parse(process.env.ASAAS_CALLBACK_ORIGIN);
  if (new URL(origin).protocol !== "https:") throw new BillingError("unavailable");
  const client = await createClient();
  const result = await client.rpc("m8_reserve_my_checkout", { p_attempt: data.attempt, p_method: data.method });
  if (result.error) throw new BillingError("unavailable");
  const r = reservationSchema.parse(result.data);
  const api = new AsaasClient(); const db = billingAdmin();
  if (r.state === "existing") return safeAsaasUrl(r.checkout_url, process.env.ASAAS_ENVIRONMENT === "production");
  if (r.method && r.method !== data.method) throw new BillingError("remote_unknown");
  const attempt = r.id!;
  const reference = `m8:${r.enterprise_id}`;
  let customer = r.customer_id;
  if (!customer) {
    const list = await api.customers(reference);
    const matches = list.data.filter(c => c.externalReference === reference && !c.deleted);
    if (list.hasMore || matches.length > 1) throw new BillingError("remote_unknown");
    if (matches.length === 1) customer = matches[0].id;
    else {
      if (!r.fresh) throw new BillingError("remote_unknown");
      const created = await api.createCustomer({ name: data.name, cpfCnpj: data.cpfCnpj, email: data.email, externalReference: reference });
      if (created.externalReference !== reference) throw new BillingError("invalid_response");
      customer = created.id;
    }
  }
  // Recovery from customer ambiguity can proceed once uniquely verified. A resource
  // phase timeout can only READ, never submit a second resource creation.
  if (r.phase === "resource" || r.phase === "review") {
    if (r.method === "PIX") {
      const list = await api.subscriptions(customer, attempt);
      const matches = list.data.filter(s => s.customer === customer && s.externalReference === attempt && s.value === 39.90 && s.cycle === "MONTHLY");
      if (!list.hasMore && matches.length === 1) {
        const verified = await api.subscription(matches[0].id);
        if (verified.customer !== customer || verified.value !== 39.90 || verified.cycle !== "MONTHLY") throw new BillingError("invalid_response");
        await db.rpc("m8_checkout_progress", { p_attempt: attempt, p_phase: "complete", p_customer: customer, p_subscription: verified.id });
        return null;
      }
    }
    throw new BillingError("remote_unknown");
  }
  await db.rpc("m8_checkout_progress", { p_attempt: attempt, p_phase: "resource", p_customer: customer });
  const due = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (data.method === "PIX") {
    const subscription = await api.createPixSubscription(customer, attempt, due);
    if (subscription.customer !== customer || subscription.value !== 39.90 || subscription.cycle !== "MONTHLY") throw new BillingError("invalid_response");
    await db.rpc("m8_checkout_progress", { p_attempt: attempt, p_phase: "complete", p_customer: customer, p_subscription: subscription.id });
    return null;
  }
  const checkout = await api.createCardCheckout({ attemptId: attempt, customer, callbackOrigin: origin, nextDueDate: due });
  const url = safeAsaasUrl(checkout.link, process.env.ASAAS_ENVIRONMENT === "production");
  if (!url) throw new BillingError("invalid_response");
  await db.rpc("m8_checkout_progress", { p_attempt: attempt, p_phase: "complete", p_customer: customer, p_checkout: checkout.id, p_url: url });
  return url;
}

export async function cancelMyCheckout(attemptId: string) {
  z.uuid().parse(attemptId);
  const client = await createClient();
  const { data, error } = await client.rpc("m8_reserve_my_checkout_cancel", { p_attempt: attemptId });
  if (error) throw new BillingError("unavailable");
  const receipt = z.object({ state: z.enum(["reserved", "unknown", "confirmed"]), checkout_id: z.uuid() }).parse(data);
  if (receipt.state === "confirmed") return;
  if (receipt.state === "unknown") throw new BillingError("remote_unknown");
  try {
    await new AsaasClient().cancelCheckout(receipt.checkout_id);
    await billingAdmin().rpc("m8_confirm_checkout_cancel", { p_attempt: attemptId, p_checkout: receipt.checkout_id });
  } catch { throw new BillingError("remote_unknown"); }
}

/** Owner authority and durable reservation are checked inside SQL, not browser claims. */
export async function cancelMySubscription(attemptId: string) {
  z.uuid().parse(attemptId);
  const client = await createClient();
  const { data, error } = await client.rpc("m8_reserve_my_cancellation", { p_attempt: attemptId });
  if (error) throw new BillingError("unavailable");
  const receipt = z.object({ state: z.enum(["reserved", "unknown", "confirmed"]), subscription_id: z.string() }).parse(data);
  if (receipt.state === "confirmed") return;
  // A repeated reserved/unknown attempt is never sent again. Recovery requires
  // independent provider verification by an operator, not another DELETE.
  if (receipt.state === "unknown") throw new BillingError("remote_unknown");
  const api = new AsaasClient();
  try {
    await api.deleteSubscription(receipt.subscription_id);
  } catch {
    // Reservation already persisted unknown before the outbound request.
    throw new BillingError("remote_unknown");
  }
  try {
    await billingAdmin().rpc("m8_confirm_my_cancellation", { p_attempt: attemptId, p_subscription: receipt.subscription_id });
  } catch { throw new BillingError("remote_unknown"); }
}

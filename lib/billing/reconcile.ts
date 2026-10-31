import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AsaasClient, billingConfig } from "./asaas";
import { billingAdmin } from "./admin";
import { safeAsaasUrl, financialState } from "./contracts";
import { scanBillingPages } from "./scan";

const workSchema = z.array(z.object({ id: z.string(), event_type: z.string(), resource_kind: z.string(), resource_id: z.string().nullable() }));
const linkSchema = z.array(z.object({ enterprise_id: z.uuid(), customer_id: z.string(), subscription_id: z.string().nullable(), checkout_id: z.uuid().nullable(), state: z.string() })).max(1);
const claimSchema = z.object({ version: z.number().int().positive(), customer_id: z.string(), subscription_id: z.string().nullable(), state: z.string() }).nullable();
const unknownSchema = z.array(z.object({ enterprise_id: z.uuid(), subscription_id: z.string() }));

/** Fenced durable reconciliation. A 404 is NOT proof of deletion: the official
 * GET contract also returns it for IDs inaccessible to the authenticated account.
 * Thus 404/transport/invalid snapshots keep unknown/retry state, never downgrade.
 */
export async function reconcileBilling(eventId: string | null = null, enterprise?: string) {
  const db = billingAdmin(); const api = new AsaasClient();
  const scan = await scanBillingPages(enterprise);
  const work = workSchema.parse(await db.rpc("m8_billing_work_scoped", { p_id: eventId, p_enterprise: enterprise ?? null }));
  let observed = 0; let review = scan.review;
  async function subscriptionSnapshot(enterprise: string, id: string, event: string | null) {
    const token = randomUUID();
    const claim = claimSchema.parse(await db.rpc("m8_claim_billing_account", { p_enterprise: enterprise, p_token: token }));
    if (!claim) return false;
    // The GET must happen AFTER durable claim; previous hints cannot be committed.
    const snapshot = await api.subscription(id);
    if (snapshot.id !== id || snapshot.customer !== claim.customer_id || snapshot.id !== claim.subscription_id) throw new Error("identity_mismatch");
    await db.rpc("m8_apply_subscription_snapshot", {
      p_enterprise: enterprise, p_token: token, p_version: claim.version,
      p_subscription: snapshot.id, p_customer: snapshot.customer,
      p_deleted: snapshot.deleted === true, p_status: snapshot.status, p_event: event,
    });
    return true;
  }
  // Recovers crash/timeout after DELETE without repeating the mutation.
  const cancellations = unknownSchema.parse(await db.rpc("m8_unknown_cancellations", {}));
  for (const account of cancellations) {
    if (enterprise && account.enterprise_id !== enterprise) continue;
    try { if (await subscriptionSnapshot(account.enterprise_id, account.subscription_id, null)) observed++; else review++; }
    catch { review++; } // Lease expires durably; unknown reservation remains locked.
  }
  for (const event of work) {
    try {
      if (!event.resource_id || !["payment", "subscription"].includes(event.resource_kind)) {
        await db.rpc("m8_billing_event_review", { p_id: event.id }); review++; continue;
      }
      if (event.resource_kind === "subscription") {
        const account = linkSchema.parse(await db.rpc("m8_billing_link", { p_kind: "subscription", p_id: event.resource_id }))[0];
        if (!account || (enterprise && account.enterprise_id !== enterprise)) throw new Error("unlinked");
        if (await subscriptionSnapshot(account.enterprise_id, event.resource_id, event.id)) observed++; else review++;
        continue;
      }
      // First GET discovers linkage only; never commit that pre-claim snapshot.
      const hint = await api.payment(event.resource_id);
      const kind = hint.checkoutSession ? "checkout" : "subscription";
      const id = hint.checkoutSession ?? hint.subscription;
      if (!id) throw new Error("unlinked");
      const account = linkSchema.parse(await db.rpc("m8_billing_link", { p_kind: kind, p_id: id }))[0];
      if (!account || (enterprise && account.enterprise_id !== enterprise) || account.customer_id !== hint.customer) throw new Error("unlinked");
      const token = randomUUID();
      const claim = claimSchema.parse(await db.rpc("m8_claim_billing_account", { p_enterprise: account.enterprise_id, p_token: token }));
      if (!claim) { review++; continue; }
      const payment = await api.payment(event.resource_id);
      if (payment.id !== event.resource_id || payment.customer !== claim.customer_id || financialState(payment) === "review") throw new Error("identity_mismatch");
      if (payment.subscription) {
        const subscription = await api.subscription(payment.subscription);
        if (subscription.customer !== claim.customer_id || subscription.value !== 39.90 || subscription.cycle !== "MONTHLY" || (payment.checkoutSession && subscription.checkoutSession !== payment.checkoutSession) || (financialState(payment) === "confirmed" && (subscription.deleted || subscription.status !== "ACTIVE"))) throw new Error("subscription_mismatch");
      }
      await db.rpc("m8_apply_payment_snapshot", {
        p_enterprise: account.enterprise_id, p_token: token, p_version: claim.version,
        p_event: event.id, p_payment: payment.id, p_customer: payment.customer,
        p_subscription: payment.subscription ?? null, p_checkout: payment.checkoutSession ?? null,
        p_status: payment.status, p_value: Math.round(payment.value * 100), p_due: payment.dueDate,
        p_invoice: safeAsaasUrl(payment.invoiceUrl, billingConfig().production),
      });
      observed++;
    } catch { await db.rpc("m8_billing_event_failed", { p_id: event.id }); review++; }
  }
  return { observed, review, scan_pages: scan.pages, resumable: true, activation: "verified_ledger" };
}

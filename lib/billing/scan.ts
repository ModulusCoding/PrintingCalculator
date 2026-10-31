import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { billingAdmin } from "./admin";
import { AsaasClient } from "./asaas";

const claimSchema = z.object({ enterprise_id: z.uuid(), generation: z.uuid(), customer_id: z.string(), subscription_id: z.string().nullable(), checkout_id: z.uuid().nullable(), scan_offset: z.number().int().nonnegative(), scan_version: z.number().int().positive() }).nullable();
/** One page per claim: fair round-robin DB queue, resumable across processes.
 * Page hints + next offset commit atomically, never grants from list snapshots.
 */
export async function scanBillingPages(enterprise?: string, budget = 4) {
  const db = billingAdmin(); const api = new AsaasClient();
  let pages = 0; let review = 0;
  for (let i = 0; i < budget; i++) {
    const token = randomUUID();
    const claim = claimSchema.parse(await db.rpc("m8_claim_scan_page", { p_enterprise: enterprise ?? null, p_token: token }));
    if (!claim) break;
    try {
      const page = await api.paymentPage(claim.customer_id, claim.subscription_id, claim.checkout_id, claim.scan_offset);
      if (page.offset !== claim.scan_offset || page.limit !== 100 || page.data.length > 100 || (page.hasMore && page.data.length !== 100)) throw Error("invalid_page");
      // Validate EVERY resource before checkpoint; no partial page acceptance.
      if (page.data.some(p => p.customer !== claim.customer_id || (claim.subscription_id ? p.subscription !== claim.subscription_id : p.checkoutSession !== claim.checkout_id))) throw Error("page_identity_mismatch");
      await db.rpc("m8_commit_scan_page", {
        p_enterprise: claim.enterprise_id, p_generation: claim.generation, p_token: token, p_version: claim.scan_version,
        p_offset: claim.scan_offset, p_count: page.data.length, p_more: page.hasMore,
        p_payments: page.data.map(p => ({ id: p.id, status: p.status })),
      });
      pages++;
    } catch { review++; } // Lease expiry retries SAME offset, fairness ticket already advanced.
  }
  return { pages, review };
}

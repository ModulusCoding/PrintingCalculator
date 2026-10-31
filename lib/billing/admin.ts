import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BillingError } from "./asaas";

// Kept in billing, never exported from the shared Supabase client modules.
export function billingAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BillingError("unavailable");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async rpc(name: "m8_claim_scan_page" | "m8_commit_scan_page" | "m8_billing_work_scoped" | "m8_reserve_my_checkout_cancel" | "m8_confirm_checkout_cancel" | "m8_scan_accounts" | "m8_checkout_progress" | "m8_receive_billing_event" | "m8_billing_work" | "m8_billing_link" | "m8_observe_billing_payment" | "m8_billing_event_failed" | "m8_billing_event_review" | "m8_confirm_my_cancellation" | "m8_claim_billing_account" | "m8_apply_subscription_snapshot" | "m8_apply_payment_snapshot" | "m8_unknown_cancellations", args: Record<string, unknown>) {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new BillingError("unavailable");
      return data;
    },
  };
}

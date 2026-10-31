"use server";
import { redirect } from "next/navigation";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { cancelMySubscription, cancelMyCheckout, startCheckout } from "./commands";
import { reconcileBilling } from "./reconcile";

export async function startSubscriptionAction(form: FormData) {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready" || identity.role !== "owner" || form.get("accepted") !== "on") redirect("/meu-plano?billing=not_authorized");
  let url: string | null = null;
  try { url = await startCheckout({ attempt: String(form.get("attempt")), method: form.get("method"), name: form.get("name"), cpfCnpj: form.get("cpfCnpj"), email: form.get("email") }); }
  catch { redirect("/meu-plano?billing=verification_required"); }
  redirect(url ?? "/meu-plano?billing=awaiting_pix");
}

export async function refreshSubscriptionAction() {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready" || identity.role !== "owner") redirect("/meu-plano?billing=not_authorized");
  // Owner refresh is intentionally tenant-scoped by the orchestrator RPC below.
  // Global inbox processing remains the separately authenticated admin endpoint.
  try { await reconcileBilling(null, identity.enterpriseId); }
  catch { redirect("/meu-plano?billing=verification_required"); }
  redirect("/meu-plano");
}

export async function cancelCheckoutAction(form: FormData) {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready" || identity.role !== "owner" || form.get("confirmed") !== "on") redirect("/meu-plano?billing=not_authorized");
  try { await cancelMyCheckout(String(form.get("attempt"))); }
  catch { redirect("/meu-plano?billing=verification_required"); }
  redirect("/meu-plano?billing=checkout_cancelled");
}

export async function cancelSubscriptionAction(form: FormData) {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready" || identity.role !== "owner" || form.get("confirmed") !== "on") redirect("/meu-plano?billing=not_authorized");
  try { await cancelMySubscription(String(form.get("attempt"))); }
  catch { redirect("/meu-plano?billing=verification_required"); }
  redirect("/meu-plano?billing=cancelled");
}

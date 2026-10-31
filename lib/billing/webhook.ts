import "server-only";
import { timingSafeEqual } from "node:crypto";
import { eventSchema } from "./contracts";
import { billingAdmin } from "./admin";

export function authenticatedToken(actual: string | null, expected: string | undefined) {
  if (!actual || !expected || expected.length < 32 || actual.length > 1024) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function receiveWebhook(request: Request) {
  if (!authenticatedToken(request.headers.get("asaas-access-token"), process.env.ASAAS_WEBHOOK_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length")) > 65536) return new Response(null, { status: 413 });
  let text: string;
  try {
    // Bound streamed bodies as well as Content-Length; do not buffer an unbounded request.
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } catch { return new Response(null, { status: 400 }); }
  const parsed = eventSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!parsed.success) return new Response(null, { status: 400 });
  const e = parsed.data;
  const kind = e.payment ? "payment" : e.subscription ? "subscription" : e.checkout ? "checkout" : "other";
  const resource = e.payment?.id ?? e.subscription?.id ?? e.checkout?.id ?? null;
  try {
    await billingAdmin().rpc("m8_receive_billing_event", { p_id: e.id, p_type: e.event, p_kind: kind, p_resource: resource });
    return Response.json({ received: true });
  } catch { return Response.json({ error: "persistence_unavailable" }, { status: 503 }); }
}

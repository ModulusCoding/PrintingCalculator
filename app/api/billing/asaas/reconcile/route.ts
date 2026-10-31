import { authenticatedToken } from "@/lib/billing/webhook";
import { reconcileBilling } from "@/lib/billing/reconcile";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!authenticatedToken(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null, process.env.ASAAS_RECONCILE_TOKEN)) return new Response(null, { status: 401 });
  const eventId = new URL(request.url).searchParams.get("event");
  if (eventId && eventId.length > 200) return new Response(null, { status: 400 });
  try { return Response.json(await reconcileBilling(eventId)); }
  catch { return Response.json({ error: "reconciliation_unavailable" }, { status: 503 }); }
}

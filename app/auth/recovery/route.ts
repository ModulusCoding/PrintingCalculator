import { createClient } from "@/lib/supabase/server";
import { clearRecoveryMarker, issueRecoveryMarker } from "@/lib/auth/recovery-cookie";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const allowedKeys = new Set(["token_hash", "type"]);

  await clearRecoveryMarker();
  if (
    !tokenHash ||
    tokenHash.length > 512 ||
    !/^[a-zA-Z0-9_-]+$/.test(tokenHash) ||
    type !== "recovery" ||
    url.searchParams.getAll("type").length !== 1 ||
    url.searchParams.getAll("token_hash").length !== 1 ||
    [...url.searchParams.keys()].some((key) => !allowedKeys.has(key))
  ) {
    return NextResponse.redirect(new URL("/auth/invalid-link?reason=recovery", url.origin));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error) return NextResponse.redirect(new URL("/auth/invalid-link?reason=recovery", url.origin));

    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) return NextResponse.redirect(new URL("/auth/invalid-link?reason=recovery", url.origin));
    const { data: claimsData } = await supabase.auth.getClaims();
    const sessionId = claimsData?.claims?.session_id;
    if (typeof sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) return NextResponse.redirect(new URL("/auth/invalid-link?reason=recovery", url.origin));
    await issueRecoveryMarker(data.user.id, sessionId);

    return NextResponse.redirect(new URL("/redefinir-senha", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/auth/invalid-link?reason=recovery", url.origin));
  }
}

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function invalid(url: URL, reason: "signup_invalid" | "signup_unavailable" | "signup_session") { return NextResponse.redirect(new URL(`/auth/invalid-link?reason=${reason}`, url.origin)); }
function isTechnical(error: { name?: string; code?: string }) { return error.name === "AuthRetryableFetchError" || ["AuthUnknown", "AuthUnknownError"].includes(error.name ?? "") || error.code === "unexpected_failure"; }

export async function GET(request: Request) {
  const url = new URL(request.url), tokenHash = url.searchParams.get("token_hash"), type = url.searchParams.get("type");
  if (!tokenHash || tokenHash.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(tokenHash) || type !== "signup" || url.searchParams.getAll("type").length !== 1 || url.searchParams.getAll("token_hash").length !== 1 || [...url.searchParams.keys()].some(key => !["type", "token_hash"].includes(key))) return invalid(url, "signup_invalid");
  try {
    const supabase = await createClient(); const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "signup" });
    if (error) return invalid(url, isTechnical(error) ? "signup_unavailable" : "signup_invalid");
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user?.email_confirmed_at) return invalid(url, "signup_session");
    return NextResponse.redirect(new URL("/cadastro/concluir", url.origin));
  } catch { return invalid(url, "signup_unavailable"); }
}

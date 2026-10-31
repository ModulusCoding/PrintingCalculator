import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function validatedRecoverySession(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: verified, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || verified?.claims.sub !== data.user.id) return null;
  const sessionId = z.string().uuid().safeParse(verified.claims.session_id);
  if (!sessionId.success) return null;
  return { uid: data.user.id, sessionId: sessionId.data };
}

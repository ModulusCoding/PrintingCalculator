"use server";
import "server-only";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { resolveMinimalIdentity } from "./context";
import { passwordError, verificationError, updatePasswordError, unknownUpdateOutcome, type RequiredPasswordState } from "./password-change-errors";

export type { RequiredPasswordState } from "./password-change-errors";

const schema = z.object({ current: z.string(), next: z.string(), confirm: z.string() });
const obligationSchema = z.object({ user_id: z.uuid(), identity_id: z.uuid(), obligation_version: z.number().int().nonnegative(), required: z.boolean() }).strict();
const releaseSchema = z.array(z.object({ status: z.enum(["released", "already_released", "version_conflict"]), obligation_version: z.number().int().nonnegative() }).strict()).length(1);

export async function changeRequiredPasswordAction(_prevState: RequiredPasswordState, formData: FormData): Promise<RequiredPasswordState> {
  const parsed = schema.safeParse({ current: formData.get("current"), next: formData.get("next"), confirm: formData.get("confirm") });
  if (!parsed.success) return passwordError("validation", "Confira os campos indicados.");
  const fieldErrors: Record<"current" | "next" | "confirm", string | undefined> = {
    current: parsed.data.current.length === 0 ? "Preencha este campo." : undefined,
    next: parsed.data.next.length === 0 ? "Preencha este campo." : parsed.data.next.length < 8 ? "Use pelo menos 8 caracteres." : undefined,
    confirm: parsed.data.confirm.length === 0 ? "Preencha este campo." : undefined,
  };
  if (fieldErrors.current || fieldErrors.next || fieldErrors.confirm) return passwordError("validation", "Confira os campos indicados.", fieldErrors);
  if (parsed.data.next !== parsed.data.confirm) return passwordError("validation", "A confirmação não corresponde à nova senha.", { confirm: "A confirmação não corresponde à nova senha." });
  if (parsed.data.current === parsed.data.next) return updatePasswordError({ code: "same_password" });
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit({ key: `required-password:${ip}`, max: 8, windowMs: 15 * 60 * 1000 }).allowed) return passwordError("rate_limited", "Muitas tentativas. Aguarde alguns minutos.");
    const session = await createClient();
    const { data: auth, error: authError } = await session.auth.getUser();
    if (authError || !auth.user || !auth.user.email) return passwordError("session_expired", "Sua sessão expirou. Entre novamente.");
    const context = await resolveMinimalIdentity();
    if (context.state !== "password_change_required") return passwordError("not_required", "A troca de senha não é necessária.");
    const issuer = process.env.SUPABASE_AUTH_ISSUER;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || issuer !== `${url.replace(/\/$/, "")}/auth/v1`) return passwordError("configuration", "A troca de senha não está configurada.");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!issuer || !url || !anon || !service) return passwordError("configuration", "A troca de senha não está configurada.");
    const admin = createSupabaseClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: obligation, error: readError } = await admin.rpc("get_required_password_change", { p_auth_user_id: auth.user.id, p_issuer: issuer });
    if (readError || !Array.isArray(obligation) || obligation.length !== 1) return passwordError("obligation_unavailable", "Não foi possível validar seu acesso neste momento. Tente novamente em alguns minutos.");
    const row = obligationSchema.safeParse(obligation[0]);
    if (!row.success || row.data.user_id !== context.userId || !row.data.required) return passwordError("not_required", "A troca de senha não é mais necessária.");
    // A disposable client verifies the old secret without touching the browser session cookies.
    const verifier = createSupabaseClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: auth.user.email, password: parsed.data.current });
    if (verifyError) return verificationError(verifyError);
    // verificationError above maps all verification failures.
    if (verified.user?.id !== auth.user.id) return passwordError("identity_mismatch", "Não foi possível validar sua identidade para esta operação.");
    // Revoke only the disposable verifier session, never the browser session.
    const { error: verifierLogoutError } = await verifier.auth.signOut({ scope: "local" });
    if (verifierLogoutError) return passwordError("verification_unavailable", "Não foi possível concluir a verificação. Tente novamente.");
    let updated: Awaited<ReturnType<typeof session.auth.updateUser>>["data"];
    try {
      const result = await session.auth.updateUser({ password: parsed.data.next, current_password: parsed.data.current });
      if (result.error) return updatePasswordError(result.error);
      updated = result.data;
    } catch {
      return unknownUpdateOutcome();
    }
    if (!updated.user || updated.user.id !== auth.user.id) return unknownUpdateOutcome();
    const partial: RequiredPasswordState = { status: "partial", code: "release_unconfirmed", passwordChanged: true, message: "Sua senha já foi alterada, mas a liberação não foi confirmada. Se continuar bloqueado, tente novamente usando a senha agora atual e outra nova senha diferente." };
    try {
      const { data: released, error: releaseError } = await admin.rpc("release_required_password_change", { p_auth_user_id: auth.user.id, p_issuer: issuer, p_expected_version: row.data.obligation_version });
      const result = releaseSchema.safeParse(released);
      if (releaseError || !result.success || result.data[0].status === "version_conflict") {
      if (result.success && result.data[0].status === "version_conflict") return passwordError("version_conflict", "Houve uma alteração simultânea. Por favor, tente novamente com sua nova senha se o acesso ainda estiver bloqueado.");
      return partial;
    }
      return { status: "success", code: "released", passwordChanged: true, message: "Senha alterada e conta liberada com sucesso." };
    } catch {
      return partial;
    }
  } catch (e) {
    void e;
    return passwordError("unavailable", "Ocorreu um erro interno.");
  }
}

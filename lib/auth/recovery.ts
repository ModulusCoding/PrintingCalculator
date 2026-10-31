"use server";

import "server-only";

import { headers } from "next/headers";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { clearRecoveryMarker, requireRecoveryMarker } from "./recovery-cookie";
import { validatedRecoverySession } from "./recovery-session";

const emailSchema = z.object({ email: z.string().trim().email("E-mail inválido.") });
const passwordSchema = z.object({
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
  confirmation: z.string().min(8, "Confirme sua senha."),
});

const genericMessage = "Se o cadastro puder prosseguir, você receberá instruções para redefinir a senha.";

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Informe um e-mail válido." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit({ key: `password-reset:${ip}`, max: 5, windowMs: 15 * 60 * 1000 }).allowed) {
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  try {
    const supabase = await createClient();
    const configured = process.env.NEXT_PUBLIC_BASE_URL;
    if (!configured) return { error: "A redefinição de senha não está configurada." };
    let originUrl: URL;
    try {
      originUrl = new URL(configured);
    } catch {
      return { error: "A redefinição de senha não está configurada." };
    }
    const isLocalHttp = process.env.NODE_ENV !== "production" && originUrl.protocol === "http:" && (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1");
    if ((originUrl.protocol !== "https:" && !isLocalHttp) || originUrl.username || originUrl.password || originUrl.search || originUrl.hash || originUrl.pathname !== "/") return { error: "A redefinição de senha não está configurada." };
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${originUrl.origin}/auth/recovery`,
    });
    if (error) return { error: "Não foi possível processar a solicitação. Tente novamente." };
    return { success: true, message: genericMessage };
  } catch {
    return { error: "Não foi possível processar a solicitação. Tente novamente." };
  }
}

export async function updatePasswordAction(formData: FormData) {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { error: "Confira a nova senha e tente novamente." };
  if (parsed.data.password !== parsed.data.confirmation) return { error: "As senhas não coincidem." };

  try {
    const supabase = await createClient();
    const recoverySession = await validatedRecoverySession(supabase);
    if (!recoverySession || !await requireRecoveryMarker(recoverySession.uid, recoverySession.sessionId)) {
      return { error: "O link de recuperação é inválido ou expirou." };
    }

    let updateResult: Awaited<ReturnType<typeof supabase.auth.updateUser>>;
    try {
      updateResult = await supabase.auth.updateUser({ password: parsed.data.password });
    } catch {
      return { error: "Não foi possível confirmar se a senha foi alterada. Verifique o resultado antes de tentar novamente.", outcomeUnknown: true };
    }
    if (updateResult.error) {
      if (updateResult.error.code === "same_password") {
        return {
          error: "A nova senha deve ser diferente da senha atual.",
          code: "same_password" as const,
          fieldErrors: { password: "A nova senha deve ser diferente da senha atual." },
        };
      }
      return { error: "Não foi possível atualizar a senha. Solicite um novo link." };
    }

    // From here on, the password update is confirmed. Cleanup failures must not
    // turn the confirmed update into a generic failure or an uncertain outcome.
    let logoutFailed = false;
    try {
      await clearRecoveryMarker();
    } catch {
      logoutFailed = true;
    }
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) logoutFailed = true;
    } catch {
      logoutFailed = true;
    }
    return logoutFailed ? { success: true, logoutFailed: true } : { success: true };
  } catch {
    return { error: "Não foi possível atualizar a senha. Tente novamente." };
  }
}

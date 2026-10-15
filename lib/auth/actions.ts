"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimitLogin } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveMinimalIdentity } from "./context";
import { clearRecoveryMarker } from "./recovery-cookie";

const loginSchema = z.object({
  email: z.string().trim().email("E-mail inválido.").toLowerCase(),
  password: z.string().min(1, "A senha é obrigatória."),
});

export async function loginAction(formData: FormData) {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";

  // Rate limiting check
  const rl = rateLimitLogin(ip);
  if (!rl.allowed) {
    return {
      error: "Muitas tentativas de login. Por favor, aguarde alguns minutos e tente novamente.",
    };
  }

  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");

  const validatedFields = loginSchema.safeParse({
    email: rawEmail,
    password: rawPassword,
  });

  if (!validatedFields.success) {
    return {
      error: validatedFields.error.flatten().fieldErrors.email?.[0] || 
             validatedFields.error.flatten().fieldErrors.password?.[0] || 
             "Dados de login inválidos.",
    };
  }

  const { email, password } = validatedFields.data;
  try {
    const supabase = await createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      if (signInError.code === "invalid_credentials") {
        return { error: "E-mail ou senha incorretos." };
      }
      return { error: "Não foi possível concluir o login. Tente novamente em instantes." };
    }

    try {
      const context = await resolveMinimalIdentity();
      return { success: true, state: context.state };
    } catch {
      await supabase.auth.signOut();
      return { error: "Erro técnico ao validar seu perfil de acesso. Tente novamente em instantes." };
    }
  } catch {
    return { error: "Não foi possível concluir o login. Tente novamente em instantes." };
  }
}

export async function logoutAction() {
  await clearRecoveryMarker();
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    
    if (error) {
      return { error: "Erro ao encerrar a sessão. Tente novamente." };
    }
    
    return { success: true };
  } catch {
    return { error: "Erro técnico ao realizar logout." };
  }
}

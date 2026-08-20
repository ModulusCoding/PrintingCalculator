"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimitLogin } from "@/lib/rate-limit";
import { headers } from "next/headers";

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

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Por favor, preencha todos os campos." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : "Erro ao realizar login. Tente novamente.",
    };
  }

  return { success: true };
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return { success: true };
}

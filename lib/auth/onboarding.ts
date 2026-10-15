"use server";
import "server-only";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isPublicOnboardingEnabled } from "./config";
import { resolveMinimalIdentity } from "./context";
import { COMPLETION_FAILURE, confirmationPending, errorResult, mapCompletionError, mapSignupError, unknownOutcome, validationError, type OnboardingResult } from "./onboarding-errors";

const credentialsSchema = z.object({
  email: z.string().trim().min(1, "Preencha este campo.").email("Informe um e-mail válido"),
  password: z.string().min(1, "Preencha este campo.").min(8, "Use pelo menos 8 caracteres"),
  confirmation: z.string().min(1, "Preencha este campo."),
});
const namesSchema = z.object({
  name: z.string().trim().min(1, "Preencha este campo.").max(200, "Use no máximo 200 caracteres"),
  enterpriseName: z.string().trim().min(1, "Preencha este campo.").max(200, "Use no máximo 200 caracteres"),
});

export async function signUpPublicAction(formData: FormData): Promise<OnboardingResult> {
  if (!isPublicOnboardingEnabled()) return errorResult("disabled", "O cadastro não está disponível neste ambiente.");
  const value = (key: string) => formData.get(key)?.toString() ?? "";
  const raw = { name: value("userName"), enterpriseName: value("enterpriseName"), email: value("email"), password: value("password"), confirmation: value("passwordConfirmation") };
  const names = namesSchema.safeParse(raw), credentials = credentialsSchema.safeParse(raw);
  const fields: Record<string, string> = {};
  if (!names.success) names.error.issues.forEach(i => { fields[i.path[0] as string] ??= i.message; });
  if (!credentials.success) credentials.error.issues.forEach(i => { fields[i.path[0] as string] ??= i.message; });
  if (credentials.success && credentials.data.password !== credentials.data.confirmation) fields.confirmation = "A confirmação não corresponde à senha.";
  if (Object.keys(fields).length || !names.success || !credentials.success) return validationError("Confira os campos indicados.", { ...fields, name: fields.name, email: fields.email, password: fields.password, confirmation: fields.confirmation, enterpriseName: fields.enterpriseName });
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit({ key: `signup:${ip}`, max: 5, windowMs: 15 * 60 * 1000 }).allowed) return errorResult("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  try {
    const supabase = await createClient();
    const configured = process.env.NEXT_PUBLIC_BASE_URL;
    if (!configured) return errorResult("configuration", "O cadastro está indisponível no momento.");
    const originUrl = new URL(configured);
    const localHttp = process.env.NODE_ENV === "development" && originUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(originUrl.hostname);
    if ((!localHttp && originUrl.protocol !== "https:") || originUrl.username || originUrl.password || originUrl.pathname !== "/" || originUrl.search || originUrl.hash) return errorResult("configuration", "O cadastro está indisponível no momento.");
    const origin = originUrl.origin;
    const { error } = await supabase.auth.signUp({ email: credentials.data.email, password: credentials.data.password, options: { emailRedirectTo: `${origin}/auth/confirm`, data: { user_name: names.data.name, enterprise_name: names.data.enterpriseName } } });
    return error ? mapSignupError(error) : confirmationPending();
  } catch { return unknownOutcome(); }
}

export async function completePublicOnboardingAction(formData: FormData): Promise<OnboardingResult> {
  if (!isPublicOnboardingEnabled()) return errorResult("disabled", "O cadastro não está disponível neste ambiente.");
  const parsed = namesSchema.safeParse({ name: formData.get("userName")?.toString() ?? "", enterpriseName: formData.get("enterpriseName")?.toString() ?? "" });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    parsed.error.issues.forEach(issue => { fieldErrors[issue.path[0] as string] = issue.message; });
    return validationError("Confira os campos indicados.", { name: fieldErrors.name, enterpriseName: fieldErrors.enterpriseName });
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit({ key: `onboarding-complete:${ip}`, max: 10, windowMs: 15 * 60 * 1000 }).allowed) return errorResult("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  const issuer = process.env.SUPABASE_AUTH_ISSUER, projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!issuer || !projectUrl || !serviceKey || issuer !== `${projectUrl.replace(/\/$/, "")}/auth/v1`) return errorResult("configuration", "O cadastro não está configurado neste ambiente.");
  let rpcStarted = false;
  try {
    const context = await resolveMinimalIdentity();
    if (context.state === "unauthenticated") return errorResult("session_unavailable", "Sua sessão não está disponível. Entre novamente para continuar.");
    if (context.state !== "no_active_internal_identity") return { status: "success", createdNew: false };
    const session = await createClient(); const { data, error: userError } = await session.auth.getUser();
    if (userError || !data.user) return errorResult("session_unavailable", "Sua sessão não está disponível. Entre novamente para continuar.");
    if (!data.user.email_confirmed_at) return errorResult("email_unconfirmed", "Confirme seu e-mail antes de concluir o cadastro.");
    const admin = createSupabaseClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    rpcStarted = true;
    const { data: result, error } = await admin.rpc("complete_public_onboarding", { p_auth_user_id: data.user.id, p_issuer: issuer, p_user_name: parsed.data.name, p_enterprise_name: parsed.data.enterpriseName });
    if (error) return mapCompletionError(error);
    const row = z.array(z.object({ user_id: z.uuid(), enterprise_id: z.uuid(), membership_id: z.uuid(), created_new: z.boolean() }).strict()).length(1).safeParse(result);
    if (!row.success) return errorResult("invalid_response", COMPLETION_FAILURE);
    return { status: "success", createdNew: row.data[0].created_new };
  } catch { return rpcStarted ? unknownOutcome(true) : errorResult("unavailable", COMPLETION_FAILURE); }
}

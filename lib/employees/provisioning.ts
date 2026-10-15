"use server";
import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z
  .object({
    fullName: z.string().trim().min(1, "Preencha este campo.").max(200, "Use no máximo 200 caracteres."),
    email: z.string().trim().min(1, "Preencha este campo.").email("Informe um e-mail válido.").max(320, "Informe um e-mail válido.").transform(value => value.toLowerCase()),
    role: z.enum(["admin", "operator"], { error: "Selecione um papel válido." }),
    temporaryPassword: z.string().min(1, "Preencha este campo.").min(8, "Use pelo menos 8 caracteres."),
    temporaryPasswordConfirmation: z.string().min(1, "Preencha este campo."),
  })
  .superRefine((value, context) => {
    if (value.temporaryPassword !== value.temporaryPasswordConfirmation) {
      context.addIssue({ code: "custom", path: ["temporaryPasswordConfirmation"], message: "A confirmação não corresponde à senha temporária." });
    }
  });

const startResponseSchema = z.array(z.object({
  operation_id: z.uuid(), enterprise_id: z.uuid(), email_normalized: z.string(),
  requested_role: z.enum(["admin", "operator"]), status: z.enum(["pending", "completed", "failed"]),
}).strict()).length(1);

const finishResponseSchema = z.array(z.object({
  operation_id: z.uuid(), user_id: z.uuid(), auth_identity_id: z.uuid(),
  membership_id: z.uuid(), status: z.literal("completed"),
}).strict()).length(1);

type FieldName = "fullName" | "email" | "role" | "temporaryPassword" | "temporaryPasswordConfirmation";
type FieldErrors = Partial<Record<FieldName, string>>;

export type EmployeeProvisioningResult =
  | { status: "idle" }
  | { status: "error"; code: "validation" | "session_expired" | "permission_denied" | "account_unavailable" | "password_rejected" | "rate_limited" | "operation_conflict" | "configuration" | "technical_failure"; message: string; fieldErrors?: FieldErrors }
  | { status: "outcome_unknown"; code: "start_outcome_unknown" | "auth_creation_outcome_unknown"; message: string; operationId?: string }
  | { status: "partial"; code: "finalization_rejected" | "finalization_outcome_unknown"; message: string; operationId: string }
  | { status: "resume"; code: "completed" | "already_completed" | "auth_account_not_found" | "inconsistent" | "failed" | "outcome_unknown"; message: string; operationId: string }
  | { status: "success"; code: "completed" | "already_completed"; message: string; operationId: string };

function error(code: Extract<EmployeeProvisioningResult, { status: "error" }>["code"], message: string, fieldErrors?: FieldErrors): EmployeeProvisioningResult {
  return { status: "error", code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function uncertain(code?: string): boolean {
  return !code || !["42501", "28000", "23505", "22023", "P0001", "P0002", "P0003", "P0004"].includes(code);
}

function mapRpcError(rpcError: { code?: string; message?: string }): EmployeeProvisioningResult {
  if (rpcError.code === "42501" || rpcError.code === "28000") return error("permission_denied", "Você não tem permissão para cadastrar este funcionário.");
  if (rpcError.code === "23505") return error("account_unavailable", "Este e-mail ou esta conta não está disponível para o provisionamento. Revise a operação antes de tentar novamente.");
  if (rpcError.code === "22023" || rpcError.code === "P0003") return error("operation_conflict", "A operação não corresponde aos dados solicitados.");
  return error("technical_failure", "Não foi possível concluir o provisionamento neste momento.");
}

function mapCreateUserError(authError: { code?: string; message?: string; status?: number }): EmployeeProvisioningResult {
  const code = authError.code?.toLowerCase() ?? "";
  const message = authError.message?.toLowerCase() ?? "";
  if (code.includes("email_exists") || code.includes("user_already_exists") || message.includes("already registered") || message.includes("already exists")) {
    return error("account_unavailable", "O e-mail já está associado a uma conta Auth ou a uma tentativa anterior de resultado desconhecido. Nenhuma conta foi vinculada ou alterada; é necessária revisão segura.");
  }
  if (code.includes("password") || message.includes("password")) return error("password_rejected", "A senha temporária foi rejeitada pelos requisitos do serviço de autenticação.", { temporaryPassword: "Escolha outra senha que atenda aos requisitos." });
  if (authError.status === 429 || code.includes("rate")) return error("rate_limited", "O serviço de autenticação limitou as tentativas. Aguarde antes de tentar novamente.");
  return error("technical_failure", "A conta Auth não pôde ser criada.");
}

const resumeResponseSchema = z.array(z.object({
  operation_id: z.uuid(), status: z.enum(["completed", "already_completed", "auth_account_not_found", "inconsistent", "failed"]),
  auth_user_id: z.uuid().nullable(), user_id: z.uuid().nullable(), auth_identity_id: z.uuid().nullable(), membership_id: z.uuid().nullable(),
}).strict()).length(1);

export async function resumeProvisioningAction(
  _previousState: EmployeeProvisioningResult,
  formData: FormData
): Promise<EmployeeProvisioningResult> {
  const operationId = formData.get("operationId")?.toString();
  if (!operationId || !z.uuid().safeParse(operationId).success) return error("validation", "ID de operação inválido.");

  const sessionClient = await createClient();
  const { data: sessionData, error: sessionError } = await sessionClient.auth.getUser();
  if (sessionError || !sessionData.user) return error("session_expired", "Sua sessão expirou. Entre novamente para continuar.");

  let context;
  try {
    context = await requireBusinessContext("members.manage_operators");
  } catch (caught) {
    if (caught instanceof AuthContextError) {
      if (caught.code === "AUTH_UNAUTHENTICATED") return error("session_expired", "Sua sessão expirou. Entre novamente para continuar.");
      if (caught.code === "AUTH_PERMISSION_DENIED" || caught.code === "AUTH_ACCESS_BLOCKED") return error("permission_denied", "Você não tem permissão para gerenciar cadastros.");
    }
    return error("technical_failure", "Não foi possível validar seu acesso neste momento.");
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit({ key: `employee-resume:${context.userId}:${ip}`, max: 10, windowMs: 15 * 60 * 1000 }).allowed) {
    return error("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const issuer = process.env.SUPABASE_AUTH_ISSUER;
  if (!projectUrl || !serviceKey || !issuer || issuer !== `${projectUrl.replace(/\/$/, "")}/auth/v1`) {
    return error("configuration", "O provisionamento não está configurado neste ambiente.");
  }
  const admin = createSupabaseClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const response = await admin.rpc("resume_employee_provisioning", {
      p_operation_id: operationId, p_actor_auth_user_id: sessionData.user.id, p_actor_issuer: issuer
    });
    if (response.error) {
      // Never log SDK messages/details: they may contain application data.
      console.error("employee_resume", {
        stage: "rpc_error",
        code: typeof response.error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(response.error.code) ? response.error.code : "unclassified",
        httpStatus: response.status,
      });
      if (uncertain(response.error.code)) return { status: "resume", code: "outcome_unknown", operationId, message: "Não foi possível confirmar o resultado da verificação. Você pode verificar novamente mais tarde." };
      return mapRpcError(response.error);
    }
    const parsed = resumeResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      console.error("employee_resume", {
        stage: "response_validation",
        failures: parsed.error.issues.map(issue => ({ path: issue.path.map(String), code: issue.code })),
      });
      return { status: "resume", code: "outcome_unknown", operationId, message: "A resposta da verificação não pôde ser confirmada. Verifique novamente mais tarde." };
    }
    if (parsed.data[0].operation_id !== operationId) {
      console.error("employee_resume", { stage: "operation_id_mismatch", code: "response_operation_id_mismatch" });
      return { status: "resume", code: "outcome_unknown", operationId, message: "A resposta da verificação não pôde ser confirmada. Verifique novamente mais tarde." };
    }
    const result = parsed.data[0];
    const completed = result.status === "completed" || result.status === "already_completed";
    const ids = [result.auth_user_id, result.user_id, result.auth_identity_id, result.membership_id];
    if (completed ? ids.some(id => id === null) : ids.some(id => id !== null)) {
      console.error("employee_resume", {
        stage: "result_invariant",
        code: "result_ids_incompatible_with_status",
        status: result.status,
      });
      return { status: "resume", code: "outcome_unknown", operationId, message: "A resposta da verificação não pôde ser confirmada. Verifique novamente mais tarde." };
    }

    const messages: Record<string, string> = {
      completed: "Provisionamento concluído com sucesso a partir do registro encontrado.",
      already_completed: "A operação já estava concluída.",
      auth_account_not_found: "A conta de autenticação não foi encontrada para esta operação.",
      inconsistent: "Foram encontradas inconsistências nos dados da conta de autenticação que impedem a retomada automática. É necessária revisão manual.",
      failed: "A tentativa de retomar o provisionamento falhou.",
      outcome_unknown: "Não foi possível verificar o status da operação neste momento."
    };

    return {
      status: "resume",
      code: result.status,
      message: messages[result.status] || "Resultado desconhecido da retomada.",
      operationId: result.operation_id
    };
  } catch {
    console.error("employee_resume", { stage: "rpc_transport_exception", code: "exception" });
    return { status: "resume", code: "outcome_unknown", operationId, message: "Não foi possível confirmar o resultado da verificação. Você pode verificar novamente mais tarde." };
  }
}

export async function provisionEmployeeAction(
  _previousState: EmployeeProvisioningResult,
  formData: FormData
): Promise<EmployeeProvisioningResult> {
  const value = (name: string) => formData.get(name)?.toString() ?? "";
  const parsed = inputSchema.safeParse({
    fullName: value("fullName"), email: value("email"), role: value("role"),
    temporaryPassword: value("temporaryPassword"),
    temporaryPasswordConfirmation: value("temporaryPasswordConfirmation"),
  });
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as FieldName | undefined;
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return error("validation", "Confira os campos indicados.", fieldErrors);
  }

  const sessionClient = await createClient();
  const { data: sessionData, error: sessionError } = await sessionClient.auth.getUser();
  if (sessionError || !sessionData.user) return error("session_expired", "Sua sessão expirou. Entre novamente para continuar.");

  const permission = parsed.data.role === "admin" ? "members.manage_admins" : "members.manage_operators";
  let context;
  try {
    context = await requireBusinessContext(permission);
  } catch (caught) {
    if (caught instanceof AuthContextError) {
      if (caught.code === "AUTH_UNAUTHENTICATED") return error("session_expired", "Sua sessão expirou. Entre novamente para continuar.");
      if (caught.code === "AUTH_PERMISSION_DENIED" || caught.code === "AUTH_ACCESS_BLOCKED") return error("permission_denied", "Você não tem permissão para cadastrar este funcionário.");
    }
    return error("technical_failure", "Não foi possível validar seu acesso neste momento.");
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit({ key: `employee-provision:${context.userId}:${ip}`, max: 10, windowMs: 15 * 60 * 1000 }).allowed) {
    return error("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const issuer = process.env.SUPABASE_AUTH_ISSUER;
  if (!projectUrl || !serviceKey || !issuer || issuer !== `${projectUrl.replace(/\/$/, "")}/auth/v1`) {
    return error("configuration", "O provisionamento não está configurado neste ambiente.");
  }
  const admin = createSupabaseClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let startCallBegan = false;
  let startResult;
  try {
    startCallBegan = true;
    const response = await admin.rpc("start_employee_provisioning", {
      p_actor_auth_user_id: sessionData.user.id, p_actor_issuer: issuer,
      p_email: parsed.data.email, p_full_name: parsed.data.fullName, p_role: parsed.data.role,
    });
    if (response.error) {
      console.error("employee_provisioning", {
        stage: "start_rpc_error",
        code: typeof response.error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(response.error.code) ? response.error.code : "unclassified",
        httpStatus: response.status,
      });
      return uncertain(response.error.code)
        ? { status: "outcome_unknown", code: "start_outcome_unknown", message: "Não foi possível confirmar o resultado do início da operação. Não repita o cadastro sem revisar ou retomar a operação." }
        : mapRpcError(response.error);
    }
    startResult = startResponseSchema.safeParse(response.data);
    if (!startResult.success) {
      console.error("employee_provisioning", {
        stage: "start_response_validation",
        failures: startResult.error.issues.map(issue => ({ path: issue.path.map(String), code: issue.code })),
      });
    }
  } catch {
    console.error("employee_provisioning", { stage: "start_transport_exception", code: "exception" });
    return startCallBegan
      ? { status: "outcome_unknown", code: "start_outcome_unknown", message: "Não foi possível confirmar o resultado do início da operação. Não repita o cadastro sem revisar ou retomar a operação." }
      : error("technical_failure", "Não foi possível iniciar o provisionamento.");
  }
  if (!startResult.success) return error("technical_failure", "O servidor retornou uma resposta inválida ao iniciar o provisionamento.");
  const operation = startResult.data[0];
  if (operation.enterprise_id !== context.enterpriseId || operation.email_normalized !== parsed.data.email || operation.requested_role !== parsed.data.role) {
    return error("operation_conflict", "A operação existente possui parâmetros incompatíveis com esta solicitação.");
  }
  if (operation.status === "completed") return { status: "success", code: "already_completed", message: "O funcionário já havia sido provisionado. Nenhuma conta ou senha foi alterada.", operationId: operation.operation_id };
  if (operation.status !== "pending") return error("operation_conflict", "A operação não está disponível para continuação.");

  let authUserId: string;
  try {
    const created = await admin.auth.admin.createUser({
      email: parsed.data.email, password: parsed.data.temporaryPassword, email_confirm: true,
      app_metadata: { modulus_employee_provisioning_operation_id: operation.operation_id },
    });
    if (created.error) {
      if (!created.error.status || created.error.status >= 500 || created.error.status === 408) {
        return { status: "outcome_unknown", code: "auth_creation_outcome_unknown", message: "A criação da conta foi iniciada, mas seu resultado não pôde ser confirmado. Não tente criar outra conta; solicite revisão da operação.", operationId: operation.operation_id };
      }
      return mapCreateUserError(created.error);
    }
    if (!created.data.user || !z.uuid().safeParse(created.data.user.id).success) {
      return { status: "outcome_unknown", code: "auth_creation_outcome_unknown", message: "A criação da conta foi iniciada, mas seu resultado não pôde ser confirmado. Não tente criar outra conta; solicite revisão da operação." };
    }
    authUserId = created.data.user.id;
  } catch {
    return { status: "outcome_unknown", code: "auth_creation_outcome_unknown", message: "A criação da conta foi iniciada, mas seu resultado não pôde ser confirmado. Não tente criar outra conta; solicite revisão da operação.", operationId: operation.operation_id };
  }

  try {
    const finished = await admin.rpc("finish_employee_provisioning", {
      p_operation_id: operation.operation_id, p_actor_auth_user_id: sessionData.user.id,
      p_actor_issuer: issuer, p_auth_user_id: authUserId, p_auth_issuer: issuer,
    });
    if (finished.error) return uncertain(finished.error.code)
      ? { status: "partial", code: "finalization_outcome_unknown", message: "A conta Auth foi criada, mas a conclusão não pôde ser confirmada. Não crie outra conta; retome após revisão.", operationId: operation.operation_id }
      : { status: "partial", code: "finalization_rejected", message: "A conta Auth foi criada, mas a conclusão interna foi rejeitada. A operação precisa ser revisada; a conta não foi excluída.", operationId: operation.operation_id };
    const finalResult = finishResponseSchema.safeParse(finished.data);
    if (!finalResult.success || finalResult.data[0].operation_id !== operation.operation_id) {
      return { status: "partial", code: "finalization_outcome_unknown", message: "A conta Auth foi criada, mas a conclusão não pôde ser confirmada. Não crie outra conta; retome após revisão.", operationId: operation.operation_id };
    }
    return { status: "success", code: "completed", message: "Funcionário provisionado com sucesso.", operationId: operation.operation_id };
  } catch {
    return { status: "partial", code: "finalization_outcome_unknown", message: "A conta Auth foi criada, mas a conclusão não pôde ser confirmada. Não crie outra conta; retome após revisão.", operationId: operation.operation_id };
  }
}

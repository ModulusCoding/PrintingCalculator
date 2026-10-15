import "server-only";

export type OnboardingCode = "validation" | "rate_limited" | "disabled" | "confirmation_pending" | "unavailable" | "configuration" | "session_unavailable" | "email_unconfirmed" | "invalid_response" | "unknown" | "internal_conflict";
export type OnboardingField = "name" | "enterpriseName" | "email" | "password" | "confirmation";
export type OnboardingResult =
  | { status: "idle" }
  | { status: "error"; code: OnboardingCode; message: string; fieldErrors?: Partial<Record<OnboardingField, string>> }
  | { status: "outcome_unknown"; code: "unknown"; message: string }
  | { status: "confirmation_pending"; code: "confirmation_pending"; message: string }
  | { status: "success"; createdNew: boolean };
export const CONFIRMATION_PENDING_MESSAGE = "Se for possível concluir o cadastro com esse endereço, você receberá instruções por e-mail. Se já tiver uma conta, entre para continuar.";
export const COMPLETION_FAILURE = "Seu e-mail foi confirmado, mas não foi possível concluir a configuração da conta. Tente novamente.";
export const validationError = (message: string, fieldErrors?: Partial<Record<OnboardingField, string>>): OnboardingResult => ({ status: "error", code: "validation", message, ...(fieldErrors ? { fieldErrors } : {}) });
export const errorResult = (code: OnboardingCode, message: string): OnboardingResult => ({ status: "error", code, message });
export const confirmationPending = (): OnboardingResult => ({ status: "confirmation_pending", code: "confirmation_pending", message: CONFIRMATION_PENDING_MESSAGE });
export const unknownOutcome = (completion = false): OnboardingResult => ({ status: "outcome_unknown", code: "unknown", message: completion ? "Não foi possível confirmar a conclusão. Tente continuar novamente; se a operação já tiver sido concluída, seus dados serão preservados." : "Não foi possível confirmar o resultado do cadastro. A solicitação pode ter sido processada. Verifique seu e-mail ou entre para continuar; também é possível recuperar sua senha." });
type Failure = { code?: string; name?: string; reasons?: unknown; weak_password?: { reasons?: unknown } };
export function isTransportFailure(error: Failure) {
  return ["request_timeout", "57014", "PGRST003"].includes(error.code ?? "") || ["AuthRetryableFetchError", "AuthUnknownError", "AuthUnknown", "TypeError", "AbortError"].includes(error.name ?? "");
}
export function mapSignupError(error: Failure): OnboardingResult {
  if (isTransportFailure(error)) return unknownOutcome();
  switch (error.code) {
    case "user_already_exists": case "email_exists": return confirmationPending();
    case "weak_password": {
      const reasons = error.reasons ?? error.weak_password?.reasons;
      const known = Array.isArray(reasons) ? reasons : [];
      const details = [known.includes("length") ? "Use uma senha mais longa." : "", known.includes("characters") ? "Use os caracteres exigidos pela política de senha." : "", known.includes("pwned") ? "Escolha uma senha que não tenha sido exposta em vazamentos." : ""].filter(Boolean).join(" ");
      const message = `A senha não atende aos requisitos de segurança.${details ? ` ${details}` : ""}`;
      return validationError(message, { password: message });
    }
    case "email_address_invalid": return validationError("Confira o e-mail informado.", { email: "Informe um e-mail válido." });
    case "validation_failed": return validationError("Confira os dados informados e tente novamente.");
    case "over_request_rate_limit": return errorResult("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    case "over_email_send_rate_limit": return errorResult("rate_limited", "Aguarde alguns minutos antes de solicitar um novo envio.");
    case "signup_disabled": case "email_provider_disabled": return errorResult("disabled", "O cadastro está indisponível no momento.");
    case "email_address_not_authorized": case "smtp_error": return errorResult("unavailable", "Não foi possível processar o cadastro ou enviar as instruções. Tente novamente mais tarde.");
    default: return errorResult("unavailable", "Não foi possível processar o cadastro. Tente novamente mais tarde.");
  }
}
// Only for complete_public_onboarding, after the backend verified email confirmation.
// SQLSTATE 22023/23505 may cover multiple constraints: never infer a specific field/company.
export function mapCompletionError(error: Failure): OnboardingResult {
  if (isTransportFailure(error) || error.code === "") return unknownOutcome(true);
  switch (error.code) {
    case "P0001": return errorResult("session_unavailable", "Sua sessão não está disponível. Entre novamente para continuar.");
    case "P0002": return errorResult("email_unconfirmed", "Confirme seu e-mail antes de concluir o cadastro.");
    case "P0003": case "P0004": case "23505": return errorResult("internal_conflict", "Não foi possível concluir seu cadastro. Entre novamente e, se o problema continuar, contate o responsável.");
    case "28000": return errorResult("configuration", COMPLETION_FAILURE);
    case "22023": return errorResult("validation", `${COMPLETION_FAILURE} Confira os dados informados.`);
    default: return errorResult("unavailable", COMPLETION_FAILURE);
  }
}

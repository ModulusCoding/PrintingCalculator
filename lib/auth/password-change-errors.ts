export type PasswordField = "current" | "next" | "confirm";
export type PasswordFieldErrors = Partial<Record<PasswordField, string>>;

export type RequiredPasswordState =
  | { status: "idle" }
  | { status: "error"; code: "validation" | "same_password" | "invalid_credentials" | "weak_password" | "reauthentication_needed" | "reauthentication_not_valid" | "session_expired" | "access_unavailable" | "rate_limited" | "unavailable" | "not_required" | "configuration" | "obligation_unavailable" | "identity_mismatch" | "verification_unavailable" | "update_failed" | "version_conflict"; message: string; fieldErrors?: PasswordFieldErrors }
  | { status: "outcome_unknown"; code: "update_outcome_unknown"; message: string }
  | { status: "partial"; code: "release_version_conflict" | "release_unconfirmed"; passwordChanged: true; message: string }
  | { status: "success"; code: "released"; passwordChanged: true; message: string };

type AuthFailure = { code?: string; name?: string; status?: number; reasons?: unknown; weak_password?: { reasons?: unknown } };

const error = (code: Extract<RequiredPasswordState, { status: "error" }>["code"], message: string, fieldErrors?: PasswordFieldErrors): RequiredPasswordState => ({ status: "error", code, message, ...(fieldErrors ? { fieldErrors } : {}) });

export const passwordError = error;

const unavailable = () => error("unavailable", "Serviço temporariamente indisponível. Tente novamente em alguns minutos.");

function commonAuthError(failure: AuthFailure): RequiredPasswordState | null {
  if (["session_expired", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "no_authorization"].includes(failure.code ?? "") || failure.name === "AuthSessionMissingError")
    return error("session_expired", "Sua sessão expirou. Entre novamente.");
  if (failure.code === "user_banned" || failure.code === "user_not_found")
    return error("access_unavailable", "O acesso a esta conta não está disponível. Entre em contato com o suporte.");
  if (failure.code === "over_request_rate_limit" || failure.status === 429)
    return error("rate_limited", "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.");
  if (failure.name === "AuthRetryableFetchError" || failure.name === "AuthUnknownError") return unavailable();
  return null;
}

export function verificationError(failure: AuthFailure): RequiredPasswordState {
  if (failure.code === "invalid_credentials") return error("invalid_credentials", "A senha atual está incorreta.", { current: "Confira sua senha atual." });
  return commonAuthError(failure) ?? error("verification_unavailable", "Não foi possível validar a senha atual. Tente novamente.");
}

export const unknownUpdateOutcome = (): RequiredPasswordState => ({ status: "outcome_unknown", code: "update_outcome_unknown", message: "Não foi possível confirmar se a senha foi alterada. Não tente reutilizar a senha anterior sem verificar o resultado. Se o acesso continuar bloqueado, tente entrar novamente ou contate o suporte." });

export function updatePasswordError(failure: AuthFailure): RequiredPasswordState {
  // After the update request starts, a timeout or transport failure does not prove rollback.
  if (failure.code === "request_timeout" || failure.name === "AuthRetryableFetchError" || failure.name === "AuthUnknownError") return unknownUpdateOutcome();
  if (failure.code === "same_password") return error("same_password", "A nova senha deve ser diferente da senha atual.", { next: "Escolha outra senha." });
  if (failure.code === "weak_password") {
    const reasons = failure.weak_password?.reasons ?? failure.reasons;
    const list = Array.isArray(reasons) ? reasons : [];
    const details = [
      list.includes("length") ? "Use uma senha mais longa." : null,
      list.includes("characters") ? "Use uma combinação diferente de caracteres." : null,
      list.includes("pwned") ? "Escolha uma senha que não tenha sido exposta em vazamentos." : null,
    ].filter(Boolean).join(" ");
    const message = `A nova senha não atende aos requisitos de segurança.${details ? ` ${details}` : " Escolha outra senha que atenda aos requisitos de segurança."}`;
    return error("weak_password", message, { next: message });
  }
  if (failure.code === "reauthentication_needed") return error("reauthentication_needed", "É necessária uma nova autenticação para alterar a senha. Entre novamente e tente de novo.");
  if (failure.code === "reauthentication_not_valid") return error("reauthentication_not_valid", "A nova autenticação não foi aceita. Entre novamente e tente de novo.");
  return commonAuthError(failure) ?? error("update_failed", "Não foi possível alterar a senha. Tente novamente.");
}

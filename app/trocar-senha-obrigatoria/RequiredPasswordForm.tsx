"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRequiredPasswordAction, type RequiredPasswordState } from "@/lib/auth/password-change";
import { logoutAction } from "@/lib/auth/actions";
import { AuthHeading, AuthNotice, AuthSubmit, authStyles } from "@/components/auth/AuthUI";
import { PasswordField } from "@/components/auth/PasswordField";

const initial: RequiredPasswordState = { status: "idle" };

export function RequiredPasswordForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(changeRequiredPasswordAction, initial);
  useEffect(() => {
    if (state.status === "success") {
      router.replace("/home");
      router.refresh();
    }
  }, [router, state.status]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "partial" && state.passwordChanged) formRef.current?.reset();
  }, [state]);
  const [logoutPending, startLogoutTransition] = useTransition();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  const handleLogout = () => {
    startLogoutTransition(async () => {
      const res = await logoutAction();
      if (res?.error) {
        setLogoutError(res.error);
      } else {
        window.location.href = "/admin/login";
      }
    });
  };

  return (
    <div className="w-full">
      <AuthHeading title="Defina uma nova senha" description="Por segurança, sua senha precisa ser alterada antes de continuar." />
      <form ref={formRef} action={action} className="space-y-5">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutPending}
            className={`${authStyles.link} text-sm disabled:opacity-50`}
          >
            {logoutPending ? "Saindo..." : "Sair"}
          </button>
        </div>
        <PasswordField label="Senha atual" name="current" autoComplete="current-password" required error={fieldErrors?.current} />
        <PasswordField label="Nova senha" name="next" autoComplete="new-password" required error={fieldErrors?.next} />
        <PasswordField label="Confirme a nova senha" name="confirm" autoComplete="new-password" required error={fieldErrors?.confirm} />
        
        {state.status === "error" && <AuthNotice type="error">{state.message}</AuthNotice>}
        {state.status === "outcome_unknown" && <AuthNotice type="error">{state.message}</AuthNotice>}
        {state.status === "partial" && <AuthNotice type="error">{state.message}</AuthNotice>}
        {logoutError && <AuthNotice type="error">{logoutError}</AuthNotice>}

        {state.status === "success" ? (
          <AuthNotice type="success">{state.message}</AuthNotice>
        ) : (
          <AuthSubmit pending={pending} pendingText="Alterando...">Alterar senha</AuthSubmit>
        )}
      </form>
    </div>
  );
}

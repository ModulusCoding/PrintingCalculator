"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRequiredPasswordAction, type RequiredPasswordState } from "@/lib/auth/password-change";
import { logoutAction } from "@/lib/auth/actions";

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
    <div className="w-full max-w-md space-y-4">
      <form ref={formRef} action={action} className="w-full bg-white border rounded-xl p-8 shadow-sm space-y-5">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Defina uma nova senha</h1>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutPending}
            className="text-sm text-gray-600 hover:text-red-600 underline disabled:opacity-50"
          >
            {logoutPending ? "Saindo..." : "Sair"}
          </button>
        </div>
        <p className="text-gray-600">Por segurança, sua senha precisa ser alterada antes de continuar.</p>
        
        <label className="block text-sm font-medium text-gray-700">
          Senha atual
          <input name="current" type="password" autoComplete="current-password" required className="mt-1 w-full border rounded p-3 text-base" aria-invalid={!!fieldErrors?.current} aria-describedby={fieldErrors?.current ? "current-error" : undefined} />
          {fieldErrors?.current && <p id="current-error" className="text-red-600 text-sm mt-1" role="alert">{fieldErrors.current}</p>}
        </label>
        
        <label className="block text-sm font-medium text-gray-700">
          Nova senha
          <input name="next" type="password" autoComplete="new-password" required className="mt-1 w-full border rounded p-3 text-base" aria-invalid={!!fieldErrors?.next} aria-describedby={fieldErrors?.next ? "next-error" : undefined} />
          {fieldErrors?.next && <p id="next-error" className="text-red-600 text-sm mt-1" role="alert">{fieldErrors.next}</p>}
        </label>
        
        <label className="block text-sm font-medium text-gray-700">
          Confirme a nova senha
          <input name="confirm" type="password" autoComplete="new-password" required className="mt-1 w-full border rounded p-3 text-base" aria-invalid={!!fieldErrors?.confirm} aria-describedby={fieldErrors?.confirm ? "confirm-error" : undefined} />
          {fieldErrors?.confirm && <p id="confirm-error" className="text-red-600 text-sm mt-1" role="alert">{fieldErrors.confirm}</p>}
        </label>
        
        {state.status === "error" && <p className="text-red-600 text-sm" role="alert">{state.message}</p>}
        {state.status === "outcome_unknown" && <p className="text-red-600 text-sm" role="alert">{state.message}</p>}
        {state.status === "partial" && <p className="text-yellow-700 text-sm" role="alert">{state.message}</p>}
        {logoutError && <p className="text-red-600 text-sm" role="alert">{logoutError}</p>}
        
        {state.status === "success" ? (
          <div className="space-y-3">
            <p className="text-green-700 text-sm" role="status">{state.message}</p>
          </div>
        ) : (
          <button disabled={pending} className="w-full rounded bg-indigo-600 text-white py-3 font-semibold disabled:opacity-60 hover:bg-indigo-700 transition">
            {pending ? "Alterando..." : "Alterar senha"}
          </button>
        )}
      </form>
    </div>
  );
}

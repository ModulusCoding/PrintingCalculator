"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { updatePasswordAction } from "@/lib/auth/recovery";

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"password", string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updatePasswordAction(new FormData(event.currentTarget));
        if ("error" in result) {
          setError(result.code === "same_password" ? null : result.error ?? "Não foi possível atualizar a senha.");
          setFieldErrors(result.fieldErrors ?? {});
        }
        else router.replace(result.logoutFailed ? "/redefinir-senha/sucesso?logout=failed" : "/redefinir-senha/sucesso");
      } catch { setError("Não foi possível atualizar a senha. Tente novamente."); }
    });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f8f9fa] px-4">
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(to right,#e5e7eb 1px,transparent 1px),linear-gradient(to bottom,#e5e7eb 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <main className="relative w-full max-w-md rounded-xl border bg-white p-8 shadow-sm sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white">M</div>
          <div>
            <h1 className="text-3xl font-bold text-black">Nova senha</h1>
            <p className="text-gray-500">Defina uma nova senha para sua conta.</p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mb-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-5" noValidate>
          <PasswordField label="Nova senha" name="password" show={showPassword} toggle={() => setShowPassword(!showPassword)} disabled={pending} error={fieldErrors.password} />
          <PasswordField label="Confirme a nova senha" name="confirmation" show={showPassword} toggle={() => setShowPassword(!showPassword)} disabled={pending} />
          <button disabled={pending} className="flex w-full items-center justify-center rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-70">
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Atualizando...
              </>
            ) : (
              "Atualizar senha"
            )}
          </button>
        </form>
      </main>
    </div>
  );
}

function PasswordField({ label, name, show, toggle, disabled, error }: { label: string; name: string; show: boolean; toggle: () => void; disabled: boolean; error?: string }) {
  return (
    <label htmlFor={name} className="block text-sm text-black">
      {label}
      <div className="relative mt-2">
        <Lock className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-gray-400" />
        <input
          id={name}
          name={name}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? `${name}-error` : undefined}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          disabled={disabled}
          className="w-full rounded-lg border border-gray-200 py-3 pl-10 pr-12 text-black outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button type="button" onClick={toggle} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {error ? <span id={`${name}-error`} className="mt-1 block text-sm text-red-700">{error}</span> : null}
    </label>
  );
}
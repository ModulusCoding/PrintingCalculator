"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePasswordAction } from "@/lib/auth/recovery";
import { AuthBack, AuthHeading, AuthNotice, AuthShell, AuthSubmit } from "@/components/auth/AuthUI";
import { PasswordField } from "@/components/auth/PasswordField";

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"password", string>>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updatePasswordAction(form);
        if ("error" in result) {
          setError(result.code === "same_password" ? null : result.error ?? "Não foi possível atualizar a senha.");
          setFieldErrors(result.fieldErrors ?? {});
        }
        else router.replace(result.logoutFailed ? "/redefinir-senha/sucesso?logout=failed" : "/redefinir-senha/sucesso");
      } catch { setError("Não foi possível atualizar a senha. Tente novamente."); }
    });
  }

  return <AuthShell>
    <AuthHeading title="Nova senha" description="Defina uma nova senha para sua conta." badge="RECUPERAÇÃO DE ACESSO" />
    {error ? <AuthNotice type="error">{error}</AuthNotice> : null}
    <form onSubmit={submit} className="space-y-5" noValidate aria-busy={pending}>
      <PasswordField label="Nova senha" name="password" required autoComplete="new-password" disabled={pending} error={fieldErrors.password} aria-describedby="password-help" placeholder="Digite sua nova senha" />
      <p id="password-help" className="rounded-lg bg-[#f3f4f5] p-3 text-sm text-[#5e5e5e]">Use pelo menos 8 caracteres.</p>
      <PasswordField label="Confirme a nova senha" name="confirmation" required autoComplete="new-password" disabled={pending} placeholder="Repita sua nova senha" />
      <AuthSubmit pending={pending} pendingText="Atualizando...">Atualizar senha</AuthSubmit>
    </form>
    <AuthBack />
  </AuthShell>;
}

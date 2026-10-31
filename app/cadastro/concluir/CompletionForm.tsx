"use client";
import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, User } from "lucide-react";
import { completePublicOnboardingAction } from "@/lib/auth/onboarding";
import { LogoutButton } from "@/app/conta/LogoutButton";
import type { OnboardingField } from "@/lib/auth/onboarding-errors";
import { AuthField, AuthHeading, AuthNotice, AuthShell, AuthSubmit } from "@/components/auth/AuthUI";

export function CompletionForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, string>>>({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null); setFieldErrors({});
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await completePublicOnboardingAction(form);
        if (result.status === "error") { setError(result.message); setFieldErrors(result.fieldErrors ?? {}); }
        else if (result.status === "outcome_unknown") setError(result.message);
        else if (result.status === "success") { router.replace("/home"); router.refresh(); }
      } catch { setError("Não foi possível confirmar o resultado da conclusão. Tente novamente."); }
    });
  }
  return <AuthShell>
    <AuthHeading title="Conclua seu cadastro" description="Informe os dados para criar seu espaço no Modulus." badge="VOCÊ E SUA EMPRESA" />
    {error ? <AuthNotice type="error">{error}</AuthNotice> : null}
    <form onSubmit={submit} noValidate className="space-y-5" aria-busy={pending}>
      <AuthField name="userName" label="Nome" autoComplete="name" icon={<User size={20} />} error={fieldErrors.name} required disabled={pending} />
      <AuthField name="enterpriseName" label="Nome da empresa" autoComplete="organization" icon={<Building2 size={20} />} error={fieldErrors.enterpriseName} required disabled={pending} />
      <AuthSubmit pending={pending} pendingText="Concluindo...">Concluir cadastro</AuthSubmit>
    </form>
    <div className="mt-6"><LogoutButton /></div>
  </AuthShell>;
}

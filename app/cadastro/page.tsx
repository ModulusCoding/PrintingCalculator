"use client";

import Link from "next/link";
import { FormEvent, useRef, useState, useTransition } from "react";
import { Building2, Mail, User } from "lucide-react";
import { signUpPublicAction } from "@/lib/auth/onboarding";
import type { OnboardingField } from "@/lib/auth/onboarding-errors";
import { AuthBack, AuthField, AuthHeading, AuthNotice, AuthShell, AuthStatus, AuthSubmit, authStyles } from "@/components/auth/AuthUI";
import { PasswordField } from "@/components/auth/PasswordField";

export default function CadastroPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordVersion, setPasswordVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, string>>>({});
  const [outcome, setOutcome] = useState<"confirmation_pending" | "outcome_unknown" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    setMessage(null);
    setFieldErrors({});
    setOutcome(null);
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await signUpPublicAction(form);
        if (result.status === "error") { setError(result.message); setFieldErrors(result.fieldErrors ?? {}); }
        if (result.status === "outcome_unknown") { setError(result.message); setOutcome(result.status); }
        if (result.status === "confirmation_pending") {
          setMessage(result.message);
          setOutcome(result.status);
          for (const name of ["password", "passwordConfirmation"]) {
            const input = formRef.current?.elements.namedItem(name);
            if (input instanceof HTMLInputElement) input.value = "";
          }
          setPasswordVersion((version) => version + 1);
        }
      } catch {
        setOutcome("outcome_unknown");
        setError("Não foi possível confirmar o resultado do cadastro. Você pode tentar entrar ou recuperar sua senha antes de tentar novamente.");
      }
    });
  }

  return <AuthShell>
    {outcome === "confirmation_pending" ? <AuthStatus title="Confira seu e-mail" description="Verifique sua caixa de entrada para continuar.">
      <AuthNotice>{message}</AuthNotice>
      <div className="rounded-xl bg-[#f3f4f5] p-5 text-left text-sm leading-relaxed text-[#5e5e5e]"><p>Se você recebeu um link de confirmação, siga as instruções no e-mail.</p><p className="mt-3">Não encontrou? Verifique também sua caixa de spam ou lixo eletrônico.</p><p className="mt-3">A confirmação do e-mail não libera, por si só, o acesso empresarial.</p></div>
      <AuthBack />
      <button type="button" onClick={() => { setOutcome(null); setMessage(null); }} className={`${authStyles.link} inline-flex min-h-11 items-center text-sm`}>Revisar dados do cadastro</button>
      <Link href="/esqueci-senha" className={`${authStyles.link} mt-2 inline-flex min-h-11 items-center text-sm`}>Recuperar senha de uma conta existente</Link>
    </AuthStatus> : <>
      <AuthHeading title="Crie sua conta" description="Comece criando seu acesso ao Modulus Hub." badge="CONFIGURAÇÃO INICIAL" />
      {error ? <AuthNotice type="error">{error}</AuthNotice> : null}
    </>}
    <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate aria-busy={isPending} hidden={outcome === "confirmation_pending"}>
      <AuthField label="Nome" icon={<User size={20} />} name="userName" error={fieldErrors.name} autoComplete="name" placeholder="Seu nome" required disabled={isPending} />
      <AuthField label="Nome da empresa" icon={<Building2 size={20} />} name="enterpriseName" error={fieldErrors.enterpriseName} autoComplete="organization" placeholder="Nome da sua operação" required disabled={isPending} />
      <AuthField label="E-mail" icon={<Mail size={20} />} name="email" error={fieldErrors.email} type="email" autoComplete="email" placeholder="nome@empresa.com.br" required disabled={isPending} />
      <PasswordField key={`password-${passwordVersion}`} label="Senha de acesso" name="password" error={fieldErrors.password} autoComplete="new-password" placeholder="Digite sua senha" required disabled={isPending} aria-describedby="password-help" />
      <p id="password-help" className="rounded-lg bg-[#f3f4f5] p-3 text-sm text-[#5e5e5e]">Use pelo menos 8 caracteres.</p>
      <PasswordField key={`confirmation-${passwordVersion}`} label="Confirmar senha" name="passwordConfirmation" error={fieldErrors.confirmation} autoComplete="new-password" placeholder="Repita sua senha" required disabled={isPending} />
      <AuthNotice type="info">Será necessário confirmar seu e-mail para continuar o cadastro.</AuthNotice>
      <AuthSubmit pending={isPending}>Criar acesso</AuthSubmit>
    </form>
    {outcome === "outcome_unknown" ? <AuthBack href="/esqueci-senha">Recuperar senha</AuthBack> : null}
    {outcome !== "confirmation_pending" ? <p className="mt-6 text-center text-sm text-[#5e5e5e]">Já tem uma conta? <Link href="/admin/login" className={`${authStyles.link} inline-flex min-h-11 items-center`}>Entrar</Link></p> : null}
  </AuthShell>;
}

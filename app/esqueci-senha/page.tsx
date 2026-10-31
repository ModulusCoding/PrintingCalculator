"use client";

import { FormEvent, useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { requestPasswordResetAction } from "@/lib/auth/recovery";
import { AuthBack, AuthField, AuthHeading, AuthNotice, AuthShell, AuthSubmit } from "@/components/auth/AuthUI";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await requestPasswordResetAction(form);
        if ("error" in result) setError(result.error ?? "Não foi possível processar a solicitação.");
        else setMessage(result.message);
      } catch { setError("Não foi possível processar a solicitação. Tente novamente."); }
    });
  }

  return <AuthShell>
    <AuthHeading title="Recupere sua senha" description="Informe seu e-mail para receber instruções de redefinição." badge="RECUPERAÇÃO DE ACESSO" />
    {error ? <AuthNotice type="error">{error}</AuthNotice> : null}
    {message ? <AuthNotice>{message}</AuthNotice> : null}
    <form onSubmit={submit} className="space-y-6" noValidate aria-busy={pending}>
      <AuthField label="E-mail" name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} placeholder="seu@email.com" icon={<Mail size={20} />} aria-describedby={error ? "recovery-error" : undefined} />
      {error ? <p id="recovery-error" className="sr-only">{error}</p> : null}
      <AuthSubmit pending={pending}>Enviar instruções</AuthSubmit>
    </form>
    <div className="mt-6 rounded-lg bg-[#f3f4f5] p-4 text-sm leading-relaxed text-[#5e5e5e]">Se você receber as instruções, abra o link no e-mail para definir uma nova senha. Verifique também a pasta de spam.</div>
    <AuthBack />
  </AuthShell>;
}

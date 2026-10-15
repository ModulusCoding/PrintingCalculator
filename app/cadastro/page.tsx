"use client";

import Link from "next/link";
import { FormEvent, useRef, useState, useTransition } from "react";
import { AlertCircle, Building2, Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";
import { signUpPublicAction } from "@/lib/auth/onboarding";
import type { OnboardingField } from "@/lib/auth/onboarding-errors";

export default function CadastroPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
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
          setShowPassword(false);
        }
      } catch {
        setOutcome("outcome_unknown");
        setError("Não foi possível confirmar o resultado do cadastro. Você pode tentar entrar ou recuperar sua senha antes de tentar novamente.");
      }
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-10 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: "linear-gradient(to right,#e5e7eb 1px,transparent 1px),linear-gradient(to bottom,#e5e7eb 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <main className="relative w-full max-w-md bg-white rounded-xl shadow-sm border p-8 sm:p-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/30">M</div>
          <div>
            <h1 className="text-3xl font-bold text-black">Crie sua conta</h1>
            <p className="text-gray-500">Comece a configurar seu espaço no Modulus.</p>
          </div>
        </div>

        {error ? <p role="alert" className="mb-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 shrink-0" />{error}</p> : null}
        {message ? <p role="status" className="mb-5 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">{message}</p> : null}

        <form ref={formRef} onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Nome" icon={<User className="h-5 w-5" />} name="userName" error={fieldErrors.name} autoComplete="name" disabled={isPending} />
          <Field label="Nome da empresa" icon={<Building2 className="h-5 w-5" />} name="enterpriseName" error={fieldErrors.enterpriseName} autoComplete="organization" disabled={isPending} />
          <Field label="E-mail" icon={<Mail className="h-5 w-5" />} name="email" error={fieldErrors.email} type="email" autoComplete="email" disabled={isPending} />
          <PasswordField label="Senha" name="password" error={fieldErrors.password} show={showPassword} toggle={() => setShowPassword(!showPassword)} disabled={isPending} />
          <PasswordField label="Confirme a senha" name="passwordConfirmation" error={fieldErrors.confirmation} show={showPassword} toggle={() => setShowPassword(!showPassword)} disabled={isPending} />
          <button type="submit" disabled={isPending} className="w-full flex justify-center items-center bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white py-3 rounded-lg font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
            {isPending ? <><Loader2 className="animate-spin mr-2 h-4 w-4" />Enviando...</> : "Criar conta"}
          </button>
        </form>

        {outcome ? <p className="mt-5 text-center text-sm text-gray-600"><Link href="/admin/login" className="font-medium text-indigo-600 hover:underline">Entrar</Link> · <Link href="/esqueci-senha" className="font-medium text-indigo-600 hover:underline">Recuperar senha</Link></p> : null}
         <p className="mt-6 text-center text-sm text-gray-600">Já possui uma conta? <Link href="/admin/login" className="font-medium text-indigo-600 hover:underline">Entrar</Link></p>
      </main>
    </div>
  );
}

function Field({ label, icon, name, type = "text", autoComplete, disabled, error }: { label: string; icon: React.ReactNode; name: string; type?: string; autoComplete: string; disabled: boolean; error?: string }) {
  return <div><label htmlFor={name} className="block text-sm mb-2 text-black">{label}</label><div className="relative"><div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">{icon}</div><input id={name} name={name} type={type} autoComplete={autoComplete} required disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-4 text-black outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" /></div>{error ? <p id={`${name}-error`} className="mt-1 text-sm text-red-700">{error}</p> : null}</div>;
}

function PasswordField({ label, name, show, toggle, disabled, error }: { label: string; name: string; show: boolean; toggle: () => void; disabled: boolean; error?: string }) {
  return <div><label htmlFor={name} className="block text-sm mb-2 text-black">{label}</label><div className="relative"><div className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none"><Lock className="h-5 w-5" /></div><input id={name} name={name} type={show ? "text" : "password"} autoComplete={name === "password" ? "new-password" : "new-password"} required disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : undefined} className="w-full rounded-lg border border-gray-200 bg-white py-3 pl-10 pr-12 text-black outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" /><button type="button" onClick={toggle} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div>{error ? <p id={`${name}-error`} className="mt-1 text-sm text-red-700">{error}</p> : null}</div>;
}

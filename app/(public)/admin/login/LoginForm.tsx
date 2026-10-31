"use client";

import Link from "next/link";
import { useState, useTransition, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { loginAction } from "@/lib/auth/actions";
import { AuthField, AuthHeading, AuthNotice, AuthShell, AuthSubmit, authStyles } from "@/components/auth/AuthUI";
import { PasswordField } from "@/components/auth/PasswordField";

export function LoginForm({ signupEnabled = false }: { signupEnabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;
    setError(null);
    setFieldErrors({});
    if (!email.trim()) { setFieldErrors({ email: "Informe o e-mail." }); return; }
    if (!password) { setFieldErrors({ password: "Informe a senha." }); return; }
    const formData = new FormData();
    formData.append("email", email);
    formData.append("password", password);
    startTransition(async () => {
      try {
        const result = await loginAction(formData);
        if (result.error) setError(result.error);
        else if (result.success) {
          router.push(result.state === "business_ready" ? "/home" : "/conta");
          router.refresh();
        }
      } catch { setError("Não foi possível concluir o login. Tente novamente em instantes."); }
    });
  };

  return <AuthShell>
    <AuthHeading title="Bem-vindo de volta" description="Entre para acessar o Modulus Hub." />
    {error ? <AuthNotice type="error">{error}</AuthNotice> : null}
    <form onSubmit={handleSubmit} className="space-y-6" noValidate aria-busy={isPending}>
      <AuthField label="E-mail" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined }); }} placeholder="seu@email.com" error={fieldErrors.email} disabled={isPending} icon={<Mail size={20} />} />
      <div>
        <PasswordField label="Senha" name="password" autoComplete="current-password" required value={password} onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined }); }} placeholder="Digite sua senha" error={fieldErrors.password} disabled={isPending} />
        <div className="mt-2 text-right"><Link href="/esqueci-senha" className={`${authStyles.link} inline-flex min-h-11 items-center text-sm`}>Esqueci minha senha</Link></div>
      </div>
      <AuthSubmit pending={isPending} pendingText="Entrando...">Entrar</AuthSubmit>
    </form>
    {signupEnabled ? <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#f3f4f5] p-5"><div><p className="text-sm font-medium">Ainda não tem uma conta?</p><p className="mt-1 text-xs text-[#5e5e5e]">Comece com o Modulus Hub.</p></div><Link href="/cadastro" className={`${authStyles.link} inline-flex min-h-11 items-center rounded-md bg-white px-4 text-sm shadow-sm`}>Criar conta</Link></div> : null}
  </AuthShell>;
}

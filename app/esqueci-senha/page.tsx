"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { AlertCircle, Loader2, Mail } from "lucide-react";
import { requestPasswordResetAction } from "@/lib/auth/recovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await requestPasswordResetAction(form);
        if ("error" in result) setError(result.error ?? "Não foi possível processar a solicitação.");
        else setMessage(result.message);
      } catch {
        setError("Não foi possível processar a solicitação. Tente novamente.");
      }
    });
  }

  return <AuthShell title="Recupere sua senha" description="Informe seu e-mail para receber instruções de redefinição.">
    {error ? <Notice type="error">{error}</Notice> : null}
    {message ? <Notice type="success">{message}</Notice> : null}
    <form onSubmit={submit} className="space-y-6" noValidate>
      <label htmlFor="email" className="block text-sm text-black">E-mail<div className="relative mt-2"><Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" /><input id="email" name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} className="w-full rounded-lg border border-gray-200 py-3 pl-10 pr-4 text-black outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" /></div></label>
      <button disabled={pending} className="flex w-full items-center justify-center rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-70">{pending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : "Enviar instruções"}</button>
    </form>
    <p className="mt-6 text-center text-sm text-gray-600"><Link href="/admin/login" className="text-indigo-600 hover:underline">Voltar para o login</Link></p>
  </AuthShell>;
}

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f8f9fa] px-4"><div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(to right,#e5e7eb 1px,transparent 1px),linear-gradient(to bottom,#e5e7eb 1px,transparent 1px)", backgroundSize: "40px 40px" }} /><main className="relative w-full max-w-md rounded-xl border bg-white p-8 shadow-sm sm:p-10"><div className="mb-8 flex items-center gap-3"><div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white">M</div><div><h1 className="text-3xl font-bold text-black">{title}</h1><p className="text-gray-500">{description}</p></div></div>{children}</main></div>;
}
function Notice({ children, type }: { children: React.ReactNode; type: "error" | "success" }) { return <p role={type === "error" ? "alert" : "status"} className={`mb-5 flex gap-2 rounded-lg border p-4 text-sm ${type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-indigo-200 bg-indigo-50 text-indigo-900"}`}>{type === "error" ? <AlertCircle className="h-5 w-5 shrink-0" /> : null}{children}</p>; }

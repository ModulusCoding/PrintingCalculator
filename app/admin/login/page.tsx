"use client";

import Link from "next/link";
import { useState, useTransition, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/lib/auth/actions";
import { Lock, Mail, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!email.trim()) {
      setFieldErrors({ email: "Informe o e-mail." });
      return;
    }
    if (!password) {
      setFieldErrors({ password: "Informe a senha." });
      return;
    }

    const formData = new FormData();
    formData.append("email", email);
    formData.append("password", password);

    startTransition(async () => {
      try {
        const result = await loginAction(formData);
        if (result.error) {
          setError(result.error);
        } else if (result.success) {
          router.push("/conta");
          router.refresh();
        }
      } catch {
        setError("Não foi possível concluir o login. Tente novamente em instantes.");
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right,#e5e7eb 1px,transparent 1px),linear-gradient(to bottom,#e5e7eb 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative w-full max-w-md bg-white rounded-xl overflow-hidden shadow-sm border p-10">
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/30">
              M
            </div>
            <div>
              <h2 className="text-3xl font-bold mb-1 text-black">Bem-vindo de volta</h2>
              <p className="text-gray-500">Entre com suas credenciais para acessar o Modulus.</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 p-4 text-sm text-red-700 bg-red-50 rounded-xl border border-red-200" role="alert">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm mb-2 text-black">
              E-mail
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Mail className="h-5 w-5" />
              </div>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined });
                }}
                placeholder="nome@empresa.com"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "email-error" : undefined}
                disabled={isPending}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg bg-white text-black placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
              />
            </div>
            {fieldErrors.email ? (
              <p id="email-error" className="mt-2 text-sm text-red-600">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <label htmlFor="password" className="text-black">
                Senha
              </label>
              <Link
                href="/esqueci-senha"
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Esqueci minha senha
              </Link>
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Lock className="h-5 w-5" />
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined });
                }}
                placeholder="••••••••"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? "password-error" : undefined}
                disabled={isPending}
                className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-lg bg-white text-black placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {fieldErrors.password ? (
              <p id="password-error" className="mt-2 text-sm text-red-600">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white py-3 rounded-lg font-semibold transition"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                Entrando...
              </>
            ) : (
              "Entrar →"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

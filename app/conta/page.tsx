import { resolveMinimalIdentity } from "@/lib/auth/context";
import { isPublicOnboardingEnabled } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import Link from "next/link";
import { AuthenticatedShell } from "@/app/(authenticated)/AuthenticatedShell";
import { shellAccessForRole } from "@/components/layout/access";

const stateMessages: Record<string, { title: string; description: string }> = {
  unauthenticated: {
    title: "Não autenticado",
    description: "Sua sessão expirou ou não foi encontrada.",
  },
  no_active_internal_identity: {
    title: "Cadastro interno pendente",
    description: "Sua conta no provedor de autenticação ainda não foi vinculada ao sistema Modulus. Aguarde a configuração pelo administrador.",
  },
  password_change_required: {
    title: "Troca de senha necessária",
    description: "Você precisa definir uma nova senha antes de acessar os módulos.",
  },
  user_inactive: {
    title: "Usuário inativo",
    description: "Seu usuário está inativo e não pode acessar os módulos.",
  },
  enterprise_inactive: {
    title: "Empresa inativa",
    description: "A empresa à qual você pertence está inativa. Acesso indisponível.",
  },
  membership_inactive: {
    title: "Vínculo inativo",
    description: "Seu vínculo com a empresa está inativo. Acesso indisponível.",
  },
  ambiguous_active_enterprise: {
    title: "Acesso precisa de revisão",
    description: "Você possui vínculos ativos em mais de uma empresa. O administrador deve resolver essa ambiguidade.",
  },
  no_enterprise_membership: {
    title: "Sem vínculo empresarial",
    description: "Você não possui vínculo ativo com nenhuma empresa. Aguarde o cadastro pelo administrador.",
  },
  business_ready: {
    title: "Acesso configurado",
    description: "Sua conta está pronta para usar os módulos do Modulus.",
  },
};

export default async function ContaPage() {
  let context;
  try {
    context = await resolveMinimalIdentity();
  } catch {
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
        <main className="relative w-full max-w-md bg-white rounded-xl overflow-hidden shadow-sm border p-10 text-center">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/30">
              M
            </div>
            <h1 className="text-3xl font-bold text-black">Minha conta</h1>
          </div>

          <div className="mb-8 p-6 rounded-lg bg-red-50 border border-red-200">
            <h2 className="text-lg font-semibold text-red-700 mb-2">Erro técnico</h2>
            <p className="text-red-600">Não foi possível validar seu acesso. Tente novamente em instantes.</p>
          </div>

          <LogoutButton />
        </main>
      </div>
    );
  }

  if (context.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (context.state === "business_ready") {
    return (
      <AuthenticatedShell {...shellAccessForRole(context.role)}><section className="mx-auto max-w-xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 text-[#152336]">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Configurações / Perfil</p>
          <h1 className="text-3xl font-semibold tracking-tight">Minha conta</h1>
          <p className="text-sm text-slate-600">Sua conta está ativa e vinculada à empresa.</p>
        </header>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2 text-sm">
          <p><strong className="font-medium text-[#152336]">Papel no sistema:</strong> {context.role}</p>
          <p><strong className="font-medium text-[#152336]">Empresa ID:</strong> <span className="font-mono text-xs text-slate-500">{context.enterpriseId}</span></p>
        </div>
        <nav className="flex flex-wrap items-center gap-4 pt-2">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2B00FF] px-5 py-3 text-sm font-medium text-white hover:bg-[#2200CC]" href="/home">Ir para o Hub</Link>
          {context.role === "owner" && <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#152336] hover:bg-slate-50" href="/meu-plano">Meu plano</Link>}
        </nav>
        <div className="border-t border-slate-100 pt-6">
          <LogoutButton />
        </div>
      </section></AuthenticatedShell>
    );
  }

  const message = stateMessages[context.state] || {
    title: "Estado desconhecido",
    description: "Não foi possível determinar seu estado de acesso.",
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
      <main className="relative w-full max-w-md bg-white rounded-xl overflow-hidden shadow-sm border p-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/30">
            M
          </div>
          <h1 className="text-3xl font-bold text-black">Minha conta</h1>
        </div>

        <div className="mb-8 p-6 rounded-lg bg-gray-50 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{message.title}</h2>
          <p className="text-gray-600">{message.description}</p>
        </div>

        <div className="flex flex-col gap-4">
          {context.state === "password_change_required" && (
            <Link href="/trocar-senha-obrigatoria" className="flex justify-center items-center bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition">Alterar senha</Link>
          )}
          {context.state === "no_active_internal_identity" && isPublicOnboardingEnabled() && (
            <Link
              href="/cadastro/concluir"
              className="flex justify-center items-center bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-semibold transition"
            >
              Completar cadastro
            </Link>
          )}
          <LogoutButton />
        </div>
      </main>
    </div>
  );
}
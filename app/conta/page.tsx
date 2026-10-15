import { resolveMinimalIdentity } from "@/lib/auth/context";
import { isPublicOnboardingEnabled } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { LogoutButton } from "./LogoutButton";
import Link from "next/link";

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
    redirect("/home");
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
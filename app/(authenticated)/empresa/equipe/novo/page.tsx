import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { NewEmployeeContent } from "@/app/conta/equipe/novo/NewEmployeeContent";
import { z } from "zod";

export default async function NewTeamMemberPage(props: { searchParams?: Promise<{ operationId?: string }> }) {
  const searchParams = props.searchParams ? await props.searchParams : undefined;
  const rawOperationId = searchParams?.operationId;
  const initialOperationId = rawOperationId && z.uuid().safeParse(rawOperationId).success ? rawOperationId : undefined;
  let context;
  try {
    context = await requireBusinessContext("members.manage_operators");
  } catch (caught) {
    if (caught instanceof AuthContextError && caught.code === "AUTH_UNAUTHENTICATED") redirect("/admin/login");
    const unavailable = caught instanceof AuthContextError && (caught.code === "AUTH_ACCESS_BLOCKED" || caught.code === "AUTH_PERMISSION_DENIED");
    return (
      <main className="min-h-screen bg-[#f8f9fa] px-4 py-10">
        <section className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm" role="alert">
          <h1 className="text-xl font-bold text-gray-900">{unavailable ? "Acesso indisponível" : "Erro técnico"}</h1>
          <p className="mt-3 text-gray-600">{unavailable ? "Sua conta não possui acesso a este cadastro." : "Não foi possível validar seu acesso."}</p>
          <Link href="/home" className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white">Voltar para o início</Link>
        </section>
      </main>
    );
  }
  const canCreateAdmin = context.role === "owner";
  return <NewEmployeeContent canCreateAdmin={canCreateAdmin} initialOperationId={initialOperationId} />;
}

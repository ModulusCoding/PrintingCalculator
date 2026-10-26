import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { listMembers } from "@/lib/enterprise/management";
import { TeamList } from "./TeamList";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { PlanAccessError } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; page?: string }> }) {
  const query = await searchParams;
  const search = (query.search ?? "").trim();
  const status: "active" | "inactive" | "all" = query.status === "inactive" || query.status === "all" ? query.status : "active";
  const rawPage = Number(query.page);
  const page = Math.min(10000, Math.max(1, Number.isInteger(rawPage) ? rawPage : 1));
  if (search.length > 200) redirect("/empresa/equipe");
  let data: Awaited<ReturnType<typeof listMembers>>;
  let canManageAdmins = false;
  try {
    const context = await requireBusinessContext("members.manage_operators");
    canManageAdmins = context.role === "owner";
    data = await listMembers(search, status, page);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PlanAccessError) return planAccessNotice(error);
    if (error instanceof AuthContextError && error.code === "AUTH_UNAUTHENTICATED") redirect("/admin/login");
    return <TeamUnavailable />;
  }
  return <section className="mx-auto max-w-4xl rounded-2xl border bg-white p-8 shadow-sm"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Equipe</h1><p className="mt-2 text-[#464556]">Gestão de membros da empresa.</p></div><Link href="/empresa/equipe/novo" className="rounded bg-indigo-600 px-4 py-2 text-white">Novo membro</Link></div><TeamList {...data} canManageAdmins={canManageAdmins} unfilteredVisibleTotal={data.unfiltered_visible_total} page={page} status={status} search={search}/></section>;
}
function TeamUnavailable(){return <section role="alert" className="mx-auto max-w-3xl rounded border bg-white p-8"><h1 className="text-2xl font-bold">Acesso indisponível</h1><p className="mt-3">Não foi possível carregar a equipe.</p></section>}

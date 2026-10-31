import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { listMembers } from "@/lib/enterprise/management";
import { TeamList } from "./TeamList";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { getMyPlanAccess, PLAN_CAPABILITIES, PLAN_LABELS, PlanAccessError } from "@/lib/plans";
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
  let planAccess = null;
  try {
    const context = await requireBusinessContext("members.manage_operators");
    canManageAdmins = context.role === "owner";
    [data, planAccess] = await Promise.all([listMembers(search, status, page), getMyPlanAccess()]);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PlanAccessError) return planAccessNotice(error);
    if (error instanceof AuthContextError && error.code === "AUTH_UNAUTHENTICATED") redirect("/admin/login");
    return <TeamUnavailable />;
  }
  const plan = planAccess?.effective_plan || 'free';
  const limit = PLAN_CAPABILITIES[plan].operators;
  const used = data.members.filter(m => m.role === 'operator' || m.role === 'admin').length;

  return <section className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 text-[#152336]"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Empresa / Acessos</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Equipe</h1><p className="mt-2 text-sm text-slate-600">Gestão de membros e permissões da empresa.</p></div><Link href="/empresa/equipe/novo" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2B00FF] px-5 py-3 text-sm font-medium text-white hover:bg-[#2200CC] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF]">Novo membro</Link></div>
    {planAccess && <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="text-sm"><p className="font-semibold">Plano {PLAN_LABELS[plan]}</p><p className="text-slate-500">Você possui {limit === null ? "acesso ilimitado" : `${limit} ${limit === 1 ? "vaga" : "vagas"} para equipe`} no seu plano.</p></div>{plan === 'free' && <Link href="/planos" className="text-sm font-medium text-[#2B00FF] underline">Ver outros planos</Link>}</div>}
    <TeamList {...data} canManageAdmins={canManageAdmins} unfilteredVisibleTotal={data.unfiltered_visible_total} page={page} status={status} search={search}/></section>;
}
function TeamUnavailable(){return <section role="alert" className="mx-auto max-w-3xl rounded border bg-white p-8"><h1 className="text-2xl font-bold">Acesso indisponível</h1><p className="mt-3">Não foi possível carregar a equipe.</p></section>}

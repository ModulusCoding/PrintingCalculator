import Link from "next/link";
import { SubscriptionPanel } from "@/components/plans/SubscriptionPanel";
import { z } from "zod";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { getMyPlanAccess, PLAN_CAPABILITIES, PLAN_LABELS } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { unstable_rethrow } from "next/navigation";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";

// Postgres bigint may be serialized as a number or a decimal string. Reject
// negatives, fractions, nulls and unsafe integers instead of inventing zeros.
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const usageSchema = z.array(z.object({
  products: count,
  shared_materials: count,
  operators: count,
  printers: count,
}).strict()).length(1);

async function readUsage() {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("get_my_plan_usage");
    if (error) throw error;
    return usageSchema.parse(data)[0];
  } catch (error) {
    unstable_rethrow(error);
    const correlationId = createLogger("plans", "usage").error({ stage: error instanceof z.ZodError ? "interpretation" : "rpc", rpc_name: "get_my_plan_usage", ...safeErrorDiagnostic(error) });
    return { correlationId };
  }
}

const accessLabels = {
  selection_required: "Escolha inicial pendente",
  free: "Gratuito",
  paid: "Pago",
  expired: "Vigência encerrada",
  cancelled: "Cancelado",
} as const;

export default async function MyPlanPage() {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready") return null;
  if (identity.role !== "owner") return <section className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-[#152336]"><h1 className="text-2xl font-bold">Meu plano</h1><p className="mt-3 text-slate-600">Somente o responsável pela empresa pode consultar esta página. Procure o proprietário para revisar o plano.</p><Link href="/conta" className="mt-4 inline-flex text-[#2B00FF] font-semibold underline">Minha conta</Link></section>;
  let access;
  try { access = await getMyPlanAccess(); }
  catch (error) { return planAccessNotice(error); }
  const usageResult = await readUsage();
  const usage = "correlationId" in usageResult ? null : usageResult;
  const usageReference = "correlationId" in usageResult ? usageResult.correlationId : undefined;
  const limits = access ? PLAN_CAPABILITIES[access.effective_plan] : null;
  const formatLimit = (value: number | null) => value === null ? "Sem limite" : value.toLocaleString("pt-BR");
  const rows = [
    { label: "Produtos (empresa)", value: usage?.products, limit: limits?.products },
    { label: "Materiais compartilhados (empresa)", value: usage?.shared_materials, limit: limits?.sharedMaterials },
    { label: "Operadores (empresa)", value: usage?.operators, limit: limits?.operators },
    { label: "Impressoras (empresa)", value: usage?.printers, limit: undefined },
  ];

  return <section className="mx-auto max-w-4xl space-y-8 text-[#152336]">
    <header className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Configurações / Assinatura</p>
      <h1 className="text-3xl font-semibold tracking-tight">Meu plano</h1>
      <p className="text-slate-600">Consulte o plano e o uso atual, inclusive enquanto o acesso aos módulos precisa de regularização.</p>
    </header>

    {!access ? <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm" role="alert">
      <h2 className="text-xl font-semibold">Plano indisponível</h2>
      <p className="mt-2 text-slate-600">Não há dados de plano disponíveis para esta empresa. Consulte Minha conta.</p>
    </section> : <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">Situação atual</h2>
      <dl className="grid gap-6 sm:grid-cols-2">
        <div><dt className="text-sm text-slate-500">Plano escolhido</dt><dd className="mt-1 font-semibold text-[#152336]">{access.selected_plan ? PLAN_LABELS[access.selected_plan] : "Ainda não escolhido"}</dd></div>
        <div><dt className="text-sm text-slate-500">Plano efetivo</dt><dd className="mt-1 font-semibold text-[#152336]">{PLAN_LABELS[access.effective_plan]}</dd></div>
        <div><dt className="text-sm text-slate-500">Estado de acesso</dt><dd className="mt-1 font-semibold text-[#152336]">{accessLabels[access.access_state]}</dd></div>
        <div><dt className="text-sm text-slate-500">Vigência paga até</dt><dd className="mt-1 font-semibold text-[#152336]">{access.paid_until ? new Date(access.paid_until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)" : "Sem vigência paga registrada"}</dd></div>
      </dl>
      {access.selection_required && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">A escolha inicial ainda está pendente. {identity.role === "owner" ? <Link className="font-semibold underline" href="/planos">Escolher o plano gratuito</Link> : "Solicite a escolha ao proprietário."}</p>}
      {(access.access_state === "expired" || access.access_state === "cancelled") && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Os recursos disponíveis seguem o plano efetivo informado acima. A equipe pode precisar de regularização; consulte Minha conta e a gestão da empresa.</p>}
    </section>}
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">Uso e limites do plano efetivo</h2>
      {!usage && <p role="alert" className="mt-3 text-red-700">Não foi possível consultar o uso. As contagens estão indisponíveis. Atualize a página. Referência: {usageReference}.</p>}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wider"><th scope="col" className="py-3 pr-4">Recurso</th><th scope="col" className="py-3 pr-4">Em uso</th><th scope="col" className="py-3">Limite</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.label}>
            <th scope="row" className="py-4 pr-4 font-medium text-[#152336]">{row.label}</th>
            <td className="py-4 pr-4 text-slate-600">{row.value === undefined ? "Indisponível" : row.value.toLocaleString("pt-BR")}</td>
            <td className="py-4 text-slate-600">{row.label === "Impressoras (empresa)" && access ? (access.effective_plan === "free" ? "Recurso indisponível" : "Sem cota numérica") : row.limit === undefined ? "Indisponível" : formatLimit(row.limit)}</td>
          </tr>)}
          <tr><th scope="row" className="py-4 pr-4 font-medium text-[#152336]">Pedidos</th><td className="py-4 pr-4 text-slate-600">Indisponível</td><td className="py-4 text-slate-600">{limits ? formatLimit(limits.orders) : "Indisponível"}</td></tr>
          <tr><th scope="row" className="py-4 pr-4 font-medium text-[#152336]">Clientes</th><td className="py-4 pr-4 text-slate-600">Indisponível</td><td className="py-4 text-slate-600">{limits ? formatLimit(limits.customers) : "Indisponível"}</td></tr>
          </tbody>
        </table>
      </div>
      {limits && <p className="mt-6 text-sm text-slate-500">Precificação: {limits.integratedPricing ? "integrada ao estoque" : "manual"}. Cadastros arquivados também contam.</p>}
    </section>
    <SubscriptionPanel />
    <nav aria-label="Navegação complementar" className="flex flex-wrap gap-5 text-sm font-semibold text-[#2B00FF]">
      <Link href="/planos" className="underline">Ver planos</Link>
      <Link href="/conta" className="underline">Minha conta</Link>
      <Link href="/home" className="underline">Ir para o início</Link>
    </nav>
  </section>;
}

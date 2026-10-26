import Link from "next/link";
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
  if (identity.role !== "owner") return <section className="rounded-xl border bg-white p-6"><h1 className="text-2xl font-bold">Meu plano</h1><p className="mt-3">Somente o responsável pela empresa pode consultar esta página. Procure o proprietário para revisar o plano.</p><Link href="/conta" className="mt-4 inline-block underline">Minha conta</Link></section>;
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

  return <>
    <section className="space-y-3">
      <h1 className="text-3xl font-bold">Meu plano</h1>
      <p className="text-[#464556]">Consulte o plano e o uso atual, inclusive enquanto o acesso aos módulos precisa de regularização.</p>
      {identity.role !== "owner" && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4">A escolha e a regularização do plano são responsabilidade do proprietário. Se os módulos estiverem bloqueados, peça que ele revise o plano e a equipe.</p>}
    </section>
    {!access ? <section className="rounded-2xl border bg-white p-6" role="alert">
      <h2 className="text-xl font-semibold">Plano indisponível</h2>
      <p className="mt-2">Não há dados de plano disponíveis para esta empresa. Consulte Minha conta.</p>
    </section> : <section className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Situação atual</h2>
      <dl className="grid gap-5 sm:grid-cols-2">
        <div><dt className="text-sm text-gray-500">Plano escolhido</dt><dd className="font-semibold">{access.selected_plan ? PLAN_LABELS[access.selected_plan] : "Ainda não escolhido"}</dd></div>
        <div><dt className="text-sm text-gray-500">Plano efetivo</dt><dd className="font-semibold">{PLAN_LABELS[access.effective_plan]}</dd></div>
        <div><dt className="text-sm text-gray-500">Estado de acesso</dt><dd className="font-semibold">{accessLabels[access.access_state]}</dd></div>
        <div><dt className="text-sm text-gray-500">Vigência paga até</dt><dd className="font-semibold">{access.paid_until ? new Date(access.paid_until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)" : "Sem vigência paga registrada"}</dd></div>
      </dl>
      {access.selection_required && <p className="rounded-xl bg-amber-50 p-4">A escolha inicial ainda está pendente. {identity.role === "owner" ? <Link className="font-semibold underline" href="/planos">Escolher o plano gratuito</Link> : "Solicite a escolha ao proprietário."}</p>}
      {(access.access_state === "expired" || access.access_state === "cancelled") && <p className="rounded-xl bg-amber-50 p-4">Os recursos disponíveis seguem o plano efetivo informado acima. A equipe pode precisar de regularização; consulte Minha conta e a gestão da empresa. A contratação paga não está disponível nesta versão.</p>}
      <p className="text-sm text-gray-500">A vigência e o plano efetivo são informados pelo servidor. Esta página não ativa planos pagos nem altera a equipe.</p>
    </section>}
    <section className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold">Uso e limites do plano efetivo</h2>
      {!usage && <p role="alert" className="mt-3 text-amber-800">Não foi possível consultar o uso. As contagens estão indisponíveis, não zeradas. Atualize a página para tentar novamente. Referência: {usageReference}.</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b"><th scope="col" className="py-3 pr-4">Recurso</th><th scope="col" className="py-3 pr-4">Em uso</th><th scope="col" className="py-3">Limite</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label} className="border-b border-gray-100">
            <th scope="row" className="py-4 pr-4 font-medium">{row.label}</th>
            <td className="py-4 pr-4">{row.value === undefined ? "Indisponível" : row.value.toLocaleString("pt-BR")}</td>
            <td className="py-4">{row.label === "Impressoras (empresa)" && access ? (access.effective_plan === "free" ? "Recurso indisponível" : "Sem cota numérica nesta fase") : row.limit === undefined ? "Indisponível" : formatLimit(row.limit)}</td>
          </tr>)}
          <tr className="border-b border-gray-100"><th scope="row" className="py-4 pr-4 font-medium">Pedidos (por usuário, recurso futuro)</th><td className="py-4 pr-4">Indisponível</td><td>{limits ? formatLimit(limits.orders) : "Indisponível"}</td></tr>
          <tr><th scope="row" className="py-4 pr-4 font-medium">Clientes (por usuário, recurso futuro)</th><td className="py-4 pr-4">Indisponível</td><td>{limits ? formatLimit(limits.customers) : "Indisponível"}</td></tr>
          </tbody>
        </table>
      </div>
      {limits && <p className="mt-4 text-sm text-gray-500">Precificação: {limits.integratedPricing ? "integrada ao estoque" : "manual, sem integração ao estoque"}. Carretéis e materiais gerais compartilham a mesma cota; cadastros arquivados também contam. Produtos excluídos não contam. Pedidos e clientes ainda não estão disponíveis.</p>}
    </section>
    <nav aria-label="Próximos passos" className="flex flex-wrap gap-5 font-semibold">
      <Link className="underline" href="/planos">Ver planos</Link>
      <Link className="underline" href="/conta">Minha conta</Link>
      <Link className="underline" href="/home">Ir para o início</Link>
    </nav>
  </>;
}

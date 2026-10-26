import Link from "next/link";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { getMyPlanAccess, PLAN_CAPABILITIES, PLAN_LABELS } from "@/lib/plans";
import { FreePlanChoice } from "./FreePlanChoice";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function PlansPage() {
  const identity = await resolveMinimalIdentity();
  if (identity.state !== "business_ready") return null;
  let access;
  try {
    access = await getMyPlanAccess();
  } catch (error) {
    return planAccessNotice(error);
  }
  const owner = identity.role === "owner";
  const canSelect = owner && access?.selection_required === true;
  const plans = ["free", "intermediate", "advanced"] as const;

  return <>
    <section className="space-y-3">
      <h1 className="text-3xl font-bold">{access && !access.selection_required ? "Compare os planos" : "Escolha seu plano"}</h1>
      <p className="max-w-3xl text-[#464556]">Comece com o Aprendiz, gratuito. Compare a precificadora manual com a integrada. As cotas de cadastros são da empresa; pedidos e clientes ainda não estão disponíveis.</p>
      {!owner && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">Somente o proprietário pode escolher o plano. Peça a ele para concluir a escolha ou regularizar o acesso da equipe.</p>}
      {!access && <p role="alert">Não foi encontrado um plano para esta empresa. Consulte Minha conta; a escolha está indisponível até a situação ser verificada.</p>}
      {access && !access.selection_required && <p className="rounded-xl border bg-white p-4">Sua escolha já está registrada. <Link href="/meu-plano" className="font-semibold underline">Consultar Meu plano</Link></p>}
    </section>
    <div className="grid gap-6 lg:grid-cols-3">
      {plans.map((key) => {
        const limits = PLAN_CAPABILITIES[key];
        const limit = (value: number | null) => value === null ? "Ilimitados" : String(value);
        return <section key={key} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">{PLAN_LABELS[key]}</h2>
          <p className="mt-4 text-3xl font-bold">{(limits.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}<span className="text-sm font-normal text-gray-500">/mês</span></p>
          <ul className="my-6 flex-1 space-y-3 text-sm text-[#464556]">
            <li>1 perfil master{key === "intermediate" ? " + 1 operador" : key === "free" ? ", sem operadores" : " — em breve"}</li>
            <li>Produtos: {limit(limits.products)}{key === "intermediate" ? " nesta fase de lançamento" : ""}</li>
            <li>Pedidos: {limit(limits.orders)}{key === "intermediate" ? " nesta fase de lançamento" : ""} (ainda não disponível)</li>
            <li>{key === "free" ? "Sem cadastro de impressoras, carretéis ou materiais gerais" : key === "intermediate" ? "Cadastro de impressoras; 15 cadastros compartilhados entre carretéis e materiais gerais (não são 15 de cada)" : "Recursos futuros, ainda indisponíveis"}</li>
            {key === "intermediate" && <li>R$ 39,90/mês, sem fidelidade</li>}
            <li>{limits.integratedPricing ? "Precificação integrada ao estoque" : "Precificação manual, sem integração ao estoque"}</li>
          </ul>
          {key === "free" ? canSelect ? <FreePlanChoice /> : <p className="text-sm text-gray-500">{owner ? "Consulte o status da sua escolha em Meu plano." : "Escolha exclusiva do proprietário."}</p> : <>
            <button disabled className="rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-500 disabled:cursor-not-allowed">{key === "advanced" ? "Em breve" : "Contratação indisponível"}</button>
            <p className="mt-3 text-sm text-gray-500">{key === "intermediate" ? "A ativação paga ainda não está disponível nesta versão. Nenhuma cobrança ou ativação é realizada por esta página." : "O Magnata ainda não pode ser contratado."}</p>
          </>}
        </section>;
      })}
    </div>
  </>;
}

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { requireBusinessContext } from "@/lib/auth/context";
import { getMyPlanAccess } from "@/lib/plans";
import { OrderForm } from "@/components/admin/orders/OrderForm";

export default async function NewOrderPage() {
  let plan;
  try {
    await requireBusinessContext("sales.write");
    plan = await getMyPlanAccess();
    if (!plan) throw new Error("Plan unavailable");
  } catch (error) {
    unstable_rethrow(error);
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">Não foi possível abrir o cadastro. Confira sua sessão, permissão de escrita e regularização do plano. <Link href="/admin/orders" className="underline">Voltar</Link></div>;
  }
  return <div className="space-y-6">
    <header>
      <Link href="/admin/orders" className="text-sm text-[#3d32e6]">← Pedidos</Link>
      <h1 className="mt-2 text-2xl font-bold text-[#152336]">Novo pedido</h1>
      <p className="text-sm text-[#464556]">Registre o atendimento com valores negociados. O servidor confirma preços e disponibilidade.</p>
      {plan.effective_plan === "free" && <p className="mt-2 text-sm text-amber-800">Aprendiz: até três pedidos históricos por empresa, incluindo cancelados.</p>}
    </header>
    <OrderForm physical={plan.effective_plan === "intermediate" && plan.access_state === "paid"}/>
  </div>;
}

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireBusinessContext } from "@/lib/auth/context";
import { getOrderDetails } from "@/lib/orders/actions";
import { OrderForm } from "@/components/admin/orders/OrderForm";

export default async function EditOrderPage({params}: {params:Promise<{orderId:string}>}) {
  let detail;
  let orderId;
  try {
    await requireBusinessContext("sales.write");
    orderId = (await params).orderId;
    if (!z.string().uuid().safeParse(orderId).success) throw new Error("Invalid order");
    detail = await getOrderDetails(orderId);
  } catch (error) {
    unstable_rethrow(error);
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">Não foi possível abrir a edição. Confira sua sessão, permissão e plano. <Link href="/admin/orders" className="underline">Voltar</Link></div>;
  }
  if (detail.error || !detail.order) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">{detail.error || "Pedido indisponível."} <Link href="/admin/orders" className="underline">Voltar</Link></div>;
  const blocked = ["cancelado","entregue"].includes(detail.order.operationalStatus) || detail.items.some(i=>i.fulfillmentMode !== "untracked");
  if (blocked) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">Este pedido não permite edição comercial: pedidos cancelados, entregues ou com atendimento físico são protegidos pelo servidor. <Link href={`/admin/orders?orderId=${orderId}`} className="underline">Ver detalhes</Link></div>;
  return <div className="space-y-6">
    <header>
      <Link href={`/admin/orders?orderId=${orderId}`} className="text-sm text-[#3d32e6]">Detalhes</Link>
      <h1 className="mt-2 text-2xl font-bold text-[#152336]">Editar pedido #{detail.order.displayNumber}</h1>
      <p className="text-sm text-[#464556]">Versão {detail.order.version}. Alterações concorrentes exigirão recarregar os dados.</p>
    </header>
    <OrderForm key={`${orderId}:${detail.order.version}`} initial={detail.order} initialItems={detail.items} physical={false}/>
  </div>;
}

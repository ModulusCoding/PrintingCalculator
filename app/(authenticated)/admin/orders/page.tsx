import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { listOrders, getOrderDetails, type OrdersResult } from "@/lib/orders/actions";
import { OrdersView } from "@/components/admin/orders/OrdersView";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let identity;
  try {
    const context = await requireBusinessContext("sales.read");
    identity = {userId:context.userId, enterpriseId:context.enterpriseId};
  } catch (err: unknown) {
    if (err instanceof AuthContextError && err.code === "AUTH_UNAUTHENTICATED") {
      redirect("/admin/login");
    }
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h2 className="text-lg font-bold">Acesso não autorizado</h2>
        <p className="mt-2 text-sm text-red-700">
          Você não possui permissão para visualizar os pedidos da empresa ou sua sessão é inválida.
        </p>
      </div>
    );
  }

  let canWrite = false;
  try { await requireBusinessContext("sales.write"); canWrite = true; } catch { /* RPCs and edit pages independently enforce authorization. */ }
  let canDelete = false;
  try { await requireBusinessContext("sales.delete"); canDelete = true; } catch { /* Independently enforced by each command. */ }
  const rawParams = await searchParams;
  const params: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(rawParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  const viewMode = params.view === "kanban" ? "kanban" : "list";
  const selectedOrderId = params.orderId || null;

  // Single order detail if selected
  const detailResult = selectedOrderId ? await getOrderDetails(selectedOrderId) : null;

  // If viewMode is list, load standard paged list
  let listData = null;
  const kanbanData: Record<string, OrdersResult> = {};

  if (viewMode === "list") {
    listData = await listOrders({
      search: params.search,
      status: params.status,
      page: params.page,
    });
  } else {
    // Kanban mode: fetch paged orders for each status independently
    const statuses = ["em_conversao", "orcado", "pago", "modelando", "imprimindo", "entregue", "cancelado"];
    const results = await Promise.all(
      statuses.map(st =>
        listOrders({
          search: params.search,
          status: st,
          page: params[`page_${st}`] || "1",
          limit: "10",
        })
      )
    );
    statuses.forEach((st, idx) => {
      kanbanData[st] = results[idx];
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#152336]">Gestão de Pedidos</h1>
          <p className="text-sm text-[#464556]">
            Acompanhe a produção, fluxo operacional e situação financeira dos seus pedidos.
          </p>
        </div>
        {canWrite && <Link href="/admin/orders/new" className="rounded-lg bg-[#5852ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d32e6]">Novo pedido</Link>}
      </div>

      <OrdersView
        key={`${identity.userId}:${identity.enterpriseId}`}
        identity={identity}
        canDelete={canDelete}
        canWrite={canWrite}
        viewMode={viewMode}
        searchParams={params}
        listData={listData}
        kanbanData={kanbanData}
        selectedOrder={detailResult?.order || null}
        selectedItems={detailResult?.items || []}
        selectedError={detailResult?.error || null}
      />
    </div>
  );
}

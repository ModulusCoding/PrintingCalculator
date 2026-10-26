import Link from "next/link";
import { notFound } from "next/navigation";
import { MovementForm } from "@/components/inventory/MovementForm";
import { getProductInventoryDetail } from "@/lib/inventory/actions";
import { normalizeReturnTo, safePage } from "@/lib/inventory/navigation";

const movementLabels = {
  entry: "Entrada",
  exit: "Saída",
  adjustment: "Ajuste",
} as const;

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidProductInventoryDetailPage(props: Parameters<typeof ProductInventoryDetailPage>[0]) {
  return renderPaidModule("inventory", "inventory.read", () => ProductInventoryDetailPage(props));
}

async function ProductInventoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; returnTo?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const page = safePage(query.page);
  const returnTo = normalizeReturnTo(query.returnTo);
  const data = await getProductInventoryDetail(id, page);

  if (data.error === "product_unavailable") notFound();

  if (data.error || !data.detail) {
    return (
      <section role="alert" className="rounded border bg-red-50 p-5 text-red-800">
        <h1 className="font-bold">Não foi possível carregar o estoque</h1>
        <p>Tente novamente. O saldo não foi substituído por zero.</p>
      </section>
    );
  }

  const detail = data.detail;
  const totalPages = Math.max(1, Math.ceil(data.total / 20));
  const historyHref = (nextPage: number) => {
    const params = new URLSearchParams({ returnTo, page: String(nextPage) });
    return `/estoque/produtos/${encodeURIComponent(id)}?${params.toString()}`;
  };

  return (
    <section className="space-y-6">
      <header>
        <Link href={returnTo} className="text-sm text-indigo-700 hover:underline">
          ← Voltar ao estoque
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{detail.product_name}</h1>
            <p className="text-sm text-slate-600">
              {detail.product_active ? "Produto ativo" : "Produto arquivado"}
            </p>
          </div>
          <Link href={`/admin/products/${detail.product_id}`} className="text-sm text-indigo-700 hover:underline">
            Consultar cadastro do produto
          </Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border bg-white p-5">
          <p className="text-sm text-slate-600">Saldo atual</p>
          <p className="text-3xl font-bold tabular-nums">
            {detail.balance.toLocaleString("pt-BR")} <span className="text-base font-normal">unidades</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Versão do estoque: {detail.inventory_version}</p>
        </div>
        {!detail.product_active && (
          <div className="rounded border bg-amber-50 p-5 text-amber-900">
            <h2 className="font-semibold">Movimentações indisponíveis</h2>
            <p className="text-sm">Restaure o produto na área de Produtos para registrar novas movimentações. Saldo e histórico permanecem disponíveis.</p>
          </div>
        )}
      </div>

      {data.canWrite && detail.product_active && (
        <MovementForm productId={detail.product_id} productName={detail.product_name} balance={detail.balance} version={detail.inventory_version} />
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold">Histórico</h2>
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">Histórico de movimentações de {detail.product_name}</caption>
            <thead>
              <tr className="bg-slate-50 text-left">
                <th scope="col" className="p-3">Data</th>
                <th scope="col" className="p-3">Tipo</th>
                <th scope="col" className="p-3 text-right">Quantidade</th>
                <th scope="col" className="p-3 text-right">Antes</th>
                <th scope="col" className="p-3 text-right">Depois</th>
                <th scope="col" className="p-3">Motivo</th>
                <th scope="col" className="p-3">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((movement) => (
                <tr key={movement.movement_id} className="border-t">
                  <td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(movement.movement_at))}</td>
                  <td className="p-3">{movementLabels[movement.movement_type]}</td>
                  <td className="p-3 text-right tabular-nums">{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td>
                  <td className="p-3 text-right tabular-nums">{movement.balance_before}</td>
                  <td className="p-3 text-right tabular-nums">{movement.balance_after}</td>
                  <td className="p-3">{movement.reason ?? "—"}</td>
                  <td className="p-3">{movement.actor_id === detail.userId ? "Você" : "Membro da equipe"}</td>
                </tr>
              ))}
              {data.movements.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-slate-600">Nenhuma movimentação nesta página.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <nav className="mt-3 flex justify-end gap-2" aria-label="Paginação do histórico">
          <Link aria-disabled={page <= 1} className={`rounded border px-3 py-2 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={historyHref(Math.max(1, page - 1))}>Anterior</Link>
          <span className="p-2">Página {page} de {totalPages}</span>
          <Link aria-disabled={page >= totalPages} className={`rounded border px-3 py-2 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={historyHref(Math.min(totalPages, page + 1))}>Próxima</Link>
        </nav>
      </section>
    </section>
  );
}

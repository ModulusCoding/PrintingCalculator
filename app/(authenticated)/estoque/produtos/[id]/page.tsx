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
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <Link href={returnTo} className="inline-flex min-h-11 items-center text-sm font-medium text-modulus-primary hover:underline">
          Voltar ao estoque
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{detail.product_name}</h1>
            <p className="text-sm text-slate-600">
              {detail.product_active ? "Produto ativo" : "Produto arquivado"}
            </p>
          </div>
          <Link href={`/admin/products/${detail.product_id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-modulus-primary hover:underline">
            Consultar cadastro do produto
          </Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 border-b-modulus-primary bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Saldo físico atual</p>
          <p className="mt-3 text-4xl font-bold tracking-tight tabular-nums text-slate-900">
            {detail.balance.toLocaleString("pt-BR")} <span className="text-base font-normal">unidades</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">Saldo físico, não disponibilidade para venda. Reservas e saldo disponível não são apresentados nesta consulta.</p>
          <p className="mt-3 text-xs text-slate-500">Versão do estoque: {detail.inventory_version}</p>
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
        <div className="mb-4"><p className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">Rastreabilidade</p><h2 id="history-heading" className="text-lg font-semibold text-slate-900">Histórico de movimentações</h2></div>
        <div className="space-y-3 xl:hidden">
          {data.movements.map((movement) => (
            <article key={movement.movement_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-lg bg-modulus-primary/10 px-3 py-1 text-xs font-semibold text-modulus-primary">{movementLabels[movement.movement_type]}</span>
                <time dateTime={movement.movement_at} className="text-xs text-slate-500">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(movement.movement_at))}</time>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div className="col-span-2"><dt className="text-xs text-slate-500">Quantidade</dt><dd className="mt-1 text-xl font-bold tabular-nums">{movement.quantity > 0 ? "+" : ""}{movement.quantity}</dd></div>
                <div><dt className="text-xs text-slate-500">Saldo físico antes</dt><dd className="mt-1 font-medium tabular-nums">{movement.balance_before}</dd></div>
                <div><dt className="text-xs text-slate-500">Saldo físico depois</dt><dd className="mt-1 font-medium tabular-nums">{movement.balance_after}</dd></div>
                <div className="col-span-2 border-t border-slate-100 pt-3"><dt className="text-xs text-slate-500">Motivo</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-700">{movement.reason ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-slate-500">Responsável</dt><dd className="mt-1 text-slate-700">{movement.actor_id === detail.userId ? "Você" : "Membro da equipe"}</dd></div>
              </dl>
            </article>
          ))}
          {data.movements.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nenhuma movimentação nesta página.</p>}
        </div>
        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block">
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
                  <td className="max-w-xs whitespace-pre-wrap break-words p-3">{movement.reason ?? "—"}</td>
                  <td className="p-3">{movement.actor_id === detail.userId ? "Você" : "Membro da equipe"}</td>
                </tr>
              ))}
              {data.movements.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-slate-600">Nenhuma movimentação nesta página.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm sm:justify-end" aria-label="Paginação do histórico">
          {page <= 1 ? <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 text-slate-400">Anterior</span> : <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-medium text-modulus-primary hover:bg-slate-50" href={historyHref(Math.max(1, page - 1))}>Anterior</Link>}
          <span className="p-2">Página {page} de {totalPages}</span>
          {page >= totalPages ? <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 text-slate-400">Próxima</span> : <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-medium text-modulus-primary hover:bg-slate-50" href={historyHref(Math.min(totalPages, page + 1))}>Próxima</Link>}
        </nav>
      </section>
    </section>
  );
}

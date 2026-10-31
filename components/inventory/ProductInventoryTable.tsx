import Link from "next/link";
import { Archive, Package } from "lucide-react";
import type { ProductInventory } from "@/lib/inventory/schemas";
import { productInventoryDetailHref } from "@/lib/inventory/navigation";

type ProductInventoryTableProps = {
  items: ProductInventory[];
  total: number;
  page: number;
  search: string;
  balanceFilter: string;
  productStatus: string;
  returnTo: string;
};

export function ProductInventoryTable({
  items,
  total,
  page,
  search,
  balanceFilter,
  productStatus,
  returnTo,
}: ProductInventoryTableProps) {
  const pageSize = 20;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const href = (nextPage: number) => {
    const params = new URLSearchParams({
      balanceFilter,
      productStatus,
      page: String(nextPage),
    });

    if (search) params.set("search", search);
    return `/estoque/produtos?${params}`;
  };

  return (
    <>
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <article key={item.product_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-modulus-primary"><Package className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <Link className="inline-flex min-h-11 items-center break-words font-semibold text-slate-900 hover:text-modulus-primary" href={productInventoryDetailHref(item.product_id, returnTo)}>{item.product_name}</Link>
                <p className="mt-1 text-xs text-slate-500">Situação: {item.product_active ? "Ativo" : "Arquivado"}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Saldo físico</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{item.balance.toLocaleString("pt-BR")} <span className="text-xs font-normal text-slate-500">unidades</span></p></div>
              <Link href={productInventoryDetailHref(item.product_id, returnTo)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-modulus-primary/5 px-3 text-sm font-semibold text-modulus-primary">Detalhes</Link>
            </div>
          </article>
        ))}
        {items.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500"><Package className="mx-auto mb-3 size-8" aria-hidden="true" />Nenhum produto encontrado.</div>}
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Produtos prontos e seus saldos</caption>
          <thead>
            <tr className="bg-slate-50 text-left text-slate-600">
              <th scope="col" className="w-[38%] px-4 py-3">Produto</th>
              <th scope="col" className="px-4 py-4 text-right">Saldo físico</th>
              <th scope="col" className="px-4 py-3">Situação</th>
              <th scope="col" className="px-4 py-3">Ação</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.product_id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">
                  <Link className="inline-flex min-h-11 max-w-full items-center break-all font-medium text-modulus-primary hover:underline" href={productInventoryDetailHref(item.product_id, returnTo)}>
                    {item.product_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{item.balance.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">
                  {item.product_active ? "Ativo" : <span className="inline-flex items-center gap-1"><Archive className="size-4" aria-hidden="true" />Arquivado</span>}
                </td>
                <td className="px-4 py-3">
                  <Link href={productInventoryDetailHref(item.product_id, returnTo)} className="inline-flex min-h-11 max-w-full items-center break-all font-medium text-modulus-primary hover:underline">
                    Detalhes
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-slate-600">
                  <Package className="mx-auto mb-2 size-8" aria-hidden="true" />
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="Paginação do estoque" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-slate-600">{total.toLocaleString("pt-BR")} produto(s)</span>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {page <= 1 ? <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 text-slate-400">Anterior</span> : (
            <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-medium text-modulus-primary hover:bg-slate-50" href={href(Math.max(1, page - 1))}>Anterior</Link>
          )}
          <span className="px-2 py-2">Página {page} de {maxPage}</span>
          {page >= maxPage ? <span aria-disabled="true" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 text-slate-400">Próxima</span> : (
            <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 py-2 font-medium text-modulus-primary hover:bg-slate-50" href={href(Math.min(maxPage, page + 1))}>Próxima</Link>
          )}
        </div>
      </nav>
    </>
  );
}

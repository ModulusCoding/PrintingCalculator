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
      <div className="overflow-hidden rounded border bg-white">
        <table className="w-full text-sm">
          <caption className="sr-only">Produtos prontos e seus saldos</caption>
          <thead>
            <tr className="bg-slate-50 text-left text-slate-600">
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Ação</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.product_id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">
                  <Link className="text-indigo-700 hover:underline" href={productInventoryDetailHref(item.product_id, returnTo)}>
                    {item.product_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{item.balance.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">
                  {item.product_active ? "Ativo" : <span className="inline-flex items-center gap-1"><Archive className="size-4" aria-hidden="true" />Arquivado</span>}
                </td>
                <td className="px-4 py-3">
                  <Link href={productInventoryDetailHref(item.product_id, returnTo)} className="text-indigo-700 hover:underline">
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
      <nav aria-label="Paginação do estoque" className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{total.toLocaleString("pt-BR")} produto(s)</span>
        <div className="flex gap-2">
          <Link aria-disabled={page <= 1} className={`rounded border px-3 py-2 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={href(Math.max(1, page - 1))}>
            Anterior
          </Link>
          <span className="px-2 py-2">Página {page} de {maxPage}</span>
          <Link aria-disabled={page >= maxPage} className={`rounded border px-3 py-2 ${page >= maxPage ? "pointer-events-none opacity-50" : ""}`} href={href(Math.min(maxPage, page + 1))}>
            Próxima
          </Link>
        </div>
      </nav>
    </>
  );
}

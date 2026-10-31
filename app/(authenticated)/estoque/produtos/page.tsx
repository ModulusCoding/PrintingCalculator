import type { Metadata } from "next";
import Link from "next/link";
import { listProductInventory } from "@/lib/inventory/actions";
import { ProductInventoryTable } from "@/components/inventory/ProductInventoryTable";
import { ProductInventoryFilters } from "@/components/inventory/ProductInventoryFilters";
import { inventoryListPath, normalizeReturnTo, safePage } from "@/lib/inventory/navigation";

export const metadata: Metadata = { title: "Produtos prontos — Estoque" };

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidProductInventoryListPage(props: Parameters<typeof ProductInventoryListPage>[0]) {
  return renderPaidModule("inventory", "inventory.read", () => ProductInventoryListPage(props));
}

async function ProductInventoryListPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Repeated parameters are invalid, not a request to use the first value.
  const search = typeof params.search === "string" && params.search.length <= 120 ? params.search.trim() : "";
  const balanceFilter = typeof params.balanceFilter === "string" && ["all", "with_balance", "without_balance"].includes(params.balanceFilter) ? params.balanceFilter : "all";
  const productStatus = typeof params.productStatus === "string" && ["active", "archived", "all"].includes(params.productStatus) ? params.productStatus : "active";
  const page = safePage(params.page);
  const query = new URLSearchParams({ balanceFilter, productStatus, page: String(page) });
  if (search) query.set("search", search);
  const returnTo = normalizeReturnTo(`${inventoryListPath}?${query}`);
  const { items, total, error } = await listProductInventory({ search, balanceFilter, productStatus, page: String(page) });

  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Operação / Estoque</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Produtos prontos</h1>
          <span className="rounded-full bg-modulus-primary/10 px-3 py-1 text-xs font-semibold text-modulus-primary">Estoque físico</span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">Acompanhe o saldo físico de peças prontas por produto. Consulte detalhes para registrar movimentações e acompanhar o histórico.</p>
      </header>
      <div role="note" className="rounded-2xl border border-modulus-primary/15 bg-modulus-primary/5 px-5 py-4 text-sm leading-relaxed text-slate-700">
        <strong className="text-modulus-primary">Saldo físico não é disponibilidade para venda.</strong> Esta consulta não apresenta quantidades reservadas nem saldo disponível.
      </div>
      <ProductInventoryFilters key={`${search}:${balanceFilter}:${productStatus}`} search={search} balanceFilter={balanceFilter} productStatus={productStatus} />
      {error ? (
        <div role="alert" className="rounded border bg-red-50 p-4 text-sm text-red-700">
          {error === "permission_denied" ? "Você não tem permissão para listar o estoque."
            : error === "denied" ? "Seu acesso ao estoque está bloqueado."
            : error === "session_expired" ? <><span>Sua sessão expirou. </span><Link href="/admin/login" className="underline">Entre novamente</Link>.</>
            : "Falha técnica ao carregar a lista. Os saldos e a contagem estão indisponíveis, não foram substituídos por zero."}
          {!["permission_denied", "denied", "session_expired"].includes(error) && <p className="mt-2"><Link href={returnTo} className="underline">Tentar novamente</Link></p>}
        </div>
      ) : (
        <ProductInventoryTable items={items} total={total} page={page} search={search} balanceFilter={balanceFilter} productStatus={productStatus} returnTo={returnTo} />
      )}
    </section>
  );
}

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
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Produtos prontos</h1>
        <p className="mt-1 text-sm text-slate-600">Saldo de peças prontas por produto. Busca literal, filtros de saldo e situação do produto.</p>
      </header>
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

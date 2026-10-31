import { Search, SlidersHorizontal } from "lucide-react";

type ProductInventoryFiltersProps = {
  search: string;
  balanceFilter: string;
  productStatus: string;
};

export function ProductInventoryFilters({ search, balanceFilter, productStatus }: ProductInventoryFiltersProps) {
  const control = "mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-modulus-primary focus:ring-2 focus:ring-modulus-primary/15";
  return (
    <form method="get" action="/estoque/produtos" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:p-5">
      <label className="min-w-0 sm:col-span-2 lg:col-span-1">
        <span className="text-sm font-medium text-slate-700">Buscar por nome</span>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-5 size-4 text-slate-400" />
          <input name="search" defaultValue={search} maxLength={120} className={`${control} pl-10`} placeholder="Nome do produto" />
        </div>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Saldo físico</span>
        <select name="balanceFilter" defaultValue={balanceFilter} className={control}>
          <option value="all">Todos</option>
          <option value="with_balance">Com saldo</option>
          <option value="without_balance">Sem saldo</option>
        </select>
      </label>
      <label>
        <span className="text-sm font-medium text-slate-700">Produto</span>
        <select name="productStatus" defaultValue={productStatus} className={control}>
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </select>
      </label>
      <button className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-xl bg-modulus-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-modulus-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modulus-primary sm:col-span-2 lg:col-span-1"><SlidersHorizontal aria-hidden="true" className="size-4" />Filtrar</button>
    </form>
  );
}

type ProductInventoryFiltersProps = {
  search: string;
  balanceFilter: string;
  productStatus: string;
};

export function ProductInventoryFilters({
  search,
  balanceFilter,
  productStatus,
}: ProductInventoryFiltersProps) {
  return (
    <form method="get" action="/estoque/produtos" className="grid gap-3 rounded border bg-white p-4 sm:grid-cols-[1fr_180px_180px_auto]">
      <label>
        <span className="text-sm font-medium">Buscar por nome</span>
        <input name="search" defaultValue={search} maxLength={120} className="mt-1 w-full rounded border p-2" placeholder="Nome do produto" />
      </label>
      <label>
        <span className="text-sm font-medium">Saldo</span>
        <select name="balanceFilter" defaultValue={balanceFilter} className="mt-1 w-full rounded border p-2">
          <option value="all">Todos</option>
          <option value="with_balance">Com saldo</option>
          <option value="without_balance">Sem saldo</option>
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">Produto</span>
        <select name="productStatus" defaultValue={productStatus} className="mt-1 w-full rounded border p-2">
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </select>
      </label>
      <button className="self-end rounded bg-indigo-700 px-4 py-2 text-white">Filtrar</button>
    </form>
  );
}

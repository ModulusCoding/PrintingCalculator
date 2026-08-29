"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Edit,
  Eye,
  Filter,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  CANAL_ABORDAGEM_OPTIONS,
  CANAL_FECHAMENTO_OPTIONS,
  ClosedSale,
  ORDER_STATUS_VALUES,
  OrderStatus,
  STATUS_CONFIG,
  TIPO_PRODUTO_OPTIONS,
} from "@/types/sales";
import { SaleDetailModal } from "@/components/admin/SaleDetailModal";
import { SaleFormModal } from "@/components/admin/SaleFormModal";
import { DeleteSaleModal } from "@/components/admin/DeleteSaleModal";
import { formatCurrency } from "@/utils/currency";

type ColumnKey =
  | "display_id"
  | "cliente_nome"
  | "produto"
  | "preco_venda"
  | "lucro"
  | "status"
  | "data_fechamento";

type SortDirection = "asc" | "desc";

interface SalesListClientProps {
  initialSales: ClosedSale[];
  initialError: string | null;
}

interface SortHeaderProps {
  column: ColumnKey;
  label: string;
  className?: string;
  columnSort: { key: ColumnKey; direction: SortDirection } | null;
  onSort: (column: ColumnKey) => void;
}

function SortHeader({
  column,
  label,
  className = "",
  columnSort,
  onSort,
}: SortHeaderProps) {
  const active = columnSort?.key === column;
  const Icon = active
    ? columnSort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      className={`px-6 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 ${
            active ? "text-blue-600 dark:text-blue-400" : ""
          }`}
        />
      </button>
    </th>
  );
}

export function SalesListClient({
  initialSales,
  initialError,
}: SalesListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [cliente, setCliente] = useState(searchParams.get("cliente") || "");
  const [tipoProduto, setTipoProduto] = useState(
    searchParams.get("tipo_produto") || ""
  );
  const [canalAbordagem, setCanalAbordagem] = useState(
    searchParams.get("canal_abordagem") || ""
  );
  const [canalFechamento, setCanalFechamento] = useState(
    searchParams.get("canal_fechamento") || ""
  );
  const [selectedStatuses, setSelectedStatuses] = useState<OrderStatus[]>(
    () => {
      const values = searchParams.get("status")?.split(",") || [];
      return values.filter((value): value is OrderStatus =>
        ORDER_STATUS_VALUES.includes(value as OrderStatus)
      );
    }
  );
  const [sort, setSort] = useState(searchParams.get("sort") || "recent");

  const [columnSort, setColumnSort] = useState<{
    key: ColumnKey;
    direction: SortDirection;
  } | null>(null);

  const [selectedSaleDetail, setSelectedSaleDetail] =
    useState<ClosedSale | null>(null);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<ClosedSale | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<{
    id: string;
    customer: string;
  } | null>(null);

  const [, startTransition] = useTransition();

  const updateFilters = (
    next: Partial<{
      search: string;
      cliente: string;
      tipoProduto: string;
      canalAbordagem: string;
      canalFechamento: string;
      statuses: OrderStatus[];
      sort: string;
    }>
  ) => {
    const values = {
      search,
      cliente,
      tipoProduto,
      canalAbordagem,
      canalFechamento,
      statuses: selectedStatuses,
      sort,
      ...next,
    };

    const params = new URLSearchParams();

    if (values.search.trim()) params.set("search", values.search.trim());
    if (values.cliente.trim()) params.set("cliente", values.cliente.trim());
    if (values.tipoProduto) params.set("tipo_produto", values.tipoProduto);
    if (values.canalAbordagem)
      params.set("canal_abordagem", values.canalAbordagem);
    if (values.canalFechamento)
      params.set("canal_fechamento", values.canalFechamento);
    if (values.statuses.length)
      params.set("status", values.statuses.join(","));
    if (values.sort !== "recent") params.set("sort", values.sort);

    const query = params.toString();
    startTransition(() =>
      router.push(query ? `/admin/sales?${query}` : "/admin/sales")
    );
  };

  const setFilter = <
    K extends
      | "search"
      | "cliente"
      | "tipoProduto"
      | "canalAbordagem"
      | "canalFechamento"
      | "sort"
  >(
    key: K,
    value: string
  ) => {
    const setters = {
      search: setSearch,
      cliente: setCliente,
      tipoProduto: setTipoProduto,
      canalAbordagem: setCanalAbordagem,
      canalFechamento: setCanalFechamento,
      sort: setSort,
    };
    setters[key](value);
    updateFilters({ [key]: value });
  };

  const toggleStatus = (status: OrderStatus) => {
    const next = selectedStatuses.includes(status)
      ? selectedStatuses.filter((value) => value !== status)
      : [...selectedStatuses, status];
    setSelectedStatuses(next);
    updateFilters({ statuses: next });
  };

  const clearFilters = () => {
    setSearch("");
    setCliente("");
    setTipoProduto("");
    setCanalAbordagem("");
    setCanalFechamento("");
    setSelectedStatuses([]);
    setSort("recent");
    startTransition(() => router.push("/admin/sales"));
  };

  const activeFilters = [
    search.trim() && {
      label: `Busca: ${search.trim()}`,
      remove: () => setFilter("search", ""),
    },
    cliente.trim() && {
      label: `Cliente: ${cliente.trim()}`,
      remove: () => setFilter("cliente", ""),
    },
    tipoProduto && {
      label: `Produto: ${tipoProduto}`,
      remove: () => setFilter("tipoProduto", ""),
    },
    canalAbordagem && {
      label: `Canal de abordagem: ${canalAbordagem}`,
      remove: () => setFilter("canalAbordagem", ""),
    },
    canalFechamento && {
      label: `Canal de fechamento: ${canalFechamento}`,
      remove: () => setFilter("canalFechamento", ""),
    },
    ...selectedStatuses.map((status) => ({
      label: `Status: ${STATUS_CONFIG[status].label}`,
      remove: () => toggleStatus(status),
    })),
    sort !== "recent" && {
      label: `Ordenação: ${
        sort === "oldest"
          ? "Mais antigas"
          : sort === "highest_value"
          ? "Maior valor"
          : "Menor valor"
      }`,
      remove: () => setFilter("sort", "recent"),
    },
  ].filter(Boolean) as { label: string; remove: () => void }[];

  const sortedSales = useMemo(() => {
    if (!columnSort) return initialSales;

    const compareNullableNumbers = (
      left: number | null,
      right: number | null
    ) => {
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    };

    return [...initialSales].sort((left, right) => {
      let comparison = 0;

      switch (columnSort.key) {
        case "display_id":
          comparison = compareNullableNumbers(
            left.display_id ?? null,
            right.display_id ?? null
          );
          break;
        case "preco_venda":
          comparison = compareNullableNumbers(
            left.preco_venda,
            right.preco_venda
          );
          break;
        case "lucro":
          comparison = compareNullableNumbers(left.lucro, right.lucro);
          break;
        case "data_fechamento":
          comparison = left.data_fechamento.localeCompare(
            right.data_fechamento
          );
          break;
        case "status":
          comparison = STATUS_CONFIG[left.status].label.localeCompare(
            STATUS_CONFIG[right.status].label,
            "pt-BR"
          );
          break;
        default:
          comparison = left[columnSort.key].localeCompare(
            right[columnSort.key],
            "pt-BR",
            { sensitivity: "base" }
          );
      }

      return columnSort.direction === "asc" ? comparison : -comparison;
    });
  }, [columnSort, initialSales]);

  const toggleColumnSort = (key: ColumnKey) => {
    setColumnSort((current) =>
      current?.key === key && current.direction === "asc"
        ? { key, direction: "desc" }
        : { key, direction: "asc" }
    );
  };

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-");
    return year && month && day ? `${day}/${month}/${year}` : dateStr;
  };

  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Administração
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Acompanhamento dos pedidos registrados da Modulus.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingSale(null);
            setFormModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-md shadow-blue-600/20"
        >
          <Plus className="h-4 w-4" />
          Registrar Pedido
        </button>
      </div>

      {initialError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          {initialError}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder="Buscar cliente ou produto..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <input
            type="text"
            value={cliente}
            onChange={(event) => setFilter("cliente", event.target.value)}
            placeholder="Filtrar por cliente"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <select
            value={tipoProduto}
            onChange={(event) => setFilter("tipoProduto", event.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Todos os produtos</option>
            {TIPO_PRODUTO_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setFilter("sort", event.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="highest_value">Maior valor</option>
            <option value="lowest_value">Menor valor</option>
          </select>
          <select
            value={canalAbordagem}
            onChange={(event) =>
              setFilter("canalAbordagem", event.target.value)
            }
            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Canal de abordagem</option>
            {CANAL_ABORDAGEM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={canalFechamento}
            onChange={(event) =>
              setFilter("canalFechamento", event.target.value)
            }
            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Canal de fechamento</option>
            {CANAL_FECHAMENTO_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Status
            </p>
            <div className="flex flex-wrap gap-2">
              {ORDER_STATUS_VALUES.map((status) => {
                const statusInfo = STATUS_CONFIG[status];
                const isSelected = selectedStatuses.includes(status);

                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleStatus(status)}
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? statusInfo.badgeClass
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {statusInfo.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Filter className="h-3.5 w-3.5" />
                Filtros ativos
              </span>
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                <X className="h-3.5 w-3.5" />
                Limpar filtros
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {activeFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.label}
                  onClick={filter.remove}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {filter.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {initialSales.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-12 text-center bg-white dark:bg-slate-900/50">
          <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center mb-4">
            <TrendingUp className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {hasActiveFilters
              ? "Nenhum pedido encontrado com os filtros atuais."
              : "Nenhum pedido registrado."}
          </h3>
          <div className="mt-4">
            {hasActiveFilters ? (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Limpar filtros
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditingSale(null);
                  setFormModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Registrar Pedido
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                  <SortHeader
                    column="display_id"
                    label="ID"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="cliente_nome"
                    label="Cliente"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="produto"
                    label="Produto"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="preco_venda"
                    label="Preço"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="lucro"
                    label="Lucro"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="status"
                    label="Status"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <SortHeader
                    column="data_fechamento"
                    label="Data"
                    columnSort={columnSort}
                    onSort={toggleColumnSort}
                  />
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sortedSales.map((sale) => {
                  const statusInfo =
                    STATUS_CONFIG[sale.status] || STATUS_CONFIG.em_conversao;
                  return (
                    <tr
                      key={sale.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedSaleDetail(sale)}
                    >
                      <td className="px-6 py-4 text-sm font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {sale.display_id ? `#${sale.display_id}` : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-sm text-slate-900 dark:text-white">
                          {sale.cliente_nome}
                        </p>
                        {sale.cliente_telefone && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {sale.cliente_telefone}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <p className="text-sm text-slate-900 dark:text-white truncate">
                          {sale.produto}
                        </p>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {sale.tipo_produto}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                        {sale.preco_venda !== null
                          ? formatCurrency(sale.preco_venda)
                          : "—"}
                      </td>
                      <td
                        className={`px-6 py-4 text-sm font-semibold tabular-nums ${
                          sale.lucro === null
                            ? "text-slate-400"
                            : sale.lucro >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {sale.lucro !== null
                          ? formatCurrency(sale.lucro)
                          : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${statusInfo.badgeClass}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400 tabular-nums">
                        {formatDate(sale.data_fechamento)}
                      </td>
                      <td
                        className="px-6 py-4 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedSaleDetail(sale)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingSale(sale);
                              setFormModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Editar"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setSaleToDelete({
                                id: sale.id,
                                customer: sale.cliente_nome,
                              });
                              setDeleteModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SaleDetailModal
        sale={selectedSaleDetail}
        onClose={() => setSelectedSaleDetail(null)}
        onEdit={(sale) => {
          setEditingSale(sale);
          setFormModalOpen(true);
        }}
        onDelete={(id, customer) => {
          setSelectedSaleDetail(null);
          setSaleToDelete({ id, customer });
          setDeleteModalOpen(true);
        }}
      />
      <SaleFormModal
        key={editingSale?.id ?? "new"}
        sale={editingSale}
        isOpen={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingSale(null);
        }}
        onSuccess={() => router.refresh()}
      />
      <DeleteSaleModal
        saleId={saleToDelete?.id || null}
        saleCustomer={saleToDelete?.customer || null}
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSaleToDelete(null);
        }}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}

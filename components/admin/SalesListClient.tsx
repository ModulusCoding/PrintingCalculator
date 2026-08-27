"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  Eye,
  Edit,
  Trash2,
  TrendingUp,
  Filter,
  X,
} from "lucide-react";
import {
  ClosedSale,
  TIPO_PRODUTO_OPTIONS,
  CANAL_ABORDAGEM_OPTIONS,
  CANAL_FECHAMENTO_OPTIONS,
} from "@/types/sales";
import { SaleDetailModal } from "@/components/admin/SaleDetailModal";
import { SaleFormModal } from "@/components/admin/SaleFormModal";
import { DeleteSaleModal } from "@/components/admin/DeleteSaleModal";

interface SalesListClientProps {
  initialSales: ClosedSale[];
  initialError: string | null;
}

export function SalesListClient({
  initialSales,
  initialError,
}: SalesListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search & Filter local states
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [tipoProduto, setTipoProduto] = useState(
    searchParams.get("tipo_produto") || ""
  );
  const [canalAbordagem, setCanalAbordagem] = useState(
    searchParams.get("canal_abordagem") || ""
  );
  const [canalFechamento, setCanalFechamento] = useState(
    searchParams.get("canal_fechamento") || ""
  );
  const [sort, setSort] = useState(searchParams.get("sort") || "recent");

  // Modals state
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

  const applyFilters = (newFilters: {
    search?: string;
    tipo_produto?: string;
    canal_abordagem?: string;
    canal_fechamento?: string;
    sort?: string;
  }) => {
    const params = new URLSearchParams();
    const activeSearch =
      newFilters.search !== undefined ? newFilters.search : search;
    const activeTipo =
      newFilters.tipo_produto !== undefined
        ? newFilters.tipo_produto
        : tipoProduto;
    const activeAbordagem =
      newFilters.canal_abordagem !== undefined
        ? newFilters.canal_abordagem
        : canalAbordagem;
    const activeFechamento =
      newFilters.canal_fechamento !== undefined
        ? newFilters.canal_fechamento
        : canalFechamento;
    const activeSort = newFilters.sort !== undefined ? newFilters.sort : sort;

    if (activeSearch.trim()) params.set("search", activeSearch.trim());
    if (activeTipo) params.set("tipo_produto", activeTipo);
    if (activeAbordagem) params.set("canal_abordagem", activeAbordagem);
    if (activeFechamento) params.set("canal_fechamento", activeFechamento);
    if (activeSort && activeSort !== "recent") params.set("sort", activeSort);

    startTransition(() => {
      router.push(`/admin/sales?${params.toString()}`);
    });
  };

  const clearFilters = () => {
    setSearch("");
    setTipoProduto("");
    setCanalAbordagem("");
    setCanalFechamento("");
    setSort("recent");
    startTransition(() => {
      router.push("/admin/sales");
    });
  };

  const hasActiveFilters =
    search.trim() !== "" ||
    tipoProduto !== "" ||
    canalAbordagem !== "" ||
    canalFechamento !== "" ||
    sort !== "recent";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    return dateStr;
  };

  const handleRefresh = () => {
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Administração
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Vendas Fechadas
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Histórico comercial e registro de vendas concluídas da Modulus.
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
          Registrar Venda
        </button>
      </div>

      {initialError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          {initialError}
        </div>
      )}

      {/* Search and Filters Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                applyFilters({ search: e.target.value });
              }}
              placeholder="Buscar cliente ou produto..."
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Tipo de Produto */}
          <div>
            <select
              value={tipoProduto}
              onChange={(e) => {
                setTipoProduto(e.target.value);
                applyFilters({ tipo_produto: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Todos os tipos</option>
              {TIPO_PRODUTO_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Canal Abordagem */}
          <div>
            <select
              value={canalAbordagem}
              onChange={(e) => {
                setCanalAbordagem(e.target.value);
                applyFilters({ canal_abordagem: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Canal de abordagem</option>
              {CANAL_ABORDAGEM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={canalFechamento}
              onChange={(e) => {
                setCanalFechamento(e.target.value);
                applyFilters({ canal_fechamento: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Canal de fechamento</option>
              {CANAL_FECHAMENTO_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Ordenação */}
          <div>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                applyFilters({ sort: e.target.value });
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              <option value="highest_value">Maior valor</option>
              <option value="lowest_value">Menor valor</option>
            </select>
          </div>
        </div>

        {/* Filter details and clear action */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Filter className="h-3.5 w-3.5" />
              Filtros ativos
            </span>
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Table Section */}
      {initialSales.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-12 text-center bg-white dark:bg-slate-900/50">
          <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center mb-4">
            <TrendingUp className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Nenhuma venda registrada
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {hasActiveFilters
              ? "Nenhum resultado corresponde aos filtros selecionados."
              : "Registre sua primeira venda fechada para iniciar o histórico."}
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {hasActiveFilters ? (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Limpar Filtros
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditingSale(null);
                  setFormModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Registrar Venda
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            {/* Strict 5-Column Table: Cliente | Produto | Valor | Data | Canal */}
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Cliente
                  </th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Produto
                  </th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Valor
                  </th>
                  <th className="px-6 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Data
                  </th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Canal / Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {initialSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group cursor-pointer"
                    onClick={() => setSelectedSaleDetail(sale)}
                  >
                    {/* 1. Cliente */}
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

                    {/* 2. Produto */}
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-sm text-slate-900 dark:text-white truncate">
                        {sale.produto}
                      </p>
                      <span className="inline-block mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {sale.tipo_produto}
                      </span>
                    </td>

                    {/* 3. Valor */}
                    <td className="px-6 py-4 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                      {formatCurrency(sale.preco_venda)}
                    </td>

                    {/* 4. Data */}
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400 tabular-nums">
                      {formatDate(sale.data_fechamento)}
                    </td>

                    {/* 5. Canal + Ações */}
                    <td
                      className="px-6 py-4 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {sale.canal_fechamento}
                        </span>

                        <button
                          onClick={() => setSelectedSaleDetail(sale)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Ver Detalhes"
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sale Detail Modal */}
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

      {/* Create / Edit Form Modal */}
      <SaleFormModal
        sale={editingSale}
        isOpen={formModalOpen}
        onClose={() => {
          setFormModalOpen(false);
          setEditingSale(null);
        }}
        onSuccess={handleRefresh}
      />

      {/* Delete Confirmation Modal */}
      <DeleteSaleModal
        saleId={saleToDelete?.id || null}
        saleCustomer={saleToDelete?.customer || null}
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setSaleToDelete(null);
        }}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { X, Check, Loader2, Search, Package, ChevronLeft, ChevronRight } from "lucide-react";
import { getFilterProductIds, getProductsForFilterModal, syncFilterProductsAction } from "@/lib/filters/actions";

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  price: number | null;
  image_url: string | null;
  active: boolean;
}

interface FilterProductsModalProps {
  filterId: string;
  filterName: string;
  catalogId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const PAGE_SIZE = 20;

export function FilterProductsModal({ filterId, filterName, catalogId, isOpen, onClose, onSaved }: FilterProductsModalProps) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [productsRes, selectedRes] = await Promise.all([
        getProductsForFilterModal(catalogId, { search: debouncedSearch, page, pageSize: PAGE_SIZE }),
        getFilterProductIds(filterId),
      ]);
      if (productsRes.error) setError(productsRes.error);
      else {
        setProducts((productsRes.products as ProductRow[]) || []);
        setTotal(productsRes.total ?? 0);
        setTotalPages(productsRes.totalPages ?? 1);
      }
      if (selectedRes.error) setError(selectedRes.error);
      else setSelectedIds(selectedRes.productIds || []);
    } catch {
      setError("Erro inesperado ao carregar dados.");
    } finally {
      setIsLoading(false);
    }
  }, [catalogId, filterId, debouncedSearch, page]);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setDebouncedSearch("");
      setPage(1);
      setSuccess(false);
      setError(null);
    }
  }, [isOpen]);

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSave = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await syncFilterProductsAction(filterId, selectedIds);
      if (res.error) setError(res.error);
      else {
        setSuccess(true);
        onSaved?.();
        setTimeout(() => onClose(), 800);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="filter-products-title">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} aria-hidden="true" />
        <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 id="filter-products-title" className="text-lg font-bold text-slate-900 dark:text-white">Produtos do filtro: {filterName}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{total} produto(s) no catálogo · página {page} de {totalPages} · {selectedIds.length} associado(s) ao filtro</p>
            </div>
            <button type="button" onClick={onClose} disabled={isSaving} className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50" aria-label="Fechar modal">
              <X className="h-5 w-5" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Buscar produtos..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" />
                </div>
              </div>

              <div className="max-h-[50vh] overflow-y-auto">
                {products.length === 0 ? (
                  <div className="p-12 text-center">
                    <Package className="h-12 w-12 mx-auto text-slate-400 dark:text-slate-600 mb-4" />
                    <p className="text-slate-500 dark:text-slate-400">{searchQuery ? "Nenhum produto encontrado com esse termo." : total === 0 ? "Nenhum produto neste catálogo. Adicione produtos ao catálogo primeiro." : "Nenhum resultado."}</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {products.map((product) => {
                      const isSelected = selectedIds.includes(product.id);
                      return (
                        <li key={product.id}>
                          <button type="button" onClick={() => toggleProduct(product.id)} className={`w-full flex items-center gap-3 p-4 text-left transition-all ${isSelected ? "bg-blue-50/50 dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                            {product.image_url ? <img src={product.image_url} alt={product.name} className="h-12 w-12 rounded-lg object-cover bg-slate-200 dark:bg-slate-800 shrink-0" /> : <div className="h-12 w-12 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0"><Package className="h-6 w-6 text-slate-400" /></div>}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-slate-900 dark:text-white truncate">{product.name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{product.price != null ? `R$ ${product.price.toFixed(2).replace(".", ",")}` : "Sob consulta"}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">{isSelected ? <Check className="h-5 w-5 text-blue-600 shrink-0" /> : <div className="h-5 w-5 rounded-lg border-2 border-slate-300 dark:border-slate-600 shrink-0" />}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 p-3 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedIds.length} selecionado(s) neste filtro</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400 min-w-[70px] text-center">{page} / {totalPages}</span>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>

              {error && <div className="p-4 bg-red-50 dark:bg-red-950/50 border-t border-red-200 dark:border-red-900"><p className="text-sm text-red-700 dark:text-red-400">{error}</p></div>}

              <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 shadow-md shadow-blue-600/20 disabled:opacity-50">
                  {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : success ? <><Check className="h-4 w-4" /> Salvo!</> : "Salvar alterações"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

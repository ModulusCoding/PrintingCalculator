"use client";

import { useEffect, useState, useTransition } from "react";
import { GripVertical, Pencil, Trash2, Plus, Package, Loader2, AlertCircle, Check, ArrowUp, ArrowDown } from "lucide-react";
import { getFiltersByCatalog, reorderFiltersAction, deleteFilterAction } from "@/lib/filters/actions";
import type { CatalogFilter } from "@/types/catalog";
import { FilterFormModal } from "./FilterFormModal";
import { FilterProductsModal } from "./FilterProductsModal";

interface CatalogFilterManagerProps {
  catalogId: string;
}

export function CatalogFilterManager({ catalogId }: CatalogFilterManagerProps) {
  const [filters, setFilters] = useState<CatalogFilter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<CatalogFilter | null>(null);
  const [productsModalFilter, setProductsModalFilter] = useState<CatalogFilter | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CatalogFilter | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const loadFilters = async () => {
    setIsLoading(true);
    setError(null);
    const res = await getFiltersByCatalog(catalogId);
    if (res.error) setError(res.error);
    else setFilters(res.filters as CatalogFilter[]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadFilters();
  }, [catalogId]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const next = [...filters];
    const dragged = next[draggedIndex];
    next.splice(draggedIndex, 1);
    next.splice(index, 0, dragged);
    setDraggedIndex(index);
    setFilters(next);
    setSavedSuccess(false);
  };

  const handleDragEnd = () => setDraggedIndex(null);

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...filters];
    const tmp = next[index];
    next[index] = next[index - 1];
    next[index - 1] = tmp;
    setFilters(next);
    setSavedSuccess(false);
  };

  const moveDown = (index: number) => {
    if (index === filters.length - 1) return;
    const next = [...filters];
    const tmp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = tmp;
    setFilters(next);
    setSavedSuccess(false);
  };

  const handleSaveOrder = () => {
    setError(null);
    setSavedSuccess(false);
    startTransition(async () => {
      const res = await reorderFiltersAction(catalogId, filters.map((f) => f.id));
      if (res.error) setError(res.error);
      else {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    });
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeletePending(true);
    const res = await deleteFilterAction(deleteConfirm.id);
    setDeletePending(false);
    if (res.error) setError(res.error);
    else {
      setDeleteConfirm(null);
      loadFilters();
    }
  };

  const openCreate = () => {
    setEditingFilter(null);
    setFormOpen(true);
  };

  const openEdit = (f: CatalogFilter) => {
    setEditingFilter(f);
    setFormOpen(true);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-8 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Filtros do Catálogo</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Gerencie os filtros e a ordem de exibição na página pública. Arraste para reordenar.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold text-xs shadow-md shadow-blue-600/20">
            <Plus className="h-3.5 w-3.5" /> Criar filtro
          </button>
          {filters.length > 1 && (
            <button type="button" onClick={handleSaveOrder} disabled={isPending} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-xs disabled:opacity-50">
              {isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando...</> : savedSuccess ? <><Check className="h-3.5 w-3.5" /> Ordem salva!</> : "Salvar ordem"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {filters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum filtro criado neste catálogo.</p>
          <p className="text-xs text-slate-400">Crie filtros como Gamer, Esotérico, Utilidade e associe produtos a cada um.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filters.map((filter, index) => {
            const isDragging = draggedIndex === index;
            return (
              <div
                key={filter.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${isDragging ? "opacity-50 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 scale-[0.99]" : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700"}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title="Arraste para reordenar">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <span className="w-6 text-center text-xs font-mono font-bold text-slate-400">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{filter.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">/{filter.slug} · {filter.description || "Sem descrição"} · {filter.product_count ?? 0} produto(s)</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => moveUp(index)} disabled={index === 0} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30" title="Mover para cima"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => moveDown(index)} disabled={index === filters.length - 1} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30" title="Mover para baixo"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setProductsModalFilter(filter)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" title="Gerenciar produtos deste filtro">
                    <Package className="h-3.5 w-3.5" /> Produtos
                  </button>
                  <button type="button" onClick={() => openEdit(filter)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800" title="Editar filtro"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setDeleteConfirm(filter)} className="p-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50" title="Excluir filtro"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FilterFormModal
        catalogId={catalogId}
        filter={editingFilter}
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={loadFilters}
      />

      {productsModalFilter && (
        <FilterProductsModal
          filterId={productsModalFilter.id}
          filterName={productsModalFilter.name}
          catalogId={catalogId}
          isOpen={!!productsModalFilter}
          onClose={() => setProductsModalFilter(null)}
          onSaved={loadFilters}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => !deletePending && setDeleteConfirm(null)} aria-hidden="true" />
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Excluir filtro?</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <strong>{deleteConfirm.name}</strong> possui <strong>{deleteConfirm.product_count ?? 0} produto(s)</strong> associado(s). Ao continuar, as associações serão removidas. Os produtos e o catálogo serão preservados.
              </p>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setDeleteConfirm(null)} disabled={deletePending} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={handleDelete} disabled={deletePending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white hover:bg-red-700 text-sm font-semibold disabled:opacity-50">
                  {deletePending ? <><Loader2 className="h-4 w-4 animate-spin" /> Excluindo...</> : "Excluir filtro"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

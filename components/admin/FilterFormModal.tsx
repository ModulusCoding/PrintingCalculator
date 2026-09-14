"use client";

import { useState, useTransition, useEffect } from "react";
import { X, Loader2, Save, AlertCircle } from "lucide-react";
import { createFilterAction, updateFilterAction } from "@/lib/filters/actions";
import type { CatalogFilter } from "@/types/catalog";

interface FilterFormModalProps {
  catalogId: string;
  filter?: CatalogFilter | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function FilterFormModal({ catalogId, filter, isOpen, onClose, onSuccess }: FilterFormModalProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(filter?.name || "");
  const [slug, setSlug] = useState(filter?.slug || "");
  const [isSlugAuto, setIsSlugAuto] = useState(!filter);
  const [description, setDescription] = useState(filter?.description || "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(filter?.name || "");
      setSlug(filter?.slug || "");
      setIsSlugAuto(!filter);
      setDescription(filter?.description || "");
      setError(null);
    }
  }, [isOpen, filter]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (isSlugAuto) {
      const generated = val.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
      setSlug(generated);
    }
  };

  const handleSlugChange = (val: string) => {
    setIsSlugAuto(false);
    setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload = { name, slug, description: description || null };
    startTransition(async () => {
      const res = filter ? await updateFilterAction(filter.id, payload) : await createFilterAction(catalogId, payload);
      if (res.error) setError(res.error);
      else {
        onSuccess();
        onClose();
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
        <form onSubmit={handleSubmit} className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{filter ? "Editar filtro" : "Novo filtro"}</h2>
            <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome *</label>
              <input type="text" required value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="ex: Gamer" className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Slug *</label>
              <input type="text" required value={slug} onChange={(e) => handleSlugChange(e.target.value)} placeholder="gamer" className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono" />
              <p className="mt-1 text-xs text-slate-500">URL: <span className="font-mono text-blue-600">?filtros={slug || "exemplo"}</span></p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional..." className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={isPending} className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-sm font-semibold disabled:opacity-50">
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4" /> {filter ? "Salvar" : "Criar filtro"}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

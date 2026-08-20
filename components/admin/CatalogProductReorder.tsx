"use client";

import { useState, useTransition } from "react";
import { reorderCatalogProductsAction } from "@/lib/catalogs/actions";
import { GripVertical, Check, AlertCircle, Loader2, ArrowUp, ArrowDown } from "lucide-react";

export interface ReorderableProduct {
  id: string;
  name: string;
  slug: string;
  image_url?: string | null;
  category?: string | null;
  price?: number | null;
}

interface CatalogProductReorderProps {
  catalogId: string;
  initialProducts: ReorderableProduct[];
}

export function CatalogProductReorder({
  catalogId,
  initialProducts,
}: CatalogProductReorderProps) {
  const [products, setProducts] = useState<ReorderableProduct[]>(initialProducts);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set a subtle ghost style or transfer data
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newProducts = [...products];
    const draggedItem = newProducts[draggedIndex];
    newProducts.splice(draggedIndex, 1);
    newProducts.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    setProducts(newProducts);
    setSavedSuccess(false);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newProducts = [...products];
    const item = newProducts[index];
    newProducts[index] = newProducts[index - 1];
    newProducts[index - 1] = item;
    setProducts(newProducts);
    setSavedSuccess(false);
  };

  const moveDown = (index: number) => {
    if (index === products.length - 1) return;
    const newProducts = [...products];
    const item = newProducts[index];
    newProducts[index] = newProducts[index + 1];
    newProducts[index + 1] = item;
    setProducts(newProducts);
    setSavedSuccess(false);
  };

  const handleSaveOrder = () => {
    setError(null);
    setSavedSuccess(false);

    startTransition(async () => {
      const productIds = products.map((p) => p.id);
      const res = await reorderCatalogProductsAction(catalogId, productIds);

      if (res.error) {
        setError(res.error);
      } else {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    });
  };

  if (!products.length) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhum produto associado a este catálogo. Associe produtos editando-os na seção de Produtos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 md:p-8 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Ordem dos Produtos no Catálogo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Arraste e solte para definir a ordem em que os produtos aparecem no catálogo público (Destaques).
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveOrder}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold text-xs transition-colors shadow-md shadow-blue-600/20 disabled:opacity-50 shrink-0 self-start sm:self-auto"
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Salvando Ordem...
            </>
          ) : savedSuccess ? (
            <>
              <Check className="h-3.5 w-3.5 text-white" />
              Ordem Salva!
            </>
          ) : (
            "Salvar Ordenação"
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {products.map((product, index) => {
          const isDragging = draggedIndex === index;
          return (
            <div
              key={product.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center justify-between gap-4 p-3 rounded-xl border transition-all select-none ${
                isDragging
                  ? "opacity-50 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 scale-[0.99]"
                  : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Segure e arraste para reordenar"
                >
                  <GripVertical className="h-5 w-5" />
                </div>

                <span className="w-6 text-center text-xs font-mono font-bold text-slate-400">
                  {index + 1}
                </span>

                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-10 w-10 rounded-lg object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-slate-500">
                      {product.name.charAt(0)}
                    </span>
                  </div>
                )}

                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                    {product.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                    {product.category || "Sem categoria"} · {product.price ? `R$ ${product.price.toFixed(2)}` : "Sob consulta"}
                  </p>
                </div>
              </div>

              {/* Botões de acessibilidade para subir/descer */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Mover para cima"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(index)}
                  disabled={index === products.length - 1}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30"
                  title="Mover para baixo"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

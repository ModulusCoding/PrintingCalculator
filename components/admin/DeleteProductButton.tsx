"use client";

import { useState, useTransition } from "react";
import { deleteProductAction } from "@/lib/products/actions";
import { Trash2, X, Loader2 } from "lucide-react";

export function DeleteProductButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteProductAction(productId);
      if (res.error) {
        alert(res.error);
      }
      setConfirming(false);
    });
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
          title={`Confirmar exclusão de ${productName}`}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Excluir
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Cancelar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-900 transition-colors"
      title="Excluir Produto"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

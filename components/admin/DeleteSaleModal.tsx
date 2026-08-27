"use client";

import { useState, useTransition } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { deleteSaleAction } from "@/lib/sales/actions";

interface DeleteSaleModalProps {
  saleId: string | null;
  saleCustomer: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteSaleModal({
  saleId,
  saleCustomer,
  isOpen,
  onClose,
  onSuccess,
}: DeleteSaleModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !saleId) return null;

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteSaleAction(saleId);
      if (result.error) {
        setError(result.error);
      } else {
        onSuccess();
        onClose();
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-sale-title"
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-6 overflow-hidden space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h3 id="delete-sale-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Excluir Venda
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Esta ação é definitiva e não poderá ser desfeita.
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300">
          Tem certeza que deseja excluir o registro de venda de{" "}
          <strong className="text-slate-900 dark:text-white font-semibold">
            {saleCustomer || "este cliente"}
          </strong>
          ?
        </p>

        {error && (
          <div className="p-3 text-xs text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 text-sm font-semibold transition-colors shadow-md shadow-red-600/20 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Confirmar Exclusão
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
"use client";

import { X, Edit, Trash2 } from "lucide-react";
import { ClosedSale } from "@/types/sales";
import { formatCurrency } from "@/utils/currency";
import { formatPhone } from "@/utils/phone";

interface SaleDetailModalProps {
  sale: ClosedSale | null;
  onClose: () => void;
  onEdit: (sale: ClosedSale) => void;
  onDelete: (id: string, name: string) => void;
}

export function SaleDetailModal({
  sale,
  onClose,
  onEdit,
  onDelete,
}: SaleDetailModalProps) {
  if (!sale) return null;

  const formatDate = (dateStr: string) => {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    return dateStr;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-detail-title"
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="sale-detail-title" className="text-xl font-bold text-slate-900 dark:text-white">
            Detalhes da Venda
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cliente */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Cliente
              </label>
              <p className="text-slate-900 dark:text-white">{sale.cliente_nome}</p>
            </div>

            {/* Telefone */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Telefone
              </label>
              <p className="text-slate-900 dark:text-white">
                {sale.cliente_telefone
                  ? formatPhone(sale.cliente_telefone)
                  : "Não informado"}
              </p>
            </div>

            {/* Produto */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Produto
              </label>
              <p className="text-slate-900 dark:text-white">{sale.produto}</p>
            </div>

            {/* Tipo de Produto */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Tipo de Produto
              </label>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400 border border-violet-100 dark:border-violet-900"
              >
                {sale.tipo_produto}
              </span>
            </div>

            {/* Preço de Venda */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Preço de Venda
              </label>
              <p className="text-lg font-bold text-slate-900 dark:text-white">
                {formatCurrency(sale.preco_venda)}
              </p>
            </div>

            {/* Custo */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Custo
              </label>
              <p className="text-slate-900 dark:text-white">
                {formatCurrency(sale.custo)}
              </p>
            </div>

            {/* Lucro */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Lucro
              </label>
              <p
                className={`text-lg font-bold ${
                  sale.lucro >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {formatCurrency(sale.lucro)}
              </p>
            </div>

            {/* Data de Fechamento */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Data de Fechamento
              </label>
              <p className="text-slate-900 dark:text-white">
                {formatDate(sale.data_fechamento)}
              </p>
            </div>

            {/* Canal de Abordagem */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Canal de Abordagem
              </label>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900"
              >
                {sale.canal_abordagem}
              </span>
            </div>

            {/* Canal de Fechamento */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Canal de Fechamento
              </label>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900"
              >
                {sale.canal_fechamento}
              </span>
            </div>

            {/* Forma de Pagamento */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Forma de Pagamento
              </label>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900"
              >
                {sale.forma_pagamento}
              </span>
            </div>

            {/* Detalhes */}
            {sale.detalhes && (
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Detalhes
                </label>
                <p className="text-slate-900 dark:text-white whitespace-pre-wrap">
                  {sale.detalhes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={() => onDelete(sale.id, sale.cliente_nome)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 font-medium text-sm transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Excluir
          </button>
          <button
            onClick={() => {
              onEdit(sale);
              onClose();
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold text-sm transition-colors shadow-md shadow-blue-600/20"
          >
            <Edit className="h-4 w-4" />
            Editar
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
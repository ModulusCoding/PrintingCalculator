"use client";

import { useState, useTransition, useMemo } from "react";
import { X, Loader2, Save, AlertCircle } from "lucide-react";
import {
  ClosedSale,
  TIPO_PRODUTO_OPTIONS,
  CANAL_ABORDAGEM_OPTIONS,
  CANAL_FECHAMENTO_OPTIONS,
  FORMA_PAGAMENTO_OPTIONS,
  TipoProduto,
  CanalAbordagem,
  CanalFechamento,
  FormaPagamento,
} from "@/types/sales";
import { createSaleAction, updateSaleAction } from "@/lib/sales/actions";
import {
  formatCurrency,
  formatCurrencyInput,
  parseCurrencyInput,
} from "@/utils/currency";
import { normalizePhone } from "@/utils/phone";

interface SaleFormModalProps {
  sale?: ClosedSale | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SaleFormModal({
  sale,
  isOpen,
  onClose,
  onSuccess,
}: SaleFormModalProps) {
  const [isPending, startTransition] = useTransition();

  const [clienteNome, setClienteNome] = useState(sale?.cliente_nome || "");
  const [clienteTelefone, setClienteTelefone] = useState(
    sale?.cliente_telefone || ""
  );
  const [produto, setProduto] = useState(sale?.produto || "");
  const [tipoProduto, setTipoProduto] = useState<TipoProduto>(
    sale?.tipo_produto || "Produto padrão"
  );
  const [precoVenda, setPrecoVenda] = useState<string>(
    sale ? formatCurrencyInput(String(Math.round(sale.preco_venda * 100))) : ""
  );
  const [custo, setCusto] = useState<string>(
    sale ? formatCurrencyInput(String(Math.round(sale.custo * 100))) : ""
  );
  const [dataFechamento, setDataFechamento] = useState<string>(
    sale?.data_fechamento || new Date().toISOString().split("T")[0]
  );
  const [canalAbordagem, setCanalAbordagem] = useState<CanalAbordagem>(
    sale?.canal_abordagem || "Instagram"
  );
  const [canalFechamento, setCanalFechamento] = useState<CanalFechamento>(
    sale?.canal_fechamento || "WhatsApp"
  );
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>(
    sale?.forma_pagamento || "PIX"
  );
  const [detalhes, setDetalhes] = useState(sale?.detalhes || "");

  const [error, setError] = useState<string | null>(null);

  const calculatedProfit = useMemo(() => {
    if (!precoVenda || !custo) return null;
    return parseCurrencyInput(precoVenda) - parseCurrencyInput(custo);
  }, [precoVenda, custo]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const pv = parseCurrencyInput(precoVenda);
    const c = parseCurrencyInput(custo);

    if (!precoVenda || !Number.isFinite(pv) || pv < 0) {
      setError("Por favor, informe um preço de venda válido (maior ou igual a zero).");
      return;
    }

    if (!custo || !Number.isFinite(c) || c < 0) {
      setError("Por favor, informe um custo válido (maior ou igual a zero).");
      return;
    }

    const payload = {
      cliente_nome: clienteNome,
      cliente_telefone: clienteTelefone || null,
      produto: produto,
      tipo_produto: tipoProduto,
      preco_venda: pv,
      custo: c,
      data_fechamento: dataFechamento,
      canal_abordagem: canalAbordagem,
      canal_fechamento: canalFechamento,
      forma_pagamento: formaPagamento,
      detalhes: detalhes.trim() ? detalhes.trim() : null,
    };

    startTransition(async () => {
      const result = sale
        ? await updateSaleAction(sale.id, payload)
        : await createSaleAction(payload);

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
      aria-labelledby="sale-form-title"
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="sale-form-title" className="text-xl font-bold text-slate-900 dark:text-white">
            {sale ? "Editar Venda" : "Registrar Venda Fechada"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Body */}
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {error && (
              <div className="flex items-center gap-2 p-4 text-sm text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Nome do Cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome do Cliente *
                </label>
                <input
                  type="text"
                  required
                  maxLength={255}
                  value={clienteNome}
                  onChange={(e) => setClienteNome(e.target.value)}
                  placeholder="ex: João Silva"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>

              {/* Telefone do Cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Telefone do Cliente
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={15}
                  value={clienteTelefone}
                  onChange={(e) => setClienteTelefone(normalizePhone(e.target.value))}
                  placeholder="ex: 11999999999"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>

              {/* Produto */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Produto Vendido *
                </label>
                <input
                  type="text"
                  required
                  maxLength={255}
                  value={produto}
                  onChange={(e) => setProduto(e.target.value)}
                  placeholder="ex: Escultura de Zeus personalizada"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>

              {/* Tipo de Produto */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tipo de Produto *
                </label>
                <select
                  required
                  value={tipoProduto}
                  onChange={(e) => setTipoProduto(e.target.value as TipoProduto)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                >
                  {TIPO_PRODUTO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Data de Fechamento */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Data de Fechamento *
                </label>
                <input
                  type="date"
                  required
                  value={dataFechamento}
                  onChange={(e) => setDataFechamento(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>

              {/* Preço de Venda */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Preço de Venda (R$) *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-4 flex items-center text-sm text-slate-500 dark:text-slate-400 pointer-events-none">R$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={precoVenda}
                    onChange={(e) => setPrecoVenda(formatCurrencyInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Custo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custo (R$) *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-4 flex items-center text-sm text-slate-500 dark:text-slate-400 pointer-events-none">R$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={custo}
                    onChange={(e) => setCusto(formatCurrencyInput(e.target.value))}
                    placeholder="0,00"
                    className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Lucro Calculado em Tempo Real */}
              <div className="sm:col-span-2 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Lucro Estimado (Automático)
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    Preço de Venda − Custo
                  </p>
                </div>
                <div
                  className={`text-xl font-bold font-mono ${
                    calculatedProfit !== null && calculatedProfit >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : calculatedProfit !== null
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-400"
                  }`}
                >
                  {calculatedProfit !== null
                    ? formatCurrency(calculatedProfit)
                    : "—"}
                </div>
              </div>

              {/* Canal de Abordagem */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Canal de Abordagem *
                </label>
                <select
                  required
                  value={canalAbordagem}
                  onChange={(e) =>
                    setCanalAbordagem(e.target.value as CanalAbordagem)
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                >
                  {CANAL_ABORDAGEM_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Canal de Fechamento */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Canal de Fechamento *
                </label>
                <select
                  required
                  value={canalFechamento}
                  onChange={(e) =>
                    setCanalFechamento(e.target.value as CanalFechamento)
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                >
                  {CANAL_FECHAMENTO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Forma de Pagamento */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Forma de Pagamento *
                </label>
                <select
                  required
                  value={formaPagamento}
                  onChange={(e) =>
                    setFormaPagamento(e.target.value as FormaPagamento)
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                >
                  {FORMA_PAGAMENTO_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Detalhes */}
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Detalhes / Observações
                </label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={detalhes}
                  onChange={(e) => setDetalhes(e.target.value)}
                  placeholder="Informações adicionais sobre o pedido, descontos, entrega..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-sm transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold text-sm transition-colors shadow-md shadow-blue-600/20 disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {sale ? "Salvar Alterações" : "Registrar Venda"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
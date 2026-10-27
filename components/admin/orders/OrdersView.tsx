"use client";

import Link from "next/link";
import type { OrdersResult, OrderDetail, OrderItem } from "@/lib/orders/actions";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { KanbanBoard } from "./KanbanBoard";
import { OrderOperations } from "./OrderOperations";
import { OrderDialog } from "./OrderDialog";
import type { OrderIdentity } from "@/lib/orders/operation-schema";
import { useOrderTransitions, type TransitionController } from "./useOrderTransitions";
import { OrderStatusSelector, TransitionFeedback } from "./OrderStatusSelector";
import { LayoutList, Kanban, Search, X, Eye, FileText } from "lucide-react";

export const STATUS_LABELS: Record<string, { label: string; color: string; border: string; bg: string }> = {
  em_conversao: { label: "Em Conversão", color: "text-amber-700", border: "border-amber-300", bg: "bg-amber-50" },
  orcado: { label: "Orçado", color: "text-blue-700", border: "border-blue-300", bg: "bg-blue-50" },
  pago: { label: "Pago", color: "text-emerald-700", border: "border-emerald-300", bg: "bg-emerald-50" },
  modelando: { label: "Modelando", color: "text-purple-700", border: "border-purple-300", bg: "bg-purple-50" },
  imprimindo: { label: "Imprimindo", color: "text-indigo-700", border: "border-indigo-300", bg: "bg-indigo-50" },
  entregue: { label: "Entregue", color: "text-slate-700", border: "border-slate-300", bg: "bg-slate-100" },
  cancelado: { label: "Cancelado", color: "text-rose-700", border: "border-rose-300", bg: "bg-rose-50" },
};

export const FINANCIAL_STATUS_BADGES: Record<string, { label: string; class: string }> = {
  pago: { label: "Quitado", class: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  parcial: { label: "Parcial", class: "bg-amber-100 text-amber-800 border-amber-200" },
  pendente: { label: "Pendente", class: "bg-rose-100 text-rose-800 border-rose-200" },
};

export function OrdersView({
  identity,
  canDelete,
  canWrite,
  viewMode,
  searchParams,
  listData,
  kanbanData,
  selectedOrder,
  selectedItems,
  selectedError,
}: {
  identity: OrderIdentity;
  canDelete: boolean;
  canWrite: boolean;
  viewMode: "list" | "kanban";
  searchParams: Record<string, string | undefined>;
  listData: OrdersResult | null;
  kanbanData: Record<string, OrdersResult>;
  selectedOrder: OrderDetail | null;
  selectedItems: OrderItem[];
  selectedError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const rawParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const transitions = useOrderTransitions(canWrite, [
    ...(listData?.orders ?? []), ...Object.values(kanbanData).flatMap(column => column.orders),
    ...(selectedOrder ? [selectedOrder] : []),
  ], identity);
  const [searchInput, setSearchInput] = useState(searchParams.search || "");

  function updateParams(newParams: Record<string, string | null>) {
    const params = new URLSearchParams(rawParams.toString());
    Object.entries(newParams).forEach(([key, val]) => {
      if (val === null || val === "") {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    });
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ search: searchInput || null, page: "1",
      ...Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [`page_${status}`, null])) });
  }

  function formatCurrency(val: number) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
  }

  function formatDate(dt: string | null) {
    if (!dt) return "—";
    return new Date(dt).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-6">
      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#c7c4d9] bg-white p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <form onSubmit={handleSearch} className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-[#464556]/60" />
            <input
              type="text"
              placeholder="Buscar por número, comprador, e-mail ou telefone..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full rounded-lg border border-[#c7c4d9] bg-[#f8f9fa] py-2 pl-9 pr-3 text-sm focus:border-[#5852ff] focus:bg-white focus:outline-hidden"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[#5852ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d32e6] disabled:opacity-50"
          >
            Buscar
          </button>
          {(searchParams.search || searchParams.status) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                updateParams({ search: null, status: null, page: null,
                  ...Object.fromEntries(Object.keys(STATUS_LABELS).map(status => [`page_${status}`, null])) });
              }}
              className="flex items-center gap-1 text-xs font-medium text-[#464556] hover:text-[#152336]"
            >
              <X className="size-3" /> Limpar
            </button>
          )}
        </form>

        <div className="flex items-center gap-3">
          {viewMode === "list" && (
            <select
              value={searchParams.status || ""}
              onChange={e => updateParams({ status: e.target.value || null, page: "1" })}
              className="rounded-lg border border-[#c7c4d9] bg-white px-3 py-2 text-sm focus:border-[#5852ff] focus:outline-hidden"
            >
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          )}

          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-[#c7c4d9] bg-[#f3f4f5] p-1">
            <button
              type="button"
              onClick={() => updateParams({ view: "list" })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === "list" ? "bg-white text-[#3d32e6] shadow-xs" : "text-[#464556] hover:text-[#152336]"
              }`}
            >
              <LayoutList className="size-4" /> Lista
            </button>
            <button
              type="button"
              onClick={() => updateParams({ view: "kanban" })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                viewMode === "kanban" ? "bg-white text-[#3d32e6] shadow-xs" : "text-[#464556] hover:text-[#152336]"
              }`}
            >
              <Kanban className="size-4" /> Kanban
            </button>
          </div>
        </div>
      </div>

      <TransitionFeedback controller={transitions} />
      {/* Main View Render */}
      {viewMode === "list" ? (
        <ListView
          listData={listData}
          onSelectOrder={id => updateParams({ orderId: id })}
          onPageChange={p => updateParams({ page: String(p) })}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
      ) : (
        <KanbanBoard
          canWrite={canWrite}
          blockedIds={transitions.blockedIds}
          onMove={transitions.move}
          kanbanData={kanbanData}
          onSelectOrder={id => updateParams({ orderId: id })}
          onStatusPageChange={(st, p) => updateParams({ [`page_${st}`]: String(p) })}
          formatCurrency={formatCurrency}
        />
      )}

      {/* Detail Slide-over Modal */}
      {(selectedOrder || selectedError) && (
        <DetailDrawer
          controller={transitions}
          canDelete={canDelete}
          canWrite={canWrite}
          order={selectedOrder}
          items={selectedItems}
          error={selectedError}
          onClose={() => updateParams({ orderId: null })}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
      )}
    </div>
  );
}

function ListView({
  listData,
  onSelectOrder,
  onPageChange,
  formatCurrency,
  formatDate,
}: {
  listData: OrdersResult | null;
  onSelectOrder: (id: string) => void;
  onPageChange: (p: number) => void;
  formatCurrency: (v: number) => string;
  formatDate: (d: string | null) => string;
}) {
  if (!listData || listData.error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        <h3 className="font-bold">Erro ao carregar pedidos</h3>
        <p className="mt-1 text-sm">{listData?.error || "Dependência de banco de dados pendente ou falha na consulta."}</p>
      </div>
    );
  }

  if (listData.orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#c7c4d9] bg-white p-12 text-center">
        <FileText className="mx-auto size-10 text-[#464556]/40" />
        <h3 className="mt-3 text-base font-semibold text-[#152336]">
          {listData.total > 0 ? "Página fora do intervalo" : "Nenhum pedido encontrado"}
        </h3>
        <p className="mt-1 text-sm text-[#464556]">
          {listData.total > 0 ? `Existem ${listData.total} pedidos nos filtros atuais, mas esta página está vazia.`
            : "Nenhum pedido atende aos filtros atuais ou a empresa ainda não cadastrou pedidos."}
        </p>
        {listData.page > 1 && <button onClick={() => onPageChange(1)} className="mt-3 text-sm font-semibold text-[#3d32e6]">Voltar à primeira página</button>}
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(listData.total / listData.limit));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-[#c7c4d9] bg-white shadow-xs">
        <table className="w-full text-left text-sm text-[#152336]">
          <thead className="border-b border-[#c7c4d9] bg-[#f8f9fa] text-xs font-semibold text-[#464556]">
            <tr>
              <th className="px-4 py-3"># Pedido</th>
              <th className="px-4 py-3">Comprador</th>
              <th className="px-4 py-3">Status Operacional</th>
              <th className="px-4 py-3">Situação Financeira</th>
              <th className="px-4 py-3 text-right">Itens</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3 text-center">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7e8e9]">
            {listData.orders.map(o => {
              const st = STATUS_LABELS[o.operationalStatus] || { label: o.operationalStatus, color: "text-gray-700", border: "border-gray-200", bg: "bg-gray-50" };
              const fin = FINANCIAL_STATUS_BADGES[o.financialStatus] || { label: o.financialStatus, class: "bg-gray-100 text-gray-800" };
              return (
                <tr key={o.id} className="hover:bg-[#f8f9fa] transition-colors">
                  <td className="px-4 py-3 font-bold text-[#3d32e6]">#{o.displayNumber}</td>
                  <td className="px-4 py-3 font-medium">
                    <div>{o.buyerName}</div>
                    {o.buyerPhone && <div className="text-xs text-[#464556]">{o.buyerPhone}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${st.bg} ${st.color} ${st.border}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${fin.class}`}>
                      {fin.label}
                    </span>
                    {o.operationalStatus === "cancelado" && o.cancelledUnreversedAmount > 0 && (
                      <span className="ml-1 text-[10px] text-rose-600" title="A estornar">
                        (dev: {formatCurrency(o.cancelledUnreversedAmount)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{o.itemsCount}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#152336]">{formatCurrency(o.totalAmount)}</td>
                  <td className="px-4 py-3 text-xs text-[#464556]">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => onSelectOrder(o.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-[#f3f4f5] px-2.5 py-1 text-xs font-semibold text-[#3d32e6] hover:bg-[#e7e8e9]"
                    >
                      <Eye className="size-3.5" /> Detalhes
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-[#464556]">
          <span>
            Página {listData.page} de {pages} ({listData.total} pedidos)
          </span>
          <div className="flex gap-2">
            <button
              disabled={listData.page <= 1}
              onClick={() => onPageChange(listData.page - 1)}
              className="rounded-md border border-[#c7c4d9] px-3 py-1 font-medium hover:bg-[#f8f9fa] disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              disabled={listData.page >= pages}
              onClick={() => onPageChange(listData.page + 1)}
              className="rounded-md border border-[#c7c4d9] px-3 py-1 font-medium hover:bg-[#f8f9fa] disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailDrawer({
  controller,
  canDelete,
  canWrite,
  order,
  items,
  error,
  onClose,
  formatCurrency,
  formatDate,
}: {
  canWrite: boolean;
  controller: TransitionController;
  canDelete: boolean;
  order: OrderDetail | null;
  items: OrderItem[];
  error: string | null;
  onClose: () => void;
  formatCurrency: (v: number) => string;
  formatDate: (d: string | null) => string;
}) {
  if (error || !order) {
    return (
      <OrderDialog title="Erro nos detalhes" onClose={onClose}>
        <div className="w-full max-w-md rounded-xl bg-white p-6">
          <h3 className="font-bold text-red-700">Erro nos detalhes</h3>
          <p className="mt-2 text-sm text-gray-700">{error || "Pedido indisponível."}</p>
          <button onClick={onClose} className="mt-4 rounded-lg bg-gray-200 px-4 py-2 text-xs font-semibold">
            Fechar
          </button>
        </div>
      </OrderDialog>
    );
  }

  const st = STATUS_LABELS[order.operationalStatus] || { label: order.operationalStatus, color: "text-gray-700", border: "border-gray-200", bg: "bg-gray-50" };
  const fin = FINANCIAL_STATUS_BADGES[order.financialStatus] || { label: order.financialStatus, class: "bg-gray-100 text-gray-800" };

  return (
    <OrderDialog title={`Pedido #${order.displayNumber}`} onClose={onClose}>
      <div className="flex w-full flex-col bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#c7c4d9] px-6 py-4 bg-[#f8f9fa]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-[#3d32e6]">Pedido #{order.displayNumber}</h2>
              <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${st.bg} ${st.color} ${st.border}`}>
                {st.label}
              </span>
            </div>
            <p className="text-xs text-[#464556]">Criado em {formatDate(order.createdAt)} • Versão {order.version}</p>
          </div>
          {canWrite && !["entregue", "cancelado"].includes(order.operationalStatus) && items.every(i => i.fulfillmentMode === "untracked") && <Link href={`/admin/orders/${order.id}/edit`} className="ml-auto mr-3 rounded-lg bg-[#5852ff] px-3 py-2 text-xs font-semibold text-white">Editar pedido</Link>}
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#464556] hover:bg-[#e7e8e9] hover:text-[#152336]"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <OrderStatusSelector order={order} canWrite={canWrite} controller={controller} />
          <OrderOperations key={order.id} order={order} items={items} canWrite={canWrite} canDelete={canDelete} controller={controller} />
          {/* Comprador / Identificação */}
          <div className="rounded-xl border border-[#c7c4d9] p-4 bg-[#f8f9fa]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#464556]">Dados do Comprador</h3>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-[#464556]">Nome:</span>
                <p className="font-semibold text-[#152336]">{order.buyerName}</p>
              </div>
              <div>
                <span className="text-xs text-[#464556]">Telefone:</span>
                <p className="font-medium text-[#152336]">{order.buyerPhone || "—"}</p>
              </div>
              <div>
                <span className="text-xs text-[#464556]">E-mail:</span>
                <p className="font-medium text-[#152336]">{order.buyerEmail || "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <span className="text-xs text-[#464556]">Endereço:</span>
                <p className="font-medium text-[#152336]">{order.buyerAddress || "—"}</p>
              </div>
            </div>
          </div>

          {/* Itens do Pedido */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#464556]">Itens do Pedido ({items.length})</h3>
            <div className="overflow-x-auto rounded-xl border border-[#c7c4d9]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#f8f9fa] border-b border-[#c7c4d9] font-semibold text-[#464556]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-center">Atendimento</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Unitário</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e8e9]">
                  {items.map(it => (
                    <tr key={it.id}>
                      <td className="px-3 py-2 text-[#464556]">{it.lineNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[#152336]">{it.name}</div>
                        {it.description && <div className="text-[11px] text-[#464556]">{it.description}</div>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                          {it.fulfillmentMode}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-bold">{formatCurrency(it.lineSubtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resumo de Valores */}
          <div className="rounded-xl border border-[#c7c4d9] p-4 space-y-2 text-sm bg-white">
            <div className="flex justify-between text-[#464556]">
              <span>Subtotal:</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Desconto ({order.discountType === "percent" ? `${order.discountInput}%` : "fixo"}):</span>
                <span>- {formatCurrency(order.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#464556]">
              <span>Frete:</span>
              <span>{formatCurrency(order.shippingAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-[#c7c4d9] pt-2 text-[#152336]">
              <span>Valor Total:</span>
              <span>{formatCurrency(order.totalAmount)}</span>
            </div>
          </div>

          {/* Situação Financeira (C.4) */}
          <div className="rounded-xl border border-[#c7c4d9] p-4 bg-[#f8f9fa] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#464556]">Resumo Financeiro (C.4)</h3>
              <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${fin.class}`}>
                {fin.label}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[#464556]">Recebido Bruto:</span>
                <p className="font-semibold text-[#152336]">{formatCurrency(order.totalReceived)}</p>
              </div>
              <div>
                <span className="text-[#464556]">Estornado:</span>
                <p className="font-semibold text-rose-700">{formatCurrency(order.totalRefunded)}</p>
              </div>
              <div>
                <span className="text-[#464556]">Líquido Recebido:</span>
                <p className="font-semibold text-emerald-700">{formatCurrency(order.netReceived)}</p>
              </div>
              <div>
                <span className="text-[#464556]">Saldo Pendente:</span>
                <p className="font-semibold text-amber-700">{formatCurrency(order.pendingAmount)}</p>
              </div>
            </div>
            {order.operationalStatus === "cancelado" && order.cancelledUnreversedAmount > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
                <strong>Atenção:</strong> Pedido cancelado com valor líquido ainda não estornado de{" "}
                <span className="font-bold">{formatCurrency(order.cancelledUnreversedAmount)}</span>.
              </div>
            )}
          </div>

          {/* Observações */}
          {order.notes && (
            <div className="rounded-xl border border-[#c7c4d9] p-4 text-xs">
              <span className="font-bold text-[#464556]">Observações:</span>
              <p className="mt-1 text-[#152336] whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#c7c4d9] p-4 bg-[#f8f9fa] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#c7c4d9] bg-white px-4 py-2 text-xs font-semibold text-[#152336] hover:bg-[#e7e8e9]"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </OrderDialog>
  );
}

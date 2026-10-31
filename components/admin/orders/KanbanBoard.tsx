"use client";

import { useState } from "react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { ChevronLeft, ChevronRight, Eye, GripVertical, LockKeyhole } from "lucide-react";
import type { Order, OrdersResult } from "@/lib/orders/actions";
import { canTransition, destinations, dropDestination } from "@/lib/orders/transitions";
import { FINANCIAL_STATUS_BADGES, STATUS_LABELS } from "./OrdersView";

type KanbanBoardProps = {
  kanbanData: Record<string, OrdersResult>;
  canWrite: boolean;
  blockedIds: string[];
  onMove: (order: Order, target: string) => void;
  onSelectOrder: (id: string) => void;
  onStatusPageChange: (status: string, page: number) => void;
  formatCurrency: (value: number) => string;
};

export function KanbanBoard({ kanbanData, canWrite, blockedIds, onMove, onSelectOrder, onStatusPageChange, formatCurrency }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Resolve the current server-backed record, never data supplied by a drag entity.
  const findOrder = (id: string) => Object.values(kanbanData).flatMap(data => data.orders).find(order => order.id === id);
  const activeOrder = activeId ? findOrder(activeId) : undefined;

  return (
    // The installed DOM preset supplies PointerSensor and KeyboardSensor by default.
    <DragDropProvider
      onDragStart={({ operation }) => setActiveId(operation.source ? String(operation.source.id) : null)}
      onDragEnd={({ operation, canceled }) => {
        setActiveId(null);
        if (canceled || !operation.source || !operation.target || !canWrite) return;
        const order = findOrder(String(operation.source.id));
        if (!order || blockedIds.includes(order.id) || destinations(order.operationalStatus).length === 0) return;
        const target = dropDestination(order.operationalStatus, String(operation.target.id), canceled);
        if (!target) return;
        // Invalid transitions also reach the parent so it can explain the rejection.
        // Do not move any card locally: the refreshed server data owns its column.
        onMove(order, target);
      }}
    >
      <div className="flex gap-4 overflow-x-auto pb-6" aria-label="Quadro de pedidos">
        {Object.keys(STATUS_LABELS).map(status => (
          <KanbanColumn
            key={status}
            status={status}
            data={kanbanData[status]}
            activeOrder={activeOrder}
            canWrite={canWrite}
            blockedIds={blockedIds}
            onSelectOrder={onSelectOrder}
            onStatusPageChange={onStatusPageChange}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}

type ColumnProps = Omit<KanbanBoardProps, "kanbanData" | "onMove"> & {
  status: string;
  data: OrdersResult | undefined;
  activeOrder: Order | undefined;
};

function KanbanColumn({ status, data, activeOrder, canWrite, blockedIds, onSelectOrder, onStatusPageChange, formatCurrency }: ColumnProps) {
  // Every column remains a target, including empty and terminal columns.
  const { ref, isDropTarget } = useDroppable({ id: status });
  const conf = STATUS_LABELS[status];
  const terminal = destinations(status).length === 0;
  const validTarget = activeOrder && canTransition(activeOrder.operationalStatus, status);
  const currentPage = data?.page ?? 1;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit || 10)));

  return (
    <section
      ref={ref}
      aria-label={conf.label}
      className={`flex w-72 shrink-0 flex-col rounded-xl border p-3 shadow-xs transition-colors ${terminal ? `${conf.bg} ${conf.border}` : "border-[#c7c4d9] bg-[#f8f9fa]"} ${isDropTarget ? (validTarget ? "ring-2 ring-[#5852ff]" : "ring-2 ring-rose-400") : ""}`}
    >
      <div className="mb-3 flex items-center justify-between border-b border-[#c7c4d9] pb-2">
        <h3 className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider ${conf.color}`}>
          {terminal && <LockKeyhole className="size-3" aria-hidden="true" />}{conf.label}
        </h3>
        <span className="rounded-full border border-[#c7c4d9] bg-white px-2 py-0.5 text-xs font-bold text-[#152336] shadow-2xs">
          {!data || data.error ? "—" : data.total}
        </span>
      </div>
      {terminal && <p className="mb-3 text-[11px] text-[#464556]">Status especial · abra os detalhes para desfazer entrega ou reabrir. Não use transição simples.</p>}
      <div className="max-h-[calc(100vh-280px)] min-h-28 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {!data || data.error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900">{data?.error || "Não foi possível carregar os pedidos."}</div>
        ) : data.orders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#c7c4d9] p-4 text-center text-xs text-[#464556]/60">
            {data.total > 0 ? "Página fora do intervalo" : "Nenhum pedido"}
            {currentPage > 1 && <button type="button" onClick={() => onStatusPageChange(status, 1)} className="mt-2 block text-[#3d32e6]">Voltar à primeira página</button>}
          </div>
        ) : data.orders.map(order => (
          <KanbanCard key={order.id} order={order} canWrite={canWrite} blocked={blockedIds.includes(order.id)} onSelectOrder={onSelectOrder} formatCurrency={formatCurrency} />
        ))}
      </div>
      {data && !data.error && (totalPages > 1 || currentPage > 1) && (
        <div className="mt-3 flex items-center justify-between border-t border-[#c7c4d9] pt-2 text-[11px] text-[#464556]">
          <span>Pág. {currentPage}/{totalPages}</span>
          <div className="flex gap-1">
            <button type="button" aria-label={`Página anterior: ${conf.label}`} disabled={currentPage <= 1} onClick={() => onStatusPageChange(status, currentPage - 1)} className="rounded-md border border-[#c7c4d9] bg-white p-1 hover:bg-[#f3f4f5] disabled:opacity-40"><ChevronLeft className="size-3" /></button>
            <button type="button" aria-label={`Próxima página: ${conf.label}`} disabled={currentPage >= totalPages} onClick={() => onStatusPageChange(status, currentPage + 1)} className="rounded-md border border-[#c7c4d9] bg-white p-1 hover:bg-[#f3f4f5] disabled:opacity-40"><ChevronRight className="size-3" /></button>
          </div>
        </div>
      )}
    </section>
  );
}

function KanbanCard({ order, canWrite, blocked, onSelectOrder, formatCurrency }: {
  order: Order;
  canWrite: boolean;
  blocked: boolean;
  onSelectOrder: (id: string) => void;
  formatCurrency: (value: number) => string;
}) {
  const terminal = destinations(order.operationalStatus).length === 0;
  const disabled = !canWrite || blocked || terminal;
  const { ref, handleRef, isDragging } = useDraggable({ id: order.id, disabled });
  const fin = FINANCIAL_STATUS_BADGES[order.financialStatus] || { label: order.financialStatus, class: "bg-gray-100 text-gray-800" };

  return (
    <article ref={ref} aria-busy={blocked} className={`rounded-lg border bg-white p-3 shadow-2xs ${isDragging ? "border-[#5852ff] opacity-60" : "border-[#c7c4d9]"} ${blocked ? "ring-1 ring-amber-300" : ""}`}>
      <div className="flex items-center justify-between gap-2 font-bold">
        <span className="text-[#3d32e6]">#{order.displayNumber}</span>
        <span className="text-xs text-[#152336]">{formatCurrency(order.totalAmount)}</span>
      </div>
      <div className="mt-1 truncate text-xs font-medium text-[#152336]">{order.buyerName}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[#464556]">
        <span>{order.itemsCount} item(s)</span>
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${fin.class}`}>{fin.label}</span>
      </div>
      {order.operationalStatus === "cancelado" && order.cancelledUnreversedAmount > 0 && <p className="mt-2 text-[11px] text-rose-600">A estornar: {formatCurrency(order.cancelledUnreversedAmount)}</p>}
      {blocked && <p role="status" className="mt-2 text-[11px] font-medium text-amber-800">Alteração pendente · movimentação bloqueada</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        {canWrite && !terminal ? (
          <button ref={handleRef} type="button" disabled={disabled} style={{ touchAction: "none" }} aria-label={`Mover pedido #${order.displayNumber}`} title="Arraste para outro status ou use o teclado" className="cursor-grab rounded-md p-2 text-[#464556] hover:bg-[#f3f4f5] focus-visible:outline-2 focus-visible:outline-[#5852ff] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40">
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        ) : <span className="text-[10px] text-[#464556]">{terminal ? "Finalizado" : "Somente leitura"}</span>}
        <button type="button" onClick={() => onSelectOrder(order.id)} className="inline-flex items-center gap-1 rounded-md bg-[#f3f4f5] px-2.5 py-1.5 text-xs font-semibold text-[#3d32e6] hover:bg-[#e7e8e9]">
          <Eye className="size-3.5" aria-hidden="true" /> Detalhes
        </button>
      </div>
    </article>
  );
}

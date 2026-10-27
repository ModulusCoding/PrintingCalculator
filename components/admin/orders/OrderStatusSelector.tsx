"use client";

import { useState } from "react";
import { OrderDialog } from "./OrderDialog";
import { destinations } from "@/lib/orders/transitions";
import { STATUS_LABELS } from "./OrdersView";
import type { TransitionController } from "./useOrderTransitions";

type Subject = {id:string; version:number; operationalStatus:string};
export function OrderStatusSelector({order,canWrite,controller}:{order:Subject;canWrite:boolean;controller:TransitionController}) {
  const allowed = destinations(order.operationalStatus);
  const result = controller.display[order.id]?.result;
  return <section className="space-y-2 rounded-xl border border-[#c7c4d9] bg-white p-4">
    <h3 className="text-xs font-bold uppercase text-[#464556]">Gestão operacional</h3>
    <p className="text-sm">Status atual: <strong>{STATUS_LABELS[order.operationalStatus]?.label}</strong></p>
    <p className="text-xs text-[#464556]">O status operacional Pago não confirma recebimento financeiro.</p>
    {canWrite && (allowed.length ? <label className="block text-sm">Mover para
      <select aria-label="Alterar status operacional" value="" disabled={controller.blockedIds.includes(order.id)} onChange={e=>controller.move(order,e.target.value)} className="mt-1 w-full rounded-lg border border-[#c7c4d9] bg-white p-2 disabled:opacity-50">
        <option value="">Selecione um destino</option>
        {allowed.map(st=><option key={st} value={st}>{STATUS_LABELS[st]?.label}</option>)}
      </select></label> : <p className="text-xs">Não há transições simples neste estado. Utilize as ações explícitas abaixo para desfazer entrega ou reabrir.</p>)}
    {result && !result.ok && <div role="alert" className="space-y-2 text-sm text-red-700">
      <p>{result.message}</p>
      {result.uncertain && <button type="button" onClick={()=>controller.retry(order.id)} className="mr-3 font-semibold underline">Retransmitir mesma tentativa</button>}
      <button type="button" onClick={controller.reload} className="font-semibold underline">Atualizar dados</button>
    </div>}
    {controller.display[order.id]?.pending && <p role="status" className="text-sm">Atualizando status…</p>}
    {controller.display[order.id]?.result?.ok && <p role="status" className="text-sm text-emerald-800">Transição confirmada pelo servidor.</p>}
  </section>;
}

export function TransitionFeedback({controller}:{controller:TransitionController}) {
  const [reason,setReason] = useState("");
  return <>
    {controller.message && <div role="status" aria-live="polite" className="space-y-2 rounded-xl border border-[#c7c4d9] bg-white p-4 text-sm text-[#152336]">
      <p>{controller.message}</p>
      {Object.entries(controller.display).filter(([,op])=>op.result && !op.result.ok).map(([id,op])=><div key={id} role="alert" className="space-x-3">
        <span>{op.result && !op.result.ok ? op.result.message : ""}</span>
        {op.result && !op.result.ok && op.result.uncertain && <button type="button" disabled={op.pending} className="font-semibold text-[#3d32e6] disabled:opacity-50" onClick={()=>controller.retry(id)}>Retransmitir mesma tentativa</button>}
        {op.result && !op.result.ok && !op.result.uncertain && <button type="button" disabled={op.pending} onClick={()=>controller.review(id)} className="font-semibold text-[#3d32e6]">Revisar falha conhecida / nova confirmação</button>}
        <button type="button" onClick={controller.reload} className="font-semibold text-[#3d32e6]">Atualizar dados</button>
      </div>)}
    </div>}
    {controller.reasonRequest && <OrderDialog key={`${controller.reasonRequest.order.id}:${controller.reasonRequest.target}`} title="Motivo obrigatório" onClose={()=>{controller.setReasonRequest(null);setReason("");}}>
      <form aria-labelledby="transition-reason-title" className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onSubmit={e=>{e.preventDefault();const request=controller.reasonRequest;if(request)controller.move(request.order,request.target,reason);setReason("");}}>
        <h3 id="transition-reason-title" className="font-bold text-[#152336]">Motivo obrigatório</h3>
        <p className="text-sm text-[#464556]">A regra operacional exige um motivo para mover para {STATUS_LABELS[controller.reasonRequest.target]?.label}.</p>
        <label className="block text-sm">Motivo<textarea autoFocus required minLength={1} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} onKeyDown={e=>{if(e.key==="Escape"){controller.setReasonRequest(null);setReason("");}}} className="mt-1 w-full rounded-lg border border-[#c7c4d9] p-2"/></label>
        <div className="flex justify-end gap-3"><button type="button" onClick={()=>{controller.setReasonRequest(null);setReason("");}}>Cancelar</button><button disabled={!reason.trim()} className="rounded-lg bg-[#5852ff] px-4 py-2 text-white disabled:opacity-50">Mover pedido</button></div>
      </form>
    </OrderDialog>}
  </>;
}

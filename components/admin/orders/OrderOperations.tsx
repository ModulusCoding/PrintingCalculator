"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderDetail, OrderItem } from "@/lib/orders/actions";
import { getOrderPhysicalStateAction, getOrderFinancialSummaryAction, getOrderPaymentHistoryAction } from "@/lib/orders/operation-actions";
import { coherentPhysical, commonStatus, type OperationKind, type PhysicalRow, type PaymentRow, type financialSummarySchema } from "@/lib/orders/operation-schema";
import type { z } from "zod";
import type { TransitionController } from "./useOrderTransitions";
import { OrderDialog } from "./OrderDialog";

type Summary=z.infer<typeof financialSummarySchema>;
const physicalLabels:Record<string,string>={untracked:"Sem controle físico",allocated:"Estoque reservado — entrega consumirá reserva",valid_debit:"Saída já registrada — reconfirmação preserva cobertura",compensated:"Baixa compensada — nova alocação necessária",allocation_required:"Aguardando alocação integral",reconciliation_required:"Estado físico exige revisão"};
export function OrderOperations({order,items,canWrite,canDelete,controller}:{order:OrderDetail;items:OrderItem[];canWrite:boolean;canDelete:boolean;controller:TransitionController}){
  const router=useRouter();
  const [revision,setRevision]=useState(0);
  const [rows,setRows]=useState<PhysicalRow[]|null>(null);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [history,setHistory]=useState<PaymentRow[]>([]);
  const [hasMore,setHasMore]=useState(false);
  const [loadingHistory,setLoadingHistory]=useState(false);
  const [historyError,setHistoryError]=useState("");
  const [physicalError,setPhysicalError]=useState("");
  const [financialError,setFinancialError]=useState("");
  const submitting=useRef(false);
  const [sending,setSending]=useState(false);
  const [request,setRequest]=useState<{kind:OperationKind;itemId?:string;paymentId?:string}|null>(null);
  const [reason,setReason]=useState("");const [classification,setClassification]=useState("");const [target,setTarget]=useState("em_conversao");
  const [amount,setAmount]=useState("");const [method,setMethod]=useState("pix");const [date,setDate]=useState("");const [note,setNote]=useState("");const [validation,setValidation]=useState("");
  useEffect(()=>{
    let active=true;
    startTransition(async()=>{
      await Promise.resolve();
      if(!active)return;
      setRows(null);setSummary(null);setHistory([]);setHasMore(false);setPhysicalError("");setFinancialError("");setHistoryError("");
      const p=await getOrderPhysicalStateAction(order.id);if(!active)return;if(p.ok)setRows(p.data);else setPhysicalError(p.message);
      const f=await getOrderFinancialSummaryAction(order.id);if(!active)return;if(f.ok)setSummary(f.data[0]);else setFinancialError(f.message);
      const h=await getOrderPaymentHistoryAction({orderId:order.id,limit:20});if(!active)return;if(h.ok){setHistory(h.data);setHasMore(h.data.length===20);}else setHistoryError(h.message);
    });
    return ()=>{active=false;};
  },[order.id,order.version,revision]);
  const coherent=rows!==null && coherentPhysical(rows,order,items);
  const reconciles=!!rows?.some(r=>r.physical_state==="reconciliation_required");
  const physicalReady=coherent && !reconciles;
  const financialReady=summary?.version===order.version && summary.operational_status===order.operationalStatus;
  const blocked=controller.blockedIds.includes(order.id);
  const operation=controller.display[order.id];
  const failure=operation?.result && !operation.result.ok ? operation.result : undefined;
  const incorrect=physicalReady && rows!.every(r=>r.can_undo_as_incorrect);
  const terminal=["entregue","cancelado"].includes(order.operationalStatus);
  function open(kind:OperationKind,itemId?:string,paymentId?:string){setReason("");setClassification("");setTarget("em_conversao");setAmount("");setMethod("pix");setDate("");setNote("");setValidation("");setRequest({kind,itemId,paymentId});}
  async function confirm(e:React.FormEvent){
    e.preventDefault();if(!request || blocked || submitting.current)return;
    const args:Record<string,unknown>={};
    if(["undo","cancel","reopen","reverse"].includes(request.kind))args.reason=reason.replace(/^ +| +$/g,"");
    if(request.kind==="allocate")args.orderItemId=request.itemId;
    if(request.kind==="undo"){
      if(!physicalReady || !classification || (classification==="incorrect_record" && !incorrect)){setValidation("Selecione explicitamente uma classificação elegível e atualize o snapshot.");return;}
      args.classification=classification;args.targetStatus=target;args.deliveryEventId=rows![0].current_delivery_event_id;
    }
    if(request.kind==="deliver" && (!physicalReady || !financialReady)){setValidation("Atualize as leituras antes da confirmação.");return;}
    if(["record","reverse"].includes(request.kind)){
      if(!date || !Number.isFinite(new Date(date).getTime())){setValidation("Informe a data efetiva.");return;}
      args.effectiveAt=new Date(date).toISOString();
    }
    if(request.kind==="record"){args.amount=amount;args.method=method;args.note=note||null;}
    if(request.kind==="reverse")args.paymentId=request.paymentId;
    submitting.current=true;setSending(true);setValidation("");
    try{
      const result=await controller.run(order,request.kind,args);
      if(result?.ok)setRequest(null);
      else setValidation(result?.message || "Operação não iniciada. Confira o estado da tentativa e o armazenamento desta aba.");
    }finally{submitting.current=false;setSending(false);}
  }
  async function nextHistory(){
    if(loadingHistory)return;const last=history.at(-1);if(!last)return;setLoadingHistory(true);setHistoryError("");
    try{const r=await getOrderPaymentHistoryAction({orderId:order.id,limit:20,beforeRecordedAt:last.recorded_at,beforePaymentId:last.payment_id});if(r.ok){setHistory(old=>[...old,...r.data.filter(row=>!old.some(o=>o.payment_id===row.payment_id))]);setHasMore(r.data.length===20);}else setHistoryError(r.message);}catch{setHistoryError("Histórico indisponível. Tente consultar novamente.");}finally{setLoadingHistory(false);}
  }
  return <section className="space-y-4 rounded-xl border border-[#c7c4d9] p-4">
    <h3 className="font-bold">Ações explícitas · físico e financeiro</h3>
    <p className="text-xs">Nenhuma ação é otimista. Estoque e pagamentos são confirmados pelo servidor. Pago operacional não significa recebimento.</p>
    <button type="button" className="underline" onClick={()=>{setRevision(v=>v+1);router.refresh();}}>Atualizar dados autoritativos</button>
    {physicalError && <p role="alert">Físico: {physicalError}</p>}
    {!rows && !physicalError && <p role="status">Consultando físico…</p>}
    {rows && !coherent && <p role="alert">Snapshot físico incompleto ou versão divergente. Atualize antes de agir.</p>}
    {rows && <ul className="space-y-2 text-sm">{rows.map(r=><li key={r.order_item_id} className="rounded border p-2"><strong>{items.find(i=>i.id===r.order_item_id)?.name || r.order_item_id}</strong> · {r.quantity} · {physicalLabels[r.physical_state]}
      {r.source_delivery_event_id && <p className="break-all text-xs">Origem física: {r.source_delivery_event_id}</p>}
      {canWrite && !terminal && r.requires_allocation && <button disabled={blocked || !physicalReady} type="button" className="ml-2 underline disabled:opacity-50" onClick={()=>open("allocate",r.order_item_id)}>Alocar item integral</button>}
    </li>)}</ul>}
    {reconciles && <p role="alert">Reconciliação necessária: consulte o responsável. Não há reparo ou crédito forçado nesta interface.</p>}
    {rows?.[0]?.current_delivery_event_id && <p className="break-all text-xs">Confirmação vigente: {rows[0].current_delivery_event_id}</p>}
    <div className="flex flex-wrap gap-3">
      {canWrite && !terminal && <button disabled={blocked || !physicalReady || !financialReady} onClick={()=>open("deliver")}>Entregar pedido</button>}
      {canWrite && order.operationalStatus==="entregue" && <button disabled={blocked || !physicalReady} onClick={()=>open("undo")}>Desfazer entrega</button>}
      {canDelete && !terminal && <button disabled={blocked} onClick={()=>open("cancel")}>Cancelar pedido</button>}
      {canWrite && order.operationalStatus==="cancelado" && <button disabled={blocked} onClick={()=>open("reopen")}>Reabrir em Em conversão</button>}
    </div>
    <h4 className="font-semibold">Financeiro manual</h4>
    {financialError && <p role="alert">{financialError}</p>}
    {summary && !financialReady && <p role="alert">Resumo de outra versão. Atualize antes de lançar.</p>}
    {summary && <p className="text-sm">Total {summary.total_amount} · Bruto {summary.total_received} · Estornado {summary.total_refunded} · Líquido {summary.net_received} · Pendente {summary.pending_amount} · {summary.financial_status}</p>}
    {canWrite && order.operationalStatus!=="cancelado" && <button disabled={blocked || !financialReady} onClick={()=>open("record")}>Registrar recebimento manual</button>}
    <p className="text-xs">Registros manuais apenas: não cobram nem reembolsam por gateway. Estorno integral exige sales.delete; cancelamento não estorna.</p>
    <h4 className="font-semibold">Histórico financeiro (ordem de registro)</h4>
    {historyError && <p role="alert">{historyError}</p>}
    <ul className="space-y-2 text-sm">{history.map(p=><li key={p.payment_id} className="rounded border p-2"><span>{p.entry_type==="receipt"?"Recebimento":"Estorno"} · {p.amount} · {p.method} · Efetivo: {new Date(p.effective_at).toLocaleString("pt-BR")}</span><p className="break-all text-xs">{p.payment_id} · Registrado: {p.recorded_at}</p>{p.note && <p>{p.note}</p>}{p.reverses_payment_id && <p className="break-all text-xs">Estorna: {p.reverses_payment_id}</p>}
      {canDelete && p.entry_type==="receipt" && <button disabled={blocked || !financialReady || history.some(h=>h.reverses_payment_id===p.payment_id)} onClick={()=>open("reverse",undefined,p.payment_id)}>Estornar integralmente</button>}
    </li>)}</ul>
    {hasMore && <button disabled={loadingHistory} onClick={()=>startTransition(async()=>{await nextHistory();})}>{loadingHistory?"Carregando…":"Carregar anteriores"}</button>}
    {request && <OrderDialog title={({allocate:"Alocar estoque",deliver:"Confirmar entrega",undo:"Desfazer confirmação de entrega",cancel:"Cancelar pedido",reopen:"Reabrir pedido",record:"Registrar recebimento manual",reverse:"Estornar recebimento integral"} as Partial<Record<OperationKind,string>>)[request.kind] || "Confirmar"} onClose={()=>setRequest(null)}>
      <form onSubmit={confirm} className="space-y-4">
        <fieldset disabled={blocked || sending} className="space-y-4">
        {request.kind==="allocate" && <p>Reserva integral do item {items.find(i=>i.id===request.itemId)?.name}. Não debita físico nem recebe pagamento. Plano e saldo são avaliados sob lock pelo servidor. Cada item é uma operação independente.</p>}
        {request.kind==="deliver" && <><p>Confirmar entrega: reservas elegíveis serão consumidas; saídas já registradas serão preservadas sem nova baixa; itens sem controle não geram movimento.</p><ul>{rows?.map(r=><li key={r.order_item_id}>{items.find(i=>i.id===r.order_item_id)?.name}: {physicalLabels[r.physical_state]}</li>)}</ul>{summary && Number(summary.pending_amount)>0 && <p className="rounded bg-amber-50 p-3">Há saldo pendente de R$ {summary.pending_amount}. Isso não impede a entrega e esta ação não registra recebimento.</p>}</>}
        {request.kind==="cancel" && <p>Libera reservas ativas; preserva baixas e valores recebidos (líquido R$ {order.netReceived}). Não compensa estoque nem estorna pagamentos.</p>}
        {request.kind==="reopen" && <p>Destino fixo: Em conversão. Preserva cobertura válida; obrigações descobertas podem exigir plano elegível, saldo ou alocação posterior. Não reativa reservas antigas.</p>}
        {request.kind==="undo" && <><label className="block">Destino<select value={target} onChange={e=>setTarget(e.target.value)}>{commonStatus.options.map(s=><option key={s}>{s}</option>)}</select></label><label className="block">Classificação obrigatória<select required value={classification} onChange={e=>setClassification(e.target.value)}><option value="">Selecione explicitamente</option><option value="actual_delivery">Entrega realmente realizada — manter saída física</option><option disabled={!incorrect} value="incorrect_record">Registro incorreto — compensar baixa elegível</option></select></label>{!incorrect && <p>D4: compensação indisponível para cobertura herdada ou snapshot inelegível. Entrega real preserva a saída, sujeita à validação do servidor.</p>}<p>Não cria nova reserva automaticamente. Sem baixa física, pode não haver movimento.</p></>}
        {request.kind==="reverse" && <p>Estorno integral único do recebimento {request.paymentId}. Valor e método são os do original; não há reembolso externo automático.</p>}
        {request.kind==="record" && <><label className="block">Valor decimal (ex.: 10.50)<input required pattern="(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="block">Método<select value={method} onChange={e=>setMethod(e.target.value)}>{["pix","card","cash","bank_transfer","other"].map(m=><option key={m}>{m}</option>)}</select></label><label className="block">Nota opcional (não inclua dados sensíveis)<textarea maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label></>}
        {["record","reverse"].includes(request.kind) && <label className="block">Data efetiva explícita (horário local)<input required type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label>}
        {["undo","cancel","reopen","reverse"].includes(request.kind) && <label className="block">Motivo obrigatório (não inclua dados sensíveis)<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
        </fieldset>
        {validation && <p role="alert">{validation}</p>}
        {blocked && <p role="status">{failure?.message || "Aguarde a confirmação autoritativa."}</p>}
        <button type="button" onClick={()=>{setRevision(v=>v+1);controller.reload();}}>Atualizar dados autoritativos</button>
        {failure?.uncertain && <button type="button" disabled={sending || controller.display[order.id]?.pending} onClick={()=>startTransition(async()=>{const result=await controller.retry(order.id);if(result?.ok)setRequest(null);else if(result)setValidation(result.message);})}>Retransmitir exatamente a tentativa preservada</button>}
        <p className="text-xs">A tentativa e seus argumentos mínimos serão preservados no sessionStorage desta aba para retomada explícita. Sem tokens ou dados de comprador. Fechar após envio não cancela no banco.</p>
        <button type="button" onClick={()=>setRequest(null)}>Voltar</button> <button disabled={blocked || sending} className="rounded bg-[#5852ff] px-4 py-2 text-white">Confirmar operação</button>
      </form>
    </OrderDialog>}
  </section>;
}

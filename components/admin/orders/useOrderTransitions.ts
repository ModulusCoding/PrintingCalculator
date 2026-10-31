"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { executeOrderOperationAction } from "@/lib/orders/operation-actions";
import { envelopeSchema, type OperationKind, type OperationResult, type OrderIdentity } from "@/lib/orders/operation-schema";
import { canTransition, needsReason, transitionInputSchema } from "@/lib/orders/transitions";

type Subject = {id:string;version:number;operationalStatus:string};
type Envelope = {identity:OrderIdentity;kind:OperationKind;input:{attemptId:string;orderId:string;expectedVersion:number}&Record<string,unknown>};
type Operation = {envelope:Envelope;pending:boolean;result?:OperationResult};
export function useOrderTransitions(canWrite:boolean, orders:Subject[], identity:OrderIdentity) {
  const router=useRouter();
  const scope=`orders:m73:v1:${identity.userId}:${identity.enterpriseId}`;
  const operations=useRef<Record<string,Operation>>({});
  const [display,setDisplay]=useState<Record<string,Operation>>({});
  const [message,setMessage]=useState("");
  const [ready,setReady]=useState(false);
  const [reasonRequest,setReasonRequest]=useState<{order:Subject;target:string}|null>(null);
  function publish(){setDisplay({...operations.current});}
  useEffect(()=>{
    let active=true;
    Promise.resolve().then(()=>{
    if(!active)return;
    operations.current={};
    try{
      const raw=sessionStorage.getItem(scope);
      if(raw){
        const saved=JSON.parse(raw);
        if(saved.schema!==1 || !Array.isArray(saved.operations))throw new Error("Invalid persistence");
        for(const entry of saved.operations){
          const parsed=envelopeSchema.safeParse(entry.envelope);
          if(!parsed.success || parsed.data.identity.userId!==identity.userId || parsed.data.identity.enterpriseId!==identity.enterpriseId)throw new Error("Invalid identity");
          const env=parsed.data as Envelope;
          if(typeof env.input?.orderId!=="string" || !Number.isSafeInteger(env.input.expectedVersion))throw new Error("Invalid input");
          const knownFailure=entry.result?.ok===false && entry.result.uncertain!==true;
          operations.current[env.input.orderId]={envelope:env,pending:false,result:knownFailure?entry.result:{ok:false,code:"restored",uncertain:true,message:"Tentativa recuperada nesta aba. Nenhum reenvio automático. Confira e retome explicitamente na identidade original."}};
        }
      }
    }catch{setMessage("Armazenamento de tentativas indisponível ou inválido. Operações bloqueadas; solicite revisão das tentativas desta aba antes de limpar o armazenamento.");publish();setReady(false);return;}
    publish();setReady(true);
    // Scope changes never dispatch a recovered command.
    });
    return ()=>{active=false;};
  },[scope,identity.userId,identity.enterpriseId]);
  function persist(){
    try{sessionStorage.setItem(scope,JSON.stringify({schema:1,operations:Object.values(operations.current).filter(op=>op.pending || !op.result?.ok).map(op=>({envelope:op.envelope,...(op.result && !op.result.ok && !op.result.uncertain?{result:op.result}:{})}))}));return true;}
    catch{setMessage("Não foi possível preservar a tentativa nesta aba. A operação não foi iniciada; habilite armazenamento e atualize.");return false;}
  }
  function blocked(order:Subject,op?:Operation){
    if(!op)return false;
    if(op.pending || !op.result)return true;
    if(op.result.ok)return order.version<op.result.data.version;
    if(op.result.uncertain)return true;
    if(op.result.code==="version_conflict")return order.version<=op.envelope.input.expectedVersion;
    return ["idempotency_conflict","receipt_result_unavailable","identity_changed","unauthorized"].includes(op.result.code);
  }
  const blockedIds=ready?Object.entries(display).filter(([id,op])=>{const order=orders.find(o=>o.id===id);return !order || blocked(order,op);}).map(([id])=>id):orders.map(o=>o.id);
  async function send(envelope:Envelope):Promise<OperationResult|undefined>{
    const id=envelope.input.orderId;
    if(operations.current[id]?.pending)return;
    const previous=operations.current[id];
    const op:Operation={envelope,pending:true};operations.current[id]=op;
    if(!persist()){if(previous)operations.current[id]=previous;else delete operations.current[id];publish();return;}
    publish();
    let result:OperationResult;
    try{result=await executeOrderOperationAction(envelope);}catch{result={ok:false,code:"network",uncertain:true,message:"Resultado não confirmado. Não gere nova tentativa; retransmita a mesma ou consulte os dados."};}
    // An authorization/pre-dispatch failure on retry does not resolve the original uncertainty.
    if(previous?.result && !previous.result.ok && previous.result.uncertain && !result.ok && (result.dispatched===false || ["invalid_input","unauthorized","identity_changed","technical"].includes(result.code)))result={...result,uncertain:true};
    operations.current[id]={...op,pending:false,result};persist();publish();
    setMessage(result.ok?"Operação confirmada. Sincronizando dados autoritativos (replay não substitui o estado atual)…":result.message);
    if(result.ok || result.uncertain || result.code==="version_conflict")router.refresh();
    return result;
  }
  function run(order:Subject,kind:OperationKind,args:Record<string,unknown>={}):Promise<OperationResult|undefined>{
    if(!ready || blocked(order,operations.current[order.id]))return Promise.resolve(undefined);
    const envelope:Envelope={identity:{...identity},kind,input:{...args,attemptId:crypto.randomUUID(),orderId:order.id,expectedVersion:order.version}};
    return new Promise(resolve=>{startTransition(async()=>{resolve(await send(envelope));});});
  }
  function move(order:Subject,target:string,reason?:string){
    if(!canWrite || blocked(order,operations.current[order.id]) || order.operationalStatus===target)return;
    if(!canTransition(order.operationalStatus,target)){setMessage("Abra os detalhes para Entregar, Desfazer entrega, Cancelar ou Reabrir. Estados terminais nunca usam transição simples.");return;}
    if(needsReason(order.operationalStatus,target) && reason===undefined){setReasonRequest({order,target});return;}
    const parsed=transitionInputSchema.safeParse({attemptId:crypto.randomUUID(),orderId:order.id,expectedVersion:order.version,targetStatus:target,reason:reason??null});
    if(!parsed.success){setMessage("Informe um motivo válido de até 1.000 caracteres.");return;}
    setReasonRequest(null);run(order,"transition",{targetStatus:target,reason:parsed.data.reason});
  }
  return {move,run,blockedIds,display,message,reasonRequest,setReasonRequest,
    retry:(id:string):Promise<OperationResult|undefined>=>{const op=operations.current[id];if(op && !op.pending && op.result && !op.result.ok && op.result.uncertain)return new Promise(resolve=>{startTransition(async()=>{resolve(await send(op.envelope));});});return Promise.resolve(undefined);},
    review:(id:string)=>{const op=operations.current[id];if(op && !op.pending && op.result && !op.result.ok && !op.result.uncertain && orders.some(order=>order.id===id && !blocked(order,op))){delete operations.current[id];persist();publish();setMessage("Falha conhecida revisada. Atualize e confirme uma nova intenção com os dados atuais.");router.refresh();}},
    reload:()=>router.refresh()};
}
export type TransitionController=ReturnType<typeof useOrderTransitions>;

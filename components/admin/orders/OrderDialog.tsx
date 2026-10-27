"use client";
import { useEffect, useRef, type ReactNode } from "react";

// Native modal supplies focus containment, inert background and Escape semantics.
export function OrderDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const dialog=ref.current;dialog?.showModal();
    return ()=>{dialog?.close();previous?.focus();};
  },[]);
  return <dialog ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} className="m-auto max-h-[90dvh] w-[min(95vw,42rem)] overflow-y-auto rounded-xl border border-[#c7c4d9] bg-white p-6 text-[#152336] shadow-xl backdrop:bg-black/40">
    <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-bold">{title}</h2><button type="button" aria-label="Fechar diálogo" onClick={onClose}>Fechar</button></div>{children}
  </dialog>;
}

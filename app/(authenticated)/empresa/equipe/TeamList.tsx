"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Member } from "@/lib/enterprise/management";
import { MemberDialog } from "./MemberDialog";

export function TeamList({members,total,unfilteredVisibleTotal,page,status,search,canManageAdmins}:{members:Member[];total:number;unfilteredVisibleTotal:number;page:number;status:string;search:string;canManageAdmins:boolean}) {
  const router=useRouter(), params=useSearchParams();
  const [pending,start]=useTransition();
  const [selected,setSelected]=useState<{member:Member;mode:"edit"|"status"}|null>(null);
  const trigger=useRef<HTMLButtonElement|null>(null);
  const update=(values:Record<string,string>)=>{const query=new URLSearchParams(params);Object.entries(values).forEach(([k,v])=>query.set(k,v));start(()=>router.push(`?${query}`));};
  const close=()=>{setSelected(null);trigger.current?.focus();};
  return <div className="mt-8" aria-busy={pending}>
    <form onSubmit={e=>{e.preventDefault();update({search:String(new FormData(e.currentTarget).get('search')??''),page:'1'});}} className="grid items-end gap-4 sm:grid-cols-[1fr,auto]">
      <div className="space-y-2">
        <label htmlFor="team-search" className="text-xs font-medium text-slate-500 uppercase tracking-widest">Buscar membro</label>
        <input id="team-search" key={search} name="search" type="search" maxLength={200} aria-label="Buscar por nome ou e-mail" defaultValue={search} className="min-h-11 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm text-[#152336] focus-visible:border-[#2B00FF] focus-visible:ring-2 focus-visible:ring-[#2B00FF]/20" placeholder="Nome ou e-mail" />
      </div>
      <button disabled={pending} className="min-h-11 rounded-lg bg-slate-100 px-5 text-sm font-semibold text-[#152336] hover:bg-slate-200">Buscar</button>
    </form>
    {pending&&<p role="status" className="mt-4">Carregando equipe...</p>}
    <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {members.length?<table className="w-full text-left text-sm"><thead><tr className="bg-slate-50 text-slate-500 uppercase tracking-wider text-xs"><th scope="col" className="p-4">Membro</th><th scope="col" className="p-4">Papel</th><th scope="col" className="p-4">Status</th><th scope="col" className="p-4">Ações</th></tr></thead><tbody className="divide-y divide-slate-100">{members.map(m=><tr key={m.membership_id} className="hover:bg-slate-50">
        <td className="p-4"><div className="font-semibold text-[#152336]">{m.full_name}</div><div className="text-slate-500">{m.email}</div>{m.must_change_password&&<span className="block text-amber-700 text-xs font-medium mt-1">Troca de senha obrigatória</span>}</td>
        <td className="p-4">{{owner:'Proprietário',admin:'Administrador',operator:'Operador'}[m.role]}</td>
        <td className="p-4"><span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${m.membership_status==='active'?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 bg-slate-100 text-slate-600'}`}>{m.membership_status==='active'?'Ativo':'Inativo'}</span></td>
        <td className="p-4">{!m.is_protected&&!m.is_self&&m.role!=='owner'&&(canManageAdmins||m.role==='operator')?<div className="flex gap-2">{(['edit','status'] as const).map(mode=><button key={mode} disabled={pending} onClick={e=>{trigger.current=e.currentTarget;setSelected({member:m,mode});}} className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-[#152336] hover:bg-slate-50">{mode==='edit'?'Editar':m.membership_status==='active'?'Desativar':'Ativar'}</button>)}</div>:<span>Protegido</span>}</td>
      </tr>)}</tbody></table>:<p className="p-8 text-slate-500">{unfilteredVisibleTotal===0?'Nenhum membro disponível.':'Nenhum membro encontrado nesta página ou para estes filtros.'}</p>}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-500"><p>Total: {total}</p><div className="flex gap-2"><button disabled={pending||page===1} onClick={()=>update({page:String(page-1)})} className="rounded-lg border px-4 py-2 hover:bg-slate-50">Anterior</button><span className="flex items-center px-2">Página {page}</span><button disabled={pending||page*20>=total} onClick={()=>update({page:String(page+1)})} className="rounded-lg border px-4 py-2 hover:bg-slate-50">Próximo</button></div></div>
    {selected&&<MemberDialog {...selected} canManageAdmins={canManageAdmins} close={close}/>}
  </div>;
}

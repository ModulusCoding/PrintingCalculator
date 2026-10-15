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
    <form onSubmit={e=>{e.preventDefault();update({search:String(new FormData(e.currentTarget).get('search')??''),page:'1'});}} className="flex flex-wrap gap-4">
      <input key={search} name="search" type="search" maxLength={200} aria-label="Buscar por nome ou e-mail" defaultValue={search} className="flex-1 rounded border p-3"/><button disabled={pending}>Buscar</button>
      <select aria-label="Filtrar status" value={status} onChange={e=>update({status:e.target.value,page:'1'})} className="rounded border p-3"><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></select>
    </form>
    {pending&&<p role="status">Carregando equipe...</p>}
    <div className="mt-6 overflow-x-auto rounded border">
      {members.length?<table className="w-full text-left text-sm"><thead><tr>{['Nome','E-mail','Papel','Status','Cadastro','Ações'].map(h=><th key={h} scope="col" className="p-3">{h}</th>)}</tr></thead><tbody>{members.map(m=><tr key={m.membership_id} className="border-t">
        <td className="p-3">{m.full_name}{m.must_change_password&&<span className="block text-amber-800">Troca de senha obrigatória</span>}</td><td className="p-3">{m.email}</td><td className="p-3">{{owner:'Proprietário',admin:'Administrador',operator:'Operador'}[m.role]}</td><td className="p-3">{m.membership_status==='active'?'Ativo':'Inativo'}</td><td className="p-3">{new Date(m.membership_created_at).toLocaleDateString('pt-BR',{timeZone:'UTC'})}</td>
        <td className="p-3">{!m.is_protected&&!m.is_self&&m.role!=='owner'&&(canManageAdmins||m.role==='operator')?<div className="flex gap-2">{(['edit','status'] as const).map(mode=><button key={mode} disabled={pending} onClick={e=>{trigger.current=e.currentTarget;setSelected({member:m,mode});}} className="rounded border px-2 py-1">{mode==='edit'?'Editar':m.membership_status==='active'?'Desativar':'Ativar'}</button>)}</div>:<span>Protegido</span>}</td>
      </tr>)}</tbody></table>:<p className="p-8">{unfilteredVisibleTotal===0?'Nenhum membro disponível.':'Nenhum membro encontrado nesta página ou para estes filtros.'}</p>}
    </div>
    <div className="mt-4 flex justify-between"><span>Total: {total}</span><div className="flex gap-2"><button disabled={pending||page===1} onClick={()=>update({page:String(page-1)})}>Anterior</button><span>Página {page}</span><button disabled={pending||page*20>=total} onClick={()=>update({page:String(page+1)})}>Próximo</button></div></div>
    {selected&&<MemberDialog {...selected} canManageAdmins={canManageAdmins} close={close}/>}
  </div>;
}

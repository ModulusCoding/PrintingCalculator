"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { memberMutation } from "@/lib/enterprise/actions";
import type { Member } from "@/lib/enterprise/management";
import { useRouter } from "next/navigation";

export function MemberDialog({member, mode, canManageAdmins, close}: {member:Member;mode:"edit"|"status";canManageAdmins:boolean;close:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending,start] = useTransition();
  const [message,setMessage] = useState("");
  const [blocked,setBlocked] = useState(false);
  const router=useRouter();
  useEffect(()=>{dialog.current?.showModal();},[]);
  const target=member.membership_status==='active'?'inactive':'active';
  return <dialog ref={dialog} aria-labelledby="member-title" onCancel={e=>{e.preventDefault();if(!pending)close();}} onClick={e=>{if(e.target===e.currentTarget&&!pending)close();}} className="m-auto w-full max-w-md rounded-2xl p-6 backdrop:bg-[#152336]/40 text-[#152336]">
    <h2 id="member-title" className="text-xl font-semibold tracking-tight">{mode==='edit'?'Editar membro':target==='inactive'?'Desativar membro':'Ativar membro'}</h2>
    <form action={form=>start(async()=>{
      try {const result=await memberMutation(mode,null,form);
        if(result.status==='success'){router.refresh();close();return;}
        const messages:Record<string,string>={session_expired:'Sua sessão expirou. Entre novamente.',permission_denied:'Você não tem permissão para esta alteração.',invalid_input:'Confira os campos informados.',target_unavailable:'Membro indisponível.',protected:'Este membro está protegido.',name_not_editable:'O nome não pode ser alterado. Nenhuma alteração foi aplicada.',conflict:'Os dados mudaram. Atualize a página antes de tentar novamente.',unknown:'Não foi possível confirmar o resultado. Confira os dados antes de reenviar.',technical:'Não foi possível concluir a operação.'};
        setMessage(result.fieldErrors ? Object.values(result.fieldErrors).flat().join(' ') : messages[result.status]);
        setBlocked(['unknown','conflict'].includes(result.status));
      } catch {setMessage('Não foi possível confirmar o resultado. Confira os dados antes de reenviar.');setBlocked(true);}
    })} className="mt-6 space-y-4">
      <input type="hidden" name="membership_id" value={member.membership_id}/><input type="hidden" name="version" value={member.version}/>{mode === "edit" && <input type="hidden" name="expected_full_name" value={member.full_name}/>}
      {mode==='edit'?<>
        <label className="block text-sm font-medium">Nome<input autoFocus name={member.name_editable?'full_name':undefined} defaultValue={member.full_name} disabled={!member.name_editable||pending} required maxLength={200} className="mt-1 w-full rounded-lg border border-slate-300 p-3 focus-visible:border-[#2B00FF] focus-visible:ring-2 focus-visible:ring-[#2B00FF]/20"/></label>
        {!member.name_editable&&<><input type="hidden" name="full_name" value={member.full_name}/><p className="text-sm text-slate-500">Este nome é compartilhado por mais de um vínculo e não pode ser editado aqui. O papel ainda pode ser alterado conforme suas permissões.</p></>}
        {canManageAdmins?<label className="block text-sm font-medium">Papel<select name="role" defaultValue={member.role} disabled={pending} className="mt-1 w-full rounded-lg border border-slate-300 p-3 focus-visible:border-[#2B00FF] focus-visible:ring-2 focus-visible:ring-[#2B00FF]/20"><option value="operator">Operador</option><option value="admin">Administrador</option></select></label>:<><input type="hidden" name="role" value="operator"/><p className="text-sm">Papel: Operador</p></>}
        <p className="text-sm text-slate-700">Confirma salvar as alterações deste membro?</p>
      </>:<><input type="hidden" name="status" value={target}/><p className="text-sm text-slate-700">{target==='inactive'?'Confirma desativar este membro?':'Confirma ativar este membro?'} <strong>{member.full_name}</strong></p><p className="text-sm text-slate-500">Esta alteração afeta apenas o vínculo com esta empresa, não a conta global. Ativar o vínculo não garante acesso se houver outros bloqueios.</p></>}
      {message&&<p role="alert" className="text-sm text-red-600 font-medium">{message}</p>}
      {blocked&&<a href={typeof window==='undefined'?'':window.location.href} className="text-sm text-[#2B00FF] underline">Atualizar dados</a>}
      <div className="flex justify-end gap-3 mt-8"><button type="button" disabled={pending} onClick={close} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 text-[#152336]">Cancelar</button><button disabled={pending||blocked} className="rounded-lg bg-[#2B00FF] px-4 py-2 text-sm font-medium text-white hover:bg-[#2200CC] disabled:opacity-50">{pending?'Salvando...':'Confirmar'}</button></div>
    </form>
  </dialog>;
}

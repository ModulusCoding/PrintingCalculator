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
  return <dialog ref={dialog} aria-labelledby="member-title" onCancel={e=>{e.preventDefault();if(!pending)close();}} onClick={e=>{if(e.target===e.currentTarget&&!pending)close();}} className="m-auto w-full max-w-md rounded-xl p-6 backdrop:bg-black/40">
    <h2 id="member-title" className="text-xl font-bold">{mode==='edit'?'Editar membro':target==='inactive'?'Desativar membro':'Ativar membro'}</h2>
    <form action={form=>start(async()=>{
      try {const result=await memberMutation(mode,null,form);
        if(result.status==='success'){router.refresh();close();return;}
        const messages:Record<string,string>={session_expired:'Sua sessão expirou. Entre novamente.',permission_denied:'Você não tem permissão para esta alteração.',invalid_input:'Confira os campos informados.',target_unavailable:'Membro indisponível.',protected:'Este membro está protegido.',name_not_editable:'O nome não pode ser alterado. Nenhuma alteração foi aplicada.',conflict:'Os dados mudaram. Atualize a página antes de tentar novamente.',unknown:'Não foi possível confirmar o resultado. Confira os dados antes de reenviar.',technical:'Não foi possível concluir a operação.'};
        setMessage(result.fieldErrors ? Object.values(result.fieldErrors).flat().join(' ') : messages[result.status]);
        setBlocked(['unknown','conflict'].includes(result.status));
      } catch {setMessage('Não foi possível confirmar o resultado. Confira os dados antes de reenviar.');setBlocked(true);}
    })} className="mt-4 space-y-4">
      <input type="hidden" name="membership_id" value={member.membership_id}/><input type="hidden" name="version" value={member.version}/>{mode === "edit" && <input type="hidden" name="expected_full_name" value={member.full_name}/>}
      {mode==='edit'?<>
        <label className="block">Nome<input autoFocus name={member.name_editable?'full_name':undefined} defaultValue={member.full_name} disabled={!member.name_editable||pending} required maxLength={200} className="mt-1 w-full rounded border p-2"/></label>
        {!member.name_editable&&<><input type="hidden" name="full_name" value={member.full_name}/><p className="text-sm">Este nome é compartilhado por mais de um vínculo e não pode ser editado aqui. O papel ainda pode ser alterado conforme suas permissões.</p></>}
        {canManageAdmins?<label className="block">Papel<select name="role" defaultValue={member.role} disabled={pending} className="mt-1 w-full rounded border p-2"><option value="operator">Operador</option><option value="admin">Administrador</option></select></label>:<><input type="hidden" name="role" value="operator"/><p>Papel: Operador</p></>}
        <p>Confirma salvar as alterações deste membro?</p>
      </>:<><input type="hidden" name="status" value={target}/><p>{target==='inactive'?'Confirma desativar este membro?':'Confirma ativar este membro?'} {member.full_name}</p><p className="text-sm">Esta alteração afeta apenas o vínculo com esta empresa, não a conta global. Ativar o vínculo não garante acesso se houver outros bloqueios.</p></>}
      {message&&<p role="alert">{message}</p>}
      {blocked&&<a href={typeof window==='undefined'?'':window.location.href} className="underline">Atualizar dados</a>}
      <div className="flex justify-end gap-2"><button type="button" disabled={pending} onClick={close} className="rounded border px-3 py-2">Cancelar</button><button disabled={pending||blocked} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">{pending?'Salvando...':'Confirmar'}</button></div>
    </form>
  </dialog>;
}

"use client";
import { useActionState } from "react";
import { updateCompanyName } from "@/lib/enterprise/actions";
import type { Company } from "@/lib/enterprise/management";

type ActionState = { status: "idle" } | { status: "permission_denied" | "technical" | "conflict" | "unknown" | "invalid_input"; message: string } | { status: "success"; name: string; version: number };
const initialState: ActionState = { status: "idle" };

export function CompanyForm({ company }: { company: Company }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (_: ActionState, form: FormData) => {
    const res = await updateCompanyName(null, form);
    if (res.status === "success") return res;
    return { status: res.status, message: res.status === "permission_denied" ? "Acesso negado para gerenciar a empresa." : "Não foi possível atualizar o nome." };
  }, initialState);
  const value = state.status === "success" ? state.name : company.name;
  const version = state.status === "success" ? state.version : company.version;
  const invalid = state.status === "conflict" || state.status === "unknown";
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="version" value={version} />
      <label htmlFor="company-name" className="block font-medium">
        Nome da empresa
        <input id="company-name" name="name" defaultValue={value} maxLength={200} required aria-invalid={invalid} aria-describedby="company-name-help company-name-error" className="mt-2 w-full rounded-lg border p-3 focus:outline-none focus:ring-2 focus:ring-[#5852ff]" />
      </label>
      <p id="company-name-help" className="text-sm text-gray-600">Obrigatório, até 200 caracteres.</p>
      {state.status !== "idle" && state.status !== "success" && <p id="company-name-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">{state.message}{state.status === "conflict" || state.status === "unknown" ? " Atualize a página para conferir o nome atual antes de reenviar." : ""}</p>}
      {state.status === "success" && <p role="status" className="text-green-700">Nome atualizado com sucesso: {state.name}</p>}
      {(state.status === "conflict" || state.status === "unknown") && <button type="button" onClick={() => window.location.reload()} className="rounded-lg border px-4 py-2">Atualizar dados</button>}
      <button disabled={pending} className="rounded-lg bg-[#5852ff] px-4 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Salvando..." : "Salvar nome"}</button>
    </form>
  );
}
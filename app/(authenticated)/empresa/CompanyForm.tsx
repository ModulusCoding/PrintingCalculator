"use client";
import { useActionState, useState } from "react";
import { updateCompanyName, updateCompanyRateAction } from "@/lib/enterprise/actions";
import type { Company } from "@/lib/enterprise/management";

type ActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "permission_denied" | "technical" | "conflict" | "unknown" | "invalid_input" | "session_expired"; message: string };

const initialNameState: ActionState = { status: "idle" };
const initialRateState: ActionState = { status: "idle" };

export function CompanyForm({ company }: { company: Company }) {
  const [currentVersion, setCurrentVersion] = useState<number>(company.version);
  const [currentName, setCurrentName] = useState<string>(company.name);
  const [currentRate, setCurrentRate] = useState<number | null>(company.electricity_rate_per_kwh);

  const [nameState, nameAction, namePending] = useActionState<ActionState, FormData>(
    async (_: ActionState, form: FormData) => {
      const res = await updateCompanyName(null, form);
      if (res.status === "success") {
        if (res.version !== undefined) setCurrentVersion(res.version);
        if (res.name !== undefined) setCurrentName(res.name);
        return { status: "success", message: "Nome salvo com sucesso." };
      }
      if (res.status === "conflict") {
        return { status: "conflict", message: "Outro usuário ou processo atualizou os dados da empresa. Atualize a página antes de continuar." };
      }
      return {
        status: res.status,
        message: res.status === "permission_denied"
          ? "Acesso negado."
          : res.status === "invalid_input"
            ? "Nome inválido."
            : "Erro ao atualizar nome."
      };
    },
    initialNameState
  );

  const [rateState, rateAction, ratePending] = useActionState<ActionState, FormData>(
    async (_: ActionState, form: FormData) => {
      const res = await updateCompanyRateAction(null, form);
      if (res.status === "success") {
        if (res.version !== undefined) setCurrentVersion(res.version);
        if (res.electricity_rate_per_kwh !== undefined) setCurrentRate(res.electricity_rate_per_kwh);
        return { status: "success", message: "Tarifa salva com sucesso." };
      }
      if (res.status === "conflict") {
        return { status: "conflict", message: "Outro usuário ou processo atualizou os dados da empresa. Atualize a página antes de continuar." };
      }
      return {
        status: res.status,
        message: res.status === "permission_denied"
          ? "Acesso negado."
          : res.status === "invalid_input"
            ? "Tarifa inválida. Use um valor entre 0 e 100 com até 6 casas decimais."
            : res.status === "session_expired"
              ? "Sessão expirada. Faça login novamente."
              : res.status === "unknown"
                ? "Resultado da atualização incerto. Verifique os dados ou tente novamente."
                : "Erro ao atualizar tarifa."
      };
    },
    initialRateState
  );

  return (
    <div className="mt-8 space-y-8">
      <form action={nameAction} className="space-y-4">
        <input type="hidden" name="version" value={currentVersion} />
        <label htmlFor="company-name" className="block font-medium">
          Nome da empresa
          <input id="company-name" name="name" defaultValue={currentName} className="mt-2 w-full rounded-lg border p-3" />
        </label>
        {nameState.status === "success" && <p className="text-sm font-medium text-green-600">{nameState.message}</p>}
        {nameState.status !== "idle" && nameState.status !== "success" && <p className="text-sm font-medium text-red-600">{nameState.message}</p>}
        <button type="submit" disabled={namePending} className="rounded-lg bg-[#5852ff] px-4 py-2 font-semibold text-white disabled:opacity-50">
          {namePending ? "Salvando..." : "Salvar nome"}
        </button>
      </form>

      <form action={rateAction} className="space-y-4 border-t pt-8">
        <input type="hidden" name="version" value={currentVersion} />
        <label htmlFor="electricity-rate" className="block font-medium">
          Tarifa de energia (R$/kWh)
          <input id="electricity-rate" name="electricity_rate_per_kwh" type="text" defaultValue={currentRate !== null ? currentRate.toString().replace('.', ',') : ""} className="mt-2 w-full rounded-lg border p-3" />
        </label>
        <p className="text-sm text-gray-600">Opcional. Valor entre 0 e 100 com até 6 casas decimais (ex: 0,854321). Deixe em branco para remover.</p>
        {rateState.status === "success" && <p className="text-sm font-medium text-green-600">{rateState.message}</p>}
        {rateState.status !== "idle" && rateState.status !== "success" && <p className="text-sm font-medium text-red-600">{rateState.message}</p>}
        <button type="submit" disabled={ratePending} className="rounded-lg bg-[#5852ff] px-4 py-2 font-semibold text-white disabled:opacity-50">
          {ratePending ? "Salvando..." : "Salvar tarifa"}
        </button>
      </form>
    </div>
  );
}

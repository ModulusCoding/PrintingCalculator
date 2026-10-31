"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { provisionEmployeeAction, resumeProvisioningAction, type EmployeeProvisioningResult } from "@/lib/employees/provisioning";

const initialState: EmployeeProvisioningResult = { status: "idle" };

type Props = { initialOperationId?: string };

export function EmployeeProvisioningForm({ initialOperationId }: Props) {
  const [state, formAction, pending] = useActionState(provisionEmployeeAction, initialState);
  const [resumeState, resumeAction, resumePending] = useActionState(resumeProvisioningAction, initialState);
  const resumeOperationId = initialOperationId ?? ("operationId" in state ? state.operationId : undefined);
  const displayedState = resumeState.status === "idle" ? state : resumeState;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resumeOperationId) {
      const url = new URL(window.location.href);
      url.searchParams.set("operationId", resumeOperationId);
      window.history.replaceState(null, "", url);
    }
  }, [resumeOperationId]);
  const terminal = Boolean(resumeOperationId) || state.status === "success" || state.status === "partial" || state.status === "outcome_unknown" || state.status === "resume" || resumeState.status === "resume";

  useEffect(() => {
    if (terminal) {
      const passwordInput = formRef.current?.querySelector<HTMLInputElement>("[name=temporaryPassword]");
      if (passwordInput) passwordInput.value = "";
      const confirmationInput = formRef.current?.querySelector<HTMLInputElement>("[name=temporaryPasswordConfirmation]");
      if (confirmationInput) confirmationInput.value = "";
    }
  }, [terminal]);

  const fields = state.status === "error" ? state.fieldErrors ?? {} : {};
  const inputClass = "mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-[#152336] outline-none transition focus:border-[#2B00FF] focus:ring-2 focus:ring-[#2B00FF]/20";
  const errorId = (name: string) => `${name}-error`;

  if (terminal) {
    const success = (state.status === "success" && (state.code === "completed" || state.code === "already_completed")) ||
                    (resumeState.status === "resume" && (resumeState.code === "completed" || resumeState.code === "already_completed"));
    const isAlreadyCompleted = (state.status === "success" && state.code === "already_completed") ||
                               (resumeState.status === "resume" && resumeState.code === "already_completed");
    const unknown = displayedState.status === "outcome_unknown" || (displayedState.status === "resume" && displayedState.code === "outcome_unknown");
    const notFound = displayedState.status === "resume" && displayedState.code === "auth_account_not_found";
    const inconsistentOrFailed = displayedState.status === "resume" && (displayedState.code === "inconsistent" || displayedState.code === "failed");

    return (
      <section className={`rounded-lg border p-5 ${success ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} role="alert" aria-live="polite">
        <h2 className={`text-lg font-semibold ${success ? "text-emerald-900" : "text-amber-900"}`}>
          {success ? (isAlreadyCompleted ? "Cadastro já concluído" : "Funcionário cadastrado") : unknown ? "Resultado não confirmado" : notFound ? "Conta não localizada" : inconsistentOrFailed ? "Revisão necessária" : "Conclusão pendente"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{displayedState.status !== "idle" ? displayedState.message : "Operação pendente."}</p>
        {success && <p className="mt-3 text-sm font-medium text-[#152336]">O funcionário deverá trocar a senha no primeiro acesso.</p>}
        {!success && <p className="mt-3 text-sm font-medium text-[#152336]">Esta verificação não cria outra conta nem altera senhas. Verifique a operação com o responsável se necessário.</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          {success && <button type="button" onClick={() => { const url = new URL(window.location.href); url.searchParams.delete("operationId"); window.location.assign(url.toString()); }} className="rounded-lg bg-[#2B00FF] px-4 py-3 font-semibold text-white hover:bg-[#2200CC] focus:outline-none focus:ring-2 focus:ring-[#2B00FF] focus:ring-offset-2">Cadastrar outro funcionário</button>}
          {!success && !inconsistentOrFailed && resumeOperationId && (
            <form action={resumeAction}>
              <input type="hidden" name="operationId" value={resumeOperationId} />
              <button type="submit" disabled={resumePending} className="rounded-lg bg-[#2B00FF] px-4 py-3 font-semibold text-white hover:bg-[#2200CC] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#2B00FF] focus:ring-offset-2">{resumePending ? "Verificando e concluindo..." : "Verificar e concluir cadastro"}</button>
            </form>
          )}
          <Link href="/empresa/equipe" className="rounded-lg border border-slate-300 bg-white px-4 py-3 font-semibold text-[#152336] hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#2B00FF] focus:ring-offset-2">Voltar para equipe</Link>
        </div>
      </section>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5" noValidate>
      {state.status === "error" && state.message && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{state.message}</div>}
      <div>
        <label htmlFor="fullName" className="font-medium text-[#152336]">Nome completo</label>
        <input id="fullName" name="fullName" type="text" maxLength={200} autoComplete="name" className={inputClass} aria-invalid={Boolean(fields.fullName)} aria-describedby={fields.fullName ? errorId("fullName") : undefined} />
        {fields.fullName && <p id={errorId("fullName")} className="mt-1 text-sm text-red-600">{fields.fullName}</p>}
      </div>
      <div>
        <label htmlFor="email" className="font-medium text-[#152336]">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" className={inputClass} aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? errorId("email") : undefined} />
        {fields.email && <p id={errorId("email")} className="mt-1 text-sm text-red-600">{fields.email}</p>}
      </div>
      <div>
        <label htmlFor="role" className="font-medium text-[#152336]">Papel</label>
        <select id="role" name="role" defaultValue="operator" className={inputClass} aria-invalid={Boolean(fields.role)} aria-describedby={fields.role ? errorId("role") : undefined}>
          <option value="operator">Operador</option>
        </select>
        {fields.role && <p id={errorId("role")} className="mt-1 text-sm text-red-600">{fields.role}</p>}
      </div>
      <div className="space-y-5">
        <PasswordField id="temporaryPassword" label="Senha temporária" show={showPassword} onToggle={() => setShowPassword(v => !v)} error={fields.temporaryPassword} inputClass={inputClass} errorId={errorId("temporaryPassword")} />
        <PasswordField id="temporaryPasswordConfirmation" label="Confirme a senha temporária" show={showConfirmation} onToggle={() => setShowConfirmation(v => !v)} error={fields.temporaryPasswordConfirmation} inputClass={inputClass} errorId={errorId("temporaryPasswordConfirmation")} />
      </div>
      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900">
        <p>Compartilhe a senha temporária diretamente com o funcionário. Ele deverá alterá-la no primeiro acesso.</p>
        <p className="mt-1">Este cadastro não envia convite por e-mail.</p>
      </div>
      <button type="submit" disabled={pending} className="flex w-full items-center justify-center rounded-lg bg-[#2B00FF] px-4 py-3 font-semibold text-white transition hover:bg-[#2200CC] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#2B00FF] focus:ring-offset-2">
        {pending ? "Cadastrando funcionário..." : "Cadastrar funcionário"}
      </button>
    </form>
  );
}

function PasswordField({ id, label, show, onToggle, error, inputClass, errorId }: { id: string; label: string; show: boolean; onToggle: () => void; error?: string; inputClass: string; errorId: string }) {
  return <div>
    <label htmlFor={id} className="font-medium text-[#152336]">{label}</label>
    <div className="relative mt-2">
      <input id={id} name={id} type={show ? "text" : "password"} autoComplete="new-password" className={`${inputClass} pr-20 !mt-0`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
      <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-sm text-[#2B00FF] hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-[#2B00FF]" aria-label={show ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}>{show ? "Ocultar" : "Mostrar"}</button>
    </div>
    {error && <p id={errorId} className="mt-1 text-sm text-red-600">{error}</p>}
  </div>;
}

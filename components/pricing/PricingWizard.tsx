"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { numericError, type NumericRule } from "@/lib/pricing/input";

export const pricingButton = "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2B00FF] px-5 py-3 text-sm font-medium text-white hover:bg-[#2200CC] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF]";
export const pricingPanel = "min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6";
const steps = ["Filamento", "Impressora e energia", "Lote e acabamento", "Embalagens", "Revisão", "Resultado"];

export function PricingInput({ label, value, onChange, rule, textMax = 200 }: { label: string; value: string; onChange: (value: string) => void; rule?: NumericRule; textMax?: number }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const error = rule ? numericError(value, rule) : !value.trim() ? "Informe um nome." : value.trim().length > textMax ? `Use até ${textMax} caracteres.` : null;
  return <div className="min-w-0"><label htmlFor={id} className="block text-sm font-medium text-[#152336]">{label}</label><input id={id} type="text" inputMode={rule ? rule.integer ? "numeric" : "decimal" : "text"} value={value} onChange={event => onChange(event.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!error} aria-describedby={touched && error ? `${id}-error` : undefined} data-pricing-invalid={error ? "true" : undefined} onInvalid={() => setTouched(true)} className={`mt-2 min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B00FF] ${touched && error ? "border-red-500" : "border-slate-300"}`} />{touched && error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-red-800">{error}</p>}</div>;
}

export function PricingWizard({ step, setStep, validateStep, children, summary, mode, onCalculate, disabled = false }: { step: number; setStep: (step: number) => void; validateStep: (step: number) => boolean; children: ReactNode[]; summary: ReactNode; mode: string; onCalculate?: () => boolean; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [stepError, setStepError] = useState(false);
  function valid(index: number) {
    const section = root.current?.querySelector(`[data-pricing-step="${index}"]`);
    const invalid = section?.querySelectorAll<HTMLInputElement>('[data-pricing-invalid="true"]');
    invalid?.forEach(input => input.dispatchEvent(new Event("invalid", { bubbles: false })));
    const domainValid = validateStep(index);
    if (invalid?.length || !domainValid) {
      setStepError(true);
      if (index !== step) setStep(index);
      // Panels stay mounted, but only the active one is exposed.
      requestAnimationFrame(() => {
        // Domain errors may only mount after validateStep updates the form state.
        const activeSection = root.current?.querySelector(`[data-pricing-step="${index}"]`);
        (invalid?.[0] ?? activeSection?.querySelector<HTMLElement>('[data-pricing-domain-invalid="true"]') ?? activeSection?.querySelector<HTMLElement>("button, input, select"))?.focus();
      });
      return false;
    }
    return true;
  }
  function navigate(target: number) {
    if (disabled) return;
    if (target > step) {
      for (let index = 0; index < Math.min(target, 5); index++) if (!valid(index)) return;
      if (target === 5 && onCalculate && !onCalculate()) return;
    }
    setStepError(false); setStep(target);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return <div ref={root} onKeyDown={event => {
    // Require an explicit button action; Enter in a field must never save or advance.
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault();
  }} className="@container mx-auto max-w-[1600px] space-y-6 text-[#152336]">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-widest text-[#2B00FF]">Produção · FDM</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Precificadora</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">{mode} · Tempo e consumo de filamento representam o lote completo. Simular ou salvar não movimenta estoque.</p></div><Link href="/precificadora/historico" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-[#2B00FF] focus-visible:outline-2">Histórico</Link></header>
    <nav aria-label="Etapas da precificação"><ol className="grid grid-cols-2 gap-2 @min-[560px]:grid-cols-3 @min-[960px]:grid-cols-6">{steps.map((title, index) => <li key={title} className="min-w-0"><button type="button" disabled={disabled} aria-current={index === step ? "step" : undefined} onClick={() => navigate(index)} className={`flex min-h-14 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B00FF] ${index === step ? "border-[#2B00FF] bg-[#2B00FF] text-white" : "border-slate-200 bg-white text-slate-600"}`}><span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#A6B4FF]/20">{index + 1}</span><span className="break-words">{title}</span></button></li>)}</ol></nav>
    <div className="h-1 overflow-hidden rounded bg-slate-200" role="progressbar" aria-label="Progresso das etapas" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step + 1} aria-valuetext={`Etapa ${step + 1} de ${steps.length}: ${steps[step]}`}><div className="h-full bg-[#2B00FF]" style={{ width: `${(step + 1) / 6 * 100}%` }} /></div>
    <div className="grid items-start gap-6 min-[1200px]:grid-cols-[minmax(0,2.5fr)_minmax(250px,1fr)]"><div className={pricingPanel}><div><p className="text-xs font-medium uppercase tracking-wide text-[#2B00FF]">Etapa {step + 1} de 6</p><h2 ref={heading} tabIndex={-1} className="mt-2 text-xl font-semibold focus-visible:outline-2">{steps[step]}</h2></div>
      {stepError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">Revise os campos indicados e as seleções obrigatórias desta etapa. Nenhum valor inválido foi convertido em zero.</p>}
      <fieldset disabled={disabled} className="min-w-0">{children.map((child, index) => <div key={index} data-pricing-step={index} hidden={step !== index}>{child}</div>)}</fieldset>
      <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5"><button type="button" disabled={step === 0 || disabled} onClick={() => navigate(step - 1)} className="min-h-11 rounded-lg border border-slate-300 px-5 py-2 text-sm disabled:opacity-50">Voltar</button>{step < 5 && <button type="button" disabled={disabled} onClick={() => navigate(step + 1)} className={pricingButton}>{step === 4 ? "Calcular e ver resultado" : "Continuar"}</button>}</div>
    </div><aside className={pricingPanel} aria-label="Contexto da simulação"><h2 className="font-semibold">Sua simulação</h2>{summary}<p className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">O resultado só é definitivo após validar e calcular. Salvar preserva um snapshot; aplicar o preço exige a revisão no histórico.</p></aside></div>
  </div>;
}

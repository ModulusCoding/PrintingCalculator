"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { planActionMessage } from "@/lib/plans/action-messages";
import { updateSpoolThreshold } from "@/lib/spools/actions";
import type { Config } from "@/lib/spools/schemas";
import { fieldErrors, updateThresholdSchema } from "@/lib/spools/validation";
import styles from "./SpoolForms.module.css";

type Result = { status: string; fieldErrors?: Record<string, string[]> };
const messages: Record<string, string> = {
  updated: "Limite salvo.", no_change: "Nenhuma alteração necessária.",
  version_conflict: "Configuração alterada. Atualize a página e revise o limite.",
  permission_denied: "Sem permissão para alterar este limite.", invalid_input: "Revise o limite informado.",
  technical: "Falha técnica. Tente novamente.", session_expired: "Sua sessão expirou. Entre novamente.",
  uncertain: "Não foi possível confirmar o resultado. Confira a configuração antes de tentar novamente.",
};

export function ThresholdForm({ config }: { config: Config }) {
  const router = useRouter();
  const id = useId();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const errors = result?.fieldErrors?.threshold;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const payload = { threshold: new FormData(event.currentTarget).get("threshold"), expected_version: config.version };
    const parsed = updateThresholdSchema.safeParse(payload);
    if (!parsed.success) { setResult({ status: "invalid_input", fieldErrors: fieldErrors(parsed.error) }); return; }
    sending.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await updateSpoolThreshold(payload);
      setResult(response);
      if (response.status === "updated" || response.status === "no_change") router.refresh();
    } catch { setResult({ status: "uncertain" }); }
    finally { sending.current = false; setBusy(false); }
  }

  const saved = result?.status === "updated" || result?.status === "no_change";
  return <form onSubmit={save} noValidate className={styles.card} aria-busy={busy}>
    <header className={styles.header}><span className={styles.eyebrow}>ALERTA DE ESTOQUE</span><h2>Limite de baixo saldo</h2><p>Percentual do peso original abaixo do qual o carretel aparece em “Baixo saldo”.</p></header>
    <div className={styles.field}>
      <label htmlFor={id}>Limite (0 a 100) <span className={styles.required}>*</span></label>
      <div className={styles.percent}><input id={id} required name="threshold" defaultValue={config.low_spool_threshold_percent.toString().replace(".", ",")} inputMode="decimal" className={styles.input} disabled={busy} aria-invalid={!!errors?.length} aria-describedby={`${id}-hint${errors?.length ? ` ${id}-error` : ""}`} /><span aria-hidden="true">%</span></div>
      <p id={`${id}-hint`} className={styles.hint}>De 0 a 100%, com até 2 casas decimais. Ex.: 20,50.</p>
      {!!errors?.length && <div id={`${id}-error`} className={styles.error}>{errors.map(error => <p key={error}>{error}</p>)}</div>}
    </div>
    {result && <p role={saved ? "status" : "alert"} className={saved ? styles.success : styles.notice}>{messages[result.status] ?? (planActionMessage(result.status) || "Não foi possível salvar o limite.")}</p>}
    <div className={styles.footer}><button type="submit" disabled={busy} className={styles.primary}>{busy ? "Salvando…" : "Salvar limite"}</button></div>
  </form>;
}

"use client";

import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { planActionMessages } from "@/lib/plans/action-messages";
import { createMovement, createSpool, setSpoolActive, updateSpoolProfile } from "@/lib/spools/actions";
import type { Spool } from "@/lib/spools/schemas";
import { createMovementSchema, createSpoolSchema, fieldErrors, setActiveSchema, updateProfileSchema } from "@/lib/spools/validation";
import { normalizeSpoolColor } from "@/lib/spools/color";
import { SpoolColorField } from "./SpoolColorField";
import styles from "./SpoolForms.module.css";

const invalidColor = "Informe um HEX válido com # (#RRGGBB ou #RGB) ou um nome de cor (até 80 caracteres).";

function previewGrams(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(trimmed)) return null;
  const number = Number(trimmed.replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number <= 100000 ? number : null;
}

type ResultType = { status: string; fieldErrors?: Record<string, string[]>; spool_id?: string; version?: number };
type Payload = Record<string, unknown>;
type Operation = "movement" | "profile" | "archive";
type Attempt = { operation: Operation; payload: Payload };
const success = new Set(["created", "idempotent", "updated", "no_change"]);
const messages: Record<string, string> = {
  ...planActionMessages,
  created: "Operação registrada.", idempotent: "Operação já registrada.", updated: "Alteração salva.",
  no_change: "Nenhuma alteração necessária.", version_conflict: "O registro mudou. Atualize a página e revise os dados.",
  uncertain: "Não foi possível confirmar o resultado. Os dados foram preservados. Repita a mesma tentativa antes de realizar outra operação.",
  technical: "Falha técnica. Tente novamente.", invalid_input: "Revise os campos indicados.",
  permission_denied: "Você não tem permissão para esta operação.", session_expired: "Sua sessão expirou. Entre novamente.",
  insufficient_balance: "Saldo insuficiente para este consumo.", capacity_exceeded: "O saldo ultrapassaria o peso original do carretel.",
  identifier_conflict: "Este identificador interno já está em uso.", spool_unavailable: "Carretel indisponível. Atualize a página.",
  idempotency_conflict: "Esta tentativa não corresponde à operação registrada. Atualize a página e confira o histórico.",
};

function Notice({ result }: { result: ResultType | null }) {
  if (!result) return null;
  return <div role={success.has(result.status) ? "status" : "alert"} className={success.has(result.status) ? styles.success : styles.notice}>
    <p>{messages[result.status] ?? "Não foi possível concluir a operação. Tente novamente."}</p>
    {result.fieldErrors?._form?.map(error => <p key={error}>{error}</p>)}
  </div>;
}

function Input({ name, label, errors, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; errors?: string[]; hint?: string }) {
  const id = useId();
  return <div className={styles.field}>
    <label htmlFor={id}>{label}{props.required && <span className={styles.required}> *</span>}</label>
    <input {...props} id={id} name={name} className={styles.input} aria-invalid={!!errors?.length} aria-describedby={[hint ? `${id}-hint` : "", errors?.length ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} />
    {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
    {!!errors?.length && <div id={`${id}-error`} className={styles.error}>{errors.map(error => <p key={error}>{error}</p>)}</div>}
  </div>;
}

export function NewSpoolForm() {
  const router = useRouter();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState<Payload | null>(null);
  const [originalDraft, setOriginalDraft] = useState("");
  const [balanceDraft, setBalanceDraft] = useState("");
  const [result, setResult] = useState<ResultType | null>(null);
  const disabled = busy || !!frozen;
  const errors = result?.fieldErrors;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    let payload = frozen ?? { ...Object.fromEntries(new FormData(event.currentTarget)), attempt_id: crypto.randomUUID() };
    const color = typeof payload.color === "string" ? normalizeSpoolColor(payload.color) : null;
    if (color === null) { setResult({ status: "invalid_input", fieldErrors: { color: [invalidColor] } }); return; }
    if (!frozen) payload = { ...payload, color };
    const parsed = createSpoolSchema.safeParse(payload);
    if (!parsed.success) { setResult({ status: "invalid_input", fieldErrors: fieldErrors(parsed.error) }); return; }
    // Keep raw values: optional text transforms to null in the schema, but actions expect strings.
    sending.current = true;
    setBusy(true);
    setFrozen(payload);
    setResult(null);
    try {
      const response = await createSpool(payload);
      setResult(response);
      if ((response.status === "created" || response.status === "idempotent") && response.spool_id) {
        router.push(`/estoque/carreteis/${response.spool_id}?returnTo=${encodeURIComponent("/estoque/carreteis")}`);
      } else if (response.status !== "uncertain") setFrozen(null);
    } catch { setResult({ status: "uncertain" }); }
    finally { sending.current = false; setBusy(false); }
  }

  return <form onSubmit={onSubmit} noValidate className={styles.card} aria-busy={busy}>
    <header className={styles.header}><span className={styles.eyebrow}>ESTOQUE · FILAMENTOS</span><h2>Novo carretel</h2><p>Identifique seu filamento e informe o saldo disponível para impressão.</p></header>
    <Notice result={result} />
    <div className={styles.grid}>
      <Input required name="material_type" label="Tipo de filamento" placeholder="Ex.: PLA, PETG, ABS" maxLength={80} disabled={disabled} errors={errors?.material_type} />
      <Input required name="internal_identifier" label="Identificador interno" placeholder="Ex.: PLA-01" maxLength={120} disabled={disabled} errors={errors?.internal_identifier} />
      <Input name="brand" label="Marca" placeholder="Marca do filamento" maxLength={120} disabled={disabled} errors={errors?.brand} />
      <SpoolColorField disabled={disabled} errors={errors?.color} remainingGrams={previewGrams(balanceDraft)} referenceGrams={previewGrams(originalDraft)} lowThresholdPercent={null} />
    </div>
    <div className={styles.gridThree}>
      <Input required name="original_grams" value={originalDraft} onChange={event => setOriginalDraft(event.target.value)} label="Peso original (g)" inputMode="decimal" placeholder="1.000 em gramas: 1000" hint="Até 3 casas decimais. Ex.: 1000,000." disabled={disabled} errors={errors?.original_grams} />
      <Input required name="initial_balance_grams" value={balanceDraft} onChange={event => setBalanceDraft(event.target.value)} label="Saldo inicial (g)" inputMode="decimal" placeholder="Ex.: 750,500" hint="Não pode superar o peso original." disabled={disabled} errors={errors?.initial_balance_grams} />
      <Input required name="purchase_price" label="Preço pago (R$)" inputMode="decimal" placeholder="Ex.: 89,90" hint="Valor em reais, com até 2 casas decimais." disabled={disabled} errors={errors?.purchase_price} />
    </div>
    <footer className={styles.footer}><p className={styles.hint}>* Campos obrigatórios. Use vírgula ou ponto decimal, sem separador de milhar.</p><button type="submit" disabled={busy} className={styles.primary}>{busy ? "Salvando…" : frozen ? "Repetir tentativa" : "Cadastrar carretel"}</button></footer>
  </form>;
}

export function SpoolControls({ spool, canWrite = true, canArchive = true }: { spool: Spool; canWrite?: boolean; canArchive?: boolean }) {
  const router = useRouter();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("consumption");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<ResultType | null>(null);
  const [resultFor, setResultFor] = useState<Operation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const selectId = useId();
  const disabled = busy || refreshing || !!attempt;
  const errorsFor = (operation: Operation) => resultFor === operation ? result?.fieldErrors : undefined;

  async function dispatch(operation: Operation, payload: Payload) {
    if (sending.current || refreshing || (attempt && attempt.operation !== operation)) return;
    if ((operation === "movement" && (!canWrite || !spool.active)) || (operation !== "movement" && !canArchive) || (operation === "profile" && !spool.active)) {
      setResult({ status: "permission_denied" }); return;
    }
    if (operation === "profile") {
      const color = typeof payload.color === "string" ? normalizeSpoolColor(payload.color) : null;
      if (color === null) {
        setResultFor(operation);
        setResult({ status: "invalid_input", fieldErrors: { color: [invalidColor] } });
        return;
      }
      if (!attempt) payload = { ...payload, color };
    }
    const schema = operation === "movement" ? createMovementSchema : operation === "profile" ? updateProfileSchema : setActiveSchema;
    const parsed = schema.safeParse(payload);
    setResultFor(operation);
    if (!parsed.success) { setResult({ status: "invalid_input", fieldErrors: fieldErrors(parsed.error) }); return; }
    if (!attempt && operation !== "profile" && !window.confirm(operation === "movement" ? "Confirma esta movimentação? Ela será registrada no histórico." : spool.active ? "Arquivar este carretel?" : "Restaurar este carretel?")) return;
    sending.current = true;
    setBusy(true);
    setAttempt({ operation, payload });
    setResult(null);
    try {
      const response = await (operation === "movement" ? createMovement(payload) : operation === "profile" ? updateSpoolProfile(payload) : setSpoolActive(payload));
      setResult(response);
      // no_change is definitive too: it must not leave the controls frozen.
      if (response.status !== "uncertain") setAttempt(null);
      if (success.has(response.status)) {
        if (response.status !== "no_change" && response.version !== spool.version) { sending.current = true; setRefreshing(true); }
        router.refresh();
      }
    } catch { setResult({ status: "uncertain" }); }
    finally { sending.current = false; setBusy(false); }
  }

  function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !spool.active || sending.current || (attempt && attempt.operation !== "movement")) return;
    const payload = attempt?.payload ?? { ...Object.fromEntries(new FormData(event.currentTarget)), spool_id: spool.id, expected_version: spool.version, attempt_id: crypto.randomUUID() };
    void dispatch("movement", payload);
  }
  function profile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canArchive || !spool.active || sending.current || (attempt && attempt.operation !== "profile")) return;
    void dispatch("profile", attempt?.payload ?? { ...Object.fromEntries(new FormData(event.currentTarget)), spool_id: spool.id, expected_version: spool.version });
  }
  function toggle() {
    if (!canArchive || sending.current || (attempt && attempt.operation !== "archive")) return;
    void dispatch("archive", attempt?.payload ?? { spool_id: spool.id, expected_version: spool.version, active: !spool.active });
  }

  return <section className={styles.controls} aria-busy={busy}>
    <Notice result={result} />
    {refreshing && <p role="status" className={styles.success}>Operação confirmada. Atualizando os dados; se necessário, reabra o carretel antes de continuar.</p>}
    {canWrite && spool.active && <form onSubmit={move} noValidate className={styles.card}>
      <header className={styles.header}><span className={styles.eyebrow}>CONTROLE DE SALDO</span><h2>Movimentar carretel</h2><p>Registre o consumo, uma reposição ou o saldo conferido na balança.</p></header>
      <div className={styles.field}><label htmlFor={selectId}>Tipo de movimentação</label><select id={selectId} name="movement_type" value={type} disabled={disabled} onChange={event => setType(event.target.value)} className={styles.input}>
        <option value="consumption">Consumo</option><option value="replenishment">Reposição</option><option value="adjustment">Ajuste de saldo</option>
      </select></div>
      <Input key={type === "adjustment" ? "balance" : "quantity"} required name={type === "adjustment" ? "counted_balance_grams" : "quantity_grams"} label={type === "adjustment" ? "Saldo contado (g)" : "Quantidade (g)"} inputMode="decimal" placeholder="Ex.: 125,500" hint={type === "adjustment" ? "Informe o saldo final medido, inclusive zero. Até 3 casas decimais." : "Informe um peso maior que zero, com até 3 casas decimais."} disabled={disabled} errors={errorsFor("movement")?.[type === "adjustment" ? "counted_balance_grams" : "quantity_grams"]} />
      <Input required name="reason" label="Motivo" placeholder="Descreva o motivo desta movimentação" maxLength={500} disabled={disabled} errors={errorsFor("movement")?.reason} />
      <div className={styles.footer}><button type="submit" disabled={busy || refreshing || (!!attempt && attempt.operation !== "movement")} className={styles.primary}>{busy && attempt?.operation === "movement" ? "Enviando…" : attempt?.operation === "movement" ? "Repetir movimento" : "Confirmar movimento"}</button></div>
    </form>}
    {canArchive && spool.active && <form onSubmit={profile} noValidate className={styles.card}>
      <header className={styles.header}><h2>Dados do carretel</h2><p>Mantenha a identificação do filamento sempre atualizada.</p></header>
      <div className={styles.grid}>
        <Input required name="internal_identifier" label="Identificador interno" defaultValue={spool.internal_identifier} maxLength={120} disabled={disabled} errors={errorsFor("profile")?.internal_identifier} />
        <Input required name="material_type" label="Tipo de filamento" defaultValue={spool.material_type ?? ""} maxLength={80} disabled={disabled} errors={errorsFor("profile")?.material_type} />
        <Input name="brand" label="Marca" defaultValue={spool.brand ?? ""} maxLength={120} disabled={disabled} errors={errorsFor("profile")?.brand} />
        <SpoolColorField key={`${spool.id}-${spool.version}`} defaultValue={spool.color ?? ""} disabled={disabled} errors={errorsFor("profile")?.color} remainingGrams={spool.current_balance_grams} referenceGrams={spool.original_filament_grams} lowThresholdPercent={null} />
      </div>
      <div className={styles.footer}><button type="submit" disabled={busy || refreshing || (!!attempt && attempt.operation !== "profile")} className={styles.secondary}>{busy && attempt?.operation === "profile" ? "Salvando…" : attempt?.operation === "profile" ? "Repetir alteração" : "Salvar dados"}</button></div>
    </form>}
    {canArchive && <div className={styles.archive}><div><h2>{spool.active ? "Arquivar carretel" : "Restaurar carretel"}</h2><p>{spool.active ? "Retire este carretel do uso sem apagar seu histórico." : "Disponibilize este carretel novamente para movimentações."}</p></div><button type="button" disabled={busy || refreshing || (!!attempt && attempt.operation !== "archive")} onClick={toggle} className={styles.secondary}>{attempt?.operation === "archive" ? "Repetir alteração de status" : spool.active ? "Arquivar" : "Restaurar"}</button></div>}
  </section>;
}

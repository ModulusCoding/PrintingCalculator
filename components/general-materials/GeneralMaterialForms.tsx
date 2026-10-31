"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { planActionMessages } from "@/lib/plans/action-messages";
import { createGeneralMaterial, moveGeneralMaterial, setGeneralMaterialActive, updateGeneralMaterialCostReference, updateGeneralMaterialProfile, type MutationResult } from "@/lib/general-materials/actions";
import { createMaterialSchema, createMovementSchema, updateProfileSchema, updateCostRefSchema, setActiveSchema, fieldErrors } from "@/lib/general-materials/validation";
import type { Material } from "@/lib/general-materials/schemas";
import styles from "./MaterialForms.module.css";

const units = ["unidade", "metro", "centimetro", "grama", "quilograma"] as const;
const labels: Record<string, string> = { unidade: "Unidade", metro: "Metro", centimetro: "Centímetro", grama: "Grama", quilograma: "Quilograma" };
type Payload = Record<string, string | boolean | number>;
const success = ["created", "updated", "idempotent", "no_change"];
const messages: Record<string, string> = {
  ...planActionMessages,
  created: "Material criado.", updated: "Alteração salva.", idempotent: "Operação já registrada.", no_change: "Nenhuma alteração necessária.", uncertain: "Não foi possível confirmar o resultado. Use Repetir tentativa para consultar com os mesmos dados.", permission_denied: "Sem permissão.", version_conflict: "O registro mudou. Atualize a página antes de continuar.", insufficient_balance: "Saldo insuficiente.", invalid_input: "Revise os campos indicados. Valores numéricos aceitam até seis casas decimais, sem separador de milhar.", technical: "Não foi possível concluir a operação.", material_unavailable: "Material indisponível.", idempotency_conflict: "Esta tentativa já foi usada com dados diferentes.", name_conflict: "Já existe um material com esse nome.", session_expired: "Sua sessão expirou. Entre novamente.", incompatible_units: "A unidade informada não é compatível com a unidade de controle.", nonrepresentable_conversion: "A conversão excede seis casas decimais. Revise a quantidade informada.",
};
function Notice({ result }: { result?: MutationResult }) {
  if (!result) return null;
  const ok = success.includes(result.status);
  return <p role={ok ? "status" : "alert"} className={`${styles.notice} ${ok ? styles.success : ""}`}>{messages[result.status] ?? "Não foi possível concluir a operação."}{result.correlation_id && ["technical", "uncertain"].includes(result.status) ? ` Código de suporte: ${result.correlation_id}.` : ""}</p>;
}
function Field({ label, scope, errors, money, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; scope: string; errors?: string[]; money?: boolean }) {
  const id = `${scope}-${props.name}`;
  return <label className={styles.field} htmlFor={id}>{label}<input {...props} id={id} className={styles.input} aria-invalid={Boolean(errors?.length)} aria-describedby={`${id}-hint${errors?.length ? ` ${id}-error` : ""}`} /><span id={`${id}-hint`} className={styles.hint}>{money ? "BRL (R$), ex.: 12,50. Até 6 casas decimais; sem separador de milhar." : props.inputMode === "decimal" ? "Até 6 casas decimais. Use vírgula ou ponto; máximo 1.000.000." : ""}</span>{errors?.length ? <span id={`${id}-error`} className={styles.error}>{errors.join(" ")}</span> : null}</label>;
}
function UnitSelect({ name, label, initial = "unidade", disabled }: { name: string; label: string; initial?: string; disabled: boolean }) {
  return <label className={styles.field}>{label}<select className={styles.input} name={name} defaultValue={initial} disabled={disabled}>{units.map(unit => <option key={unit} value={unit}>{labels[unit]}</option>)}</select></label>;
}
function formPayload(data: FormData): Record<string, string> {
  return Object.fromEntries(Array.from(data.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function NewGeneralMaterialForm() {
  const router = useRouter();
  const [result, setResult] = useState<MutationResult>();
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState<Payload>();
  async function submit(data: FormData) {
    const payload = frozen ?? { ...formPayload(data), attempt_id: crypto.randomUUID() };
    const parsed = createMaterialSchema.safeParse(payload);
    if (!parsed.success) { setResult({ status: "invalid_input", fieldErrors: fieldErrors(parsed.error) }); return; }
    setFrozen(payload); setBusy(true);
    try {
      const response = await createGeneralMaterial(payload);
      setResult(response);
      if ((response.status === "created" || response.status === "idempotent") && response.material_id) router.push(`/estoque/materiais-gerais/${response.material_id}`);
      else if (response.status !== "uncertain") setFrozen(undefined);
    } catch { setResult({ status: "uncertain" }); }
    finally { setBusy(false); }
  }
  const disabled = busy || Boolean(frozen);
  const errors = result?.fieldErrors;
  return <form onSubmit={event => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className={`${styles.surface} ${styles.card} space-y-6`} aria-busy={busy}>
    <Notice result={result} />
    <div><h2 className={styles.title}>Identificação do material</h2><p className={styles.hint}>A unidade de controle não poderá ser alterada após o cadastro.</p></div>
    <fieldset className={styles.fields} disabled={disabled}>
      <Field scope="new" required name="name" label="Nome do material" maxLength={120} errors={errors?.name} />
      <UnitSelect name="control_unit" label="Unidade de controle" disabled={disabled} />
      <div className={styles.grid}><Field scope="new" required name="reference_quantity" label="Quantidade de referência" inputMode="decimal" errors={errors?.reference_quantity} /><Field scope="new" required name="reference_price" label="Preço da quantidade de referência (R$)" money inputMode="decimal" errors={errors?.reference_price} /></div>
      <p className={styles.hint}>O preço corresponde à quantidade de referência informada, não necessariamente a uma unidade. Essa referência é utilizada no cálculo de custos.</p>
      <Field scope="new" required name="opening_quantity" label="Saldo inicial na unidade de controle" defaultValue="0" inputMode="decimal" errors={errors?.opening_quantity} />
    </fieldset>
    <button disabled={busy} className={styles.button}>{busy ? "Salvando..." : frozen ? "Repetir tentativa" : "Cadastrar material"}</button>
  </form>;
}

const schemas = { move: createMovementSchema, profile: updateProfileSchema, cost: updateCostRefSchema, active: setActiveSchema };
type Operation = keyof typeof schemas;
export function GeneralMaterialControls({ material, canArchive }: { material: Material; canArchive: boolean }) {
  const router = useRouter();
  const [results, setResults] = useState<Partial<Record<Operation, MutationResult>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [frozen, setFrozen] = useState<Partial<Record<Operation, Payload>>>({});
  const [movement, setMovement] = useState("entry");
  async function invoke(key: Operation, action: (payload: Payload) => Promise<MutationResult>, data: FormData) {
    const payload = frozen[key] ?? { ...formPayload(data), material_id: material.id, expected_version: String(material.version), attempt_id: crypto.randomUUID() };
    if (key === "active") payload.active = !material.active;
    const parsed = schemas[key].safeParse(payload);
    if (!parsed.success) { setResults(current => ({ ...current, [key]: { status: "invalid_input", fieldErrors: fieldErrors(parsed.error) } })); return; }
    setFrozen(current => ({ ...current, [key]: payload })); setBusy(true);
    try {
      const response = await action(payload);
      setResults(current => ({ ...current, [key]: response }));
      if (success.includes(response.status) && response.status !== "no_change" && response.version !== material.version) { setConfirmed(true); router.refresh(); }
      else if (response.status !== "uncertain") setFrozen(current => { const next = { ...current }; delete next[key]; return next; });
    } catch { setResults(current => ({ ...current, [key]: { status: "uncertain" } })); }
    finally { setBusy(false); }
  }
  // An uncertain attempt must be retried before another operation can change this version.
  const locked = (key: Operation) => busy || confirmed || Boolean(frozen[key]) || Object.keys(frozen).some(other => other !== key);
  const buttonLocked = (key: Operation) => busy || confirmed || Object.keys(frozen).some(other => other !== key);
  const button = (key: Operation, label: string) => <button className={styles.button} disabled={buttonLocked(key)}>{busy ? "Salvando..." : frozen[key] ? "Repetir tentativa" : label}</button>;
  const field = (key: Operation, name: string, label: string, value?: string, numeric = false, money = false) => <Field scope={key} name={name} label={label} required defaultValue={value} inputMode={numeric ? "decimal" : undefined} maxLength={numeric ? undefined : name === "reason" ? 500 : 120} errors={results[key]?.fieldErrors?.[name]} money={money} />;
  return <section className={`${styles.surface} space-y-5`} aria-label="Gerenciar material" aria-busy={busy}>
    {confirmed && <p role="status" className={`${styles.notice} ${styles.success}`}>Operação confirmada. Atualizando os dados; se a tela não atualizar, abra novamente o material antes de continuar.</p>}
    <div className={styles.grid}>
      {material.active && <form onSubmit={event => { event.preventDefault(); void invoke("move", moveGeneralMaterial, new FormData(event.currentTarget)); }} className={`${styles.card} space-y-4`}>
        <div><h2 className={styles.title}>Movimentar estoque</h2><p className={styles.hint}>Entrada e consumo alteram o saldo. No ajuste, informe o saldo total contado.</p></div><Notice result={results.move} />
        <fieldset className={styles.fields} disabled={locked("move")}>
          <label className={styles.field}>Operação<select name="movement_type" value={movement} onChange={event => setMovement(event.target.value)} className={styles.input}><option value="entry">Entrada</option><option value="consumption">Consumo</option><option value="adjustment">Ajuste por contagem</option></select></label>
          <UnitSelect name="supplied_unit" label="Unidade informada" initial={material.control_unit} disabled={locked("move")} />
          {field("move", movement === "adjustment" ? "counted_balance" : "quantity", movement === "adjustment" ? "Saldo total contado" : "Quantidade da movimentação", undefined, true)}
          {field("move", "reason", "Motivo")}
        </fieldset>{button("move", "Registrar movimentação")}
      </form>}
      {canArchive && <>
        <form onSubmit={event => { event.preventDefault(); void invoke("profile", updateGeneralMaterialProfile, new FormData(event.currentTarget)); }} className={`${styles.card} space-y-4`}><h2 className={styles.title}>Editar identificação</h2><Notice result={results.profile} /><fieldset className={styles.fields} disabled={locked("profile")}>{field("profile", "name", "Nome do material", material.name)}<p className={styles.hint}>Unidade de controle: {labels[material.control_unit]} (imutável).</p></fieldset>{button("profile", "Salvar identificação")}</form>
        <form onSubmit={event => { event.preventDefault(); void invoke("cost", updateGeneralMaterialCostReference, new FormData(event.currentTarget)); }} className={`${styles.card} space-y-4`}><div><h2 className={styles.title}>Referência de custo</h2><p className={styles.hint}>A alteração preserva o histórico e não modifica o saldo.</p></div><Notice result={results.cost} /><fieldset className={styles.fields} disabled={locked("cost")}>{field("cost", "reference_quantity", `Quantidade de referência (${labels[material.control_unit]})`, String(material.reference_quantity).replace(".", ","), true)}{field("cost", "reference_price", "Preço da referência (R$)", String(material.reference_price).replace(".", ","), true, true)}</fieldset>{button("cost", "Salvar referência")}</form>
        <form onSubmit={event => { event.preventDefault(); void invoke("active", setGeneralMaterialActive, new FormData(event.currentTarget)); }} className={`${styles.card} space-y-4`}><h2 className={styles.title}>{material.active ? "Arquivar material" : "Reativar material"}</h2><p className={styles.hint}>Materiais arquivados não recebem movimentações. Arquivar não libera espaço no limite compartilhado com Carretéis.</p><Notice result={results.active} />{button("active", material.active ? "Arquivar material" : "Reativar material")}</form>
      </>}
    </div>
  </section>;
}

"use client";

import { planActionMessage } from "@/lib/plans/action-messages";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPrinter, updatePrinter, setPrinterActive, type PrinterRecord, type PrinterResult } from "@/lib/printers/actions";
import { printerFields, validatePrinterForm, type PrinterField } from "./validation";
import styles from "./PrinterForm.module.css";

const br = (value: string) => value.replace(".", ",");
const money = (value: string, scale = 2) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: scale });
const safeReturnTo = (value: string) => (/^\/impressoras(?:\?|\/|$)/.test(value) && !value.startsWith("//")) ? value : "/impressoras";
const messageFor = (result: Exclude<PrinterResult, { status: "success" | "invalid_input" }>, action: string) => {
  const planMessage = planActionMessage(result.status);
  if (planMessage) return planMessage;
  if (result.status === "session_expired") return "Sua sessão expirou. Entre novamente para continuar.";
  if (result.status === "permission_denied") return "Você não tem permissão para realizar esta ação.";
  if (result.status === "version_conflict") return "Esta impressora foi alterada. Abra novamente o registro antes de salvar.";
  if (result.status === "printer_unavailable") return "Esta impressora não está disponível para esta operação.";
  if (result.status === "unknown_result" || result.status === "technical") return `Não foi possível confirmar ${action}. Verifique a lista antes de tentar novamente.`;
  return result.message || `Não foi possível ${action}.`;
};

export function PrinterForm({ printer, canWrite, canArchive, returnTo = "/impressoras" }: { printer?: PrinterRecord; canWrite: boolean; canArchive: boolean; returnTo?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const destination = safeReturnTo(returnTo);
  const [data, setData] = useState({ name: printer?.name || "", brand: printer?.brand || "", model: printer?.model || "", purchasePrice: printer ? br(printer.purchase_price) : "", estimatedLifeHours: printer ? br(printer.estimated_life_hours) : "", averagePowerWatts: printer ? br(printer.average_power_watts) : "", maintenanceCostPerHour: printer ? br(printer.maintenance_cost_per_hour) : "" });
  const disabled = pending || saved;
  function showError(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  function navigate() { setSaved(true); router.push(destination); router.refresh(); }
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || (printer && !printer.active) || locked.current || saved) return;
    const errors = validatePrinterForm(data);
    setFields(errors); setError("");
    if (Object.keys(errors).length) {
      const first = event.currentTarget.elements.namedItem(Object.keys(errors)[0]);
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    locked.current = true;
    start(async () => {
      try {
        const result = printer ? await updatePrinter(printer.id, printer.version, data) : await createPrinter(data);
        if (result.status === "success") navigate();
        else if (result.status === "invalid_input") { setFields(result.fieldErrors ?? {}); showError("Revise os campos. Não foi possível salvar a impressora."); }
        else showError(messageFor(result, "o salvamento"));
      } catch { showError("Não foi possível confirmar o salvamento. Verifique a lista antes de tentar novamente."); }
      finally { locked.current = false; }
    });
  }
  function toggleArchive() {
    if (!printer || !canArchive || locked.current || saved) return;
    const action = printer.active ? "Arquivar" : "Restaurar";
    if (!confirm(`${action} esta impressora?`)) return;
    locked.current = true; setError("");
    start(async () => {
      try {
        const result = await setPrinterActive(printer.id, printer.version, !printer.active);
        if (result.status === "success") navigate();
        else if (result.status === "invalid_input") showError(`Não foi possível ${action.toLowerCase()} a impressora.`);
        else showError(messageFor(result, "a alteração"));
      } catch { showError("Não foi possível confirmar a alteração. Verifique a lista antes de tentar novamente."); }
      finally { locked.current = false; }
    });
  }
  const heading = <header className={styles.header}><div className={styles.icon}><Printer size={28} aria-hidden="true" /></div><div className="min-w-0">{printer && <span className={styles.badge}>{printer.active ? "Ativa" : "Arquivada"}</span>}<h1 className={styles.title}>{printer ? printer.name : "Nova impressora"}</h1><p className={styles.hint}>{printer ? "Identificação e parâmetros de custo do equipamento." : "Cadastre o equipamento e seus parâmetros para a precificação integrada."}</p></div></header>;
  const feedback = <>{error && <p ref={errorRef} tabIndex={-1} role="alert" className={styles.notice}>{error}</p>}{saved && <p role="status" className={`${styles.notice} ${styles.info}`}>Alteração salva. Voltando à listagem.</p>}</>;
  const field = (name: PrinterField) => {
    const spec = printerFields[name];
    const numeric = "scale" in spec;
    return <div className={`${styles.field} ${name === "name" ? styles.wide : ""}`} key={name}>
      <label htmlFor={`printer-${name}`}>{spec.label}{name === "brand" || name === "model" ? " (opcional)" : " *"}</label>
      <input id={`printer-${name}`} name={name} value={data[name]} onChange={event => setData(current => ({ ...current, [name]: event.target.value }))} required={name !== "brand" && name !== "model"} maxLength={"maxLength" in spec ? spec.maxLength : undefined} inputMode={numeric ? spec.scale === 0 ? "numeric" : "decimal" : undefined} className={styles.input} aria-invalid={Boolean(fields[name]?.length)} aria-describedby={`printer-${name}-hint${fields[name]?.length ? ` printer-${name}-error` : ""}`} />
      <p id={`printer-${name}-hint`} className={styles.hint}>{spec.hint}{numeric && spec.scale > 0 ? " Use vírgula decimal, sem separador de milhar." : ""}</p>
      {fields[name]?.length ? <p id={`printer-${name}-error`} className={styles.error}>{fields[name].join(" ")}</p> : null}
    </div>;
  };
  if (printer && (!printer.active || !canWrite)) return <section className={styles.page} aria-busy={pending}>
    {heading}<p className={`${styles.notice} ${styles.info}`}>{printer.active ? "Esta impressora é somente leitura para o seu acesso." : "Esta impressora está arquivada e é somente leitura. Não está disponível para novas precificações integradas."}</p>
    <div className={styles.card}><h2 className={styles.heading}>Parâmetros cadastrados</h2><dl className={`${styles.details} mt-6`}><Detail label="Marca" value={printer.brand || "Não informada"} /><Detail label="Modelo" value={printer.model || "Não informado"} /><Detail label="Potência média" value={`${br(printer.average_power_watts)} W`} /><Detail label="Valor de compra" value={money(printer.purchase_price)} /><Detail label="Vida útil estimada" value={`${br(printer.estimated_life_hours)} h`} /><Detail label="Manutenção por hora" value={`${money(printer.maintenance_cost_per_hour, 4)}/h`} /></dl></div>
    {feedback}<div className={styles.actions}>{!printer.active && canArchive && <button type="button" onClick={toggleArchive} className={styles.primary} disabled={disabled}>{pending ? "Restaurando..." : "Restaurar impressora"}</button>}<Link href={destination} className={styles.secondary}>Voltar</Link></div>
  </section>;
  if (!canWrite) return <section className={styles.page}>{heading}<p className={`${styles.notice} ${styles.info}`}>Você não tem permissão para criar impressoras.</p><Link href={destination} className={styles.secondary}>Voltar</Link></section>;
  return <section className={styles.page} aria-busy={pending}>
    {heading}<form onSubmit={save} noValidate className="space-y-6">
      {feedback}
      <fieldset disabled={disabled} className={styles.card}><legend className="sr-only">Identificação do equipamento</legend><h2 className={styles.heading}>{printer ? "Editar identificação" : "Identificação do equipamento"}</h2><p className={styles.hint}>Campos com * são obrigatórios.</p><div className={styles.grid}>{field("name")}{field("brand")}{field("model")}</div></fieldset>
      <fieldset disabled={disabled} className={styles.card}><legend className="sr-only">Parâmetros de custo</legend><h2 className={styles.heading}>Parâmetros de custo</h2><p className={styles.hint}>Valores utilizados na Precificadora. A potência é informada em watts e a vida útil em horas.</p><div className={styles.grid}>{field("purchasePrice")}{field("estimatedLifeHours")}{field("averagePowerWatts")}{field("maintenanceCostPerHour")}</div></fieldset>
      <div className={styles.actions}><button type="submit" disabled={disabled} className={styles.primary}>{pending ? "Salvando..." : "Salvar"}</button><Link href={destination} className={styles.secondary}>Cancelar</Link></div>
    </form>
    {printer && canArchive && <section className={styles.card}><h2 className={styles.heading}>Gerenciar disponibilidade</h2><p className={`${styles.hint} mb-4`}>Ao arquivar, a impressora deixa de estar disponível para novas precificações integradas. Os registros históricos são preservados.</p><button type="button" onClick={toggleArchive} className={styles.secondary} disabled={disabled}>{pending ? "Aguarde..." : "Arquivar impressora"}</button></section>}
  </section>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

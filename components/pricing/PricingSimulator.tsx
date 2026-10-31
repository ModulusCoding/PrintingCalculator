"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { calculateFdmPricing, type FdmPricingResult } from "@/lib/pricing/fdm";
import { parsePtBr, timeToHours } from "@/lib/pricing/parse";
import { searchPrintersAction, searchPricingSpoolsAction, searchPricingGeneralMaterialsAction, type PaginatedPrinters, type PrinterItem, type PricingSpool, type PricingGeneralMaterial } from "@/lib/pricing/actions";
import { saveFdmPricingAction, searchProductsAction, type PricingProduct } from "@/lib/pricing/persistence-actions";
import { ManualPricingSimulator } from "./ManualPricingSimulator";
import { PricingWizard, PricingInput, pricingButton, pricingPanel } from "./PricingWizard";
import type { NumericRule } from "@/lib/pricing/input";

type SavePayload = Parameters<typeof saveFdmPricingAction>[0];
const rules = {
  rate: { min: 0, max: 100, scale: 6 }, loss: { min: 0, max: 100, scale: 2 },
  consumption: { min: .001, max: 1000000, scale: 3 },
  quantity: { min: 1, max: 100000, scale: 0, integer: true },
  hours: { min: 0, max: 10000, scale: 0, integer: true },
  minutes: { min: 0, max: 59, scale: 0, integer: true },
  labor: { min: 0, max: 100000, scale: 2 }, cost: { min: 0, max: 1000000, scale: 2 },
} satisfies Record<string, NumericRule>;

type Page<T> = { items: T[]; page: number; totalPages: number; total: number };
type Spool = PricingSpool;
type General = PricingGeneralMaterial;
type SpoolLine = { key: number; spool: Spool; grams: string };
type GeneralLine = { key: number; material: General; amount: string; unit: string; mode: "per_piece" | "per_lot" };
const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const text = (n: number) => String(n).replace(".", ",");
const factors: Record<string, number> = { unidade: 1, metro: 1, centimetro: .01, grama: 1, quilograma: 1000 };
const compatible = (unit: string) => unit === "metro" || unit === "centimetro" ? ["metro", "centimetro"] : unit === "grama" || unit === "quilograma" ? ["grama", "quilograma"] : ["unidade"];
const conversion = (from: string, to: string) => factors[from] / factors[to];

type SimulatorProps = { mode: "manual" | "integrated"; initialPrinters?: PaginatedPrinters; initialSpools?: Page<Spool>; initialGeneralMaterials?: Page<General>; initialProducts: Page<PricingProduct>; electricityRate?: number | null; defaultLoss?: number; configVersion?: number | null; canManageEnterprise?: boolean; canCreateProduct?: boolean; canSave: boolean; effectivePlan: "free" | "intermediate" };
export function PricingSimulator(props: SimulatorProps) {
  return props.mode === "manual" || props.effectivePlan === "free" ? <ManualPricingSimulator initialProducts={props.initialProducts} canSave={props.canSave} canCreateProduct={props.canCreateProduct} /> : <IntegratedSimulator {...props} />;
}
function IntegratedSimulator({ initialPrinters = { items: [], total: 0, page: 1, totalPages: 1 }, initialSpools = { items: [], total: 0, page: 1, totalPages: 1 }, initialGeneralMaterials = { items: [], total: 0, page: 1, totalPages: 1 }, initialProducts, electricityRate = null, defaultLoss = 0, configVersion = null, canManageEnterprise = false, canCreateProduct = false, canSave }: SimulatorProps) {
  const [printers, setPrinters] = useState(initialPrinters), [spools, setSpools] = useState(initialSpools), [generals, setGenerals] = useState(initialGeneralMaterials), [products, setProducts] = useState(initialProducts);
  const [printerQuery, setPrinterQuery] = useState(""), [spoolQuery, setSpoolQuery] = useState(""), [generalQuery, setGeneralQuery] = useState(""), [productQuery, setProductQuery] = useState("");
  const [printer, setPrinter] = useState<PrinterItem | null>(null), [product, setProduct] = useState<PricingProduct | null>(null);
  const [spoolLines, setSpoolLines] = useState<SpoolLine[]>([]), [generalLines, setGeneralLines] = useState<GeneralLine[]>([]);
  const [key, setKey] = useState(1), [quantity, setQuantity] = useState(""), [hours, setHours] = useState(""), [minutes, setMinutes] = useState("0"), [rate, setRate] = useState(electricityRate == null ? "" : text(electricityRate));
  const [loss, setLoss] = useState(text(defaultLoss)), [manualHours, setManualHours] = useState("0"), [manualMinutes, setManualMinutes] = useState("0"), [labor, setLabor] = useState("0"), [fixed, setFixed] = useState("0"), [manualPackaging, setManualPackaging] = useState("0"), [markup, setMarkup] = useState("0");
  const [result, setResult] = useState<FdmPricingResult | null>(null), [stale, setStale] = useState(false), [notice, setNotice] = useState(""), [attempt, setAttempt] = useState<string | null>(null), [saved, setSaved] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [searching, setSearching] = useState(false);
  const restoreLineFocus = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-pricing-step]:not([hidden]) button')?.focus());
  const [step, setStep] = useState(0), [uncertain, setUncertain] = useState(false);
  const snapshot = useRef<SavePayload | null>(null);
  const change = () => { setStale(true); setSaved(null); setAttempt(null); snapshot.current = null; };
  const field = (label: string, value: string, setter: (v: string) => void, rule: NumericRule) => <PricingInput label={label} value={value} rule={rule} onChange={v => { if (lock.current || uncertain) return; setter(v); change(); }} />;
  const search = async <T,>(action: (args: { query: string; page: number; limit: number }) => Promise<{ ok: true; data: Page<T> } | { ok: false; error: string }>, query: string, page: number, setter: (v: Page<T>) => void) => {
    if (busy || uncertain || searching) return;
    if (query.length > 200) { setNotice("A busca deve ter no máximo 200 caracteres."); return; }
    setSearching(true);
    try {
      const response = await action({ query, page, limit: 10 });
      if (response.ok) setter(response.data); else setNotice(response.error);
    } catch { setNotice("Não foi possível realizar a busca. Tente novamente."); }
    finally { setSearching(false); }
  };
  const section = <T,>(label: string, query: string, setQuery: (v: string) => void, page: Page<T>, load: (p: number) => void, items: React.ReactNode) => <div className="space-y-2"><div className="flex flex-col gap-2 sm:flex-row"><input aria-label={label} placeholder={label} disabled={searching} maxLength={200} value={query} onChange={e => setQuery(e.target.value)} className="min-h-11 min-w-0 w-full rounded border p-2"/><button type="button" disabled={searching} onClick={() => load(1)} className={pricingButton}>{searching ? "Buscando…" : "Buscar"}</button></div><div className="max-h-40 space-y-1 overflow-auto">{items}</div><div className="flex flex-wrap items-center gap-2 text-sm"><button className={pricingButton} type="button" disabled={searching || page.page <= 1} onClick={() => load(page.page - 1)}>Anterior</button><span>Página {page.page} de {page.totalPages}</span><button className={pricingButton} type="button" disabled={searching || page.page >= page.totalPages} onClick={() => load(page.page + 1)}>Próxima</button></div></div>;
  const values = () => {
    const q = parsePtBr(quantity, 1, 100000, 0), t = timeToHours(hours, minutes), finish = timeToHours(manualHours, manualMinutes);
    const r = parsePtBr(rate, 0, 100, 6), l = parsePtBr(loss, 0, 100, 2), wage = parsePtBr(labor, 0, 100000, 2), overhead = parsePtBr(fixed, 0, 1000000, 2), manual = parsePtBr(manualPackaging, 0, 1000000, 2), margin = parsePtBr(markup, 0, 100000, 2);
    const grams = spoolLines.map(x => parsePtBr(x.grams, .001, 1000000, 3));
    const amounts = generalLines.map(x => parsePtBr(x.amount, .001, 1000000, 3));
    if (!printer || !q || t === null || !Number.isFinite(t) || t <= 0 || finish === null || !Number.isFinite(finish) || r === null || l === null || wage === null || overhead === null || manual === null || margin === null || !spoolLines.length || grams.some(x => x === null) || amounts.some(x => x === null)) return null;
    return { q, t, finish, r, l, wage, overhead, manual, margin, grams: grams as number[], amounts: amounts as number[] };
  };
  const [timeValidationAttempted, setTimeValidationAttempted] = useState(false);
  const timeInvalid = timeValidationAttempted && (timeToHours(hours, minutes) === null || Number(timeToHours(hours, minutes)) <= 0);
  const validateStep = (n: number) => {
    if (lock.current || uncertain) return false;
    if (n === 2) setTimeValidationAttempted(true);
    if (n === 0 && spoolLines.length === 0) { setNotice("Adicione ao menos um carretel."); return false; }
    if (n === 1 && !printer) { setNotice("Selecione uma impressora."); return false; }
    if (n === 2) {
      const time = timeToHours(hours, minutes);
      if (time === null || !Number.isFinite(time) || time <= 0) { setNotice("O tempo total de impressão deve ser maior que zero."); return false; }
    }
    if (n === 4 && !values()) { setNotice("Revise impressora, carretéis, consumo, tempo, quantidade e valores numéricos."); return false; }
    setNotice(""); return true;
  };
  const calculate = (): boolean => {
    if (lock.current || uncertain) return false;
    const v = values(); if (!v || !printer) { setNotice("Revise impressora, carretéis, consumo, tempo, quantidade e valores numéricos."); return false; }
    const output = calculateFdmPricing({ quantity: v.q, printTimeHours: v.t, printer: { purchasePrice: printer.purchase_price, lifeHours: printer.estimated_life_hours, powerWatts: printer.average_power_watts, maintenancePerHour: printer.maintenance_cost_per_hour }, energyRate: v.r, lossPercent: v.l, spoolLines: spoolLines.map((x, i) => ({ spoolId: x.spool.id, consumptionGrams: v.grams[i], purchasePrice: x.spool.purchase_price, originalFilamentGrams: x.spool.original_filament_grams })), packagingLines: generalLines.map((x, i) => ({ materialId: x.material.id, mode: x.mode, quantity: v.amounts[i], conversionFactor: conversion(x.unit, x.material.control_unit), referencePrice: x.material.reference_price, referenceQuantity: x.material.reference_quantity })), finishing: { manualTimeHours: v.finish, laborPerHour: v.wage, fixedCost: v.overhead }, packagingPerPiece: v.manual, markupPercent: v.margin });
    if (Array.isArray(output)) { setNotice(output.map(x => x.message).join(" ")); return false; }
    if (!Object.values(output).every(Number.isFinite)) { setNotice("O cálculo excedeu os limites permitidos."); return false; }
    // Explicit manual cost is per piece, separate from stock packaging lines.
    snapshot.current = null;
    setResult(output); setStale(false); setSaved(null); setAttempt(crypto.randomUUID()); setNotice(""); return true;
  };
  const save = async () => {
    const v = values(); if (!canSave || saved || !v || !result || stale || !printer || !product || !attempt || configVersion === null || lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      snapshot.current ??= { attemptId: attempt, productId: product.id, productVersion: product.version, printerId: printer.id, printerVersion: printer.version, materialIds: [], materialVersions: [], spoolIds: spoolLines.map(x => x.spool.id), spoolVersions: spoolLines.map(x => x.spool.version), generalMaterialIds: generalLines.map(x => x.material.id), generalMaterialVersions: generalLines.map(x => x.material.version), configVersion, input: { quantity: v.q, printTimeHours: v.t, tariff: { original: electricityRate, effective: v.r, adjusted: v.r !== electricityRate }, lossPercent: v.l, printer: { purchasePrice: printer.purchase_price, lifeHours: printer.estimated_life_hours, powerWatts: printer.average_power_watts, maintenancePerHour: printer.maintenance_cost_per_hour }, materials: [], spoolConsumptionsGrams: v.grams, packagingLines: generalLines.map((x, i) => ({ mode: x.mode, quantity: v.amounts[i], suppliedUnit: x.unit })), generalMaterialConsumptions: generalLines.map((x, i) => v.amounts[i] * conversion(x.unit, x.material.control_unit) * (x.mode === "per_piece" ? v.q : 1)), finishing: { manualTimeHours: v.finish, laborPerHour: v.wage, fixedCost: v.overhead }, packagingPerPiece: v.manual, markupPercent: v.margin } };
      const response = await saveFdmPricingAction(snapshot.current);
      if (response.ok) { setUncertain(false); setSaved(response.data.pricingId); setNotice("Precificação salva."); }
      else { setUncertain(previous => previous || response.code === "unknown"); setNotice(response.error); }
    } catch { setUncertain(true); setNotice("Resultado não confirmado. Tente novamente com a mesma tentativa congelada."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="space-y-4">
    {notice && <p role="status" className="rounded bg-blue-50 p-3">{notice}</p>}
    {uncertain && <p role="status">A tentativa está congelada até confirmar o salvamento. Reenvie a mesma tentativa no resultado.</p>}
    <PricingWizard step={step} setStep={next => { if (!lock.current && !uncertain) setStep(next); }} validateStep={validateStep} onCalculate={calculate} disabled={busy || uncertain} mode="Visionário · fontes integradas" summary={<div className="space-y-2 break-words text-sm"><p>Impressora: {printer?.name ?? "não selecionada"}</p><p>{spoolLines.length} carretel(is) · {generalLines.length} material(is) de embalagem</p><p>Lote: {quantity || "—"} peças · impressão: {hours || "—"} h {minutes} min</p><p>Produto: {product?.name ?? "opcional para simular"}</p>{result && !stale ? <p>Custo por peça: {money(result.unitCost)}</p> : <p>Calcule na revisão para obter os custos.</p>}</div>}>
    {[
    <fieldset key="spools" disabled={busy || uncertain} className="min-w-0"><section className={pricingPanel}><h3 className="text-lg font-semibold">Carretéis</h3>{section("Buscar carretel", spoolQuery, setSpoolQuery, spools, p => search(searchPricingSpoolsAction, spoolQuery, p, setSpools), spools.items.map(x => <button key={x.id} type="button" disabled={spoolLines.length >= 10 || spoolLines.some(l => l.spool.id === x.id)} onClick={() => { setSpoolLines(lines => [...lines, { key, spool: x, grams: "" }]); setKey(k => k + 1); change(); }} className="min-h-11 block w-full rounded border p-2 text-left disabled:opacity-50">{x.internal_identifier} — {x.material_type ?? "Filamento"} · saldo {text(x.current_balance_grams)} g</button>))}{spoolLines.map(x => { const grams = parsePtBr(x.grams, .001, 1000000, 3); return <div key={x.key} className="rounded border p-3"><p>{x.spool.internal_identifier} · {x.spool.brand ?? ""} {x.spool.color ?? ""}</p>{field("Consumo do lote (g)", x.grams, v => setSpoolLines(lines => lines.map(l => l.key === x.key ? { ...l, grams: v } : l)), rules.consumption)}{grams !== null && grams > x.spool.current_balance_grams && <p className="text-amber-800">Consumo maior que o saldo atual ({text(x.spool.current_balance_grams)} g). Simulação não movimenta estoque.</p>}<button type="button" onClick={() => { setSpoolLines(lines => lines.filter(l => l.key !== x.key)); change(); restoreLineFocus(); }} className="inline-flex min-h-11 items-center underline">Remover</button></div>; })}{field("Perda de filamento (%) — padrão da empresa, ajustável apenas nesta simulação", loss, setLoss, rules.loss)}</section></fieldset>,
    <fieldset key="printer" disabled={busy || uncertain} className="min-w-0"><section className={pricingPanel}><h3 className="text-lg font-semibold">Impressora e energia</h3>{section("Buscar impressora", printerQuery, setPrinterQuery, printers, p => search(searchPrintersAction, printerQuery, p, setPrinters), printers.items.map(x => <button key={x.id} type="button" aria-pressed={printer?.id === x.id} onClick={() => { setPrinter(x); change(); }} className={`min-h-11 block w-full rounded border p-2 text-left ${printer?.id === x.id ? "border-violet-600" : ""}`}>{x.name}</button>))}<p>Selecionada: {printer?.name ?? "nenhuma"}</p>{field("Tarifa de energia (R$/kWh)", rate, setRate, rules.rate)}{electricityRate === null && <p className="text-sm text-amber-800">Tarifa não configurada. {canManageEnterprise && <Link href="/empresa" className="inline-flex min-h-11 items-center underline">Configurar</Link>}</p>}</section></fieldset>,
    <fieldset key="lot" disabled={busy || uncertain} className="min-w-0"><section className={pricingPanel}><h3 className="text-lg font-semibold">Lote, acabamento e custos manuais</h3><div className="grid gap-3 sm:grid-cols-3">{field("Quantidade de peças", quantity, setQuantity, rules.quantity)}<div className="col-span-full">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("Impressão total: horas", hours, setHours, rules.hours)}
        {field("Impressão total: minutos", minutes, setMinutes, rules.minutes)}
      </div>
      {timeInvalid && <p tabIndex={-1} role="alert" data-pricing-domain-invalid="true" className="mt-2 text-sm text-red-600">O tempo total de impressão deve ser maior que zero.</p>}
    </div>{field("Acabamento: horas", manualHours, setManualHours, rules.hours)}{field("Acabamento: minutos", manualMinutes, setManualMinutes, rules.minutes)}{field("Mão de obra (R$/h)", labor, setLabor, rules.labor)}{field("Custo fixo do lote (R$)", fixed, setFixed, rules.cost)}{field("Embalagem manual por peça (R$)", manualPackaging, setManualPackaging, rules.cost)}{field("Acréscimo (%)", markup, setMarkup, rules.labor)}</div></section></fieldset>,
    <fieldset key="packaging" disabled={busy || uncertain} className="min-w-0"><section className={pricingPanel}><h3 className="text-lg font-semibold">Materiais gerais para embalagem</h3>{section("Buscar material geral", generalQuery, setGeneralQuery, generals, p => search(searchPricingGeneralMaterialsAction, generalQuery, p, setGenerals), generals.items.map(x => <button key={x.id} type="button" disabled={generalLines.length >= 10 || generalLines.some(l => l.material.id === x.id)} onClick={() => { setGeneralLines(lines => [...lines, { key, material: x, amount: "", unit: x.control_unit, mode: "per_piece" }]); setKey(k => k + 1); change(); }} className="min-h-11 block w-full rounded border p-2 text-left disabled:opacity-50">{x.name} — {money(x.reference_price)} / {text(x.reference_quantity)} {x.control_unit}</button>))}{generalLines.map(x => <div key={x.key} className="space-y-2 rounded border p-3"><p>{x.material.name}</p><div className="grid gap-2 sm:grid-cols-3">{field("Quantidade", x.amount, v => setGeneralLines(lines => lines.map(l => l.key === x.key ? { ...l, amount: v } : l)), rules.consumption)}<label>Unidade<select value={x.unit} onChange={e => { setGeneralLines(lines => lines.map(l => l.key === x.key ? { ...l, unit: e.target.value } : l)); change(); }} className="min-h-11 block w-full rounded border p-2">{compatible(x.material.control_unit).map(u => <option key={u}>{u}</option>)}</select></label><label>Aplicação<select value={x.mode} onChange={e => { setGeneralLines(lines => lines.map(l => l.key === x.key ? { ...l, mode: e.target.value as GeneralLine["mode"] } : l)); change(); }} className="min-h-11 block w-full rounded border p-2"><option value="per_piece">Por peça</option><option value="per_lot">Por lote</option></select></label></div><button type="button" onClick={() => { setGeneralLines(lines => lines.filter(l => l.key !== x.key)); change(); restoreLineFocus(); }} className="inline-flex min-h-11 items-center underline">Remover</button></div>)}</section></fieldset>,
    <fieldset key="review" disabled={busy || uncertain} className="min-w-0"><section className={pricingPanel}><h3 className="text-lg font-semibold">Revisão e produto</h3>{section("Buscar produto", productQuery, setProductQuery, products, p => search(searchProductsAction, productQuery, p, setProducts), products.items.map(x => <button key={x.id} type="button" aria-pressed={product?.id === x.id} onClick={() => { setProduct(x); change(); }} className={`min-h-11 block w-full rounded border p-2 text-left ${printer?.id === x.id ? "border-violet-600" : ""}`}>{x.name}</button>))}{initialProducts.total === 0 && <p role="status">Nenhum produto cadastrado. {canCreateProduct && <Link href="/produtos" className="inline-flex min-h-11 items-center underline">Cadastrar produto</Link>}</p>}<p>Produto: {product?.name ?? "nenhum"}</p><p>Produto é opcional para simular e obrigatório para salvar. Confira os parâmetros antes de calcular; valores cadastrados são somente leitura.</p><p>Lote: {quantity} peças; impressão: {hours} h {minutes} min. Tarifa: {rate} R$/kWh; perda: {loss}%; acréscimo: {markup}%.</p></section></fieldset>,
    <section key="result" className={pricingPanel}>
    {configVersion === null && <p role="status" className="text-sm text-amber-900">Configuração da empresa indisponível para salvar. Atualize a página para recuperar a versão; sua simulação pode ser consultada abaixo.</p>}
    <h3 className="text-lg font-semibold">Resultado</h3>
    {result && <div className="space-y-1 rounded bg-slate-50 p-4">
      <h4 className="font-semibold">Resultado {stale && "— desatualizado; recalcule"}</h4>
      <p className="text-xs text-slate-500">Estimativa de custos e preços sugeridos — confirmação no servidor</p>
      {!stale && [["Filamento (inclui perda)", result.material], ["Energia", result.energy], ["Depreciação", result.depreciation], ["Manutenção", result.maintenance], ["Acabamento", result.finishing], ["Embalagem (materiais + custo manual)", result.packaging], ["Total do lote", result.total], ["Custo por peça", result.unitCost], ["Preço sugerido do lote", result.suggestedLotPrice], ["Preço sugerido por peça", result.suggestedUnitPrice]].map(([label, value]) => <p key={String(label)}>{label}: <strong>{money(value as number)}</strong></p>)}
      {stale && <p className="text-sm font-medium text-amber-700">Resultado desatualizado. Recalcule para atualizar os valores.</p>}
    </div>}
    {canSave && <button type="button" disabled={!result || stale || !product || busy || !!saved || configVersion === null} onClick={save} className={pricingButton}>{busy ? "Salvando…" : "Salvar precificação"}</button>}
    {saved && <Link href={`/precificadora/historico/${saved}`} className="block underline">Ver precificação salva</Link>}
    </section>
    ]}
    </PricingWizard>
    {uncertain && canSave && <button type="button" disabled={busy} onClick={save} className={pricingButton}>{busy ? "Confirmando…" : "Confirmar mesma tentativa congelada"}</button>}
  </div>;
}

"use client";

import Link from "next/link";
import { PricingInput, PricingWizard, pricingButton } from "./PricingWizard";
import { manualRules, manualDecimal, manualPositive } from "@/lib/pricing/input";
import { timeToHours } from "@/lib/pricing/parse";
import { useRef, useState } from "react";
import { calculateFdmPricing, type FdmPricingResult } from "@/lib/pricing/fdm";
import { parseManualForm, type ManualForm } from "@/lib/pricing/manual-form";
import type { ManualFdmRequest } from "@/lib/pricing/manual";
import { saveManualFdmPricingAction, searchProductsAction, type PricingProduct } from "@/lib/pricing/persistence-actions";

type ProductPage = { items: PricingProduct[]; page: number; totalPages: number; total: number };
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const emptySpool = () => ({ name: "", consumptionGrams: "", purchasePrice: "", originalFilamentGrams: "" });
const initialForm: ManualForm = {
  name: "", quantity: "", hours: "", minutes: "0", purchasePrice: "", lifeHours: "", powerWatts: "", maintenancePerHour: "0",
  energyRate: "", lossPercent: "0", finishingHours: "0", finishingMinutes: "0", laborPerHour: "0", fixedCost: "0", packagingPerPiece: "0", markupPercent: "0",
  spoolLines: [emptySpool()], packagingLines: [],
};
type Attempt = { input: ManualFdmRequest["input"]; result: FdmPricingResult; id: string; product: PricingProduct | null };

/** This branch never mounts inventory controls or effects. Only product searches are allowed. */
export function ManualPricingSimulator({ initialProducts, canSave, canCreateProduct = false }: { initialProducts: ProductPage; canSave: boolean; canCreateProduct?: boolean }) {
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState(initialProducts), [query, setQuery] = useState("");
  const [product, setProduct] = useState<PricingProduct | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null), [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<string | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const searchSequence = useRef(0);
  const [searching, setSearching] = useState(false);
  const [spoolKeys, setSpoolKeys] = useState([0]);
  const [packagingKeys, setPackagingKeys] = useState<number[]>([]);
  const nextKey = useRef(1);
  const restoreLineFocus = () => requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-pricing-step]:not([hidden]) button')?.focus());
  const [uncertain, setUncertain] = useState(false);
  const change = () => { setStale(true); setSaved(null); };
  const update = <K extends keyof ManualForm>(key: K, value: ManualForm[K]) => { if (lock.current || uncertain) return; setForm(previous => ({ ...previous, [key]: value })); change(); };
  const field = (label: string, value: string, setter: (value: string) => void, numeric = true, positive = false) => <PricingInput label={label} value={value} onChange={setter} rule={numeric ? positive ? manualPositive : manualDecimal : undefined} />;
  const mainField = (key: keyof Omit<ManualForm, "spoolLines" | "packagingLines">, label: string) => <PricingInput label={label} value={form[key]} onChange={value => update(key, value)} rule={key === "name" ? undefined : manualRules[key] ?? manualDecimal} />;
  const search = async (page: number) => {
    const sequence = ++searchSequence.current;
    setSearching(true);
    try {
      const response = await searchProductsAction({ query, page, limit: 10 });
      if (sequence !== searchSequence.current) return;
      if (response.ok) setProducts(response.data); else setNotice(response.error);
    } catch { if (sequence === searchSequence.current) setNotice("Não foi possível buscar produtos. Tente novamente; suas entradas foram preservadas."); }
    finally { if (sequence === searchSequence.current) setSearching(false); }
  };
  const calculate = () => {
    if (lock.current || uncertain) return false;
    const input = parseManualForm(form);
    if (!input) { setStale(true); setNotice("Preencha os campos obrigatórios com números finitos válidos. Use vírgula para decimais e zero explícito para custos sem valor."); return false; }
    const output = calculateFdmPricing({ ...input, energyRate: input.tariff.effective });
    if (Array.isArray(output)) { setStale(true); setNotice(output.map(error => error.message).join(" ")); return false; }
    if (!Object.values(output).every(Number.isFinite)) { setStale(true); setNotice("O cálculo excedeu os limites permitidos."); return false; }
    setAttempt({ input, result: output, id: crypto.randomUUID(), product: product ? { ...product } : null });
    setStale(false); setSaved(null); setNotice("");
    return true;
  };
  const save = async () => {
    if (!canSave || !attempt?.product || stale || saved || lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const response = await saveManualFdmPricingAction({ attemptId: attempt.id, productId: attempt.product.id, productVersion: attempt.product.version, input: attempt.input });
      if (response.ok) { setUncertain(false); setSaved(response.data.pricingId); setNotice("Precificação salva."); }
      else { setUncertain(previous => previous || response.code === "unknown"); setNotice(response.error); }
    } catch { setUncertain(true); setNotice("Resultado não confirmado. Tente novamente com a mesma tentativa congelada."); }
    finally { lock.current = false; setBusy(false); }
  };
  const [timeValidationAttempted, setTimeValidationAttempted] = useState(false);
  const timeInvalid = timeValidationAttempted && !(Number(timeToHours(form.hours, form.minutes)) > 0);
  const validateStep = (index: number) => {
    if (index === 2) setTimeValidationAttempted(true);
    if (index === 2 && !(Number(timeToHours(form.hours, form.minutes)) > 0)) {
      setNotice("Informe tempo total de impressão maior que zero, com minutos de 0 a 59."); return false;
    }
    if (index === 4 && !parseManualForm(form)) { setNotice("Revise todas as entradas antes de calcular."); return false; }
    return true;
  };
  return <div className="space-y-4">
    {notice && <p role="status" className="rounded-lg border border-[#A6B4FF] bg-[#A6B4FF]/10 p-4 text-sm">{notice}</p>}
    {uncertain && <p role="status">A tentativa está congelada porque o resultado do salvamento não foi confirmado. Salve novamente para confirmar sem duplicar.</p>}
    <PricingWizard step={step} setStep={setStep} validateStep={validateStep} onCalculate={calculate} disabled={busy || uncertain} mode="Aprendiz · dados manuais" summary={<dl className="space-y-3 text-sm"><div><dt className="text-slate-500">Impressora manual</dt><dd className="break-words">{form.name || "Não informada"}</dd></div><div><dt className="text-slate-500">Filamentos</dt><dd>{form.spoolLines.length}</dd></div><div><dt className="text-slate-500">Produto para salvar</dt><dd className="break-words">{product?.name ?? "Não vinculado (simulação permitida)"}</dd></div><div><dt className="text-slate-500">Resultado</dt><dd>{attempt ? stale ? "Desatualizado; recalcule" : "Calculado na etapa final" : "Ainda não calculado"}</dd></div></dl>}>
    {[
    <section key="filament" className="space-y-3"><h3 className="text-lg font-semibold">Filamentos manuais</h3>
      {form.spoolLines.map((line, index) => <div key={spoolKeys[index]} className="space-y-2 rounded border p-3"><h3>Filamento {index + 1}</h3><div className="grid gap-3 sm:grid-cols-2">{([["name", "Nome do filamento"], ["consumptionGrams", "Consumo total do lote (g)"], ["purchasePrice", "Preço do carretel (R$)"], ["originalFilamentGrams", "Peso original do filamento (g)"]] as const).map(([key, label]) => <div key={key}>{field(label, line[key], value => update("spoolLines", form.spoolLines.map((item, i) => i === index ? { ...item, [key]: value } : item)), key !== "name", key === "consumptionGrams" || key === "originalFilamentGrams")}</div>)}</div><button type="button" disabled={form.spoolLines.length === 1} onClick={() => { update("spoolLines", form.spoolLines.filter((_, i) => i !== index)); setSpoolKeys(keys => keys.filter((_, i) => i !== index)); restoreLineFocus(); }} className="inline-flex min-h-11 items-center text-[#2B00FF] underline disabled:opacity-50">Remover filamento</button></div>)}
      <button type="button" disabled={form.spoolLines.length >= 10} onClick={() => { setSpoolKeys(keys => [...keys, nextKey.current++]); update("spoolLines", [...form.spoolLines, emptySpool()]); }} className="inline-flex min-h-11 items-center text-[#2B00FF] underline disabled:opacity-50">Adicionar filamento</button>{mainField("lossPercent", "Perda de filamento (%)")}
    </section>,
    <section key="printer" className="space-y-3"><h3 className="text-lg font-semibold">Impressora e energia manuais</h3><div className="grid gap-3 sm:grid-cols-2">
      {mainField("name", "Nome da impressora")}{mainField("purchasePrice", "Preço de aquisição (R$)")}{mainField("lifeHours", "Vida útil estimada (h)")}{mainField("powerWatts", "Potência média (W)")}{mainField("maintenancePerHour", "Manutenção (R$/h)")}{mainField("energyRate", "Tarifa de energia (R$/kWh)")}
    </div></section>,
    <section key="costs" className="space-y-3"><h3 className="text-lg font-semibold">Lote e acabamento</h3><div className="grid gap-3 sm:grid-cols-3">{mainField("quantity", "Quantidade de peças")}<div className="col-span-full">
      <div className="grid gap-3 sm:grid-cols-2">
        {mainField("hours", "Impressão total: horas")}
        {mainField("minutes", "Impressão total: minutos")}
      </div>
      {timeInvalid && <p tabIndex={-1} role="alert" data-pricing-domain-invalid="true" className="mt-2 text-sm text-red-600">O tempo total de impressão deve ser maior que zero.</p>}
    </div>{mainField("finishingHours", "Acabamento: horas")}{mainField("finishingMinutes", "Acabamento: minutos")}{mainField("laborPerHour", "Mão de obra (R$/h)")}{mainField("fixedCost", "Custo fixo do lote (R$)")}{mainField("markupPercent", "Acréscimo (%)")}</div></section>,
    <section key="packaging" className="space-y-3"><h2 className="text-xl font-semibold">3. Embalagens manuais</h2><p className="text-sm">Informe cada custo uma única vez: nas linhas abaixo ou no custo adicional por peça. O preço de referência corresponde à quantidade de referência na mesma unidade informada.</p>
      {form.packagingLines.map((line, index) => <div key={packagingKeys[index]} className="space-y-2 rounded border p-3"><h3>Embalagem {index + 1}</h3><div className="grid gap-3 sm:grid-cols-2">{([["name", "Nome da embalagem"], ["quantity", "Quantidade consumida"], ["suppliedUnit", "Unidade"], ["referencePrice", "Preço de referência (R$)"], ["referenceQuantity", "Quantidade de referência"]] as const).map(([key, label]) => <div key={key}>{key === "suppliedUnit" ? <label className="block text-sm">Unidade<select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 p-2" value={line.suppliedUnit} onChange={event => update("packagingLines", form.packagingLines.map((item, i) => i === index ? { ...item, suppliedUnit: event.target.value } : item))}>{["unidade", "metro", "centimetro", "grama", "quilograma"].map(unit => <option key={unit}>{unit}</option>)}</select></label> : field(label, line[key], value => update("packagingLines", form.packagingLines.map((item, i) => i === index ? { ...item, [key]: value } : item)), key !== "name", key === "quantity" || key === "referenceQuantity")}</div>)}<label>Aplicação<select className="mt-2 min-h-11 min-w-0 w-full rounded-lg border p-2" value={line.mode} onChange={event => update("packagingLines", form.packagingLines.map((item, i) => i === index ? { ...item, mode: event.target.value as "per_piece" | "per_lot" } : item))}><option value="per_piece">Por peça</option><option value="per_lot">Por lote</option></select></label></div><button type="button" onClick={() => { update("packagingLines", form.packagingLines.filter((_, i) => i !== index)); setPackagingKeys(keys => keys.filter((_, i) => i !== index)); restoreLineFocus(); }} className="inline-flex min-h-11 items-center text-[#2B00FF] underline">Remover embalagem</button></div>)}
      <button type="button" disabled={form.packagingLines.length >= 10} onClick={() => { setPackagingKeys(keys => [...keys, nextKey.current++]); update("packagingLines", [...form.packagingLines, { name: "", mode: "per_piece", quantity: "", suppliedUnit: "unidade", referencePrice: "", referenceQuantity: "" }]); }} className="inline-flex min-h-11 items-center text-[#2B00FF] underline disabled:opacity-50">Adicionar embalagem</button>{mainField("packagingPerPiece", "Custo adicional de embalagem por peça (R$), não incluído nas linhas")}
    </section>,
    <section key="review" className="space-y-3"><h3 className="text-lg font-semibold">Vínculo e revisão</h3><p className="text-sm">Revise as etapas pelo indicador acima. Impressão: {form.hours} h {form.minutes} min · Lote: {form.quantity} peças · Acréscimo sobre custo: {form.markupPercent}%.</p><p className="text-sm">O produto é necessário apenas para salvar, não para simular.</p>
      {initialProducts.total === 0 ? <p role="status">Nenhum produto ativo disponível na janela do seu plano. Cadastre um produto ou revise os cadastros permitidos. {canCreateProduct && <Link href="/produtos" className="inline-flex min-h-11 items-center text-[#2B00FF] underline">Cadastrar produto</Link>}</p> : <><div className="flex flex-wrap gap-2"><input aria-label="Buscar produto" disabled={searching} maxLength={200} className="min-h-11 min-w-0 w-full rounded-lg border p-2" value={query} onChange={event => setQuery(event.target.value)} /><button className={pricingButton} type="button" disabled={searching} onClick={() => search(1)}>{searching ? "Buscando…" : "Buscar"}</button></div>{products.items.length === 0 && <p>Nenhum produto encontrado nesta busca.</p>}<label className="block">Produto<select className="mt-2 min-h-11 min-w-0 w-full rounded-lg border p-2" value={product?.id ?? ""} onChange={event => { setProduct(products.items.find(item => item.id === event.target.value) ?? null); change(); }}><option value="">Selecione</option>{product && !products.items.some(item => item.id === product.id) && <option value={product.id}>{product.name}</option>}{products.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex flex-wrap items-center gap-3"><button className={pricingButton} type="button" disabled={searching || products.page <= 1} onClick={() => search(products.page - 1)}>Anterior</button><span>Página {products.page} de {products.totalPages}</span><button className={pricingButton} type="button" disabled={searching || products.page >= products.totalPages} onClick={() => search(products.page + 1)}>Próxima</button></div></>}
    </section>,
    <section key="result" className="space-y-4">
      {attempt && <div className="space-y-1 rounded bg-slate-50 p-4"><h3 className="font-semibold">Resultado {stale && "— desatualizado; recalcule"}</h3>
      <p className="text-xs text-slate-500">Estimativa de custos e preços sugeridos — confirmação no servidor</p>
      {!stale && ([["Filamento (inclui perda)", "material"], ["Energia", "energy"], ["Depreciação", "depreciation"], ["Manutenção", "maintenance"], ["Acabamento", "finishing"], ["Embalagem", "packaging"], ["Total do lote", "total"], ["Custo por peça", "unitCost"], ["Preço sugerido do lote", "suggestedLotPrice"], ["Preço sugerido por peça", "suggestedUnitPrice"]] as const).map(([label, key]) => <p key={key}>{label}: <strong>{money(attempt.result[key])}</strong></p>)}
      {stale && <p className="text-sm font-medium text-amber-700">Resultado desatualizado. Recalcule para atualizar os valores.</p>}
      </div>}
      {!attempt && <p>Revise os parâmetros e calcule para obter o resultado.</p>}
      {canSave && !uncertain && <button type="button" disabled={!attempt?.product || stale || busy || !!saved} onClick={save} className={pricingButton}>{busy ? "Salvando…" : "Salvar precificação"}</button>}
      {attempt && !attempt.product && <p className="text-sm text-slate-600">Para salvar, volte à revisão, vincule um produto e recalcule.</p>}
      {saved && <Link href={`/precificadora/historico/${saved}`} className="inline-flex min-h-11 items-center text-[#2B00FF] underline">Ver salva e revisar aplicação ao produto</Link>}
    </section>
    ]}
    </PricingWizard>
    {uncertain && canSave && <button type="button" disabled={busy} onClick={save} className={pricingButton}>{busy ? "Confirmando…" : "Confirmar mesma tentativa congelada"}</button>}
  </div>;
}

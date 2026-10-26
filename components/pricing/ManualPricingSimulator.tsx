"use client";

import Link from "next/link";
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
  const [products, setProducts] = useState(initialProducts), [query, setQuery] = useState("");
  const [product, setProduct] = useState<PricingProduct | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null), [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<string | null>(null), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const change = () => { setStale(true); setSaved(null); };
  const update = <K extends keyof ManualForm>(key: K, value: ManualForm[K]) => { setForm(previous => ({ ...previous, [key]: value })); change(); };
  const field = (label: string, value: string, setter: (value: string) => void, numeric = true) => <label className="block text-sm">{label}<input className="mt-1 w-full rounded border p-2" inputMode={numeric ? "decimal" : "text"} value={value} onChange={event => setter(event.target.value)} /></label>;
  const mainField = (key: keyof Omit<ManualForm, "spoolLines" | "packagingLines">, label: string) => field(label, form[key], value => update(key, value), key !== "name");
  const search = async (page: number) => {
    const response = await searchProductsAction({ query, page, limit: 10 });
    if (response.ok) setProducts(response.data); else setNotice(response.error);
  };
  const calculate = () => {
    const input = parseManualForm(form);
    if (!input) { setStale(true); setNotice("Preencha os campos obrigatórios com números finitos válidos. Use vírgula para decimais e zero explícito para custos sem valor."); return; }
    const output = calculateFdmPricing({ ...input, energyRate: input.tariff.effective });
    if (Array.isArray(output)) { setStale(true); setNotice(output.map(error => error.message).join(" ")); return; }
    if (!Object.values(output).every(Number.isFinite)) { setStale(true); setNotice("O cálculo excedeu os limites permitidos."); return; }
    setAttempt({ input, result: output, id: crypto.randomUUID(), product: product ? { ...product } : null });
    setStale(false); setSaved(null); setNotice("");
  };
  const save = async () => {
    if (!canSave || !attempt?.product || stale || saved || lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const response = await saveManualFdmPricingAction({ attemptId: attempt.id, productId: attempt.product.id, productVersion: attempt.product.version, input: attempt.input });
      if (response.ok) { setSaved(response.data.pricingId); setNotice("Precificação salva."); } else setNotice(response.error);
    } catch { setNotice("Não foi possível salvar. Tente novamente com a mesma tentativa."); }
    finally { lock.current = false; setBusy(false); }
  };
  return <main className="mx-auto max-w-4xl space-y-6">
    <header className="flex justify-between gap-3"><div><h1 className="text-3xl font-bold">Precificadora FDM manual</h1><p>Plano Aprendiz: dados manuais, sem consulta de impressoras, estoque ou configuração da empresa.</p><p>Tempo de impressão e consumo de filamento são totais do lote. Valores monetários em reais.</p></div><Link href="/precificadora/historico" className="underline">Histórico</Link></header>
    {notice && <p role="status" className="rounded bg-blue-50 p-3">{notice}</p>}
    <section className="space-y-3 rounded border bg-white p-5"><h2 className="text-xl font-semibold">1. Impressora e energia manuais</h2><div className="grid gap-3 sm:grid-cols-2">
      {mainField("name", "Nome da impressora")}{mainField("purchasePrice", "Preço de aquisição (R$)")}{mainField("lifeHours", "Vida útil estimada (h)")}{mainField("powerWatts", "Potência média (W)")}{mainField("maintenancePerHour", "Manutenção (R$/h)")}{mainField("energyRate", "Tarifa de energia (R$/kWh)")}
    </div></section>
    <section className="space-y-3 rounded border bg-white p-5"><h2 className="text-xl font-semibold">2. Filamentos manuais</h2>
      {form.spoolLines.map((line, index) => <div key={index} className="space-y-2 rounded border p-3"><h3>Filamento {index + 1}</h3><div className="grid gap-3 sm:grid-cols-2">{([["name", "Nome do filamento"], ["consumptionGrams", "Consumo total do lote (g)"], ["purchasePrice", "Preço do carretel (R$)"], ["originalFilamentGrams", "Peso original do filamento (g)"]] as const).map(([key, label]) => <div key={key}>{field(label, line[key], value => update("spoolLines", form.spoolLines.map((item, i) => i === index ? { ...item, [key]: value } : item)), key !== "name")}</div>)}</div><button type="button" disabled={form.spoolLines.length === 1} onClick={() => update("spoolLines", form.spoolLines.filter((_, i) => i !== index))} className="underline disabled:opacity-50">Remover filamento</button></div>)}
      <button type="button" disabled={form.spoolLines.length >= 10} onClick={() => update("spoolLines", [...form.spoolLines, emptySpool()])} className="underline disabled:opacity-50">Adicionar filamento</button>{mainField("lossPercent", "Perda de filamento (%)")}
    </section>
    <section className="space-y-3 rounded border bg-white p-5"><h2 className="text-xl font-semibold">3. Embalagens manuais</h2><p className="text-sm">Informe cada custo uma única vez: nas linhas abaixo ou no custo adicional por peça. O preço de referência corresponde à quantidade de referência na mesma unidade informada.</p>
      {form.packagingLines.map((line, index) => <div key={index} className="space-y-2 rounded border p-3"><h3>Embalagem {index + 1}</h3><div className="grid gap-3 sm:grid-cols-2">{([["name", "Nome da embalagem"], ["quantity", "Quantidade consumida"], ["suppliedUnit", "Unidade"], ["referencePrice", "Preço de referência (R$)"], ["referenceQuantity", "Quantidade de referência"]] as const).map(([key, label]) => <div key={key}>{field(label, line[key], value => update("packagingLines", form.packagingLines.map((item, i) => i === index ? { ...item, [key]: value } : item)), key !== "name" && key !== "suppliedUnit")}</div>)}<label>Aplicação<select className="block w-full rounded border p-2" value={line.mode} onChange={event => update("packagingLines", form.packagingLines.map((item, i) => i === index ? { ...item, mode: event.target.value as "per_piece" | "per_lot" } : item))}><option value="per_piece">Por peça</option><option value="per_lot">Por lote</option></select></label></div><button type="button" onClick={() => update("packagingLines", form.packagingLines.filter((_, i) => i !== index))} className="underline">Remover embalagem</button></div>)}
      <button type="button" disabled={form.packagingLines.length >= 10} onClick={() => update("packagingLines", [...form.packagingLines, { name: "", mode: "per_piece", quantity: "", suppliedUnit: "unidade", referencePrice: "", referenceQuantity: "" }])} className="underline disabled:opacity-50">Adicionar embalagem</button>{mainField("packagingPerPiece", "Custo adicional de embalagem por peça (R$), não incluído nas linhas")}
    </section>
    <section className="space-y-3 rounded border bg-white p-5"><h2 className="text-xl font-semibold">4. Lote e acabamento</h2><div className="grid gap-3 sm:grid-cols-3">{mainField("quantity", "Quantidade de peças")}{mainField("hours", "Impressão total: horas")}{mainField("minutes", "Impressão total: minutos")}{mainField("finishingHours", "Acabamento: horas")}{mainField("finishingMinutes", "Acabamento: minutos")}{mainField("laborPerHour", "Mão de obra (R$/h)")}{mainField("fixedCost", "Custo fixo do lote (R$)")}{mainField("markupPercent", "Acréscimo (%)")}</div></section>
    <section className="space-y-3 rounded border bg-white p-5"><h2 className="text-xl font-semibold">5. Produto e resultado</h2><p className="text-sm">O produto é necessário apenas para salvar, não para simular.</p>
      {initialProducts.total === 0 ? <p role="status">Nenhum produto ativo disponível na janela do seu plano. Cadastre um produto ou revise os cadastros permitidos. {canCreateProduct && <Link href="/produtos" className="underline">Cadastrar produto</Link>}</p> : <><div className="flex gap-2"><input aria-label="Buscar produto" className="w-full rounded border p-2" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" onClick={() => search(1)}>Buscar</button></div>{products.items.length === 0 && <p>Nenhum produto encontrado nesta busca.</p>}<label className="block">Produto<select className="mt-1 w-full rounded border p-2" value={product?.id ?? ""} onChange={event => { setProduct(products.items.find(item => item.id === event.target.value) ?? null); change(); }}><option value="">Selecione</option>{product && !products.items.some(item => item.id === product.id) && <option value={product.id}>{product.name}</option>}{products.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex gap-3"><button type="button" disabled={products.page <= 1} onClick={() => search(products.page - 1)}>Anterior</button><span>Página {products.page} de {products.totalPages}</span><button type="button" disabled={products.page >= products.totalPages} onClick={() => search(products.page + 1)}>Próxima</button></div></>}
      <button type="button" onClick={calculate} className="rounded bg-violet-600 px-4 py-2 text-white">Calcular</button>
      {attempt && <div className="space-y-1 rounded bg-slate-50 p-4"><h3 className="font-semibold">Resultado {stale && "— desatualizado; recalcule"}</h3>{([["Filamento (inclui perda)", "material"], ["Energia", "energy"], ["Depreciação", "depreciation"], ["Manutenção", "maintenance"], ["Acabamento", "finishing"], ["Embalagem", "packaging"], ["Total do lote", "total"], ["Custo por peça", "unitCost"], ["Preço sugerido do lote", "suggestedLotPrice"], ["Preço sugerido por peça", "suggestedUnitPrice"]] as const).map(([label, key]) => <p key={key}>{label}: <strong>{money(attempt.result[key])}</strong></p>)}</div>}
      {canSave && <button type="button" disabled={!attempt?.product || stale || busy || !!saved} onClick={save} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar tentativa congelada"}</button>}{saved && <Link href={`/precificadora/historico/${saved}`} className="block underline">Ver salva</Link>}
    </section>
  </main>;
}

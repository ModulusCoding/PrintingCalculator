
"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import printersData from "../../public/impressoras.json";
import rawMarketData from "../../public/marketplaces.json";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { formatCurrencyInput } from "@/utils/currency";

// ─── Types — Professional Calculator ─────────────────────────────────────────

type MachineMode = "manual" | "automatic";
type WeightUnit = "g" | "kg";
type Currency = "BRL" | "USD" | "EUR";
type ActiveTab = "calculator" | "marketplace";

type ColorMaterial = {
  id: number;
  name: string;
  quantity: string;
  unit: WeightUnit;
  spoolWeight: string;
  spoolWeightUnit: WeightUnit;
  price: string;
};

type PackagingItem = {
  id: number;
  name: string;
  value: string;
};

type Step = {
  title: string;
  eyebrow: string;
  description: ReactNode;
  icon: string;
};

type PrinterCatalog = {
  marcas_impressoras_3d: {
    marca: string;
    modelos: {
      id: string;
      nome_modelo: string;
      consumo_W: { pico: number; medio: number };
    }[];
  }[];
};

type PrinterOption = {
  id: string;
  brand: string;
  model: string;
  averageConsumption: number;
  peakConsumption: number;
  searchableText: string;
};

// ─── Types — Marketplace Engine ───────────────────────────────────────────────

type TaxaPercentual = { nome: string; valor?: number; percentual?: number };
type TaxaFixa = { nome?: string; valor: number; moeda?: string; frequencia?: string; isencoes_mensais?: number };
type TaxaProcessamento = {
  nome: string;
  percentual?: number;
  percentual_min?: number;
  percentual_max?: number;
  taxa_fixa?: number;
  moeda?: string;
  embutido_na_comissao?: boolean;
};
type Mensalidade = { nome?: string; valor: number };
type Comissao = {
  nome: string;
  percentual?: number;
  percentual_min?: number;
  percentual_max?: number;
  taxa_fixa?: number;
};
type Faixa = {
  valor_min?: number;
  valor_max?: number;
  percentual?: number;
  percentual_min?: number;
  percentual_max?: number;
  taxa_fixa?: number;
  frete_gratis_mandatorio?: boolean;
  percentual_comissao?: number;
  percentual_comissao_min?: number;
  percentual_comissao_max?: number;
};
type Categoria = {
  nome: string;
  percentual?: number;
  percentual_min?: number;
  percentual_max?: number;
  dependente_categoria?: boolean;
};
type PlanoRegras = {
  taxas_percentuais?: TaxaPercentual[];
  taxas_fixas?: TaxaFixa[];
  mensalidades?: Mensalidade[];
};
type Plano = { nome: string; regras?: PlanoRegras; mensalidades?: Mensalidade[]; taxas_fixas?: TaxaFixa[] };
type ModalidadeRegras = {
  faixas?: Faixa[];
  taxas_percentuais?: TaxaPercentual[];
  taxas_fixas?: TaxaFixa[];
  percentual_comissao?: number;
  percentual_comissao_min?: number;
};
type Modalidade = { nome: string; regras: ModalidadeRegras };
type RegrasFrete = {
  subsidiado?: boolean;
  valor_minimo_frete_gratis?: number;
  custeio_vendedor_percentual_min?: number;
  custeio_vendedor_percentual_max?: number;
  fba_logistica_amazon?: boolean;
  fba_taxa_min?: number;
  fba_taxa_max?: number;
  dependente_peso_dimensao?: boolean;
  integrado_mercado_envios?: boolean;
  magalu_entregas?: boolean;
  envia?: boolean;
};
type MarketplaceJSON = {
  id: string;
  nome: string;
  pais: string;
  tipo: string;
  moeda: string;
  descricao: string;
  ativo: boolean;
  tipo_produto: string[];
  categorias: Categoria[];
  planos: Plano[];
  modalidades: Modalidade[];
  regras: Record<string, unknown>;
  faixas: Faixa[];
  comissoes: Comissao[];
  taxas: Record<string, number>;
  taxas_fixas: TaxaFixa[];
  taxas_percentuais: TaxaPercentual[];
  taxas_processamento: TaxaProcessamento[];
  mensalidades: Mensalidade[];
  frete: RegrasFrete;
  observacoes: string;
  ultima_atualizacao?: string;
};
type ManualTaxes = {
  comissao: string;
  taxaFixa: string;
  taxaProcessamento: string;
  taxaAnuncio: string;
  mensalidade: string;
  outrasTaxas: string;
  frete: string;
  impostos: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = "modulus_calculator_state";

const CURRENCY_CONFIG: Record<Currency, { symbol: string; locale: string; code: string }> = {
  BRL: { symbol: "R$", locale: "pt-BR", code: "BRL" },
  USD: { symbol: "$", locale: "en-US", code: "USD" },
  EUR: { symbol: "€", locale: "de-DE", code: "EUR" },
};

const steps: Step[] = [
  {
    title: "Material",
    eyebrow: "Etapa 1",
    description: (
      <>
        Informe cada cor ou material utilizado na peça com sua quantidade, rolo adquirido e{" "}
        <strong>preço pago individualmente</strong>.
      </>
    ),
    icon: "◐",
  },
  {
    title: "Energia",
    eyebrow: "Etapa 2",
    description: (
      <>
        Encontre sua impressora por <strong>nome ou marca</strong> e use o consumo médio em Watts,
        sem chute.
      </>
    ),
    icon: "⚡",
  },
  {
    title: "Tempo de Máquina",
    eyebrow: "Etapa 3",
    description: (
      <>
        Defina quanto a impressora precisa recuperar por hora para manter sua operação{" "}
        <em>saudável</em>. Esta etapa é <strong>opcional</strong> — pule caso não queira incluir
        custo de máquina.
      </>
    ),
    icon: "◷",
  },
  {
    title: "Acabamento",
    eyebrow: "Etapa 4",
    description: (
      <>
        Some acabamento fixo e mão de obra para que o detalhe final também entre no{" "}
        <strong>preço certo</strong>.
      </>
    ),
    icon: "✦",
  },
  {
    title: "Embalagem",
    eyebrow: "Etapa 5",
    description: (
      <>
        Monte uma lista com tudo o que protege e valoriza a entrega da peça.
      </>
    ),
    icon: "▣",
  },
  {
    title: "Impostos",
    eyebrow: "Etapa 6",
    description: (
      <>
        Aplique a alíquota sobre o subtotal operacional e evite vender com margem{" "}
        <em>ilusória</em>.
      </>
    ),
    icon: "%",
  },
  {
    title: "Resultado",
    eyebrow: "Etapa 7",
    description: (
      <>
        Veja o custo detalhado e três sugestões de venda para decidir com <strong>clareza</strong>.
      </>
    ),
    icon: "✓",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNumber = (value: string = "") => {
  const normalized = value.replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toCurrencyNumber = (value: string = "") => {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toGrams = (value: string, unit: WeightUnit) => {
  const n = toNumber(value);
  return unit === "kg" ? n * 1000 : n;
};

const normalizeSearch = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const formatCurrencyValue = (value: number, currency: Currency) => {
  const { locale, code } = CURRENCY_CONFIG[currency];
  return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(value || 0);
};

const pct = (v: number) => `${v}%`;

// ─── Marketplace data ─────────────────────────────────────────────────────────

const allMarketplaces = rawMarketData as MarketplaceJSON[];
const activeMarketplaces = allMarketplaces
  .filter((m) => m.ativo)
  .sort((a, b) => {
    if (a.id === "outro_marketplace") return 1;
    if (b.id === "outro_marketplace") return -1;
    return a.nome.localeCompare(b.nome);
  });

// ─── Marketplace Fee Engine ───────────────────────────────────────────────────

type FeeBreakdown = {
  comissao: number;
  taxaFixa: number;
  taxaProcessamento: number;
  mensalidade: number;
  frete: number;
  impostos: number;
  outrasTaxas: number;
  totalTaxas: number;
  precoFinal: number;
  lucro: number;
  comissaoLabel: string;
};

function resolveCommissionPercent(
  marketplace: MarketplaceJSON,
  selectedModalidade: string,
  selectedPlano: string,
  selectedCategoria: string,
  estimatedPrice: number,
): { percentual: number; taxaFixa: number; label: string } {
  if (marketplace.id === "outro_marketplace") return { percentual: 0, taxaFixa: 0, label: "" };

  if (marketplace.modalidades.length > 0 && selectedModalidade) {
    const mod = marketplace.modalidades.find((m) => m.nome === selectedModalidade);
    if (mod?.regras?.faixas && mod.regras.faixas.length > 0) {
      const faixa = mod.regras.faixas.find(
        (f) => estimatedPrice >= (f.valor_min ?? 0) && estimatedPrice <= (f.valor_max ?? Infinity),
      );
      if (faixa) {
        const pctVal = faixa.percentual_min ?? faixa.percentual ?? 0;
        return { percentual: pctVal, taxaFixa: faixa.taxa_fixa ?? 0, label: `${mod.nome} — ${pct(pctVal)}` };
      }
    }
    if (mod?.regras?.taxas_percentuais && mod.regras.taxas_percentuais.length > 0) {
      const t = mod.regras.taxas_percentuais[0];
      const pctVal = t.valor ?? t.percentual ?? 0;
      const tf = mod.regras.taxas_fixas?.[0]?.valor ?? 0;
      return { percentual: pctVal, taxaFixa: tf, label: `${mod.nome} — ${pct(pctVal)}` };
    }
    if (mod?.regras?.percentual_comissao !== undefined) {
      return { percentual: mod.regras.percentual_comissao, taxaFixa: 0, label: `${mod.nome} — ${pct(mod.regras.percentual_comissao)}` };
    }
    if (mod?.regras?.percentual_comissao_min !== undefined) {
      const v = mod.regras.percentual_comissao_min;
      return { percentual: v, taxaFixa: 0, label: `${mod.nome} — ~${pct(v)}` };
    }
  }

  if (marketplace.planos.length > 0 && selectedPlano) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    const pctArr = (plano?.regras?.taxas_percentuais ?? []) as TaxaPercentual[];
    const pctVal = pctArr[0]?.valor ?? pctArr[0]?.percentual ?? 0;
    const tf = (plano?.regras?.taxas_fixas ?? plano?.taxas_fixas ?? [])[0]?.valor ?? 0;
    if (pctVal > 0 || tf > 0) return { percentual: pctVal, taxaFixa: tf, label: selectedPlano };
  }

  const regras = marketplace.regras as Record<string, unknown>;
  if (typeof regras.comissao_padrao === "number") {
    const tf = typeof regras.taxa_fixa_por_pedido === "number" ? regras.taxa_fixa_por_pedido : 0;
    return { percentual: regras.comissao_padrao, taxaFixa: tf, label: `Comissão padrão ${pct(regras.comissao_padrao)}` };
  }

  const regrasFaixas = regras.faixas as Faixa[] | undefined;
  if (regrasFaixas && regrasFaixas.length > 0) {
    const faixa = regrasFaixas.find(
      (f) => estimatedPrice >= (f.valor_min ?? 0) && estimatedPrice <= (f.valor_max ?? Infinity),
    );
    if (faixa) {
      return { percentual: faixa.percentual ?? 0, taxaFixa: faixa.taxa_fixa ?? 0, label: `Comissão ${pct(faixa.percentual ?? 0)}` };
    }
  }

  if (marketplace.comissoes.length > 0) {
    const c = marketplace.comissoes[0];
    const pctVal = c.percentual ?? c.percentual_min ?? 0;
    return { percentual: pctVal, taxaFixa: c.taxa_fixa ?? 0, label: `${c.nome} — ${pct(pctVal)}` };
  }

  if (marketplace.categorias.length > 0 && selectedCategoria) {
    const cat = marketplace.categorias.find((c) => c.nome === selectedCategoria);
    if (cat?.percentual) return { percentual: cat.percentual, taxaFixa: 0, label: `${cat.nome} — ${pct(cat.percentual)}` };
    if (cat?.percentual_min) return { percentual: cat.percentual_min, taxaFixa: 0, label: `${cat.nome} — ~${pct(cat.percentual_min)}` };
  }

  return { percentual: 0, taxaFixa: 0, label: "" };
}

function calculateMarketplaceFees(
  marketplace: MarketplaceJSON,
  selectedModalidade: string,
  selectedPlano: string,
  selectedCategoria: string,
  selectedFrete: string,
  customFreteValue: string,
  impostosPercent: string,
  margemDesejada: string,
  custoProducao: number,
  manualTaxes: ManualTaxes,
): FeeBreakdown {
  const margem = toNumber(margemDesejada);
  let estimatedPrice = custoProducao > 0 ? custoProducao * (1 + margem / 100) : 0;

  if (marketplace.id === "outro_marketplace") {
    const comissaoPct = toNumber(manualTaxes.comissao);
    const taxaFixaVal = toCurrencyNumber(manualTaxes.taxaFixa);
    const taxaProcPct = toNumber(manualTaxes.taxaProcessamento);
    const taxaAnuncioPct = toNumber(manualTaxes.taxaAnuncio);
    const mensalidadeVal = toCurrencyNumber(manualTaxes.mensalidade);
    const outrasTaxasVal = toCurrencyNumber(manualTaxes.outrasTaxas);
    const freteVal = toCurrencyNumber(manualTaxes.frete);
    const impostosPct = toNumber(manualTaxes.impostos);
    const comissao = estimatedPrice * (comissaoPct / 100);
    const taxaProcessamento = estimatedPrice * (taxaProcPct / 100);
    const taxaAnuncio = estimatedPrice * (taxaAnuncioPct / 100);
    const impostos = (custoProducao + freteVal) * (impostosPct / 100);
    const totalTaxas = comissao + taxaFixaVal + taxaProcessamento + taxaAnuncio + mensalidadeVal + outrasTaxasVal + freteVal + impostos;
    const custoTotal = custoProducao + totalTaxas;
    const precoFinal = margem > 0 ? custoTotal / (1 - margem / 100) : custoTotal;
    return { comissao, taxaFixa: taxaFixaVal, taxaProcessamento, mensalidade: mensalidadeVal, frete: freteVal, impostos, outrasTaxas: outrasTaxasVal + taxaAnuncio, totalTaxas, precoFinal, lucro: precoFinal - custoTotal, comissaoLabel: "Manual" };
  }

  // Converge price estimate (faixas depend on price)
  for (let i = 0; i < 3; i++) {
    const { percentual } = resolveCommissionPercent(marketplace, selectedModalidade, selectedPlano, selectedCategoria, estimatedPrice);
    const impostosPct = toNumber(impostosPercent);
    const impostosAmt = custoProducao * (impostosPct / 100);
    const comissaoAmt = estimatedPrice * (percentual / 100);
    const custoTotal = custoProducao + comissaoAmt + impostosAmt;
    estimatedPrice = margem > 0 ? custoTotal / (1 - margem / 100) : custoTotal;
  }

  const { percentual: comissaoPct, taxaFixa: taxaFixaFromJSON, label: comissaoLabel } =
    resolveCommissionPercent(marketplace, selectedModalidade, selectedPlano, selectedCategoria, estimatedPrice);

  let taxaProcessamento = 0;
  const tp = marketplace.taxas_processamento.find((t) => !t.embutido_na_comissao);
  if (tp) {
    const pctVal = tp.percentual ?? tp.percentual_min ?? 0;
    taxaProcessamento = estimatedPrice * (pctVal / 100) + (tp.taxa_fixa ?? 0);
  }

  let mensalidade = 0;
  if (selectedPlano) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    const mens = plano?.mensalidades ?? plano?.regras?.mensalidades ?? [];
    mensalidade = (mens as Mensalidade[])[0]?.valor ?? 0;
  }
  if (mensalidade === 0 && marketplace.mensalidades.length > 0) {
    mensalidade = marketplace.mensalidades[0].valor ?? 0;
  }

  let taxaFixaFinal = taxaFixaFromJSON;
  if (selectedPlano && taxaFixaFinal === 0) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    taxaFixaFinal = (plano?.regras?.taxas_fixas ?? plano?.taxas_fixas ?? [])[0]?.valor ?? 0;
  }

  let freteAmt = 0;
  if (selectedFrete === "proprio" || selectedFrete === "manual") {
    freteAmt = toCurrencyNumber(customFreteValue);
  } else if (selectedFrete === "subsidiado" && marketplace.frete.custeio_vendedor_percentual_min) {
    freteAmt = estimatedPrice * (marketplace.frete.custeio_vendedor_percentual_min / 100);
  } else if (selectedFrete === "fba" && marketplace.frete.fba_taxa_min) {
    freteAmt = marketplace.frete.fba_taxa_min;
  }

  const impostosPctVal = toNumber(impostosPercent);
  const impostos = (custoProducao + freteAmt) * (impostosPctVal / 100);
  const comissao = estimatedPrice * (comissaoPct / 100);
  const totalTaxas = comissao + taxaFixaFinal + taxaProcessamento + mensalidade + freteAmt + impostos;
  const custoTotal = custoProducao + totalTaxas;
  const precoFinal = margem > 0 ? custoTotal / (1 - margem / 100) : custoTotal;

  return { comissao, taxaFixa: taxaFixaFinal, taxaProcessamento, mensalidade, frete: freteAmt, impostos, outrasTaxas: 0, totalTaxas, precoFinal, lucro: precoFinal - custoTotal, comissaoLabel };
}

// ─── Printer catalog ──────────────────────────────────────────────────────────

const printerOptions: PrinterOption[] = (
  printersData as {
    marcas_impressoras_3d: {
      marca: string;
      modelos: { id: string; nome_modelo: string; consumo_W: { pico: number; medio: number } }[];
    }[];
  }
).marcas_impressoras_3d
  .flatMap((brand) =>
    brand.modelos.map((printer) => ({
      id: printer.id,
      brand: brand.marca,
      model: printer.nome_modelo,
      averageConsumption: printer.consumo_W.medio,
      peakConsumption: printer.consumo_W.pico,
      searchableText: normalizeSearch(`${brand.marca} ${printer.nome_modelo}`),
    })),
  )
  .sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));

// ─── Default state ────────────────────────────────────────────────────────────

const defaultColorMaterials = (): ColorMaterial[] => [
  { id: 1, name: "Cor 1", quantity: "", unit: "g", spoolWeight: "", spoolWeightUnit: "g", price: "0,000" },
];

const defaultPackaging = (): PackagingItem[] => [
  { id: 1, name: "Caixa", value: "" },
  { id: 2, name: "Etiqueta", value: "" },
  { id: 3, name: "Plastico bolha", value: "" },
];

const emptyColorMaterial = (id: number): ColorMaterial => ({
  id, name: "", quantity: "", unit: "g", spoolWeight: "", spoolWeightUnit: "g", price: "",
});

const emptyPackagingItem = (id: number): PackagingItem => ({ id, name: "", value: "" });

const defaultManualTaxes = (): ManualTaxes => ({
  comissao: "", taxaFixa: "", taxaProcessamento: "",
  taxaAnuncio: "", mensalidade: "", outrasTaxas: "", frete: "", impostos: "",
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function CalculatorPage() {
  // ── Global ──
  const [currency, setCurrency] = useState<Currency>("BRL");
  const [activeTab, setActiveTab] = useState<ActiveTab>("calculator");

  // ── Pro Calculator ──
  const [currentStep, setCurrentStep] = useState(0);
  const [attemptedSteps, setAttemptedSteps] = useState<number[]>([]);
  const [pieceQuantity, setPieceQuantity] = useState("1");
  const [colorMaterials, setColorMaterials] = useState<ColorMaterial[]>(defaultColorMaterials());
  const [printerSearch, setPrinterSearch] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
  const [printerConsumption, setPrinterConsumption] = useState("");
  const [printingHours, setPrintingHours] = useState("");
  const [kwhValue, setKwhValue] = useState("0,000");
  const [machineMode, setMachineMode] = useState<MachineMode>("manual");
  const [machineHourValue, setMachineHourValue] = useState("");
  const [printerValue, setPrinterValue] = useState("0,000");
  const [printerLifeHours, setPrinterLifeHours] = useState("");
  const [finishFixedValue, setFinishFixedValue] = useState("");
  const [finishHours, setFinishHours] = useState("");
  const [finishHourValue, setFinishHourValue] = useState("");
  const [packagingItems, setPackagingItems] = useState<PackagingItem[]>(defaultPackaging());
  const [taxPercent, setTaxPercent] = useState("");

  // ── Marketplace tab ──
  const [selectedMarketplaceId, setSelectedMarketplaceId] = useState("");
  const [selectedModalidade, setSelectedModalidade] = useState("");
  const [selectedPlano, setSelectedPlano] = useState("");
  const [selectedCategoria, setSelectedCategoria] = useState("");
  const [selectedFrete, setSelectedFrete] = useState("");
  const [customFreteValue, setCustomFreteValue] = useState("");
  const [impostosMarketplace, setImpostosMarketplace] = useState("");
  const [margemDesejada, setMargemDesejada] = useState("30");
  const [manualTaxes, setManualTaxes] = useState<ManualTaxes>(defaultManualTaxes());

  // ─── Cache ────────────────────────────────────────────────────────────────

  const stateSnapshot = useMemo(() => ({
    currency, activeTab,
    currentStep, attemptedSteps, pieceQuantity, colorMaterials,
    printerSearch, selectedPrinterId, printerConsumption, printingHours, kwhValue,
    machineMode, machineHourValue, printerValue, printerLifeHours,
    finishFixedValue, finishHours, finishHourValue, packagingItems, taxPercent,
    selectedMarketplaceId, selectedModalidade, selectedPlano, selectedCategoria,
    selectedFrete, customFreteValue, impostosMarketplace, margemDesejada, manualTaxes,
  }), [
    currency, activeTab,
    currentStep, attemptedSteps, pieceQuantity, colorMaterials,
    printerSearch, selectedPrinterId, printerConsumption, printingHours, kwhValue,
    machineMode, machineHourValue, printerValue, printerLifeHours,
    finishFixedValue, finishHours, finishHourValue, packagingItems, taxPercent,
    selectedMarketplaceId, selectedModalidade, selectedPlano, selectedCategoria,
    selectedFrete, customFreteValue, impostosMarketplace, margemDesejada, manualTaxes,
  ]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.currency) setCurrency(s.currency);
      if (s.activeTab) setActiveTab(s.activeTab);
      if (s.currentStep != null) setCurrentStep(s.currentStep);
      if (s.attemptedSteps) setAttemptedSteps(s.attemptedSteps);
      if (s.pieceQuantity) setPieceQuantity(s.pieceQuantity);
      if (s.colorMaterials) setColorMaterials(s.colorMaterials);
      if (s.printerSearch) setPrinterSearch(s.printerSearch);
      if (s.selectedPrinterId) setSelectedPrinterId(s.selectedPrinterId);
      if (s.printerConsumption) setPrinterConsumption(s.printerConsumption);
      if (s.printingHours) setPrintingHours(s.printingHours);
      if (s.kwhValue) setKwhValue(s.kwhValue);
      if (s.machineMode) setMachineMode(s.machineMode);
      if (s.machineHourValue) setMachineHourValue(s.machineHourValue);
      if (s.printerValue) setPrinterValue(s.printerValue);
      if (s.printerLifeHours) setPrinterLifeHours(s.printerLifeHours);
      if (s.finishFixedValue) setFinishFixedValue(s.finishFixedValue);
      if (s.finishHours) setFinishHours(s.finishHours);
      if (s.finishHourValue) setFinishHourValue(s.finishHourValue);
      if (s.packagingItems) setPackagingItems(s.packagingItems);
      if (s.taxPercent) setTaxPercent(s.taxPercent);
      if (s.selectedMarketplaceId) setSelectedMarketplaceId(s.selectedMarketplaceId);
      if (s.selectedModalidade) setSelectedModalidade(s.selectedModalidade);
      if (s.selectedPlano) setSelectedPlano(s.selectedPlano);
      if (s.selectedCategoria) setSelectedCategoria(s.selectedCategoria);
      if (s.selectedFrete) setSelectedFrete(s.selectedFrete);
      if (s.customFreteValue) setCustomFreteValue(s.customFreteValue);
      if (s.impostosMarketplace) setImpostosMarketplace(s.impostosMarketplace);
      if (s.margemDesejada) setMargemDesejada(s.margemDesejada);
      if (s.manualTaxes) setManualTaxes(s.manualTaxes);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(stateSnapshot)); } catch { /* ignore */ }
  }, [stateSnapshot]);

  // ─── Clear all ────────────────────────────────────────────────────────────

  const clearAll = () => {
    setCurrency("BRL");
    setActiveTab("calculator");
    setCurrentStep(0);
    setAttemptedSteps([]);
    setPieceQuantity("1");
    setColorMaterials(defaultColorMaterials());
    setPrinterSearch("");
    setSelectedPrinterId("");
    setPrinterConsumption("");
    setPrintingHours("");
    setKwhValue("0,000");
    setMachineMode("manual");
    setMachineHourValue("");
    setPrinterValue("0,000");
    setPrinterLifeHours("");
    setFinishFixedValue("");
    setFinishHours("");
    setFinishHourValue("");
    setPackagingItems(defaultPackaging());
    setTaxPercent("");
    setSelectedMarketplaceId("");
    setSelectedModalidade("");
    setSelectedPlano("");
    setSelectedCategoria("");
    setSelectedFrete("");
    setCustomFreteValue("");
    setImpostosMarketplace("");
    setMargemDesejada("30");
    setManualTaxes(defaultManualTaxes());
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  };

  // ─── Pro Calculator derived values ────────────────────────────────────────

  const values = useMemo(() => {
    const quantidadePecas = Math.max(1, toNumber(pieceQuantity) || 1);
    const colorCosts = colorMaterials.map((cm) => {
      const gramsUsed = toGrams(cm.quantity, cm.unit);
      const spoolGrams = toGrams(cm.spoolWeight, cm.spoolWeightUnit);
      const spoolPrice = toCurrencyNumber(cm.price);
      const costPerGram = spoolGrams > 0 ? spoolPrice / spoolGrams : 0;
      return { gramsUsed, spoolGrams, spoolPrice, costPerGram, costForAllPieces: gramsUsed * costPerGram * quantidadePecas };
    });
    const totalGramsPerPiece = colorCosts.reduce((sum, c) => sum + c.gramsUsed, 0);
    const totalGramsAllPieces = totalGramsPerPiece * quantidadePecas;
    const custoMaterial = colorCosts.reduce((sum, c) => sum + c.costForAllPieces, 0);
    const consumoKW = toNumber(printerConsumption) / 1000;
    const custoEnergia = consumoKW * toNumber(printingHours) * toCurrencyNumber(kwhValue) * quantidadePecas;
    const valorHoraMaquina = machineMode === "automatic"
      ? (toNumber(printerLifeHours) > 0 ? toCurrencyNumber(printerValue) / toNumber(printerLifeHours) : 0)
      : toCurrencyNumber(machineHourValue);
    const custoMaquina = toNumber(printingHours) * valorHoraMaquina * quantidadePecas;
    const custoAcabamento = (toCurrencyNumber(finishFixedValue) + toNumber(finishHours) * toCurrencyNumber(finishHourValue)) * quantidadePecas;
    const custoEmbalagem = packagingItems.reduce((total, item) => total + toCurrencyNumber(item.value), 0);
    const subtotal = custoMaterial + custoEnergia + custoMaquina + custoAcabamento + custoEmbalagem;
    const custoImpostos = subtotal * (toNumber(taxPercent) / 100);
    const custoTotal = subtotal + custoImpostos;
    return {
      colorCosts, custoMaterial, custoEnergia, valorHoraMaquina, quantidadePecas,
      totalGramsPerPiece, totalGramsAllPieces, custoMaquina, custoAcabamento,
      custoEmbalagem, subtotal, custoImpostos, custoTotal,
      precoEconomico: custoTotal * 1.3,
      precoProfissional: custoTotal * 1.5,
      precoPremium: custoTotal * 1.8,
    };
  }, [colorMaterials, finishFixedValue, finishHourValue, finishHours, kwhValue,
    machineHourValue, machineMode, packagingItems, printerConsumption,
    printerLifeHours, printerValue, printingHours, taxPercent, pieceQuantity]);

  // ─── Marketplace derived values ───────────────────────────────────────────

  const marketplace = useMemo(
    () => activeMarketplaces.find((m) => m.id === selectedMarketplaceId) ?? null,
    [selectedMarketplaceId],
  );
  const isCustom = selectedMarketplaceId === "outro_marketplace";

  useEffect(() => {
    if (!marketplace) return;
    setSelectedModalidade(marketplace.modalidades[0]?.nome ?? "");
    setSelectedPlano(marketplace.planos[0]?.nome ?? "");
    setSelectedCategoria(marketplace.categorias[0]?.nome ?? "");
    const hasSubs = marketplace.frete.subsidiado || marketplace.frete.integrado_mercado_envios || marketplace.frete.magalu_entregas || marketplace.frete.envia;
    setSelectedFrete(hasSubs ? "subsidiado" : marketplace.frete.fba_logistica_amazon ? "fba" : "proprio");
  }, [marketplace]);

  const marketplaceResult = useMemo(() => {
    if (!marketplace || values.custoTotal <= 0) return null;
    return calculateMarketplaceFees(
      marketplace, selectedModalidade, selectedPlano, selectedCategoria,
      selectedFrete, customFreteValue, impostosMarketplace, margemDesejada,
      values.custoTotal, manualTaxes,
    );
  }, [marketplace, selectedModalidade, selectedPlano, selectedCategoria,
    selectedFrete, customFreteValue, impostosMarketplace, margemDesejada,
    values.custoTotal, manualTaxes]);

  const freteOptions = useMemo(() => {
    if (!marketplace) return [];
    const opts: { value: string; label: string }[] = [];
    if (marketplace.frete.subsidiado) opts.push({ value: "subsidiado", label: "Frete subsidiado / envios da plataforma" });
    if (marketplace.frete.fba_logistica_amazon) opts.push({ value: "fba", label: "FBA — Logística Amazon" });
    if (marketplace.frete.integrado_mercado_envios) opts.push({ value: "subsidiado", label: "Mercado Envios" });
    if (marketplace.frete.magalu_entregas) opts.push({ value: "subsidiado", label: "Magalu Entregas" });
    if (marketplace.frete.envia) opts.push({ value: "subsidiado", label: "Envia (plataforma)" });
    opts.push({ value: "proprio", label: "Frete próprio (informar valor)" });
    const seen = new Set<string>();
    return opts.filter((o) => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
  }, [marketplace]);

  // ─── Step validation ──────────────────────────────────────────────────────

  const stepErrors = useMemo(() => {
    const hasValidColor = colorMaterials.some(
      (cm) => toNumber(cm.quantity) > 0 && toNumber(cm.spoolWeight) > 0 && toCurrencyNumber(cm.price) > 0,
    );
    return [
      !toNumber(pieceQuantity) || !hasValidColor,
      !toNumber(printerConsumption) || !toNumber(printingHours) || !toCurrencyNumber(kwhValue),
      false, false,
      packagingItems.some((item) => item.name.trim() && toCurrencyNumber(item.value) <= 0),
      taxPercent.trim() === "" || toNumber(taxPercent) < 0,
      false,
    ];
  }, [colorMaterials, kwhValue, packagingItems, printerConsumption, printingHours, taxPercent, pieceQuantity]);

  // ─── Navigation ───────────────────────────────────────────────────────────

  const progress = ((currentStep + 1) / steps.length) * 100;
  const current = steps[currentStep];
  const showError = attemptedSteps.includes(currentStep) && stepErrors[currentStep];

  const goNext = () => {
    if (stepErrors[currentStep]) {
      setAttemptedSteps((prev) => prev.includes(currentStep) ? prev : [...prev, currentStep]);
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
  };
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 0));
  const goToStep = (step: number) => setCurrentStep(step);

  // ─── Color helpers ────────────────────────────────────────────────────────

  const updateColorMaterial = (id: number, field: keyof Omit<ColorMaterial, "id">, value: string) =>
    setColorMaterials((prev) => prev.map((cm) => cm.id === id ? { ...cm, [field]: value } : cm));
  const addColorMaterial = () => setColorMaterials((prev) => [...prev, emptyColorMaterial(Date.now())]);
  const removeColorMaterial = (id: number) =>
    setColorMaterials((prev) => prev.length === 1 ? prev : prev.filter((cm) => cm.id !== id));

  // ─── Packaging helpers ────────────────────────────────────────────────────

  const updatePackagingItem = (id: number, field: keyof Omit<PackagingItem, "id">, value: string) =>
    setPackagingItems((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
  const addPackagingItem = () => setPackagingItems((prev) => [...prev, emptyPackagingItem(Date.now())]);
  const removePackagingItem = (id: number) =>
    setPackagingItems((prev) => prev.length === 1 ? prev : prev.filter((item) => item.id !== id));

  // ─── Printer helpers ──────────────────────────────────────────────────────

  const selectedPrinter = printerOptions.find((p) => p.id === selectedPrinterId);
  const filteredPrinters = useMemo(() => {
    const term = normalizeSearch(printerSearch.trim());
    if (!term) return printerOptions.slice(0, 8);
    return printerOptions.filter((p) => p.searchableText.includes(term)).slice(0, 8);
  }, [printerSearch]);
  const selectPrinter = (printer: PrinterOption) => {
    setSelectedPrinterId(printer.id);
    setPrinterSearch(`${printer.brand} ${printer.model}`);
    setPrinterConsumption(String(printer.averageConsumption));
  };

  const fmt = (v: number) => formatCurrencyValue(v, currency);
  const { symbol } = CURRENCY_CONFIG[currency];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-[#000000]">
      <Header />
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">

        {/* ── Page header ── */}
        <header className="relative overflow-hidden rounded-[8px] border border-black/10 bg-white px-5 py-6 shadow-xl shadow-[#5852FF]/10 sm:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(88,82,255,0.18),transparent_30%),radial-gradient(circle_at_90%_0%,rgba(186,74,0,0.12),transparent_26%)]" />
          <div className="relative">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#BA4A00]">
                  Professional Calculator
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-normal text-black sm:text-4xl lg:text-5xl">
                  Precificacao profissional para impressao 3D
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
                  <strong>Material</strong> + Energia + Tempo de Maquina + Acabamento + Embalagem +
                  Impostos + <em>Margem</em> = Preco Final
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-1 rounded-[8px] border border-black/10 bg-[#F9FAFB] p-1">
                  {(["BRL", "USD", "EUR"] as Currency[]).map((c) => (
                    <button key={c} type="button" onClick={() => setCurrency(c)}
                      className={`rounded-[6px] px-3 py-1.5 text-xs font-bold transition ${currency === c ? "bg-[#5852FF] text-white shadow-sm" : "text-black/55 hover:text-[#5852FF]"}`}>
                      {CURRENCY_CONFIG[c].symbol} {c}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={clearAll}
                  className="flex items-center gap-2 rounded-[8px] border border-[#BA4A00]/30 px-4 py-2.5 text-sm font-semibold text-[#BA4A00] transition hover:bg-[#BA4A00] hover:text-white">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Limpar tudo
                </button>
                <div className="rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-4 py-3 text-sm text-black/75">
                  <span className="block font-semibold text-[#5852FF]">{fmt(values.custoTotal)}</span>
                  custo total estimado
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── Tab switcher ── */}
        <div className="flex items-center gap-1 rounded-[8px] border border-black/10 bg-white p-1 shadow-sm w-fit">
          <button
            type="button"
            onClick={() => setActiveTab("calculator")}
            className={`flex items-center gap-2 rounded-[6px] px-5 py-2.5 text-sm font-semibold transition ${
              activeTab === "calculator"
                ? "bg-[#5852FF] text-white shadow-sm"
                : "text-black/55 hover:text-[#5852FF]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="16" y2="10" /><line x1="8" y1="14" x2="12" y2="14" />
            </svg>
            Calculadora
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("marketplace")}
            className={`flex items-center gap-2 rounded-[6px] px-5 py-2.5 text-sm font-semibold transition ${
              activeTab === "marketplace"
                ? "bg-[#5852FF] text-white shadow-sm"
                : "text-black/55 hover:text-[#5852FF]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            Marketplace
            {marketplaceResult && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black">
                {fmt(marketplaceResult.precoFinal)}
              </span>
            )}
          </button>
        </div>

        {/* ── CALCULATOR TAB ── */}
        {activeTab === "calculator" && (
          <>
            {/* Step progress */}
            <div className="rounded-[8px] border border-black/10 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-4 text-sm">
                <span className="font-semibold text-[#5852FF]">{current.eyebrow} de {steps.length}</span>
                <span className="text-black/60">{Math.round(progress)}% concluido</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full bg-[#5852FF] transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
              </div>
              <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {steps.map((step, index) => (
                  <button key={step.title} type="button" onClick={() => goToStep(index)}
                    className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold transition hover:-translate-y-0.5 ${
                      index === currentStep
                        ? "border-[#5852FF] bg-[#5852FF] text-white shadow-lg shadow-[#5852FF]/25"
                        : "border-black/10 bg-[#F9FAFB] text-black/70 hover:border-[#5852FF]/50 hover:bg-white hover:text-[#5852FF]"
                    }`}>
                    <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-[6px] bg-white/20 text-sm">{step.icon}</span>
                    {step.title}
                    {index === 2 && <span className="mt-1 block text-[10px] font-normal opacity-60">opcional</span>}
                  </button>
                ))}
              </nav>
            </div>

            {/* Main content */}
            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5 transition-all duration-300 sm:p-7">
                <div className="mb-6 flex flex-col gap-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">{current.eyebrow}</p>
                  <h2 className="flex items-center gap-3 text-2xl font-semibold text-black sm:text-3xl">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-xl text-[#5852FF]">{current.icon}</span>
                    <span>{current.title}</span>
                    {currentStep === 2 && (
                      <span className="rounded-full border border-black/10 bg-[#F9FAFB] px-3 py-1 text-xs font-semibold text-black/50">opcional</span>
                    )}
                  </h2>
                  <p className="max-w-2xl text-sm leading-6 text-black/65">{current.description}</p>
                </div>

                {/* ── Step 0: Material ── */}
                {currentStep === 0 && (
                  <div className="flex flex-col gap-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField label="Quantidade de peças" hint="Número total de peças que serão produzidas ou vendidas." suffix="peças" value={pieceQuantity} onChange={setPieceQuantity} placeholder="1" required />
                    </div>
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-sm font-semibold text-black">Cores / materiais utilizados <span className="text-[#BA4A00]">*</span></p>
                        <button type="button" onClick={addColorMaterial} className="flex items-center gap-1.5 rounded-[6px] border border-[#5852FF]/30 px-3 py-1.5 text-xs font-semibold text-[#5852FF] transition hover:bg-[#5852FF] hover:text-white">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                          Adicionar cor
                        </button>
                      </div>
                      <div className="flex flex-col gap-4">
                        {colorMaterials.map((cm, idx) => (
                          <div key={cm.id} className="rounded-[8px] border border-black/10 bg-[#F9FAFB] p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-[#5852FF]">Material {idx + 1}</span>
                              <button type="button" onClick={() => removeColorMaterial(cm.id)} disabled={colorMaterials.length === 1}
                                className="rounded-[6px] border border-[#BA4A00]/30 px-3 py-1 text-xs font-semibold text-[#BA4A00] transition hover:bg-[#BA4A00] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                                Remover
                              </button>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="sm:col-span-2">
                                <TextField label="Nome / cor" hint="Identifique este material (ex: Vermelho PLA, Transparente PETG)." value={cm.name} onChange={(v) => updateColorMaterial(cm.id, "name", v)} placeholder="Vermelho PLA" />
                              </div>
                              <NumberField label="Qtd. usada por peça" hint="Quantidade deste material em cada peça individual." suffix="g" suffixOptions={["g", "kg"]} suffixValue={cm.unit} onSuffixChange={(v) => updateColorMaterial(cm.id, "unit", v as WeightUnit)} value={cm.quantity} onChange={(v) => updateColorMaterial(cm.id, "quantity", v)} placeholder="100" required />
                              <NumberField label="Peso do rolo / lote" hint="Peso total do rolo ou lote adquirido (ex: 1000 g, 1 kg)." suffix="g" suffixOptions={["g", "kg"]} suffixValue={cm.spoolWeightUnit} onSuffixChange={(v) => updateColorMaterial(cm.id, "spoolWeightUnit", v as WeightUnit)} value={cm.spoolWeight} onChange={(v) => updateColorMaterial(cm.id, "spoolWeight", v)} placeholder="1000" required />
                              <NumberField label="Preço pago pelo rolo / lote" hint="Valor total pago por este rolo ou lote específico." prefix={symbol} value={cm.price} onChange={(v) => updateColorMaterial(cm.id, "price", formatCurrencyInput(v, 3))} placeholder="0,00" required isCurrencyField />
                              {values.colorCosts[idx]?.costPerGram > 0 && (
                                <MetricCard label="Custo desta cor" value={fmt(values.colorCosts[idx].costForAllPieces)} helper={`${values.colorCosts[idx].gramsUsed.toFixed(1)} g × ${fmt(values.colorCosts[idx].costPerGram)}/g × ${values.quantidadePecas} peça(s)`} />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {values.totalGramsPerPiece > 0 && (
                        <div className="mt-3 rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-4 py-3 text-sm leading-6 text-black/70">
                          <strong className="text-[#5852FF]">{values.totalGramsPerPiece.toFixed(1)} g por peça</strong>{" "}×{" "}
                          <strong className="text-[#5852FF]">{values.quantidadePecas} {values.quantidadePecas === 1 ? "peça" : "peças"}</strong>{" "}={" "}
                          <strong className="text-[#5852FF]">{values.totalGramsAllPieces.toFixed(1)} g no total</strong>{" "}
                          de material consumido em todas as peças.{" "}Custo total de material:{" "}
                          <strong className="text-[#5852FF]">{fmt(values.custoMaterial)}</strong>.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Step 1: Energy ── */}
                {currentStep === 1 && (
                  <div className="flex flex-col gap-5">
                    <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] p-4">
                      <TextField label="Buscar impressora" hint="Digite a marca ou o modelo para encontrar o consumo médio cadastrado." value={printerSearch} onChange={(v) => { setPrinterSearch(v); setSelectedPrinterId(""); }} placeholder="Bambu Lab A1, Ender 3, Prusa..." />
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {filteredPrinters.map((printer) => (
                          <button key={printer.id} type="button" onClick={() => selectPrinter(printer)}
                            className={`rounded-[8px] border p-3 text-left transition hover:-translate-y-0.5 hover:border-[#5852FF] hover:bg-white ${selectedPrinterId === printer.id ? "border-[#5852FF] bg-white shadow-sm shadow-[#5852FF]/20" : "border-black/10 bg-white/70"}`}>
                            <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#BA4A00]">{printer.brand}</span>
                            <strong className="mt-1 block text-sm text-black">{printer.model}</strong>
                            <span className="mt-2 block text-xs text-black/60">Médio: <strong>{printer.averageConsumption} W</strong> · Pico: {printer.peakConsumption} W</span>
                          </button>
                        ))}
                      </div>
                      {filteredPrinters.length === 0 && (
                        <p className="mt-4 rounded-[8px] border border-[#BA4A00]/20 bg-[#BA4A00]/10 px-3 py-2 text-sm text-[#8f3900]">Nenhum modelo encontrado. Use o campo manual de Watts abaixo para continuar o cálculo.</p>
                      )}
                      {selectedPrinter && (
                        <p className="mt-4 text-sm leading-6 text-black/65">Usando o consumo médio da <strong>{selectedPrinter.brand} {selectedPrinter.model}</strong>: <strong>{selectedPrinter.averageConsumption} W</strong>.</p>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField label="Consumo médio usado no cálculo" hint="Potência média durante a impressão, em Watts. Você pode ajustar manualmente." suffix="W" value={printerConsumption} onChange={(v) => { setPrinterConsumption(v); setSelectedPrinterId(""); }} placeholder="120" required />
                      <NumberField label="Tempo de impressao" hint="Tempo total de impressao em horas." suffix="h" value={printingHours} onChange={setPrintingHours} placeholder="8" required />
                      <NumberField label="Valor do kWh" hint="Valor cobrado por kWh na sua conta de energia." prefix={symbol} value={kwhValue} onChange={(v) => setKwhValue(formatCurrencyInput(v, 3))} placeholder="0,95" required isCurrencyField />
                      <MetricCard label="Custo de energia" value={fmt(values.custoEnergia)} helper="Consumo em kW multiplicado pelas horas e pelo valor do kWh." />
                    </div>
                  </div>
                )}

                {/* ── Step 2: Machine (optional) ── */}
                {currentStep === 2 && (
                  <div className="flex flex-col gap-5">
                    <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] px-4 py-3 text-sm text-black/60">
                      Esta etapa é <strong>opcional</strong>. Se não quiser incluir custo de máquina, clique em <em>Próxima etapa</em> sem preencher nada.
                    </div>
                    <div className="grid rounded-[8px] border border-black/10 bg-[#F9FAFB] p-1 sm:w-fit sm:grid-cols-2">
                      {(["manual", "automatic"] as MachineMode[]).map((mode) => (
                        <button key={mode} type="button" onClick={() => setMachineMode(mode)}
                          className={`rounded-[6px] px-4 py-2 text-sm font-semibold transition ${machineMode === mode ? "bg-[#5852FF] text-white shadow-sm" : "text-black/65 hover:text-[#5852FF]"}`}>
                          {mode === "manual" ? "Manual" : "Automatico"}
                        </button>
                      ))}
                    </div>
                    {machineMode === "manual" ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <NumberField label="Valor por hora da maquina" hint="Quanto a impressora deve cobrar por hora de uso." prefix={symbol} value={machineHourValue} onChange={(v) => setMachineHourValue(formatCurrencyInput(v, 3))} placeholder="5,00" isCurrencyField />
                        <MetricCard label="Custo de maquina" value={fmt(values.custoMaquina)} helper="Tempo de impressao multiplicado pelo valor por hora." />
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <NumberField label="Valor da impressora" hint="Preco pago pela impressora ou valor de reposicao." prefix={symbol} value={printerValue} onChange={(v) => setPrinterValue(formatCurrencyInput(v, 3))} placeholder="2500,00" isCurrencyField />
                        <NumberField label="Vida util estimada" hint="Vida util esperada da maquina, em horas." suffix="h" value={printerLifeHours} onChange={setPrinterLifeHours} placeholder="5000" />
                        <MetricCard label="Valor calculado por hora" value={fmt(values.valorHoraMaquina)} helper="Valor da impressora dividido pela vida util estimada." />
                        <MetricCard label="Custo de maquina" value={fmt(values.custoMaquina)} helper="Valor por hora calculado multiplicado pelo tempo de impressao." />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 3: Finish ── */}
                {currentStep === 3 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField label="Valor fixo de acabamento" hint="Materiais e custos fixos de acabamento." prefix={symbol} value={finishFixedValue} onChange={(v) => setFinishFixedValue(formatCurrencyInput(v, 3))} placeholder="8,00" isCurrencyField />
                    <NumberField label="Horas de acabamento" hint="Tempo gasto em pos-processamento." suffix="h" value={finishHours} onChange={setFinishHours} placeholder="1.5" />
                    <NumberField label="Valor por hora" hint="Valor da sua mao de obra por hora." prefix={symbol} value={finishHourValue} onChange={(v) => setFinishHourValue(formatCurrencyInput(v, 3))} placeholder="35,00" isCurrencyField />
                    <MetricCard label="Custo de acabamento" value={fmt(values.custoAcabamento)} helper="Valor fixo mais horas de acabamento vezes valor por hora." />
                  </div>
                )}

                {/* ── Step 4: Packaging ── */}
                {currentStep === 4 && (
                  <div className="flex flex-col gap-4">
                    {packagingItems.map((item) => (
                      <div key={item.id} className="grid gap-3 rounded-[8px] border border-black/10 bg-[#F9FAFB] p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                        <TextField label="Nome" hint="Item de embalagem, como caixa, etiqueta, plastico bolha ou manual." value={item.name} onChange={(v) => updatePackagingItem(item.id, "name", v)} placeholder="Caixa" />
                        <NumberField label="Valor" hint="Custo deste item." prefix={symbol} value={item.value} onChange={(v) => updatePackagingItem(item.id, "value", formatCurrencyInput(v, 3))} placeholder="3,50" isCurrencyField />
                        <button type="button" onClick={() => removePackagingItem(item.id)} disabled={packagingItems.length === 1}
                          className="h-11 rounded-[8px] border border-[#BA4A00]/30 px-4 text-sm font-semibold text-[#BA4A00] transition hover:bg-[#BA4A00] hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                          Remover
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button type="button" onClick={addPackagingItem} className="rounded-[8px] bg-[#5852FF] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4741e8]">Adicionar item</button>
                      <MetricCard label="Custo de embalagem" value={fmt(values.custoEmbalagem)} helper="Soma de todos os itens informados." compact />
                    </div>
                  </div>
                )}

                {/* ── Step 5: Taxes ── */}
                {currentStep === 5 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField label="Percentual de impostos" hint="Percentual aplicado sobre o subtotal sem margem." suffix="%" value={taxPercent} onChange={setTaxPercent} placeholder="6" required />
                    <MetricCard label="Subtotal" value={fmt(values.subtotal)} helper="Soma de material, energia, maquina, acabamento e embalagem." />
                    <MetricCard label="Impostos" value={fmt(values.custoImpostos)} helper="Subtotal multiplicado pelo percentual de impostos." />
                  </div>
                )}

                {/* ── Step 6: Result ── */}
                {currentStep === 6 && <ResultView values={values} currency={currency} onGoToMarketplace={() => setActiveTab("marketplace")} />}

                {showError && (
                  <div className="mt-6 rounded-[8px] border border-[#BA4A00]/30 bg-[#BA4A00]/10 px-4 py-3 text-sm font-medium text-[#8f3900]">
                    Preencha os campos obrigatorios desta etapa antes de continuar.
                  </div>
                )}

                <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={goBack} disabled={currentStep === 0}
                    className="rounded-[8px] border border-black/15 px-5 py-3 text-sm font-semibold text-black transition hover:border-[#5852FF] hover:text-[#5852FF] disabled:cursor-not-allowed disabled:opacity-40">
                    Voltar
                  </button>
                  {currentStep < steps.length - 1 ? (
                    <button type="button" onClick={goNext} className="rounded-[8px] bg-[#5852FF] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4741e8]">Proxima etapa</button>
                  ) : (
                    <button type="button" onClick={() => setCurrentStep(0)} className="rounded-[8px] bg-[#BA4A00] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#953b00]">Revisar cálculo</button>
                  )}
                </div>
              </div>

              {/* Live summary sidebar */}
              <aside className="h-fit rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5 lg:sticky lg:top-6">
                <h3 className="text-base font-semibold text-black">Resumo ao vivo</h3>
                <p className="mt-1 text-sm text-black/60">Os valores são recalculados <strong>em tempo real</strong> a cada alteracao.</p>
                <div className="mt-5 space-y-3">
                  <SummaryRow label="Material" value={fmt(values.custoMaterial)} />
                  <SummaryRow label="Energia" value={fmt(values.custoEnergia)} />
                  <SummaryRow label="Tempo de Maquina" value={fmt(values.custoMaquina)} />
                  <SummaryRow label="Acabamento" value={fmt(values.custoAcabamento)} />
                  <SummaryRow label="Embalagem" value={fmt(values.custoEmbalagem)} />
                  <SummaryRow label="Impostos" value={fmt(values.custoImpostos)} />
                </div>
                <div className="mt-5 rounded-[8px] bg-black px-4 py-4 text-white">
                  <span className="text-sm text-white/65">Custo total</span>
                  <strong className="mt-1 block text-2xl">{fmt(values.custoTotal)}</strong>
                </div>
                {values.custoTotal > 0 && (
                  <button type="button" onClick={() => setActiveTab("marketplace")}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-[8px] border border-[#5852FF]/30 px-4 py-2.5 text-sm font-semibold text-[#5852FF] transition hover:bg-[#5852FF] hover:text-white">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
                    </svg>
                    Calcular no Marketplace
                  </button>
                )}
              </aside>
            </section>
          </>
        )}

        {/* ── MARKETPLACE TAB ── */}
        {activeTab === "marketplace" && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex flex-col gap-5">

              {/* Custo de produção (read-only, from Pro Calculator) */}
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-7">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">Custo de Produção</p>
                  <h2 className="flex items-center gap-3 text-2xl font-semibold text-black">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-xl text-[#5852FF]">◐</span>
                    Base de custo
                  </h2>
                </div>
                {values.custoTotal > 0 ? (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex-1 rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-4 py-3">
                      <p className="text-xs font-semibold text-black/50">Custo total calculado</p>
                      <strong className="mt-1 block text-3xl font-black text-[#5852FF]">{fmt(values.custoTotal)}</strong>
                      <p className="mt-1 text-xs text-black/40">Calculado automaticamente pela Professional Calculator</p>
                    </div>
                    <div className="flex flex-col gap-2 text-xs text-black/50">
                      <span>Material: <strong className="text-black">{fmt(values.custoMaterial)}</strong></span>
                      <span>Energia: <strong className="text-black">{fmt(values.custoEnergia)}</strong></span>
                      <span>Maquina: <strong className="text-black">{fmt(values.custoMaquina)}</strong></span>
                      <span>Acabamento: <strong className="text-black">{fmt(values.custoAcabamento)}</strong></span>
                      <span>Embalagem: <strong className="text-black">{fmt(values.custoEmbalagem)}</strong></span>
                      <span>Impostos: <strong className="text-black">{fmt(values.custoImpostos)}</strong></span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-[8px] border border-[#BA4A00]/20 bg-[#BA4A00]/5 px-4 py-4">
                    <p className="text-sm font-semibold text-[#BA4A00]">Custo de produção não calculado</p>
                    <p className="mt-1 text-sm text-black/60">
                      Complete a aba <strong>Calculadora</strong> para obter o custo de produção antes de calcular o preço para marketplace.
                    </p>
                    <button type="button" onClick={() => setActiveTab("calculator")}
                      className="mt-3 rounded-[8px] bg-[#5852FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4741e8]">
                      Ir para a Calculadora
                    </button>
                  </div>
                )}

                {/* Margem */}
                {values.custoTotal > 0 && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <NumberField label="Margem desejada" hint="Percentual de lucro sobre o preço de venda que você quer garantir após todas as taxas do marketplace." suffix="%" value={margemDesejada} onChange={setMargemDesejada} placeholder="30" required />
                  </div>
                )}
              </div>

              {/* Marketplace selector */}
              {values.custoTotal > 0 && (
                <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-7">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">Marketplace</p>
                    <h2 className="flex items-center gap-3 text-2xl font-semibold text-black">
                      <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-xl text-[#5852FF]">🏪</span>
                      Selecione a plataforma
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-black/65">
                      Os campos abaixo se adaptam automaticamente às regras e taxas da plataforma selecionada.
                    </p>
                  </div>

                  <div className="mt-5">
                    <SelectField label="Plataforma de venda" hint="Selecione o marketplace onde pretende vender este produto." value={selectedMarketplaceId} onChange={setSelectedMarketplaceId} required>
                      <option value="">Selecione um marketplace...</option>
                      {activeMarketplaces.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}{m.pais !== "BR" && m.pais !== "GLOBAL" ? ` (${m.pais})` : ""}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  {marketplace && !isCustom && (
                    <div className="mt-4 rounded-[8px] border border-black/10 bg-[#F9FAFB] px-4 py-3">
                      <p className="text-xs font-semibold text-black/50">{marketplace.descricao}</p>
                      {marketplace.observacoes && <p className="mt-1 text-xs leading-5 text-[#BA4A00]">⚠ {marketplace.observacoes}</p>}
                    </div>
                  )}

                  {marketplace && !isCustom && (
                    <div className="mt-5 flex flex-col gap-4">
                      {marketplace.modalidades.length > 0 && (
                        <div>
                          <FieldLabel label="Tipo de anúncio" hint="Cada modalidade tem estrutura de taxas diferente." required />
                          <RadioGroup options={marketplace.modalidades.map((m) => ({ value: m.nome, label: m.nome }))} value={selectedModalidade} onChange={setSelectedModalidade} />
                        </div>
                      )}
                      {marketplace.planos.length > 0 && (
                        <div>
                          <FieldLabel label="Plano / tipo de conta" hint="O plano determina as taxas aplicadas." required />
                          {marketplace.planos.length === 2 ? (
                            <RadioGroup options={marketplace.planos.map((p) => ({ value: p.nome, label: p.nome }))} value={selectedPlano} onChange={setSelectedPlano} />
                          ) : (
                            <SelectField label="" value={selectedPlano} onChange={setSelectedPlano}>
                              {marketplace.planos.map((p) => <option key={p.nome} value={p.nome}>{p.nome}</option>)}
                            </SelectField>
                          )}
                        </div>
                      )}
                      {marketplace.categorias.length > 1 && (
                        <SelectField label="Categoria do produto" hint="A comissão pode variar de acordo com a categoria. Escolha a mais próxima." value={selectedCategoria} onChange={setSelectedCategoria}>
                          {marketplace.categorias.map((c) => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
                        </SelectField>
                      )}
                      {Object.keys(marketplace.frete).length > 0 && freteOptions.length > 1 && (
                        <div>
                          <FieldLabel label="Frete" hint="Selecione como o frete será operado." required />
                          <RadioGroup options={freteOptions} value={selectedFrete} onChange={setSelectedFrete} />
                          {(selectedFrete === "proprio" || selectedFrete === "manual") && (
                            <div className="mt-3">
                              <NumberField label="Valor do frete" hint="Informe o custo de frete que você vai pagar ou repassar." prefix={symbol} value={customFreteValue} onChange={(v) => setCustomFreteValue(formatCurrencyInput(v, 3))} placeholder="0,00" isCurrencyField />
                            </div>
                          )}
                          {selectedFrete === "subsidiado" && marketplace.frete.valor_minimo_frete_gratis && (
                            <p className="mt-2 text-xs text-black/50">Frete grátis para pedidos acima de {fmt(marketplace.frete.valor_minimo_frete_gratis)}. Custeio do vendedor estimado em {marketplace.frete.custeio_vendedor_percentual_min}–{marketplace.frete.custeio_vendedor_percentual_max}% do valor.</p>
                          )}
                          {selectedFrete === "fba" && marketplace.frete.fba_taxa_min && (
                            <p className="mt-2 text-xs text-black/50">Taxa FBA estimada entre {fmt(marketplace.frete.fba_taxa_min)} e {fmt(marketplace.frete.fba_taxa_max ?? 0)} por unidade, dependendo de peso e dimensões.</p>
                          )}
                        </div>
                      )}
                      <NumberField label="Impostos sobre venda (%)" hint="Percentual de impostos aplicado sobre o custo de produção (MEI, Simples Nacional etc.)." suffix="%" value={impostosMarketplace} onChange={setImpostosMarketplace} placeholder="0" />
                    </div>
                  )}

                  {isCustom && (
                    <div className="mt-5 flex flex-col gap-4">
                      <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] px-4 py-3 text-sm text-black/60">
                        Preencha manualmente as taxas da plataforma que voce utiliza.
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <NumberField label="Comissão (%)" hint="Percentual de comissão cobrado sobre o valor de venda." suffix="%" value={manualTaxes.comissao} onChange={(v) => setManualTaxes((p) => ({ ...p, comissao: v }))} placeholder="15" />
                        <NumberField label="Taxa fixa por pedido" hint="Valor fixo cobrado por pedido ou item vendido." prefix={symbol} value={manualTaxes.taxaFixa} onChange={(v) => setManualTaxes((p) => ({ ...p, taxaFixa: formatCurrencyInput(v, 3) }))} placeholder="0,00" isCurrencyField />
                        <NumberField label="Taxa de processamento (%)" hint="Percentual de taxa de gateway de pagamento." suffix="%" value={manualTaxes.taxaProcessamento} onChange={(v) => setManualTaxes((p) => ({ ...p, taxaProcessamento: v }))} placeholder="3" />
                        <NumberField label="Taxa de anúncio (%)" hint="Percentual adicional por anuncio ou destaque." suffix="%" value={manualTaxes.taxaAnuncio} onChange={(v) => setManualTaxes((p) => ({ ...p, taxaAnuncio: v }))} placeholder="0" />
                        <NumberField label="Mensalidade" hint="Valor de assinatura ou plano mensal da plataforma." prefix={symbol} value={manualTaxes.mensalidade} onChange={(v) => setManualTaxes((p) => ({ ...p, mensalidade: formatCurrencyInput(v, 3) }))} placeholder="0,00" isCurrencyField />
                        <NumberField label="Outras taxas" hint="Qualquer outra taxa não listada acima." prefix={symbol} value={manualTaxes.outrasTaxas} onChange={(v) => setManualTaxes((p) => ({ ...p, outrasTaxas: formatCurrencyInput(v, 3) }))} placeholder="0,00" isCurrencyField />
                        <NumberField label="Frete" hint="Custo de frete por unidade enviada." prefix={symbol} value={manualTaxes.frete} onChange={(v) => setManualTaxes((p) => ({ ...p, frete: formatCurrencyInput(v, 3) }))} placeholder="0,00" isCurrencyField />
                        <NumberField label="Impostos (%)" hint="Percentual de impostos sobre o custo de produção." suffix="%" value={manualTaxes.impostos} onChange={(v) => setManualTaxes((p) => ({ ...p, impostos: v }))} placeholder="0" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Marketplace result sidebar */}
            <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
              {marketplaceResult ? (
                <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5">
                  <h2 className="text-base font-semibold text-black">Resultado Marketplace</h2>
                  <p className="mt-1 text-xs text-black/50">Cálculo em tempo real com as taxas da plataforma selecionada.</p>
                  {marketplaceResult.comissaoLabel && (
                    <div className="mt-4 rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-3 py-2">
                      <p className="text-xs font-semibold text-[#5852FF]">{marketplaceResult.comissaoLabel}</p>
                    </div>
                  )}
                  <div className="mt-4 space-y-3">
                    <SummaryRow label="Custo de produção" value={fmt(values.custoTotal)} />
                    <SummaryRow label="Comissão marketplace" value={fmt(marketplaceResult.comissao)} />
                    {marketplaceResult.taxaFixa > 0 && <SummaryRow label="Taxa fixa" value={fmt(marketplaceResult.taxaFixa)} />}
                    {marketplaceResult.taxaProcessamento > 0 && <SummaryRow label="Taxa de processamento" value={fmt(marketplaceResult.taxaProcessamento)} />}
                    {marketplaceResult.mensalidade > 0 && <SummaryRow label="Mensalidade" value={fmt(marketplaceResult.mensalidade)} />}
                    {marketplaceResult.frete > 0 && <SummaryRow label="Frete" value={fmt(marketplaceResult.frete)} />}
                    {marketplaceResult.impostos > 0 && <SummaryRow label="Impostos" value={fmt(marketplaceResult.impostos)} />}
                    {marketplaceResult.outrasTaxas > 0 && <SummaryRow label="Outras taxas" value={fmt(marketplaceResult.outrasTaxas)} />}
                  </div>
                  <div className="mt-4 rounded-[8px] bg-[#BA4A00]/10 px-4 py-3">
                    <p className="text-xs font-semibold text-[#BA4A00]">Total de taxas</p>
                    <strong className="mt-1 block text-xl font-black text-[#BA4A00]">{fmt(marketplaceResult.totalTaxas)}</strong>
                  </div>
                  <div className="mt-3 rounded-[8px] bg-black px-4 py-4 text-white">
                    <p className="text-xs font-semibold text-white/60">Preço mínimo recomendado</p>
                    <strong className="mt-1 block text-3xl font-black">{fmt(marketplaceResult.precoFinal)}</strong>
                    <p className="mt-2 text-xs text-white/50">Lucro estimado: <strong className="text-white">{fmt(marketplaceResult.lucro)}</strong></p>
                  </div>
                  {/* Breakdown bars */}
                  <div className="mt-4 space-y-2">
                    {[
                      { label: "Produção", value: values.custoTotal, color: "bg-[#5852FF]" },
                      { label: "Taxas", value: marketplaceResult.totalTaxas, color: "bg-[#BA4A00]" },
                      { label: "Lucro", value: marketplaceResult.lucro, color: "bg-black" },
                    ].map(({ label, value, color }) => {
                      const total = values.custoTotal + marketplaceResult.totalTaxas + marketplaceResult.lucro;
                      const widthPct = total > 0 ? Math.max(2, (value / total) * 100) : 0;
                      return (
                        <div key={label} className="flex items-center gap-2 text-xs">
                          <div className="h-2 rounded-full bg-black/8" style={{ flex: 1 }}>
                            <div className={`h-2 rounded-full ${color}`} style={{ width: `${widthPct}%` }} />
                          </div>
                          <span className="w-16 shrink-0 text-right font-semibold text-black/60">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-black">Resultado</h2>
                  <p className="mt-3 text-sm text-black/45">
                    {values.custoTotal <= 0
                      ? "Complete a aba Calculadora primeiro para obter o custo de produção."
                      : "Selecione um marketplace para ver o preço mínimo recomendado."}
                  </p>
                  <div className="mt-5 space-y-3">
                    {["Custo de produção", "Comissão", "Taxas", "Lucro"].map((label) => (
                      <div key={label} className="flex items-center justify-between gap-4 border-b border-black/8 pb-3 text-sm last:border-0">
                        <span className="text-black/35">{label}</span>
                        <span className="h-4 w-16 rounded bg-black/8" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {marketplace && !isCustom && (
                <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-black/40">Sobre o marketplace</p>
                  <div className="mt-3 space-y-2 text-xs text-black/60">
                    <div className="flex justify-between"><span>País</span><strong className="text-black">{marketplace.pais}</strong></div>
                    <div className="flex justify-between"><span>Moeda base</span><strong className="text-black">{marketplace.moeda}</strong></div>
                    <div className="flex justify-between"><span>Tipo de produto</span><strong className="text-black">{marketplace.tipo_produto.join(", ")}</strong></div>
                    {marketplace.ultima_atualizacao && (
                      <div className="flex justify-between"><span>Atualizado em</span><strong className="text-black">{marketplace.ultima_atualizacao}</strong></div>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </section>
        )}
      </section>
      <Footer />
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ label, hint, required }: { label: string; hint?: string; required?: boolean }) {
  return (
    <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
      {label}
      {required && <span className="text-[#BA4A00]">*</span>}
      {hint && <Tooltip text={hint} />}
    </span>
  );
}

function RadioGroup({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((opt) => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={`flex items-center gap-2 rounded-[8px] border px-4 py-2.5 text-sm font-semibold transition ${value === opt.value ? "border-[#5852FF] bg-[#5852FF]/8 text-[#5852FF]" : "border-black/10 bg-[#F9FAFB] text-black/65 hover:border-[#5852FF]/40 hover:text-[#5852FF]"}`}>
          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${value === opt.value ? "border-[#5852FF]" : "border-black/25"}`}>
            {value === opt.value && <span className="h-2 w-2 rounded-full bg-[#5852FF]" />}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SelectField({ label, hint, value, onChange, required, children }: { label: string; hint?: string; value: string; onChange: (v: string) => void; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && <FieldLabel label={label} hint={hint} required={required} />}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-[8px] border border-black/15 bg-white px-3 text-base text-black outline-none transition focus:border-[#5852FF] focus:ring-4 focus:ring-[#5852FF]/10">
        {children}
      </select>
    </label>
  );
}

function NumberField({ label, hint, value, onChange, placeholder, prefix, suffix, suffixOptions, suffixValue, onSuffixChange, required, isCurrencyField = false }: {
  label: string; hint?: string; value: string; onChange: (value: string) => void;
  placeholder?: string; prefix?: string; suffix?: string; suffixOptions?: string[];
  suffixValue?: string; onSuffixChange?: (value: string) => void; required?: boolean; isCurrencyField?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
        {label}
        {required && <span className="text-[#BA4A00]">*</span>}
        {hint && <Tooltip text={hint} />}
      </span>
      <span className="flex h-12 items-center rounded-[8px] border border-black/15 bg-white px-3 transition focus-within:border-[#5852FF] focus-within:ring-4 focus-within:ring-[#5852FF]/10">
        {prefix && <span className="mr-2 text-sm font-semibold text-black/45">{prefix}</span>}
        <input type="text" inputMode="decimal" value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (isCurrencyField) { onChange(raw.replace(/[^\d.,]/g, "")); }
            else { const s = raw.replace(/[^\d.]/g, ""); const p = s.split("."); onChange(p.length > 2 ? p[0] + "." + p.slice(1).join("") : s); }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base text-black outline-none placeholder:text-black/35" />
        {suffixOptions && suffixOptions.length > 0 ? (
          <select value={suffixValue} onChange={(e) => onSuffixChange?.(e.target.value)} className="ml-2 rounded-[6px] border border-black/15 bg-transparent px-2 text-sm font-semibold text-black outline-none">
            {suffixOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : (suffix && <span className="ml-2 text-sm font-semibold text-black/45">{suffix}</span>)}
      </span>
    </label>
  );
}

function TextField({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
        {label}
        {hint && <Tooltip text={hint} />}
      </span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-12 w-full rounded-[8px] border border-black/15 bg-white px-3 text-base text-black outline-none transition focus:border-[#5852FF] focus:ring-4 focus:ring-[#5852FF]/10 placeholder:text-black/35" />
    </label>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} className="flex h-5 w-5 items-center justify-center rounded-full border border-black/15 bg-[#F9FAFB] text-xs font-bold text-black/55 outline-none transition hover:border-[#5852FF] hover:text-[#5852FF] focus:border-[#5852FF] focus:text-[#5852FF]">?</span>
      <span className="pointer-events-none absolute left-1/2 top-7 z-10 w-56 -translate-x-1/2 rounded-[8px] border border-black/10 bg-black px-3 py-2 text-xs font-medium leading-5 text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">{text}</span>
    </span>
  );
}

function MetricCard({ label, value, helper, compact }: { label: string; value: string; helper: string; compact?: boolean }) {
  return (
    <div className={`rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 ${compact ? "px-4 py-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-black">{label}</span>
        <Tooltip text={helper} />
      </div>
      <strong className="mt-2 block text-2xl font-semibold text-[#5852FF]">{value}</strong>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/10 pb-3 text-sm last:border-b-0 last:pb-0">
      <span className="text-black/65">{label}</span>
      <strong className="text-black">{value}</strong>
    </div>
  );
}

function ResultView({ values, currency, onGoToMarketplace }: {
  values: { custoMaterial: number; custoEnergia: number; custoMaquina: number; custoAcabamento: number; custoEmbalagem: number; custoImpostos: number; custoTotal: number; precoEconomico: number; precoProfissional: number; precoPremium: number; };
  currency: Currency;
  onGoToMarketplace: () => void;
}) {
  const fmt = (v: number) => formatCurrencyValue(v, currency);
  const resultRows = [
    ["Material", values.custoMaterial], ["Energia", values.custoEnergia],
    ["Tempo de Maquina", values.custoMaquina], ["Acabamento", values.custoAcabamento],
    ["Embalagem", values.custoEmbalagem], ["Impostos", values.custoImpostos],
  ] as const;
  const priceCards = [
    { title: "Econômico", margin: "30%", value: values.precoEconomico, badge: "entrada competitiva", className: "border-[#5852FF]/25 bg-[#5852FF]/5" },
    { title: "Profissional", margin: "50%", value: values.precoProfissional, badge: "recomendado", className: "scale-[1.02] border-[#5852FF] bg-gradient-to-br from-[#5852FF] to-black text-white shadow-2xl shadow-[#5852FF]/30" },
    { title: "Premium", margin: "80%", value: values.precoPremium, badge: "maior margem", className: "border-[#BA4A00]/35 bg-[#BA4A00]/10 shadow-lg shadow-[#BA4A00]/10" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-black/60">Custo total</p>
            <strong className="mt-1 block text-3xl font-semibold text-black">{fmt(values.custoTotal)}</strong>
          </div>
          <span className="rounded-full bg-[#BA4A00]/10 px-3 py-1 text-sm font-semibold text-[#BA4A00]">antes da margem</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {resultRows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 border-b border-black/10 pb-3 text-sm last:border-b-0 last:pb-0">
              <span className="text-black/65">{label}</span>
              <strong className="text-black">{fmt(value)}</strong>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-black">Sugestões de preco</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {priceCards.map((card) => (
            <div key={card.title} className={`rounded-[8px] border p-5 transition hover:-translate-y-1 ${card.className}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold opacity-75">{card.title}</p>
                <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-black">{card.badge}</span>
              </div>
              <strong className="mt-3 block text-3xl font-semibold">{fmt(card.value)}</strong>
              <span className="mt-3 inline-flex rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-black">Margem {card.margin}</span>
            </div>
          ))}
        </div>
      </div>
      {/* CTA to marketplace tab */}
      <div className="rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 p-4">
        <p className="text-sm font-semibold text-black">Quer vender em um marketplace?</p>
        <p className="mt-1 text-xs text-black/60">Use o custo calculado para descobrir o preço mínimo defensável em plataformas como Mercado Livre, Shopee, Amazon e muito mais.</p>
        <button type="button" onClick={onGoToMarketplace}
          className="mt-3 flex items-center gap-2 rounded-[8px] bg-[#5852FF] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4741e8]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          Calcular preço para marketplace
        </button>
      </div>
    </div>
  );
}

import React from "react";

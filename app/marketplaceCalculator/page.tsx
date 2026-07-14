"use client";

import { useEffect, useMemo, useState } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import rawMarketData from "../../public/marketplaces.json";
import { formatCurrencyInput } from "@/utils/currency";

// ─── JSON Types (mirrors marketplaces.json) ───────────────────────────────────

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
  reputacao_min?: number;
  reputacao_max?: number;
  royalties_criador?: number;
  royalties_criador_max?: number;
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
type Plano = { nome: string; regras?: PlanoRegras; mensalidades?: Mensalidade[]; taxas_fixas?: TaxaFixa[]; observacoes?: string };
type ModalidadeRegras = {
  faixas?: Faixa[];
  taxas_percentuais?: TaxaPercentual[];
  taxas_fixas?: TaxaFixa[];
  percentual_comissao?: number;
  percentual_comissao_min?: number;
  percentual_comissao_max?: number;
};
type Modalidade = { nome: string; regras: ModalidadeRegras; observacoes?: string };
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
};

// ─── Shared UI types ──────────────────────────────────────────────────────────

type Currency = "BRL" | "USD" | "EUR";

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

const CACHE_KEY = "modulus_marketplace_state";

const CURRENCY_CONFIG: Record<Currency, { symbol: string; locale: string; code: string }> = {
  BRL: { symbol: "R$", locale: "pt-BR", code: "BRL" },
  USD: { symbol: "$", locale: "en-US", code: "USD" },
  EUR: { symbol: "€", locale: "de-DE", code: "EUR" },
};

const marketplaces = rawMarketData as MarketplaceJSON[];

const activeMarketplaces = marketplaces
  .filter((m) => m.ativo)
  .sort((a, b) => {
    if (a.id === "outro_marketplace") return 1;
    if (b.id === "outro_marketplace") return -1;
    return a.nome.localeCompare(b.nome);
  });

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

const formatCurrencyValue = (value: number, currency: Currency) => {
  const { locale, code } = CURRENCY_CONFIG[currency];
  return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(value || 0);
};

const pct = (v: number) => `${v}%`;

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
};

type EngineInput = {
  marketplace: MarketplaceJSON;
  selectedModalidade: string;
  selectedPlano: string;
  selectedCategoria: string;
  selectedFrete: string;
  customFreteValue: string;
  impostosPercent: string;
  margemDesejada: string;
  custoProducao: number;
  currency: Currency;
  manualTaxes: ManualTaxes;
};

function resolveCommissionPercent(
  marketplace: MarketplaceJSON,
  selectedModalidade: string,
  selectedPlano: string,
  selectedCategoria: string,
  estimatedPrice: number,
): { percentual: number; taxaFixa: number; label: string } {
  const id = marketplace.id;

  // ── Custom marketplace: manual inputs handled separately
  if (id === "outro_marketplace") return { percentual: 0, taxaFixa: 0, label: "" };

  // ── Modalidades with faixas (ML, Magalu-style via regras.faixas)
  if (marketplace.modalidades.length > 0 && selectedModalidade) {
    const mod = marketplace.modalidades.find((m) => m.nome === selectedModalidade);
    if (mod?.regras?.faixas && mod.regras.faixas.length > 0) {
      const faixa = mod.regras.faixas.find(
        (f) => estimatedPrice >= (f.valor_min ?? 0) && estimatedPrice <= (f.valor_max ?? Infinity),
      );
      if (faixa) {
        const pctVal = faixa.percentual_min ?? faixa.percentual ?? 0;
        return {
          percentual: pctVal,
          taxaFixa: faixa.taxa_fixa ?? 0,
          label: `${mod.nome} — ${pct(pctVal)}`,
        };
      }
    }
    if (mod?.regras?.taxas_percentuais && mod.regras.taxas_percentuais.length > 0) {
      const t = mod.regras.taxas_percentuais[0];
      const pctVal = t.valor ?? t.percentual ?? 0;
      const tf = mod.regras.taxas_fixas?.[0]?.valor ?? 0;
      return { percentual: pctVal, taxaFixa: tf, label: `${mod.nome} — ${pct(pctVal)}` };
    }
    // TurboSquid-style: percentual_comissao in regras
    if (mod?.regras?.percentual_comissao !== undefined) {
      return {
        percentual: mod.regras.percentual_comissao,
        taxaFixa: 0,
        label: `${mod.nome} — ${pct(mod.regras.percentual_comissao)}`,
      };
    }
    if (mod?.regras?.percentual_comissao_min !== undefined) {
      const v = mod.regras.percentual_comissao_min;
      return { percentual: v, taxaFixa: 0, label: `${mod.nome} — ~${pct(v)}` };
    }
  }

  // ── Planos
  if (marketplace.planos.length > 0 && selectedPlano) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    const taxasPct =
      plano?.regras?.taxas_percentuais ?? plano?.taxas_fixas?.map(() => ({ valor: 0 })) ?? [];
    const pctArr = (plano?.regras?.taxas_percentuais ?? []) as TaxaPercentual[];
    const pctVal = pctArr[0]?.valor ?? pctArr[0]?.percentual ?? 0;
    const tf = (plano?.regras?.taxas_fixas ?? plano?.taxas_fixas ?? [])[0]?.valor ?? 0;
    if (pctVal > 0 || tf > 0) return { percentual: pctVal, taxaFixa: tf, label: selectedPlano };
    void taxasPct;
  }

  // ── regras.comissao_padrao (Americanas)
  const regras = marketplace.regras as Record<string, unknown>;
  if (typeof regras.comissao_padrao === "number") {
    const tf = typeof regras.taxa_fixa_por_pedido === "number" ? regras.taxa_fixa_por_pedido : 0;
    return {
      percentual: regras.comissao_padrao,
      taxaFixa: tf,
      label: `Comissão padrão ${pct(regras.comissao_padrao)}`,
    };
  }

  // ── faixas no nível raiz de regras (Magalu)
  const regrasFaixas = regras.faixas as Faixa[] | undefined;
  if (regrasFaixas && regrasFaixas.length > 0) {
    const faixa = regrasFaixas.find(
      (f) => estimatedPrice >= (f.valor_min ?? 0) && estimatedPrice <= (f.valor_max ?? Infinity),
    );
    if (faixa) {
      return {
        percentual: faixa.percentual ?? 0,
        taxaFixa: faixa.taxa_fixa ?? 0,
        label: `Comissão ${pct(faixa.percentual ?? 0)}`,
      };
    }
  }

  // ── comissoes[] diretas
  if (marketplace.comissoes.length > 0) {
    const c = marketplace.comissoes[0];
    const pctVal = c.percentual ?? c.percentual_min ?? 0;
    const tf = c.taxa_fixa ?? 0;
    return { percentual: pctVal, taxaFixa: tf, label: `${c.nome} — ${pct(pctVal)}` };
  }

  // ── categorias com percentual fixo (Amazon Impressão 3D)
  if (marketplace.categorias.length > 0 && selectedCategoria) {
    const cat = marketplace.categorias.find((c) => c.nome === selectedCategoria);
    if (cat?.percentual) {
      return {
        percentual: cat.percentual,
        taxaFixa: 0,
        label: `${cat.nome} — ${pct(cat.percentual)}`,
      };
    }
    if (cat?.percentual_min) {
      return {
        percentual: cat.percentual_min,
        taxaFixa: 0,
        label: `${cat.nome} — ~${pct(cat.percentual_min)}`,
      };
    }
  }

  return { percentual: 0, taxaFixa: 0, label: "" };
}

function calculateMarketplaceFees(input: EngineInput): FeeBreakdown & { precoFinal: number; lucro: number; comissaoLabel: string } {
  const {
    marketplace, selectedModalidade, selectedPlano, selectedCategoria,
    selectedFrete, customFreteValue, impostosPercent, margemDesejada,
    custoProducao, currency, manualTaxes,
  } = input;

  const margem = toNumber(margemDesejada);

  // Estimated price for faixa lookup (iterate to converge)
  let estimatedPrice = custoProducao * (1 + margem / 100);

  if (marketplace.id === "outro_marketplace") {
    const comissaoPct = toCurrencyNumber(manualTaxes.comissao);
    const taxaFixaVal = toCurrencyNumber(manualTaxes.taxaFixa);
    const taxaProcPct = toCurrencyNumber(manualTaxes.taxaProcessamento);
    const taxaAnuncioPct = toCurrencyNumber(manualTaxes.taxaAnuncio);
    const mensalidadeVal = toCurrencyNumber(manualTaxes.mensalidade);
    const outrasTaxasVal = toCurrencyNumber(manualTaxes.outrasTaxas);
    const freteVal = toCurrencyNumber(manualTaxes.frete);
    const impostosPct = toCurrencyNumber(manualTaxes.impostos);

    const comissao = estimatedPrice * (comissaoPct / 100);
    const taxaProcessamento = estimatedPrice * (taxaProcPct / 100);
    const taxaAnuncio = estimatedPrice * (taxaAnuncioPct / 100);
    const impostos = (custoProducao + freteVal) * (impostosPct / 100);
    const totalTaxas = comissao + taxaFixaVal + taxaProcessamento + taxaAnuncio + mensalidadeVal + outrasTaxasVal + freteVal + impostos;
    const custoTotal = custoProducao + totalTaxas;
    const precoFinal = custoTotal / (1 - margem / 100);
    const lucro = precoFinal - custoTotal;

    return {
      comissao,
      taxaFixa: taxaFixaVal,
      taxaProcessamento,
      mensalidade: mensalidadeVal,
      frete: freteVal,
      impostos,
      outrasTaxas: outrasTaxasVal + taxaAnuncio,
      totalTaxas,
      precoFinal,
      lucro,
      comissaoLabel: "Manual",
    };
  }

  // Converge price estimate over 3 iterations (faixas depend on price)
  for (let i = 0; i < 3; i++) {
    const { percentual } = resolveCommissionPercent(
      marketplace, selectedModalidade, selectedPlano, selectedCategoria, estimatedPrice,
    );
    const comissaoAmt = estimatedPrice * (percentual / 100);
    const impostosPct = toNumber(impostosPercent);
    const impostosAmt = custoProducao * (impostosPct / 100);
    const totalTaxas = comissaoAmt + impostosAmt;
    const custoTotal = custoProducao + totalTaxas;
    estimatedPrice = custoTotal / (1 - margem / 100);
  }

  const { percentual: comissaoPct, taxaFixa: taxaFixaFromJSON, label: comissaoLabel } =
    resolveCommissionPercent(marketplace, selectedModalidade, selectedPlano, selectedCategoria, estimatedPrice);

  // Processing fee
  let taxaProcessamento = 0;
  if (marketplace.taxas_processamento.length > 0) {
    const tp = marketplace.taxas_processamento.find((t) => !t.embutido_na_comissao);
    if (tp) {
      const pctVal = tp.percentual ?? tp.percentual_min ?? 0;
      taxaProcessamento = estimatedPrice * (pctVal / 100) + (tp.taxa_fixa ?? 0);
    }
  }

  // Mensalidade: from selected plan or marketplace-level
  let mensalidade = 0;
  if (selectedPlano) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    const mens = plano?.mensalidades ?? plano?.regras?.mensalidades ?? [];
    mensalidade = (mens[0]?.valor ?? 0);
  }
  if (mensalidade === 0 && marketplace.mensalidades.length > 0) {
    mensalidade = marketplace.mensalidades[0].valor ?? 0;
  }

  // Taxa fixa from plan if not from faixa
  let taxaFixaFinal = taxaFixaFromJSON;
  if (selectedPlano && taxaFixaFinal === 0) {
    const plano = marketplace.planos.find((p) => p.nome === selectedPlano);
    const tf = (plano?.regras?.taxas_fixas ?? plano?.taxas_fixas ?? [])[0]?.valor ?? 0;
    taxaFixaFinal = tf;
  }

  // Frete
  let freteAmt = 0;
  const freteConfig = marketplace.frete;
  if (selectedFrete === "proprio" || selectedFrete === "manual") {
    freteAmt = toCurrencyNumber(customFreteValue);
  } else if (selectedFrete === "subsidiado" && freteConfig.custeio_vendedor_percentual_min) {
    freteAmt = estimatedPrice * (freteConfig.custeio_vendedor_percentual_min / 100);
  } else if (selectedFrete === "fba" && freteConfig.fba_taxa_min) {
    freteAmt = freteConfig.fba_taxa_min;
  }

  const impostosPctVal = toNumber(impostosPercent);
  const impostos = (custoProducao + freteAmt) * (impostosPctVal / 100);

  const comissao = estimatedPrice * (comissaoPct / 100);
  const totalTaxas = comissao + taxaFixaFinal + taxaProcessamento + mensalidade + freteAmt + impostos;
  const custoTotal = custoProducao + totalTaxas;
  const precoFinal = custoTotal / (1 - margem / 100);
  const lucro = precoFinal - custoTotal;

  void currency;

  return {
    comissao,
    taxaFixa: taxaFixaFinal,
    taxaProcessamento,
    mensalidade,
    frete: freteAmt,
    impostos,
    outrasTaxas: 0,
    totalTaxas,
    precoFinal,
    lucro,
    comissaoLabel,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MarketplaceCalculator() {
  const [currency, setCurrency] = useState<Currency>("BRL");

  // Production cost inputs (mirrors Professional Calculator Step 0-4)
  const [custoProducaoManual, setCustoProducaoManual] = useState("");

  // Marketplace selection
  const [selectedMarketplaceId, setSelectedMarketplaceId] = useState("");
  const [selectedModalidade, setSelectedModalidade] = useState("");
  const [selectedPlano, setSelectedPlano] = useState("");
  const [selectedCategoria, setSelectedCategoria] = useState("");
  const [selectedFrete, setSelectedFrete] = useState("");
  const [customFreteValue, setCustomFreteValue] = useState("");
  const [impostosPercent, setImpostosPercent] = useState("");
  const [margemDesejada, setMargemDesejada] = useState("30");

  // Manual taxes for "outro_marketplace"
  const [manualTaxes, setManualTaxes] = useState<ManualTaxes>({
    comissao: "", taxaFixa: "", taxaProcessamento: "",
    taxaAnuncio: "", mensalidade: "", outrasTaxas: "",
    frete: "", impostos: "",
  });

  // ─── Cache ──────────────────────────────────────────────────────────────────

  const stateSnapshot = useMemo(() => ({
    currency, custoProducaoManual, selectedMarketplaceId, selectedModalidade,
    selectedPlano, selectedCategoria, selectedFrete, customFreteValue,
    impostosPercent, margemDesejada, manualTaxes,
  }), [
    currency, custoProducaoManual, selectedMarketplaceId, selectedModalidade,
    selectedPlano, selectedCategoria, selectedFrete, customFreteValue,
    impostosPercent, margemDesejada, manualTaxes,
  ]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.currency) setCurrency(s.currency);
      if (s.custoProducaoManual) setCustoProducaoManual(s.custoProducaoManual);
      if (s.selectedMarketplaceId) setSelectedMarketplaceId(s.selectedMarketplaceId);
      if (s.selectedModalidade) setSelectedModalidade(s.selectedModalidade);
      if (s.selectedPlano) setSelectedPlano(s.selectedPlano);
      if (s.selectedCategoria) setSelectedCategoria(s.selectedCategoria);
      if (s.selectedFrete) setSelectedFrete(s.selectedFrete);
      if (s.customFreteValue) setCustomFreteValue(s.customFreteValue);
      if (s.impostosPercent) setImpostosPercent(s.impostosPercent);
      if (s.margemDesejada) setMargemDesejada(s.margemDesejada);
      if (s.manualTaxes) setManualTaxes(s.manualTaxes);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(stateSnapshot)); } catch { /* ignore */ }
  }, [stateSnapshot]);

  const clearAll = () => {
    setCurrency("BRL");
    setCustoProducaoManual("");
    setSelectedMarketplaceId("");
    setSelectedModalidade("");
    setSelectedPlano("");
    setSelectedCategoria("");
    setSelectedFrete("");
    setCustomFreteValue("");
    setImpostosPercent("");
    setMargemDesejada("30");
    setManualTaxes({ comissao: "", taxaFixa: "", taxaProcessamento: "", taxaAnuncio: "", mensalidade: "", outrasTaxas: "", frete: "", impostos: "" });
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  };

  // ─── Derived state ───────────────────────────────────────────────────────────

  const marketplace = useMemo(
    () => activeMarketplaces.find((m) => m.id === selectedMarketplaceId) ?? null,
    [selectedMarketplaceId],
  );

  const isCustom = selectedMarketplaceId === "outro_marketplace";

  // Auto-select defaults when marketplace changes
  useEffect(() => {
    if (!marketplace) return;
    setSelectedModalidade(marketplace.modalidades[0]?.nome ?? "");
    setSelectedPlano(marketplace.planos[0]?.nome ?? "");
    setSelectedCategoria(marketplace.categorias[0]?.nome ?? "");
    setSelectedFrete(marketplace.frete.subsidiado ? "subsidiado" : marketplace.frete.fba_logistica_amazon ? "fba" : "proprio");
  }, [marketplace]);

  const custoProducao = toCurrencyNumber(custoProducaoManual);

  const result = useMemo(() => {
    if (!marketplace || custoProducao <= 0) return null;
    return calculateMarketplaceFees({
      marketplace, selectedModalidade, selectedPlano, selectedCategoria,
      selectedFrete, customFreteValue, impostosPercent, margemDesejada,
      custoProducao, currency, manualTaxes,
    });
  }, [
    marketplace, selectedModalidade, selectedPlano, selectedCategoria,
    selectedFrete, customFreteValue, impostosPercent, margemDesejada,
    custoProducao, currency, manualTaxes,
  ]);

  const fmt = (v: number) => formatCurrencyValue(v, currency);
  const { symbol } = CURRENCY_CONFIG[currency];

  // ─── Frete options for current marketplace ────────────────────────────────

  const freteOptions = useMemo(() => {
    if (!marketplace) return [];
    const opts: { value: string; label: string }[] = [];
    if (marketplace.frete.subsidiado) opts.push({ value: "subsidiado", label: "Frete subsidiado / envios da plataforma" });
    if (marketplace.frete.fba_logistica_amazon) opts.push({ value: "fba", label: "FBA — Logística Amazon" });
    if (marketplace.frete.integrado_mercado_envios) opts.push({ value: "subsidiado", label: "Mercado Envios" });
    if (marketplace.frete.magalu_entregas) opts.push({ value: "subsidiado", label: "Magalu Entregas" });
    if (marketplace.frete.envia) opts.push({ value: "subsidiado", label: "Envia (plataforma)" });
    opts.push({ value: "proprio", label: "Frete próprio (informar valor)" });
    return opts;
  }, [marketplace]);

  // Unique frete options (deduplicate "subsidiado")
  const uniqueFreteOptions = useMemo(() => {
    const seen = new Set<string>();
    return freteOptions.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [freteOptions]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-black">
      <Header />
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">

        {/* ── Page header ── */}
        <header className="relative overflow-hidden rounded-[8px] border border-black/10 bg-white px-5 py-6 shadow-xl shadow-[#5852FF]/10 sm:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(88,82,255,0.18),transparent_30%),radial-gradient(circle_at_90%_0%,rgba(186,74,0,0.12),transparent_26%)]" />
          <div className="relative">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#BA4A00]">
                  Vendas em Marketplaces
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-normal text-black sm:text-4xl lg:text-5xl">
                  Marketplace Calculator
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
                  Selecione o marketplace, configure as opções e descubra o{" "}
                  <strong>preco mínimo defensável</strong> considerando todas as taxas automaticamente.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {/* Currency selector */}
                <div className="flex items-center gap-1 rounded-[8px] border border-black/10 bg-[#F9FAFB] p-1">
                  {(["BRL", "USD", "EUR"] as Currency[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurrency(c)}
                      className={`rounded-[6px] px-3 py-1.5 text-xs font-bold transition ${
                        currency === c
                          ? "bg-[#5852FF] text-white shadow-sm"
                          : "text-black/55 hover:text-[#5852FF]"
                      }`}
                    >
                      {CURRENCY_CONFIG[c].symbol} {c}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={clearAll}
                  className="flex items-center gap-2 rounded-[8px] border border-[#BA4A00]/30 px-4 py-2.5 text-sm font-semibold text-[#BA4A00] transition hover:bg-[#BA4A00] hover:text-white"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Limpar tudo
                </button>

                {result && (
                  <div className="rounded-[8px] bg-gradient-to-br from-[#5852FF] to-black p-4 text-white shadow-xl shadow-[#5852FF]/20">
                    <p className="text-xs font-semibold text-white/60">Preço mínimo</p>
                    <strong className="mt-1 block text-2xl font-black">{fmt(result.precoFinal)}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ── Main grid ── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">

          {/* ── Left: inputs ── */}
          <div className="flex flex-col gap-5">

            {/* Section 1: Custo de Produção */}
            <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-7">
              <SectionHeader
                eyebrow="Etapa 1"
                title="Custo de Produção"
                icon="◐"
                description={
                  <>
                    Informe o custo total de producao da peça — material, energia, maquina,
                    acabamento e embalagem. Use a{" "}
                    <strong>Professional Calculator</strong> para calcular com precisao.
                  </>
                }
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Custo de produção total"
                  hint="Soma de material, energia, tempo de maquina, acabamento e embalagem — exatamente o custo total gerado pela Professional Calculator."
                  prefix={symbol}
                  value={custoProducaoManual}
                  onChange={(v) => setCustoProducaoManual(formatCurrencyInput(v, 3))}
                  placeholder="0,00"
                  required
                  isCurrencyField
                />
                <NumberField
                  label="Margem desejada"
                  hint="Percentual de lucro sobre o preço de venda que você quer garantir após todas as taxas."
                  suffix="%"
                  value={margemDesejada}
                  onChange={setMargemDesejada}
                  placeholder="30"
                  required
                />
              </div>
            </div>

            {/* Section 2: Marketplace */}
            <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-7">
              <SectionHeader
                eyebrow="Etapa 2"
                title="Marketplace"
                icon="🏪"
                description="Selecione onde vai vender. Os campos abaixo se adaptam automaticamente as regras da plataforma."
              />

              {/* Marketplace select */}
              <div className="mt-5">
                <SelectField
                  label="Plataforma de venda"
                  hint="Selecione o marketplace onde pretende vender este produto."
                  value={selectedMarketplaceId}
                  onChange={(v) => setSelectedMarketplaceId(v)}
                  required
                >
                  <option value="">Selecione um marketplace...</option>
                  {activeMarketplaces.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}{m.pais !== "BR" && m.pais !== "GLOBAL" ? ` (${m.pais})` : ""}
                    </option>
                  ))}
                </SelectField>
              </div>

              {/* Marketplace info badge */}
              {marketplace && !isCustom && (
                <div className="mt-4 rounded-[8px] border border-black/10 bg-[#F9FAFB] px-4 py-3">
                  <p className="text-xs font-semibold text-black/50">{marketplace.descricao}</p>
                  {marketplace.observacoes && (
                    <p className="mt-1 text-xs leading-5 text-[#BA4A00]">
                      ⚠ {marketplace.observacoes}
                    </p>
                  )}
                </div>
              )}

              {/* Dynamic fields — only shown when marketplace selected */}
              {marketplace && !isCustom && (
                <div className="mt-5 flex flex-col gap-4">

                  {/* Modalidades (e.g. ML Clássico/Premium, Elo7 Regular/Plus) */}
                  {marketplace.modalidades.length > 0 && (
                    <div>
                      <FieldLabel label="Tipo de anúncio" hint="Cada modalidade tem estrutura de taxas diferente." required />
                      <RadioGroup
                        options={marketplace.modalidades.map((m) => ({ value: m.nome, label: m.nome }))}
                        value={selectedModalidade}
                        onChange={setSelectedModalidade}
                      />
                    </div>
                  )}

                  {/* Planos (e.g. Shopee Padrão/Frete Grátis, Amazon Individual/Profissional) */}
                  {marketplace.planos.length > 0 && (
                    <div>
                      <FieldLabel label="Plano / tipo de conta" hint="O plano determina as taxas aplicadas." required />
                      {marketplace.planos.length === 2 ? (
                        <RadioGroup
                          options={marketplace.planos.map((p) => ({ value: p.nome, label: p.nome }))}
                          value={selectedPlano}
                          onChange={setSelectedPlano}
                        />
                      ) : (
                        <SelectField
                          label=""
                          value={selectedPlano}
                          onChange={setSelectedPlano}
                        >
                          {marketplace.planos.map((p) => (
                            <option key={p.nome} value={p.nome}>{p.nome}</option>
                          ))}
                        </SelectField>
                      )}
                    </div>
                  )}

                  {/* Categorias */}
                  {marketplace.categorias.length > 1 && (
                    <SelectField
                      label="Categoria do produto"
                      hint="A comissão pode variar de acordo com a categoria. Escolha a mais próxima."
                      value={selectedCategoria}
                      onChange={setSelectedCategoria}
                    >
                      {marketplace.categorias.map((c) => (
                        <option key={c.nome} value={c.nome}>{c.nome}</option>
                      ))}
                    </SelectField>
                  )}

                  {/* Frete */}
                  {Object.keys(marketplace.frete).length > 0 && uniqueFreteOptions.length > 1 && (
                    <div>
                      <FieldLabel label="Frete" hint="Selecione como o frete será operado." required />
                      <RadioGroup
                        options={uniqueFreteOptions}
                        value={selectedFrete}
                        onChange={setSelectedFrete}
                      />
                      {(selectedFrete === "proprio" || selectedFrete === "manual") && (
                        <div className="mt-3">
                          <NumberField
                            label="Valor do frete"
                            hint="Informe o custo de frete que você vai pagar ou repassar."
                            prefix={symbol}
                            value={customFreteValue}
                            onChange={(v) => setCustomFreteValue(formatCurrencyInput(v, 3))}
                            placeholder="0,00"
                            isCurrencyField
                          />
                        </div>
                      )}
                      {selectedFrete === "subsidiado" && marketplace.frete.valor_minimo_frete_gratis && (
                        <p className="mt-2 text-xs text-black/50">
                          Frete grátis para pedidos acima de {fmt(marketplace.frete.valor_minimo_frete_gratis)}.
                          Custeio do vendedor estimado em {marketplace.frete.custeio_vendedor_percentual_min}–{marketplace.frete.custeio_vendedor_percentual_max}% do valor.
                        </p>
                      )}
                      {selectedFrete === "fba" && marketplace.frete.fba_taxa_min && (
                        <p className="mt-2 text-xs text-black/50">
                          Taxa FBA estimada entre {fmt(marketplace.frete.fba_taxa_min)} e{" "}
                          {fmt(marketplace.frete.fba_taxa_max ?? 0)} por unidade, dependendo de peso e dimensões.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Impostos */}
                  <NumberField
                    label="Impostos sobre venda (%)"
                    hint="Percentual de impostos aplicado sobre o custo de produção (MEI, Simples Nacional etc.)."
                    suffix="%"
                    value={impostosPercent}
                    onChange={setImpostosPercent}
                    placeholder="0"
                  />
                </div>
              )}

              {/* Custom / Manual marketplace */}
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
                  <NumberField
                    label="Margem desejada (%)"
                    hint="Percentual de lucro sobre o preço final após todas as taxas."
                    suffix="%"
                    value={margemDesejada}
                    onChange={setMargemDesejada}
                    placeholder="30"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Right: summary sidebar ── */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">

            {/* Result card */}
            {result ? (
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5">
                <h2 className="text-base font-semibold text-black">Resultado Marketplace</h2>
                <p className="mt-1 text-xs text-black/50">Cálculo em tempo real com as taxas da plataforma selecionada.</p>

                {result.comissaoLabel && (
                  <div className="mt-4 rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-3 py-2">
                    <p className="text-xs font-semibold text-[#5852FF]">{result.comissaoLabel}</p>
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <SummaryRow label="Custo de produção" value={fmt(custoProducao)} />
                  <SummaryRow label="Comissão marketplace" value={fmt(result.comissao)} />
                  {result.taxaFixa > 0 && <SummaryRow label="Taxa fixa" value={fmt(result.taxaFixa)} />}
                  {result.taxaProcessamento > 0 && <SummaryRow label="Taxa de processamento" value={fmt(result.taxaProcessamento)} />}
                  {result.mensalidade > 0 && <SummaryRow label="Mensalidade" value={fmt(result.mensalidade)} />}
                  {result.frete > 0 && <SummaryRow label="Frete" value={fmt(result.frete)} />}
                  {result.impostos > 0 && <SummaryRow label="Impostos" value={fmt(result.impostos)} />}
                  {result.outrasTaxas > 0 && <SummaryRow label="Outras taxas" value={fmt(result.outrasTaxas)} />}
                </div>

                <div className="mt-4 rounded-[8px] bg-[#BA4A00]/10 px-4 py-3">
                  <p className="text-xs font-semibold text-[#BA4A00]">Total de taxas</p>
                  <strong className="mt-1 block text-xl font-black text-[#BA4A00]">{fmt(result.totalTaxas)}</strong>
                </div>

                <div className="mt-3 rounded-[8px] bg-black px-4 py-4 text-white">
                  <p className="text-xs font-semibold text-white/60">Preço mínimo recomendado</p>
                  <strong className="mt-1 block text-3xl font-black">{fmt(result.precoFinal)}</strong>
                  <p className="mt-2 text-xs text-white/50">
                    Lucro estimado: <strong className="text-white">{fmt(result.lucro)}</strong>
                  </p>
                </div>

                {/* Price breakdown visual */}
                <div className="mt-4 space-y-2">
                  {[
                    { label: "Produção", value: custoProducao, color: "bg-[#5852FF]" },
                    { label: "Taxas", value: result.totalTaxas, color: "bg-[#BA4A00]" },
                    { label: "Lucro", value: result.lucro, color: "bg-black" },
                  ].map(({ label, value, color }) => {
                    const total = custoProducao + result.totalTaxas + result.lucro;
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
                  Preencha o custo de produção e selecione um marketplace para ver o preço mínimo recomendado.
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

            {/* Marketplace quick info */}
            {marketplace && !isCustom && (
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-black/40">Sobre o marketplace</p>
                <div className="mt-3 space-y-2 text-xs text-black/60">
                  <div className="flex justify-between">
                    <span>País</span>
                    <strong className="text-black">{marketplace.pais}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Moeda base</span>
                    <strong className="text-black">{marketplace.moeda}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Tipo de produto</span>
                    <strong className="text-black">{marketplace.tipo_produto.join(", ")}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Atualizado em</span>
                    <strong className="text-black">
                      {/* @ts-ignore */}
                      {(marketplace as { ultima_atualizacao?: string }).ultima_atualizacao ?? "—"}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────────────────

function SectionHeader({
  eyebrow, title, icon, description,
}: {
  eyebrow: string;
  title: string;
  icon: string;
  description: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">{eyebrow}</p>
      <h2 className="flex items-center gap-3 text-2xl font-semibold text-black">
        <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-xl text-[#5852FF]">
          {icon}
        </span>
        {title}
      </h2>
      <p className="max-w-2xl text-sm leading-6 text-black/65">{description}</p>
    </div>
  );
}

function FieldLabel({ label, hint, required }: { label: string; hint?: string; required?: boolean }) {
  return (
    <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
      {label}
      {required && <span className="text-[#BA4A00]">*</span>}
      {hint && <Tooltip text={hint} />}
    </span>
  );
}

function RadioGroup({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-2 rounded-[8px] border px-4 py-2.5 text-sm font-semibold transition ${
            value === opt.value
              ? "border-[#5852FF] bg-[#5852FF]/8 text-[#5852FF]"
              : "border-black/10 bg-[#F9FAFB] text-black/65 hover:border-[#5852FF]/40 hover:text-[#5852FF]"
          }`}
        >
          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
            value === opt.value ? "border-[#5852FF]" : "border-black/25"
          }`}>
            {value === opt.value && <span className="h-2 w-2 rounded-full bg-[#5852FF]" />}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SelectField({
  label, hint, value, onChange, required, children,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      {label && <FieldLabel label={label} hint={hint} required={required} />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-[8px] border border-black/15 bg-white px-3 text-base text-black outline-none transition focus:border-[#5852FF] focus:ring-4 focus:ring-[#5852FF]/10"
      >
        {children}
      </select>
    </label>
  );
}

function NumberField({
  label, hint, value, onChange, placeholder, prefix, suffix,
  suffixOptions, suffixValue, onSuffixChange, required, isCurrencyField = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  suffixOptions?: string[];
  suffixValue?: string;
  onSuffixChange?: (value: string) => void;
  required?: boolean;
  isCurrencyField?: boolean;
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
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (isCurrencyField) {
              onChange(raw.replace(/[^\d.,]/g, ""));
            } else {
              const stripped = raw.replace(/[^\d.]/g, "");
              const parts = stripped.split(".");
              onChange(parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : stripped);
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base text-black outline-none placeholder:text-black/35"
        />
        {suffixOptions && suffixOptions.length > 0 ? (
          <select
            value={suffixValue}
            onChange={(e) => onSuffixChange?.(e.target.value)}
            className="ml-2 rounded-[6px] border border-black/15 bg-transparent px-2 text-sm font-semibold text-black outline-none"
          >
            {suffixOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : (
          suffix && <span className="ml-2 text-sm font-semibold text-black/45">{suffix}</span>
        )}
      </span>
    </label>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} className="flex h-5 w-5 items-center justify-center rounded-full border border-black/15 bg-[#F9FAFB] text-xs font-bold text-black/55 outline-none transition hover:border-[#5852FF] hover:text-[#5852FF] focus:border-[#5852FF] focus:text-[#5852FF]">
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-7 z-10 w-56 -translate-x-1/2 rounded-[8px] border border-black/10 bg-black px-3 py-2 text-xs font-medium leading-5 text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
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

// needed for JSX in SectionHeader
import React from "react";
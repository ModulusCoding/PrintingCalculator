"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import marketData from "../../public/marketplaces.json";
import { formatCurrencyInput } from "@/utils/currency";
type MarketOption = {
  id: string;
  nome_marketplace: string;
  tipo_segmento: string;
  
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const toNumber = (value: string) => {
  const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: number) => currencyFormatter.format(value || 0);
const marketplacesOptions: MarketOption[] = (marketData as unknown as MarketOption[])
  .map((marketplace) => ({
    id: marketplace.id,
    nome_marketplace: marketplace.nome_marketplace,
    tipo_segmento: marketplace.tipo_segmento,
    
  }))
  .sort((a: { nome_marketplace: any; id: any; }, b: { nome_marketplace: any; id: any; }) => `${a.nome_marketplace} ${a.id}`.localeCompare(`${b.nome_marketplace} ${b.id}`));

const fields = [
  ["Quantidade de peças", "peças", "1"],
  ["Material utilizado", "g", "120"],
  ["Peso total adquirido", "g", "1000"],
  ["Preco pago pelo material", "R$", "89,90"],
  ["Tempo de impressao", "h", "8"],
  ["Valor por hora da maquina", "R$", "5,00"],
  ["Embalagem", "R$", "4,50"],
  ["Impostos", "%", "6"],
  ["Frete", "R$", "18,90"],
  ["Taxa Marketplace", "%", "16"],
  ["Taxa de Anuncio", "%", "4"],
  ["Margem Desejada", "%", "45"],
] as const;

export default function MarketplaceCalculator() {
  const [values, setValues] = useState<Record<string, string>>({
    "Quantidade de peças": "1",
    "Impostos": "6",
    "Taxa Marketplace": "16",
    "Taxa de Anuncio": "4",
    "Margem Desejada": "45",
  });

  const result = useMemo(() => {
    const quantidadePecas = Math.max(1, toNumber(values["Quantidade de peças"] || "") || 1);
    const materialUtilizado = toNumber(values["Material utilizado"] || "");
    const pesoTotalAdquirido = toNumber(values["Peso total adquirido"] || "");
    const precoMaterial = toNumber(values["Preco pago pelo material"] || "");
    const horasImpressao = toNumber(values["Tempo de impressao"] || "");
    const valorHoraMaquina = toNumber(values["Valor por hora da maquina"] || "");
    const embalagem = toNumber(values["Embalagem"] || "");
    const impostosPercentual = toNumber(values["Impostos"] || "");
    const frete = toNumber(values["Frete"] || "");
    const taxaMarketplace = toNumber(values["Taxa Marketplace"] || "");
    const taxaAnuncio = toNumber(values["Taxa de Anuncio"] || "");
    const margemDesejada = toNumber(values["Margem Desejada"] || "");

    const custoPorGrama =
      pesoTotalAdquirido > 0 ? precoMaterial / pesoTotalAdquirido : 0;
    const custoMaterial = materialUtilizado * custoPorGrama * quantidadePecas;
    const custoMaquina = horasImpressao * valorHoraMaquina * quantidadePecas;
    const custoProducao = custoMaterial + custoMaquina + embalagem + frete;
    const taxasMarketplace =
      (custoProducao * (taxaMarketplace + taxaAnuncio)) / 100;
    const impostos = custoProducao * (impostosPercentual / 100);
    const custoTotal = custoProducao + taxasMarketplace + impostos;
    const precoFinal = custoTotal * (1 + margemDesejada / 100);
    const lucro = precoFinal - custoTotal;

    return {
      custoMaterial,
      custoMaquina,
      custoProducao,
      taxasMarketplace,
      impostos,
      custoTotal,
      precoFinal,
      lucro,
    };
  }, [values]);

  const updateValue = (label: string, value: string) => {
    setValues((current) => ({ ...current, [label]: value }));
  };

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-black">
      <Header></Header>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-8">
          <Link href="/" className="text-sm font-bold text-[#5852FF]">
            ← Modulus
          </Link>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#BA4A00]">
                Vendas em marketplaces
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-normal sm:text-5xl">
                Marketplace Calculator
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/65">
                Considere material, maquina, frete, impostos, comissoes e margem para chegar em um preco defensavel.
              </p>
            </div>
            <div className="rounded-[8px] bg-gradient-to-br from-[#5852FF] to-black p-5 text-white shadow-xl shadow-[#5852FF]/20">
              <p className="text-sm font-bold text-white/65">Preco Minimo Recomendado</p>
              <strong className="mt-2 block text-4xl font-black">{money(result.precoFinal)}</strong>
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(([label, unit, placeholder]) => (
                <Field
                  key={label}
                  label={label}
                  prefix={unit === "R$" ? unit : undefined}
                  suffix={unit !== "R$" ? unit : undefined}
                  value={values[label] || ""}
                  placeholder={placeholder}
                  
                  onChange={(value) => updateValue(label, formatCurrencyInput(value, 3))}
                />
              ))}
            </div>
          </section>

          <aside className="h-fit rounded-[8px] border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <h2 className="text-lg font-black">Resultado Marketplace</h2>
            <div className="mt-5 space-y-3">
              <Row label="Custo Producao" value={result.custoProducao} />
              <Row label="Taxas" value={result.taxasMarketplace} />
              <Row label="Impostos" value={result.impostos} />
              <Row label="Lucro" value={result.lucro} />
            </div>
            <div className="mt-5 rounded-[8px] bg-[#BA4A00]/10 p-4">
              <p className="text-sm font-bold text-[#BA4A00]">Custo total</p>
              <strong className="mt-1 block text-2xl font-black">{money(result.custoTotal)}</strong>
            </div>
            <div className="mt-4 rounded-[8px] bg-black p-5 text-white">
              <p className="text-sm font-bold text-white/60">Preco Final</p>
              <strong className="mt-2 block text-3xl font-black">{money(result.precoFinal)}</strong>
            </div>
          </aside>
        </div>
      </section>
      <Footer></Footer>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-black">{label}</span>
      <span className="flex h-12 items-center rounded-[8px] border border-black/15 bg-[#F9FAFB] px-3 transition focus-within:border-[#5852FF] focus-within:ring-4 focus-within:ring-[#5852FF]/10">
        {prefix && <span className="mr-2 text-sm font-bold text-black/45">{prefix}</span>}
        <input
          value={value}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-black/35"
        />
        {suffix && <span className="ml-2 text-sm font-bold text-black/45">{suffix}</span>}
      </span>
    </label>

    
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/10 pb-3 text-sm last:border-b-0">
      <span className="text-black/65">{label}</span>
      <strong>{money(value)}</strong>
    </div>
  );
}

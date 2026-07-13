"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { formatCurrencyInput } from "@/utils/currency";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const toNumber = (value: string) => {
  const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: number) => currencyFormatter.format(value || 0);

export default function FastCalculator() {
  const [materialUsed, setMaterialUsed] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [materialPrice, setMaterialPrice] = useState("");
  const [printingHours, setPrintingHours] = useState("");
  const [printingMinutes, setPrintingMinutes] = useState("");
  const [margin, setMargin] = useState("30");
const [materialUnit, setMaterialUnit] = useState<"g" | "kg">("g");
const [totalWeightUnit, setTotalWeightUnit] = useState<"g" | "kg">("g");
  const result = useMemo(() => {
    const materialUtilizado =
    materialUnit === "kg"
        ? toNumber(materialUsed) * 1000
        : toNumber(materialUsed);

    const pesoTotalAdquirido =
        totalWeightUnit === "kg"
            ? toNumber(totalWeight) * 1000
            : toNumber(totalWeight);
    
    const precoMaterial = toNumber(materialPrice);
    const horasImpressao = toNumber(printingHours);
    const minutosImpressao = toNumber(printingMinutes);
    const margem = toNumber(margin);

    const totalPrintingMinutes = horasImpressao * 60 + minutosImpressao;
    const custoPorGrama =
      pesoTotalAdquirido > 0 ? precoMaterial / pesoTotalAdquirido : 0;
    const custoMaterial = materialUtilizado * custoPorGrama;
    const custoMaquina = 0;
    const custoTotal = custoMaterial + custoMaquina;
    const precoFinal = custoTotal * (1 + margem / 100);
    const lucro = precoFinal - custoTotal;

    return { custoMaterial, custoMaquina, custoTotal, precoFinal, lucro, totalPrintingMinutes };
  }, [margin, materialPrice, materialUsed, printingHours, printingMinutes, totalWeight]);

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-black">
      <Header></Header>
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8 lg:py-10">
        <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href="/" className="text-sm font-bold text-[#5852FF]">
                ← Modulus
              </Link>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.2em] text-[#BA4A00]">
                Orcamento em 15 segundos
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-normal sm:text-5xl">
                Fast Calculator
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/65">
                Informe o essencial e veja custo, preco final e lucro em tempo real.
              </p>
            </div>
            <span className="rounded-[8px] bg-[#5852FF]/10 px-4 py-3 text-sm font-bold text-[#5852FF]">
              sem botão calcular
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Filamento Consumido" suffix="g" value={materialUsed} onChange={setMaterialUsed} placeholder="120" suffixOptions={["g", "kg"]}
    suffixValue={materialUnit}
    onSuffixChange={(value) =>
        setMaterialUnit(value as "g" | "kg")
    }/>
            <Field label="Tamanho do Carretel" suffix="g" value={totalWeight} onChange={setTotalWeight} placeholder="1000" suffixOptions={["g", "kg"]}
    suffixValue={totalWeightUnit}
    onSuffixChange={(value) =>
        setTotalWeightUnit(value as "g" | "kg")
    }/>
            <Field label="Preço do Carretel" prefix="R$" value={materialPrice}  placeholder="89,90" onChange={(value) => setMaterialPrice(formatCurrencyInput(value, 3))}/>
            <Field label="Horas de impressão" suffix="h" value={printingHours} onChange={setPrintingHours} placeholder="1" />
            <Field label="Minutos de impressão" suffix="min" value={printingMinutes} onChange={setPrintingMinutes} placeholder="30"numericOnly  maxLength={2} max={59} />
            <Field label="Margem desejada" suffix="%" value={margin} onChange={setMargin} placeholder="30" />
          </div>
        </div>

        <aside className="h-fit rounded-[8px] border border-black/10 bg-black p-5 text-white shadow-2xl lg:sticky lg:top-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/50">Resultado</p>
          <div className="mt-6 grid gap-4">
            <BigNumber label="Custo" value={money(result.custoTotal)} />
            <div className="rounded-[8px] bg-[#5852FF] p-5 shadow-lg shadow-[#5852FF]/30">
              <p className="text-sm font-bold text-white/70">Preco Final</p>
              <strong className="mt-2 block text-4xl font-black">{money(result.precoFinal)}</strong>
            </div>
            <BigNumber label="Lucro" value={money(result.lucro)} accent />
          </div>
          <div className="mt-6 rounded-[8px] border border-white/10 p-4 text-sm text-white/70">
            Material: {money(result.custoMaterial)}
          </div>
        </aside>
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
  suffixOptions,
  suffixValue,
  onSuffixChange,
  maxLength,
  max,
  numericOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  prefix?: string;
  suffix?: string;
suffixOptions?: string[];
suffixValue?: string;
onSuffixChange?: (value: string) => void;
  maxLength?: number;
  max?: number;
numericOnly?: boolean;
  
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-black">{label}</span>
      <span className="flex h-12 items-center rounded-[8px] border border-black/15 bg-[#F9FAFB] px-3 transition focus-within:border-[#5852FF] focus-within:ring-4 focus-within:ring-[#5852FF]/10">
        {prefix && <span className="mr-2 text-sm font-bold text-black/45">{prefix}</span>}
        <input
          value={value}
          inputMode="decimal"
          onChange={(event) => {
  let value = event.target.value;

  if (numericOnly) {
    value = value.replace(/\D/g, "");
  } else {
    value = value.replace(/[^\d.,]/g, "");
  }

  if (maxLength) {
    value = value.slice(0, maxLength);
  }

  if (max !== undefined && value !== "") {
    value = Math.min(Number(value), max).toString();
  }

  onChange(value);
}}
          placeholder={placeholder}
          maxLength={maxLength}
          max={max}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-black/35"
        />
        {suffixOptions ? (
    <select
        value={suffixValue}
        onChange={(e) => onSuffixChange?.(e.target.value)}
        className="ml-2 bg-transparent text-sm font-bold text-black/45 outline-none cursor-pointer"
    >
        {suffixOptions.map(option => (
            <option key={option} value={option}>
                {option}
            </option>
        ))}
    </select>
) : (
    suffix && (
        <span className="ml-2 text-sm font-bold text-black/45">
            {suffix}
        </span>
    )
)}
      </span>
    </label>
  );
}

function BigNumber({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/5 p-5">
      <p className={`text-sm font-bold ${accent ? "text-[#BA4A00]" : "text-white/55"}`}>{label}</p>
      <strong className="mt-2 block text-3xl font-black">{value}</strong>
    </div>
  );
}

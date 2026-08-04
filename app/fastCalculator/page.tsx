"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { formatCurrencyInput } from "@/utils/currency";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a plain numeric string — uses '.' as decimal separator.
 * Accepts: "120", "1.5", "1000"
 * Does NOT strip dots before parsing (unlike the old toNumber).
 */
const toPlainNumber = (value: string): number => {
  const stripped = value.replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(stripped);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Parse a currency string formatted in pt-BR style.
 * Uses ',' as decimal separator and '.' as thousands separator.
 * Accepts: "89,90", "1.089,90"
 */
const toCurrencyNumber = (value: string): number => {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const money = (value: number) => currencyFormatter.format(value || 0);

// ─── Component ────────────────────────────────────────────────────────────────

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
    // Plain numeric fields — decimal separator is '.'
    const rawMaterialUsed = toPlainNumber(materialUsed);
    const materialUtilizado = materialUnit === "kg" ? rawMaterialUsed * 1000 : rawMaterialUsed;

    const rawTotalWeight = toPlainNumber(totalWeight);
    const pesoTotalAdquirido = totalWeightUnit === "kg" ? rawTotalWeight * 1000 : rawTotalWeight;

    // Currency field — decimal separator is ','
    const precoMaterial = toCurrencyNumber(materialPrice);

    const horasImpressao = toPlainNumber(printingHours);
    const minutosImpressao = toPlainNumber(printingMinutes);
    const margem = toPlainNumber(margin);

    const totalPrintingMinutes = horasImpressao * 60 + minutosImpressao;
    const custoPorGrama = pesoTotalAdquirido > 0 ? precoMaterial / pesoTotalAdquirido : 0;
    const custoMaterial = materialUtilizado * custoPorGrama;
    const custoTotal = custoMaterial;
    const precoFinal = margem > 0 ? custoTotal * (1 + margem / 100) : custoTotal;
    const lucro = precoFinal - custoTotal;

    return { custoMaterial, custoTotal, precoFinal, lucro, totalPrintingMinutes, custoPorGrama };
  }, [
    materialUsed, materialUnit,
    totalWeight, totalWeightUnit,
    materialPrice,
    printingHours, printingMinutes,
    margin,
  ]);

  const hasResult = result.custoTotal > 0;

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-black">
      <Header />
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8 lg:py-10">

        {/* ── Inputs panel ── */}
        <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href="/" className="text-sm font-bold text-[#5852FF]">
                ← Modulus
              </Link>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.2em] text-[#FF4E26]">
                Orçamento em 15 segundos
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-normal sm:text-5xl">
                Fast Calculator
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/65">
                Informe o essencial e veja custo, preço final e lucro em tempo real.
              </p>
            </div>
            <span className="rounded-[8px] bg-[#5852FF]/10 px-4 py-3 text-sm font-bold text-[#5852FF]">
              sem botão calcular
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Filamento Consumido"
              required
              suffix="g"
              suffixOptions={["g", "kg"]}
              suffixValue={materialUnit}
              onSuffixChange={(v) => setMaterialUnit(v as "g" | "kg")}
              value={materialUsed}
              onChange={setMaterialUsed}
              placeholder="120"
            />

            <Field
              label="Tamanho do Carretel"
              required
              suffix="g"
              suffixOptions={["g", "kg"]}
              suffixValue={totalWeightUnit}
              onSuffixChange={(v) => setTotalWeightUnit(v as "g" | "kg")}
              value={totalWeight}
              onChange={setTotalWeight}
              placeholder="1000"
            />

            <Field
              label="Preço do Carretel"
              required
              prefix="R$"
              value={materialPrice}
              onChange={(v) => setMaterialPrice(formatCurrencyInput(v, 3))}
              placeholder="89,90"
              isCurrencyField
            />

            <Field
              label="Horas de impressão"
              suffix="h"
              value={printingHours}
              onChange={setPrintingHours}
              placeholder="1"
            />

            <Field
              label="Minutos de impressão"
              suffix="min"
              value={printingMinutes}
              onChange={setPrintingMinutes}
              placeholder="30"
              numericOnly
              maxLength={2}
              max={59}
            />

            <Field
              label="Margem desejada"
              required
              suffix="%"
              value={margin}
              onChange={setMargin}
              placeholder="30"
            />
          </div>

          <p className="mt-5 text-xs text-black/40">
            <span className="text-[#BA4A00]">*</span>{" "}Campos obrigatórios para o cálculo
          </p>
        </div>

        {/* ── Result sidebar ── */}
        <aside className="h-fit rounded-[8px] border border-black/10 bg-black p-5 text-white shadow-2xl lg:sticky lg:top-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/50">Resultado</p>

          <div className="mt-6 grid gap-4">
            <BigNumber label="Custo" value={hasResult ? money(result.custoTotal) : "—"} />

            <div
              className={`rounded-[8px] p-5 shadow-lg transition-all duration-300 ${
                hasResult ? "bg-[#5852FF] shadow-[#5852FF]/30" : "bg-white/5 shadow-none"
              }`}
            >
              <p className="text-sm font-bold text-white/70">Preço Final</p>
              <strong
                className={`mt-2 block text-4xl font-black transition-opacity duration-300 ${
                  !hasResult ? "opacity-30" : ""
                }`}
              >
                {hasResult ? money(result.precoFinal) : "—"}
              </strong>
            </div>

            <BigNumber
              label="Lucro"
              value={hasResult ? money(result.lucro) : "—"}
              accent={hasResult}
            />
          </div>

          {/* Details breakdown */}
          <div className="mt-6 space-y-2.5 rounded-[8px] border border-white/10 p-4 text-sm">
            <div className="flex items-center justify-between text-white/70">
              <span>Material</span>
              <strong className={`transition-opacity ${hasResult ? "text-white opacity-100" : "opacity-30"}`}>
                {hasResult ? money(result.custoMaterial) : "—"}
              </strong>
            </div>

            {result.custoPorGrama > 0 && (
              <div className="flex items-center justify-between text-white/70">
                <span>Custo / grama</span>
                <strong className="text-white">
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  }).format(result.custoPorGrama)}
                </strong>
              </div>
            )}

            {result.totalPrintingMinutes > 0 && (
              <div className="flex items-center justify-between text-white/70">
                <span>Tempo total</span>
                <strong className="text-white">
                  {Math.floor(result.totalPrintingMinutes / 60)}h{" "}
                  {result.totalPrintingMinutes % 60}min
                </strong>
              </div>
            )}
          </div>

          {!hasResult && (
            <p className="mt-4 text-center text-xs text-white/30">
              Preencha os campos obrigatórios para ver o resultado
            </p>
          )}
        </aside>
      </section>
      <Footer />
    </main>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

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
  required,
  isCurrencyField,
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
  required?: boolean;
  /** When true: accepts ',' as decimal (pt-BR currency format). Otherwise: '.' only. */
  isCurrencyField?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 text-sm font-bold text-black">
        {label}
        {required && <span className="text-[#BA4A00]">*</span>}
      </span>
      <span className="flex h-12 items-center rounded-[8px] border border-black/15 bg-[#F9FAFB] px-3 transition focus-within:border-[#5852FF] focus-within:ring-4 focus-within:ring-[#5852FF]/10">
        {prefix && (
          <span className="mr-2 text-sm font-bold text-black/45">{prefix}</span>
        )}
        <input
          value={value}
          inputMode="decimal"
          onChange={(e) => {
            let v = e.target.value;

            if (numericOnly) {
              // Integer-only: digits only
              v = v.replace(/\D/g, "");
            } else if (isCurrencyField) {
              // Currency: allow digits, comma, and dot
              v = v.replace(/[^\d.,]/g, "");
            } else {
              // Plain numeric: digits and a single '.' (decimal separator)
              v = v.replace(/[^\d.]/g, "");
              const parts = v.split(".");
              if (parts.length > 2) {
                v = parts[0] + "." + parts.slice(1).join("");
              }
            }

            if (maxLength) v = v.slice(0, maxLength);

            if (max !== undefined && v !== "") {
              const n = Number(v);
              if (n > max) v = String(max);
            }

            onChange(v);
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-black/35"
        />
        {suffixOptions ? (
          <select
            value={suffixValue}
            onChange={(e) => onSuffixChange?.(e.target.value)}
            className="ml-2 cursor-pointer bg-transparent text-sm font-bold text-black/45 outline-none"
          >
            {suffixOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          suffix && (
            <span className="ml-2 text-sm font-bold text-black/45">{suffix}</span>
          )
        )}
      </span>
    </label>
  );
}

// ─── BigNumber ────────────────────────────────────────────────────────────────

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
      <p className={`text-sm font-bold ${accent ? "text-[#FF4E26]" : "text-white/55"}`}>
        {label}
      </p>
      <strong className="mt-2 block text-3xl font-black">{value}</strong>
    </div>
  );
}
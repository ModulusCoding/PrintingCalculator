"use client";

import { useMemo, useState } from "react";

type MachineMode = "manual" | "automatic";

type PackagingItem = {
  id: number;
  name: string;
  value: string;
};

type Step = {
  title: string;
  eyebrow: string;
  description: string;
};

const steps: Step[] = [
  {
    title: "Material",
    eyebrow: "Etapa 1",
    description: "Calcule o custo real do filamento, resina ou outro insumo usado na peça.",
  },
  {
    title: "Energia",
    eyebrow: "Etapa 2",
    description: "Inclua o consumo da impressora durante todo o tempo de impressão.",
  },
  {
    title: "Tempo de Máquina",
    eyebrow: "Etapa 3",
    description: "Defina quanto a impressora deve recuperar por hora de uso.",
  },
  {
    title: "Acabamento",
    eyebrow: "Etapa 4",
    description: "Some acabamento fixo e mão de obra para limpeza, pintura ou montagem.",
  },
  {
    title: "Embalagem",
    eyebrow: "Etapa 5",
    description: "Monte uma lista com todos os itens usados para entregar a peça.",
  },
  {
    title: "Impostos",
    eyebrow: "Etapa 6",
    description: "Aplique a alíquota sobre o subtotal operacional.",
  },
  {
    title: "Resultado",
    eyebrow: "Etapa 7",
    description: "Veja o custo detalhado e três sugestões de venda com margem.",
  },
];

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const emptyPackagingItem = (id: number): PackagingItem => ({
  id,
  name: "",
  value: "",
});

const toNumber = (value: string) => {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value: number) => currencyFormatter.format(value || 0);

export default function CalculatorPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [attemptedSteps, setAttemptedSteps] = useState<number[]>([]);
  const [quantityUsed, setQuantityUsed] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [materialPrice, setMaterialPrice] = useState("");
  const [printerConsumption, setPrinterConsumption] = useState("");
  const [printingHours, setPrintingHours] = useState("");
  const [kwhValue, setKwhValue] = useState("");
  const [machineMode, setMachineMode] = useState<MachineMode>("manual");
  const [machineHourValue, setMachineHourValue] = useState("");
  const [printerValue, setPrinterValue] = useState("");
  const [printerLifeHours, setPrinterLifeHours] = useState("");
  const [finishFixedValue, setFinishFixedValue] = useState("");
  const [finishHours, setFinishHours] = useState("");
  const [finishHourValue, setFinishHourValue] = useState("");
  const [packagingItems, setPackagingItems] = useState<PackagingItem[]>([
    { id: 1, name: "Caixa", value: "" },
    { id: 2, name: "Etiqueta", value: "" },
    { id: 3, name: "Plastico bolha", value: "" },
  ]);
  const [taxPercent, setTaxPercent] = useState("");

  const values = useMemo(() => {
    const quantidadeUtilizada = toNumber(quantityUsed);
    const pesoTotalAdquirido = toNumber(totalWeight);
    const precoMaterial = toNumber(materialPrice);
    const consumoWatts = toNumber(printerConsumption);
    const horasImpressao = toNumber(printingHours);
    const valorKwh = toNumber(kwhValue);
    const valorHoraManual = toNumber(machineHourValue);
    const valorImpressora = toNumber(printerValue);
    const vidaUtilHoras = toNumber(printerLifeHours);
    const valorFixoAcabamento = toNumber(finishFixedValue);
    const horasAcabamento = toNumber(finishHours);
    const valorHoraAcabamento = toNumber(finishHourValue);
    const percentualImposto = toNumber(taxPercent);

    const custoPorGrama =
      pesoTotalAdquirido > 0 ? precoMaterial / pesoTotalAdquirido : 0;
    const custoMaterial = quantidadeUtilizada * custoPorGrama;
    const consumoKW = consumoWatts / 1000;
    const custoEnergia = consumoKW * horasImpressao * valorKwh;
    const valorHoraMaquina =
      machineMode === "automatic"
        ? vidaUtilHoras > 0
          ? valorImpressora / vidaUtilHoras
          : 0
        : valorHoraManual;
    const custoMaquina = horasImpressao * valorHoraMaquina;
    const custoAcabamento =
      valorFixoAcabamento + horasAcabamento * valorHoraAcabamento;
    const custoEmbalagem = packagingItems.reduce(
      (total, item) => total + toNumber(item.value),
      0,
    );
    const subtotal =
      custoMaterial +
      custoEnergia +
      custoMaquina +
      custoAcabamento +
      custoEmbalagem;
    const custoImpostos = subtotal * (percentualImposto / 100);
    const custoTotal = subtotal + custoImpostos;

    return {
      custoPorGrama,
      custoMaterial,
      custoEnergia,
      valorHoraMaquina,
      custoMaquina,
      custoAcabamento,
      custoEmbalagem,
      subtotal,
      custoImpostos,
      custoTotal,
      precoEconomico: custoTotal * 1.3,
      precoProfissional: custoTotal * 1.5,
      precoPremium: custoTotal * 1.8,
    };
  }, [
    finishFixedValue,
    finishHourValue,
    finishHours,
    kwhValue,
    machineHourValue,
    machineMode,
    materialPrice,
    packagingItems,
    printerConsumption,
    printerLifeHours,
    printerValue,
    printingHours,
    quantityUsed,
    taxPercent,
    totalWeight,
  ]);

  const stepErrors = useMemo(() => {
    const required = (value: string) => toNumber(value) > 0;

    return [
      !required(quantityUsed) || !required(totalWeight) || !required(materialPrice),
      !required(printerConsumption) || !required(printingHours) || !required(kwhValue),
      machineMode === "manual"
        ? !required(machineHourValue)
        : !required(printerValue) || !required(printerLifeHours),
      toNumber(finishFixedValue) < 0 ||
        toNumber(finishHours) < 0 ||
        toNumber(finishHourValue) < 0,
      packagingItems.some((item) => item.name.trim() && toNumber(item.value) <= 0),
      taxPercent.trim() === "" || toNumber(taxPercent) < 0,
      false,
    ];
  }, [
    finishFixedValue,
    finishHourValue,
    finishHours,
    kwhValue,
    machineHourValue,
    machineMode,
    materialPrice,
    packagingItems,
    printerConsumption,
    printerLifeHours,
    printerValue,
    printingHours,
    quantityUsed,
    taxPercent,
    totalWeight,
  ]);

  const progress = ((currentStep + 1) / steps.length) * 100;
  const current = steps[currentStep];

  const goNext = () => {
    if (stepErrors[currentStep]) {
      setAttemptedSteps((previous) =>
        previous.includes(currentStep) ? previous : [...previous, currentStep],
      );
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  };

  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
  };

  const updatePackagingItem = (
    id: number,
    field: keyof Omit<PackagingItem, "id">,
    value: string,
  ) => {
    setPackagingItems((items) =>
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const addPackagingItem = () => {
    setPackagingItems((items) => [
      ...items,
      emptyPackagingItem(Date.now()),
    ]);
  };

  const removePackagingItem = (id: number) => {
    setPackagingItems((items) =>
      items.length === 1 ? items : items.filter((item) => item.id !== id),
    );
  };

  const showError = attemptedSteps.includes(currentStep) && stepErrors[currentStep];

  return (
    <main className="min-h-screen bg-[#F9FAFB] text-[#000000]">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="rounded-[8px] border border-black/10 bg-white px-5 py-6 shadow-sm sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#BA4A00]">
                Calculadora publica
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-black sm:text-4xl lg:text-5xl">
                Precificacao para impressao 3D
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
                Material + Energia + Tempo de Maquina + Acabamento + Embalagem +
                Impostos + Margem = Preco Final
              </p>
            </div>

            <div className="rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-4 py-3 text-sm text-black/75">
              <span className="block font-semibold text-[#5852FF]">
                {formatCurrency(values.custoTotal)}
              </span>
              custo total estimado
            </div>
          </div>
        </header>

        <div className="rounded-[8px] border border-black/10 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-4 text-sm">
            <span className="font-semibold text-[#5852FF]">
              {current.eyebrow} de {steps.length}
            </span>
            <span className="text-black/60">{Math.round(progress)}% concluido</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-[#5852FF] transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {steps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                onClick={() => goToStep(index)}
                className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold transition ${
                  index === currentStep
                    ? "border-[#5852FF] bg-[#5852FF] text-white shadow-sm"
                    : "border-black/10 bg-[#F9FAFB] text-black/70 hover:border-[#5852FF]/50 hover:text-[#5852FF]"
                }`}
              >
                <span className="block text-[11px] opacity-70">{index + 1}</span>
                {step.title}
              </button>
            ))}
          </nav>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm transition-all duration-300 sm:p-7">
            <div className="mb-6 flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">
                {current.eyebrow}
              </p>
              <h2 className="text-2xl font-semibold text-black sm:text-3xl">
                {current.title}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-black/65">
                {current.description}
              </p>
            </div>

            {currentStep === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Quantidade utilizada"
                  hint="Quantidade utilizada em gramas."
                  suffix="g"
                  value={quantityUsed}
                  onChange={setQuantityUsed}
                  placeholder="120"
                  required
                />
                <NumberField
                  label="Peso total adquirido"
                  hint="Peso total comprado do material, como 1000, 3000 ou 5000 g."
                  suffix="g"
                  value={totalWeight}
                  onChange={setTotalWeight}
                  placeholder="1000"
                  required
                />
                <NumberField
                  label="Preco pago pelo material"
                  hint="Valor total pago pelo rolo, frasco ou lote."
                  prefix="R$"
                  value={materialPrice}
                  onChange={setMaterialPrice}
                  placeholder="89,90"
                  required
                />
                <MetricCard
                  label="Custo por grama"
                  value={formatCurrency(values.custoPorGrama)}
                  helper="Preco do material dividido pelo peso total adquirido."
                />
              </div>
            )}

            {currentStep === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Consumo medio da impressora"
                  hint="Potencia media durante a impressao, em Watts."
                  suffix="W"
                  value={printerConsumption}
                  onChange={setPrinterConsumption}
                  placeholder="120"
                  required
                />
                <NumberField
                  label="Tempo de impressao"
                  hint="Tempo total de impressao em horas."
                  suffix="h"
                  value={printingHours}
                  onChange={setPrintingHours}
                  placeholder="8"
                  required
                />
                <NumberField
                  label="Valor do kWh"
                  hint="Valor cobrado por kWh na sua conta de energia."
                  prefix="R$"
                  value={kwhValue}
                  onChange={setKwhValue}
                  placeholder="0,95"
                  required
                />
                <MetricCard
                  label="Custo de energia"
                  value={formatCurrency(values.custoEnergia)}
                  helper="Consumo em kW multiplicado pelas horas e pelo valor do kWh."
                />
              </div>
            )}

            {currentStep === 2 && (
              <div className="flex flex-col gap-5">
                <div className="grid rounded-[8px] border border-black/10 bg-[#F9FAFB] p-1 sm:w-fit sm:grid-cols-2">
                  {(["manual", "automatic"] as MachineMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setMachineMode(mode)}
                      className={`rounded-[6px] px-4 py-2 text-sm font-semibold transition ${
                        machineMode === mode
                          ? "bg-[#5852FF] text-white shadow-sm"
                          : "text-black/65 hover:text-[#5852FF]"
                      }`}
                    >
                      {mode === "manual" ? "Manual" : "Automatico"}
                    </button>
                  ))}
                </div>

                {machineMode === "manual" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Valor por hora da maquina"
                      hint="Quanto a impressora deve cobrar por hora de uso."
                      prefix="R$"
                      value={machineHourValue}
                      onChange={setMachineHourValue}
                      placeholder="5,00"
                      required
                    />
                    <MetricCard
                      label="Custo de maquina"
                      value={formatCurrency(values.custoMaquina)}
                      helper="Tempo de impressao multiplicado pelo valor por hora."
                    />
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Valor da impressora"
                      hint="Preco pago pela impressora ou valor de reposicao."
                      prefix="R$"
                      value={printerValue}
                      onChange={setPrinterValue}
                      placeholder="2500,00"
                      required
                    />
                    <NumberField
                      label="Vida util estimada"
                      hint="Vida util esperada da maquina, em horas."
                      suffix="h"
                      value={printerLifeHours}
                      onChange={setPrinterLifeHours}
                      placeholder="5000"
                      required
                    />
                    <MetricCard
                      label="Valor calculado por hora"
                      value={formatCurrency(values.valorHoraMaquina)}
                      helper="Valor da impressora dividido pela vida util estimada."
                    />
                    <MetricCard
                      label="Custo de maquina"
                      value={formatCurrency(values.custoMaquina)}
                      helper="Valor por hora calculado multiplicado pelo tempo de impressao."
                    />
                  </div>
                )}
              </div>
            )}

            {currentStep === 3 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Valor fixo de acabamento"
                  hint="Materiais e custos fixos de acabamento."
                  prefix="R$"
                  value={finishFixedValue}
                  onChange={setFinishFixedValue}
                  placeholder="8,00"
                />
                <NumberField
                  label="Horas de acabamento"
                  hint="Tempo gasto em pos-processamento."
                  suffix="h"
                  value={finishHours}
                  onChange={setFinishHours}
                  placeholder="1,5"
                />
                <NumberField
                  label="Valor por hora"
                  hint="Valor da sua mao de obra por hora."
                  prefix="R$"
                  value={finishHourValue}
                  onChange={setFinishHourValue}
                  placeholder="35,00"
                />
                <MetricCard
                  label="Custo de acabamento"
                  value={formatCurrency(values.custoAcabamento)}
                  helper="Valor fixo mais horas de acabamento vezes valor por hora."
                />
              </div>
            )}

            {currentStep === 4 && (
              <div className="flex flex-col gap-4">
                {packagingItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-[8px] border border-black/10 bg-[#F9FAFB] p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end"
                  >
                    <TextField
                      label="Nome"
                      hint="Item de embalagem, como caixa, etiqueta, plastico bolha ou manual."
                      value={item.name}
                      onChange={(value) => updatePackagingItem(item.id, "name", value)}
                      placeholder="Caixa"
                    />
                    <NumberField
                      label="Valor"
                      hint="Custo deste item."
                      prefix="R$"
                      value={item.value}
                      onChange={(value) => updatePackagingItem(item.id, "value", value)}
                      placeholder="3,50"
                    />
                    <button
                      type="button"
                      onClick={() => removePackagingItem(item.id)}
                      className="h-11 rounded-[8px] border border-[#BA4A00]/30 px-4 text-sm font-semibold text-[#BA4A00] transition hover:bg-[#BA4A00] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={packagingItems.length === 1}
                    >
                      Remover
                    </button>
                  </div>
                ))}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={addPackagingItem}
                    className="rounded-[8px] bg-[#5852FF] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4741e8]"
                  >
                    Adicionar item
                  </button>
                  <MetricCard
                    label="Custo de embalagem"
                    value={formatCurrency(values.custoEmbalagem)}
                    helper="Soma de todos os itens informados."
                    compact
                  />
                </div>
              </div>
            )}

            {currentStep === 5 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Percentual de impostos"
                  hint="Percentual aplicado sobre o subtotal sem margem."
                  suffix="%"
                  value={taxPercent}
                  onChange={setTaxPercent}
                  placeholder="6"
                  required
                />
                <MetricCard
                  label="Subtotal"
                  value={formatCurrency(values.subtotal)}
                  helper="Soma de material, energia, maquina, acabamento e embalagem."
                />
                <MetricCard
                  label="Impostos"
                  value={formatCurrency(values.custoImpostos)}
                  helper="Subtotal multiplicado pelo percentual de impostos."
                />
              </div>
            )}

            {currentStep === 6 && (
              <ResultView values={values} />
            )}

            {showError && (
              <div className="mt-6 rounded-[8px] border border-[#BA4A00]/30 bg-[#BA4A00]/10 px-4 py-3 text-sm font-medium text-[#8f3900]">
                Preencha os campos obrigatorios desta etapa antes de continuar.
              </div>
            )}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={goBack}
                disabled={currentStep === 0}
                className="rounded-[8px] border border-black/15 px-5 py-3 text-sm font-semibold text-black transition hover:border-[#5852FF] hover:text-[#5852FF] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Voltar
              </button>
              {currentStep < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-[8px] bg-[#5852FF] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4741e8]"
                >
                  Proxima etapa
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCurrentStep(0)}
                  className="rounded-[8px] bg-[#BA4A00] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#953b00]"
                >
                  Revisar calculo
                </button>
              )}
            </div>
          </div>

          <aside className="h-fit rounded-[8px] border border-black/10 bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <h3 className="text-base font-semibold text-black">Resumo ao vivo</h3>
            <p className="mt-1 text-sm text-black/60">
              Os valores sao recalculados no navegador a cada alteracao.
            </p>
            <div className="mt-5 space-y-3">
              <SummaryRow label="Material" value={values.custoMaterial} />
              <SummaryRow label="Energia" value={values.custoEnergia} />
              <SummaryRow label="Tempo de Maquina" value={values.custoMaquina} />
              <SummaryRow label="Acabamento" value={values.custoAcabamento} />
              <SummaryRow label="Embalagem" value={values.custoEmbalagem} />
              <SummaryRow label="Impostos" value={values.custoImpostos} />
            </div>
            <div className="mt-5 rounded-[8px] bg-black px-4 py-4 text-white">
              <span className="text-sm text-white/65">Custo total</span>
              <strong className="mt-1 block text-2xl">
                {formatCurrency(values.custoTotal)}
              </strong>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  required,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
        {label}
        {required && <span className="text-[#BA4A00]">*</span>}
        <Tooltip text={hint} />
      </span>
      <span className="flex h-12 items-center rounded-[8px] border border-black/15 bg-white px-3 transition focus-within:border-[#5852FF] focus-within:ring-4 focus-within:ring-[#5852FF]/10">
        {prefix && <span className="mr-2 text-sm font-semibold text-black/45">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d.,]/g, "");
            onChange(next);
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base text-black outline-none placeholder:text-black/35"
        />
        {suffix && <span className="ml-2 text-sm font-semibold text-black/45">{suffix}</span>}
      </span>
    </label>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-black">
        {label}
        <Tooltip text={hint} />
      </span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-[8px] border border-black/15 bg-white px-3 text-base text-black outline-none transition focus:border-[#5852FF] focus:ring-4 focus:ring-[#5852FF]/10 placeholder:text-black/35"
      />
    </label>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-black/15 bg-[#F9FAFB] text-xs font-bold text-black/55 outline-none transition hover:border-[#5852FF] hover:text-[#5852FF] focus:border-[#5852FF] focus:text-[#5852FF]"
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-7 z-10 w-56 -translate-x-1/2 rounded-[8px] border border-black/10 bg-black px-3 py-2 text-xs font-medium leading-5 text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  helper,
  compact,
}: {
  label: string;
  value: string;
  helper: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 ${
        compact ? "px-4 py-3" : "p-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-black">{label}</span>
        <Tooltip text={helper} />
      </div>
      <strong className="mt-2 block text-2xl font-semibold text-[#5852FF]">
        {value}
      </strong>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-black/10 pb-3 text-sm last:border-b-0 last:pb-0">
      <span className="text-black/65">{label}</span>
      <strong className="text-black">{formatCurrency(value)}</strong>
    </div>
  );
}

function ResultView({
  values,
}: {
  values: {
    custoMaterial: number;
    custoEnergia: number;
    custoMaquina: number;
    custoAcabamento: number;
    custoEmbalagem: number;
    custoImpostos: number;
    custoTotal: number;
    precoEconomico: number;
    precoProfissional: number;
    precoPremium: number;
  };
}) {
  const resultRows = [
    ["Material", values.custoMaterial],
    ["Energia", values.custoEnergia],
    ["Tempo de Maquina", values.custoMaquina],
    ["Acabamento", values.custoAcabamento],
    ["Embalagem", values.custoEmbalagem],
    ["Impostos", values.custoImpostos],
  ] as const;

  const priceCards = [
    {
      title: "Economico",
      margin: "30%",
      value: values.precoEconomico,
      className: "border-[#5852FF]/25 bg-[#5852FF]/5",
    },
    {
      title: "Profissional",
      margin: "50%",
      value: values.precoProfissional,
      className: "border-[#5852FF] bg-[#5852FF] text-white shadow-md",
    },
    {
      title: "Premium",
      margin: "80%",
      value: values.precoPremium,
      className: "border-[#BA4A00]/35 bg-[#BA4A00]/10",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-black/60">Custo total</p>
            <strong className="mt-1 block text-3xl font-semibold text-black">
              {formatCurrency(values.custoTotal)}
            </strong>
          </div>
          <span className="rounded-full bg-[#BA4A00]/10 px-3 py-1 text-sm font-semibold text-[#BA4A00]">
            antes da margem
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {resultRows.map(([label, value]) => (
            <SummaryRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-black">Sugestoes de preco</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {priceCards.map((card) => (
            <div
              key={card.title}
              className={`rounded-[8px] border p-5 shadow-sm ${card.className}`}
            >
              <p className="text-sm font-semibold opacity-75">{card.title}</p>
              <strong className="mt-3 block text-3xl font-semibold">
                {formatCurrency(card.value)}
              </strong>
              <span className="mt-3 inline-flex rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-black">
                Margem {card.margin}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

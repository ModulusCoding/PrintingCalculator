"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import printersData from "../../public/impressoras.json";
import Footer from "../components/Footer";
import Header from "../components/Header";

type MachineMode = "manual" | "automatic";

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
      consumo_W: {
        pico: number;
        medio: number;
      };
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

const steps: Step[] = [
  {
    title: "Material",
    eyebrow: "Etapa 1",
    description: (
      <>
        Calcule o <strong>custo real</strong> do filamento, resina ou outro insumo usado na peça.
      </>
    ),
    icon: "◐",
  },
  {
    title: "Energia",
    eyebrow: "Etapa 2",
    description: (
      <>
        Encontre sua impressora por <strong>nome ou marca</strong> e use o consumo médio em Watts, sem chute.
      </>
    ),
    icon: "⚡",
  },
  {
    title: "Tempo de Máquina",
    eyebrow: "Etapa 3",
    description: (
      <>
        Defina quanto a impressora precisa recuperar por hora para manter sua operação <em>saudável</em>.
      </>
    ),
    icon: "◷",
  },
  {
    title: "Acabamento",
    eyebrow: "Etapa 4",
    description: (
      <>
        Some acabamento fixo e mão de obra para que o detalhe final também entre no <strong>preço certo</strong>.
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
        Aplique a alíquota sobre o subtotal operacional e evite vender com margem <em>ilusória</em>.
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

const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const printerOptions: PrinterOption[] = (printersData as PrinterCatalog)
  .marcas_impressoras_3d.flatMap((brand) =>
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

export default function CalculatorPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [attemptedSteps, setAttemptedSteps] = useState<number[]>([]);
  const [pieceQuantity, setPieceQuantity] = useState("1");
  const [quantityUsed, setQuantityUsed] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [materialPrice, setMaterialPrice] = useState("");
  const [printerSearch, setPrinterSearch] = useState("");
  const [selectedPrinterId, setSelectedPrinterId] = useState("");
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
    const quantidadePecas = Math.max(1, toNumber(pieceQuantity) || 1);
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
    const custoMaterial = quantidadeUtilizada * custoPorGrama * quantidadePecas;
    const consumoKW = consumoWatts / 1000;
    const custoEnergia = consumoKW * horasImpressao * valorKwh * quantidadePecas;
    const valorHoraMaquina =
      machineMode === "automatic"
        ? vidaUtilHoras > 0
          ? valorImpressora / vidaUtilHoras
          : 0
        : valorHoraManual;
    const custoMaquina = horasImpressao * valorHoraMaquina * quantidadePecas;
    const custoAcabamento =
      (valorFixoAcabamento + horasAcabamento * valorHoraAcabamento) * quantidadePecas;
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
      quantidadePecas,
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
      !required(pieceQuantity) || !required(quantityUsed) || !required(totalWeight) || !required(materialPrice),
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
  const selectedPrinter = printerOptions.find(
    (printer) => printer.id === selectedPrinterId,
  );
  const filteredPrinters = useMemo(() => {
    const term = normalizeSearch(printerSearch.trim());

    if (!term) {
      return printerOptions.slice(0, 8);
    }

    return printerOptions
      .filter((printer) => printer.searchableText.includes(term))
      .slice(0, 8);
  }, [printerSearch]);

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

  const selectPrinter = (printer: PrinterOption) => {
    setSelectedPrinterId(printer.id);
    setPrinterSearch(`${printer.brand} ${printer.model}`);
    setPrinterConsumption(String(printer.averageConsumption));
  };

  const showError = attemptedSteps.includes(currentStep) && stepErrors[currentStep];

  return (
    
    <main className="min-h-screen bg-[#F9FAFB] text-[#000000]">
      <Header></Header>
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
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

            <div className="rounded-[8px] border border-[#5852FF]/20 bg-[#5852FF]/5 px-4 py-3 text-sm text-black/75">
              <span className="block font-semibold text-[#5852FF]">
                {formatCurrency(values.custoTotal)}
              </span>
              custo total estimado
            </div>
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
                className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold transition hover:-translate-y-0.5 ${
                  index === currentStep
                    ? "border-[#5852FF] bg-[#5852FF] text-white shadow-lg shadow-[#5852FF]/25"
                    : "border-black/10 bg-[#F9FAFB] text-black/70 hover:border-[#5852FF]/50 hover:bg-white hover:text-[#5852FF]"
                }`}
              >
                <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-[6px] bg-white/20 text-sm">
                  {step.icon}
                </span>
                {step.title}
              </button>
            ))}
          </nav>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5 transition-all duration-300 sm:p-7">
            <div className="mb-6 flex flex-col gap-2">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#BA4A00]">
                {current.eyebrow}
              </p>
              <h2 className="flex items-center gap-3 text-2xl font-semibold text-black sm:text-3xl">
                <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-xl text-[#5852FF]">
                  {current.icon}
                </span>
                <span>{current.title}</span>
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-black/65">
                {current.description}
              </p>
            </div>

            {currentStep === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Quantidade de peças"
                  hint="Número total de peças que serão produzidas ou vendidas."
                  suffix="peças"
                  value={pieceQuantity}
                  onChange={setPieceQuantity}
                  placeholder="1"
                  required
                />
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
              <div className="flex flex-col gap-5">
                <div className="rounded-[8px] border border-black/10 bg-[#F9FAFB] p-4">
                  <TextField
                    label="Buscar impressora"
                    hint="Digite a marca ou o modelo para encontrar o consumo médio cadastrado."
                    value={printerSearch}
                    onChange={(value) => {
                      setPrinterSearch(value);
                      setSelectedPrinterId("");
                    }}
                    placeholder="Bambu Lab A1, Ender 3, Prusa..."
                  />

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {filteredPrinters.map((printer) => (
                      <button
                        key={printer.id}
                        type="button"
                        onClick={() => selectPrinter(printer)}
                        className={`rounded-[8px] border p-3 text-left transition hover:-translate-y-0.5 hover:border-[#5852FF] hover:bg-white ${
                          selectedPrinterId === printer.id
                            ? "border-[#5852FF] bg-white shadow-sm shadow-[#5852FF]/20"
                            : "border-black/10 bg-white/70"
                        }`}
                      >
                        <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#BA4A00]">
                          {printer.brand}
                        </span>
                        <strong className="mt-1 block text-sm text-black">
                          {printer.model}
                        </strong>
                        <span className="mt-2 block text-xs text-black/60">
                          Médio: <strong>{printer.averageConsumption} W</strong> · Pico: {printer.peakConsumption} W
                        </span>
                      </button>
                    ))}
                  </div>

                  {filteredPrinters.length === 0 && (
                    <p className="mt-4 rounded-[8px] border border-[#BA4A00]/20 bg-[#BA4A00]/10 px-3 py-2 text-sm text-[#8f3900]">
                      Nenhum modelo encontrado. Use o campo manual de Watts abaixo para continuar o cálculo.
                    </p>
                  )}

                  {selectedPrinter && (
                    <p className="mt-4 text-sm leading-6 text-black/65">
                      Usando o consumo médio da <strong>{selectedPrinter.brand} {selectedPrinter.model}</strong>:{" "}
                      <strong>{selectedPrinter.averageConsumption} W</strong>.
                    </p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="Consumo médio usado no cálculo"
                    hint="Potência média durante a impressão, em Watts. Você pode ajustar manualmente."
                    suffix="W"
                    value={printerConsumption}
                    onChange={(value) => {
                      setPrinterConsumption(value);
                      setSelectedPrinterId("");
                    }}
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

          <aside className="h-fit rounded-[8px] border border-black/10 bg-white p-5 shadow-xl shadow-black/5 lg:sticky lg:top-6">
            <h3 className="text-base font-semibold text-black">Resumo ao vivo</h3>
            <p className="mt-1 text-sm text-black/60">
              Os valores sao recalculados <strong>em tempo real</strong> a cada alteracao.
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
      <Footer></Footer>
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
      badge: "entrada competitiva",
      className: "border-[#5852FF]/25 bg-[#5852FF]/5",
    },
    {
      title: "Profissional",
      margin: "50%",
      value: values.precoProfissional,
      badge: "recomendado",
      className:
        "scale-[1.02] border-[#5852FF] bg-gradient-to-br from-[#5852FF] to-black text-white shadow-2xl shadow-[#5852FF]/30",
    },
    {
      title: "Premium",
      margin: "80%",
      value: values.precoPremium,
      badge: "maior margem",
      className: "border-[#BA4A00]/35 bg-[#BA4A00]/10 shadow-lg shadow-[#BA4A00]/10",
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
              className={`rounded-[8px] border p-5 transition hover:-translate-y-1 ${card.className}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold opacity-75">{card.title}</p>
                <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                  {card.badge}
                </span>
              </div>
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

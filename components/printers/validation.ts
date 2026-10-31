// UI validation mirrors lib/printers/actions.ts; the server remains authoritative.
export const printerFields = {
  name: { label: "Nome interno", maxLength: 120, hint: "De 2 a 120 caracteres. Use um nome que identifique o equipamento." },
  brand: { label: "Marca", maxLength: 120, hint: "Opcional, até 120 caracteres." },
  model: { label: "Modelo", maxLength: 160, hint: "Opcional, até 160 caracteres." },
  purchasePrice: { label: "Valor de compra (R$)", min: 0, max: 1000000, scale: 2, hint: "De R$ 0,00 a R$ 1.000.000,00. Até 2 casas decimais." },
  estimatedLifeHours: { label: "Vida útil estimada (h)", min: 1, max: 100000, scale: 0, hint: "De 1 a 100.000 horas inteiras. Não é um contador de horas de uso." },
  averagePowerWatts: { label: "Potência média (W)", min: 0.01, max: 10000, scale: 2, hint: "De 0,01 a 10.000 W. Até 2 casas decimais." },
  maintenanceCostPerHour: { label: "Manutenção por hora (R$/h)", min: 0, max: 1000, scale: 4, hint: "De R$ 0,00 a R$ 1.000,00 por hora. Até 4 casas decimais." },
} as const;
export type PrinterField = keyof typeof printerFields;
export type PrinterFormData = Record<PrinterField, string>;
export function validatePrinterForm(data: PrinterFormData): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const key of Object.keys(printerFields) as PrinterField[]) {
    const spec = printerFields[key];
    const text = data[key].trim();
    if ("maxLength" in spec) {
      if (text.length > spec.maxLength || (key === "name" && text.length < 2)) errors[key] = [key === "name" ? "Informe um nome com 2 a 120 caracteres." : `Use até ${spec.maxLength} caracteres.`];
    } else {
      const pattern = spec.scale === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:,\\d{1,${spec.scale}})?$`);
      if (!text) errors[key] = ["Este campo é obrigatório."];
      else if (!pattern.test(text)) errors[key] = [spec.scale === 0 ? "Use somente dígitos inteiros." : `Use vírgula como separador, com até ${spec.scale} casas decimais, sem separador de milhar.`];
      else {
        const value = Number(text.replace(",", "."));
        if (!Number.isFinite(value) || value < spec.min || value > spec.max) errors[key] = ["Valor fora do limite. " + spec.hint];
      }
    }
  }
  return errors;
}

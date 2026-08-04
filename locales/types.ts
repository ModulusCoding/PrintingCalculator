import { ptBR } from "./pt-BR";

// pt-BR é a fonte da verdade: o tipo Dictionary é inferido a partir dele.
// Isso garante que en-US.tsx e es-ES.tsx só compilam se tiverem exatamente
// as mesmas chaves (nem a mais, nem a menos).
export type Dictionary = typeof ptBR;

export type Locale = "pt-BR" | "en-US" | "es-ES";

export const DEFAULT_LOCALE: Locale = "pt-BR";

export type LocaleOption = {
  code: Locale;
  label: string;
  flag: string;
};

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "es-ES", label: "Español (España)", flag: "🇪🇸" },
];
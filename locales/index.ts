import { ptBR } from "./pt-BR";
import { enUS } from "./en-US";
import { esES } from "./es-ES";
import type { Dictionary, Locale } from "./types";

export type { Dictionary, Locale, LocaleOption } from "./types";
export { DEFAULT_LOCALE, LOCALE_OPTIONS } from "./types";

export const dictionaries: Record<Locale, Dictionary> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": esES,
};

/**
 * Busca um valor dentro do dicionário usando uma chave com caminho por
 * pontos, ex: "common.languageNames". Retorna o próprio valor (string,
 * número ou ReactNode) — quem chama decide como usar o resultado.
 *
 * Se a chave não existir, devolve a própria chave (facilita notar chaves
 * erradas/esquecidas durante o desenvolvimento, sem quebrar a UI).
 */
export function resolveTranslation(dictionary: Dictionary, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = dictionary;

  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] Chave de tradução não encontrada: "${key}"`);
      }
      return key;
    }
  }

  return current;
}
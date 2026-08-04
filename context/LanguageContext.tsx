"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_OPTIONS,
  dictionaries,
  resolveTranslation,
  type Dictionary,
  type Locale,
} from "@/locales";

const STORAGE_KEY = "modulus_language";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dict: Dictionary;
  t: <T = string>(key: string) => T;
};

export const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLocale(value: string | null): value is Locale {
  return value !== null && LOCALE_OPTIONS.some((option) => option.code === value);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) {
        setLocaleState(stored);
      }
    } catch {
      // localStorage indisponível (ex: modo privado) — mantém o padrão.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Falha ao persistir não deve quebrar a troca de idioma.
    }
  }, []);

  const dict = dictionaries[locale];

  const t = useCallback(
    <T,>(key: string): T => resolveTranslation(dict, key) as T,
    [dict]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, dict, t }),
    [locale, setLocale, dict, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
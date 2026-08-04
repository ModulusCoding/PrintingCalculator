"use client";

import { useContext } from "react";
import { LanguageContext } from "@/context/LanguageContext";

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage precisa ser usado dentro de um LanguageProvider");
  }

  return context;
}
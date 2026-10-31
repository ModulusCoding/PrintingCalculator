"use client";
import { useState, type ReactNode } from "react";

export default function PricingComparison({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><div className="ml-pricing-under ml-reveal"><span>✓ Seus dados permanecem preservados ao mudar de plano.</span><button className="ml-text-button" aria-expanded={open} aria-controls="detailed-comparison" onClick={() => setOpen(!open)}>{open ? "Fechar comparação" : "Comparar todos os recursos"} <span>{open ? "−" : "＋"}</span></button></div><div id="detailed-comparison" className={open ? "ml-panel-in" : undefined} hidden={!open}>{children}</div></>;
}

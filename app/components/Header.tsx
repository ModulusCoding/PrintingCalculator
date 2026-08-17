"use client";

import Link from "next/link";
import { useState } from "react";

const sectionLinks = [
  { label: "Modulus", href: "/#modulus" },
  { label: "Como funciona", href: "/#como-funciona" },
  { label: "Redes", href: "/#redes" },
];

const calculators = [
  {
    icon: "⚡",
    title: "Fast Calculator",
    href: "/fastCalculator",
    description:
      "Faça um orçamento em segundos utilizando apenas os dados mais importantes. Ideal para estimativas rapidas.",
  },
  {
    icon: "🧮",
    title: "Professional Calculator",
    href: "/calculator",
    description:
      "Calcule todos os custos da sua impressão 3D incluindo energia, acabamento, embalagem e impostos.",
  },
  {
    icon: "🏪",
    title: "Marketplace Calculator",
    href: "/marketplaceCalculator",
    description:
      "Descubra o preço ideal para vender em marketplaces considerando taxas, comissões e custos adicionais.",
  },
];

export default function Header() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#F9FAFB]/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-[10px] border border-black/10 bg-white/85 px-4 py-3 shadow-sm">
          <Link href="/" className="flex min-w-0 items-center gap-2">
           <div>
            <img className="h-12" src="../logo_Horizontal.svg" alt="Logo Modulus" ></img>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Navegacao principal">
            {sectionLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[6px] px-3.5 py-2 text-sm font-semibold text-black/60 transition hover:bg-[var(--modulus-primary)]/10 hover:text-[var(--modulus-primary)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="rounded-[8px] bg-[var(--modulus-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-[var(--modulus-primary)]/20 transition hover:-translate-y-0.5 hover:bg-[var(--modulus-primary)] sm:px-5"
          >
            Calculadoras
          </button>
        </div>
      </header>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calculator-modal-title"
        >
          <div className="max-h-[calc(100vh-48px)] w-full max-w-5xl overflow-y-auto rounded-[16px] border border-white/20 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#FF4E26]">
                  <span className="h-px w-5 bg-[#FF4E26]" />
                  Escolha seu fluxo
                </p>
                <h2 id="calculator-modal-title" className="mt-2 text-3xl font-black">
                  Calculadoras Modulus
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-black/10 text-black/50 transition hover:bg-black hover:text-white"
                aria-label="Fechar modal"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {calculators.map((calculator) => (
                <article
                  key={calculator.href}
                  className="group rounded-[12px] border border-black/10 bg-[#F9FAFB] p-5 shadow-sm transition hover:-translate-y-1 hover:border-[var(--modulus-primary)]/20 hover:shadow-md"
                >
                  <span className="text-4xl">{calculator.icon}</span>
                  <h3 className="mt-5 text-xl font-bold">{calculator.title}</h3>
                  <p className="mt-3 min-h-[88px] text-sm leading-6 text-black/60">
                    {calculator.description}
                  </p>
                  <Link
                    href={calculator.href}
                    onClick={() => setIsModalOpen(false)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--modulus-primary)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--modulus-primary)]"
                  >
                    Abrir calculadora
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

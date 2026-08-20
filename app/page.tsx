"use client";

import Link from "next/link";
import { useState } from "react";
import Footer from "./components/Footer";
import Header from "./components/Header";
import CinematicJourney from "./components/landing/CinematicJourney";
import WorldsSplit from "./components/landing/WorldsSplit";
import Positioning from "./components/landing/Positioning";
import FinalCta from "./components/landing/FinalCta";

const calculators = [
  {
    icon: "⚡",
    title: "Fast Calculator",
    href: "/fastCalculator",
    description:
      "Faça um Orçamento em segundos utilizando apenas os dados mais importantes. Ideal para estimativas rapidas.",
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

const socialLinks = [
  {
    name: "TikTok",
    handle: "@modulus.studios",
    href: "https://www.tiktok.com/@modulus.studios?_r=1&_t=zs-95u3cwvuqep",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.78 1.52V6.79a4.85 4.85 0 0 1-1.01-.1z" />
      </svg>
    ),
  },
  {
    name: "Instagram",
    handle: "@modulus.studios",
    href: "https://www.instagram.com/modulus.studios?igsh=Zno4cTY2cG51aXR0&utm_source=qr",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    ),
  },
  {
    name: "WhatsApp",
    handle: "+55 (11) 91200-0753",
    href: "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    ),
  },
];

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen overflow-x-clip bg-[var(--modulus-dark)] text-black">
      <div className="sticky top-0 z-40">
        <Header></Header>
      </div>

      {/* ── JORNADA: 01 a 05 (descoberta → manufatura digital) ── */}
      <CinematicJourney />

      {/* ── DOIS MUNDOS: criar / viver ── */}
      <WorldsSplit onOpenCalculators={() => setIsModalOpen(true)} />

      {/* ── POSICIONAMENTO ── */}
      <Positioning />

      {/* ── REDES ── */}
      <section id="redes" className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col gap-2 border-t border-black/10 pt-10">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--modulus-accent)]">
              <span className="h-px w-6 bg-[var(--modulus-accent)]" />
              Comunidade
            </p>
            <h2 className="text-3xl font-black">Acompanhe a Modulus</h2>
          </div>

          <div className="flex flex-col divide-y divide-black/8 border-y border-black/8">
            {socialLinks.map(({ name, handle, href, icon }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-4 py-5 transition hover:pl-2"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-black/50 transition group-hover:border-[var(--modulus-primary)]/30 group-hover:text-[var(--modulus-primary)]">
                    {icon}
                  </span>
                  <div>
                    <p className="text-base font-bold">{name}</p>
                    <p className="text-sm text-black/45">{handle}</p>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black/30 transition group-hover:translate-x-1 group-hover:text-[var(--modulus-primary)]">
                  <path d="M7 17L17 7M17 7H7M17 7V17" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL: solicitar projeto ── */}
      <FinalCta />

      {/* ── FOOTER ── */}
      <Footer></Footer>

      {/* ── MODAL: calculadoras (caminho maker) ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-[16px] border border-white/20 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--modulus-accent)]">
                  <span className="h-px w-5 bg-[var(--modulus-accent)]" />
                  Escolha seu fluxo
                </p>
                <h2 className="mt-2 text-3xl font-black">Calculadoras Modulus</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-black/10 text-black/50 transition hover:bg-black hover:text-white"
                aria-label="Fechar modal"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {calculators.map((calculator) => (
                <article
                  key={calculator.href}
                  className="group rounded-[12px] border border-black/10 bg-[#F9FAFB] p-5 shadow-sm transition hover:border-[var(--modulus-primary)]/20 hover:shadow-md"
                >
                  <span className="text-4xl">{calculator.icon}</span>
                  <h3 className="mt-5 text-xl font-bold">{calculator.title}</h3>
                  <p className="mt-3 min-h-[88px] text-sm leading-6 text-black/60">{calculator.description}</p>
                  <Link
                    href={calculator.href}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--modulus-primary)] px-5 py-3 text-sm font-bold text-white transition hover:opacity-90"
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
    </main>
  );
}

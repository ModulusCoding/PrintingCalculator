"use client";

import Link from "next/link";
import { useState } from "react";
import Footer from "./components/Footer";
import Header from "./components/Header";
const calculators = [
  {
    icon: "⚡",
    title: "Fast Calculator",
    href: "/fastCalculator",
    description:
      "Faca um orcamento em segundos utilizando apenas os dados mais importantes. Ideal para estimativas rapidas.",
  },
  {
    icon: "🧮",
    title: "Professional Calculator",
    href: "/calculator",
    description:
      "Calcule todos os custos da sua impressao 3D incluindo energia, acabamento, embalagem e impostos.",
  },
  {
    icon: "🏪",
    title: "Marketplace Calculator",
    href: "/marketplaceCalculator",
    description:
      "Descubra o preco ideal para vender em marketplaces considerando taxas, comissoes e custos adicionais.",
  },
];

const modulusBlocks = [
  {
    title: "Missao",
    text: "Precisao, processos claros e tomada de decisao orientada por dados para quem fabrica com seriedade.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
      </svg>
    ),
  },
  {
    title: "Visao",
    text: "Construir uma camada inteligente para negocios de fabricacao digital que crescem com margem, nao no escuro.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    title: "Diferenciais",
    text: "Fluxos simples, calculos transparentes e experiencia pronta para producao — sem planilha, sem suposicao.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    title: "Tecnologia",
    text: "Interfaces responsivas, calculos no navegador e design de produto SaaS pensado para makers reais.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

const socialLinks = [
  {
    name: "TikTok",
    handle: "@modulus.studios",
    description: "Conteudos curtos sobre impressao 3D, precificacao e bastidores de fabricacao.",
    href: "https://www.tiktok.com/@modulus.studios?_r=1&_t=zs-95u3cwvuqep",
    stat: "videos",
    color: "from-[#010101] to-[#69C9D0]",
    textColor: "text-white",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.78 1.52V6.79a4.85 4.85 0 0 1-1.01-.1z" />
      </svg>
    ),
    
  },
  {
    name: "Instagram",
    handle: "@modulus.studios",
    description: "Projetos, dicas visuais e novidades da Modulus para makers e empreendedores.",
    href: "https://www.instagram.com/modulus.studios?igsh=Zno4cTY2cG51aXR0&utm_source=qr",
    stat: "posts",
    color: "from-[#f09433] via-[#e6683c] via-[#dc2743] via-[#cc2366] to-[#bc1888]",
    textColor: "text-white",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    ),
    
  },
  {
    name: "WhatsApp",
    handle: "+55 (11) 91200-0753",
    description: "Canal direto para conversas, suporte comercial e proximos lancamentos da plataforma.",
    href: "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A",
    stat: "chat",
    color: "from-[#25D366] to-[#128C7E]",
    textColor: "text-white",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
      </svg>
    ),
    
  },
];

const steps = [
  {
    number: "01",
    title: "Escolha sua calculadora",
    text: "Selecione o fluxo certo para estimativa rapida, precificacao completa ou marketplace.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Informe os dados",
    text: "Preencha material, horas, custos e percentuais com atualizacao em tempo real.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Receba seu preco ideal",
    text: "Visualize custo, lucro e preco final com uma leitura simples e pronta para vender.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
];

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="min-h-screen overflow-hidden bg-[#F9FAFB] text-black">
      {/* ── HERO ── */}
      <section className="relative min-h-screen px-4 py-5 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(88,82,255,0.18),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(186,74,0,0.12),transparent_28%),linear-gradient(135deg,#ffffff_0%,#f9fafb_52%,rgba(88,82,255,0.06)_100%)]" />

        {/* Decorative shapes */}
        <div className="absolute left-8 top-28 hidden h-24 w-24 rotate-12 rounded-[12px] border border-[#5852FF]/20 bg-white/60 shadow-xl backdrop-blur md:block" />
        <div className="absolute bottom-20 right-10 hidden h-32 w-32 rounded-full border border-[#BA4A00]/20 bg-[#BA4A00]/10 blur-[1px] lg:block" />
        <div className="absolute right-32 top-40 hidden h-8 w-8 rounded-full bg-[#5852FF]/15 lg:block" />
        <div className="absolute bottom-40 left-1/3 hidden h-5 w-5 rotate-45 border border-[#5852FF]/20 bg-transparent lg:block" />

        <div className="relative mx-auto flex min-h-[calc(100vh-40px)] max-w-7xl flex-col">
          {/* Nav */}
          <Header></Header>

          {/* Hero content */}
          <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1fr_500px]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#5852FF]/20 bg-white/80 px-4 py-2 text-sm font-semibold text-[#5852FF] shadow-sm">
                <span className="flex h-2 w-2 rounded-full bg-[#5852FF]" />
                Precificacao inteligente para fabricacao digital
              </div>
              <h1 className="mt-7 text-5xl font-black leading-[0.96] tracking-tight text-black sm:text-6xl lg:text-[72px]">
                Modulus<br />
                <span className="text-[#5852FF]">3D</span> Calculator
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-black/60">
                Uma plataforma moderna para makers, studios e negocios digitais
                precificarem impressao 3D com velocidade, clareza e margem real.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className="flex items-center justify-center gap-2 rounded-[10px] bg-[#5852FF] px-7 py-4 text-base font-bold text-white shadow-lg shadow-[#5852FF]/25 transition hover:-translate-y-0.5 hover:bg-[#4741e8]"
                >
                  Escolher Calculadora
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
                <a
                  href="#como-funciona"
                  className="flex items-center justify-center gap-2 rounded-[10px] border border-black/15 px-7 py-4 text-base font-bold text-black/70 transition hover:border-[#5852FF]/40 hover:text-[#5852FF]"
                >
                  Como funciona
                </a>
              </div>

              {/* Trust pills */}
              <div className="mt-10 flex flex-wrap gap-3">
                {["Sem planilha", "Calculos em tempo real", "100% no navegador"].map((pill) => (
                  <span key={pill} className="flex items-center gap-1.5 rounded-full bg-white border border-black/10 px-3.5 py-1.5 text-xs font-semibold text-black/55 shadow-sm">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5852FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            {/* Hero card */}
            <div className="relative min-h-[540px]">
              {/* Main card */}
              <div className="absolute inset-x-4 top-8 rounded-[14px] border border-black/10 bg-white p-5 shadow-2xl shadow-[#5852FF]/10">
                <div className="flex items-center justify-between border-b border-black/8 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-black/40">Simulacao ativa</p>
                    <strong className="mt-0.5 block text-xl font-black">Drone mount PLA+</strong>
                  </div>
                  <span className="rounded-full bg-[#5852FF]/10 px-3 py-1.5 text-xs font-bold text-[#5852FF]">
                    3D Print
                  </span>
                </div>
                <div className="mt-5 grid gap-3">
                  {[
                    { label: "Material", value: "R$ 18,40", width: "w-7/12", pct: "29%" },
                    { label: "Maquina", value: "R$ 22,00", width: "w-9/12", pct: "35%" },
                    { label: "Acabamento", value: "R$ 14,50", width: "w-5/12", pct: "23%" },
                    { label: "Taxas", value: "R$ 9,80", width: "w-4/12", pct: "13%" },
                  ].map(({ label, value, width, pct }) => (
                    <div key={label} className="rounded-[8px] bg-[#F9FAFB] p-3">
                      <div className="mb-2 flex justify-between text-sm">
                        <span className="font-semibold text-black/55">{label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-black/35">{pct}</span>
                          <strong>{value}</strong>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-black/8">
                        <div className={`h-1.5 rounded-full bg-gradient-to-r from-[#5852FF] to-[#7B77FF] transition-all ${width}`} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-[8px] bg-[#5852FF]/6 px-4 py-3">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5852FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
                  </svg>
                  <p className="text-xs font-semibold text-[#5852FF]">Tempo estimado: 6h 30min</p>
                </div>
              </div>

              {/* Price badge */}
              <div className="absolute bottom-12 left-0 rounded-[12px] border border-[#BA4A00]/15 bg-white p-5 shadow-xl">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#BA4A00]">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                  </svg>
                  Preco final sugerido
                </p>
                <strong className="mt-2 block text-4xl font-black leading-none">R$ 129,90</strong>
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex rounded-full bg-[#BA4A00]/10 px-3 py-1 text-xs font-bold text-[#BA4A00]">
                    margem 52%
                  </span>
                  <span className="inline-flex rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                    ↑ lucro R$ 67,60
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── MODULUS ── */}
      <section id="modulus" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#BA4A00]">
              <span className="h-px w-6 bg-[#BA4A00]" />
              Plataforma
            </p>
            <h2 className="mt-3 text-4xl font-black">Conheca a Modulus</h2>
            <p className="mt-3 text-base leading-7 text-black/55">
              Construida para quem leva a fabricacao digital a serio e quer números confiáveis antes de precificar.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {modulusBlocks.map(({ title, text, icon }) => (
              <article
                key={title}
                className="group rounded-[12px] border border-black/10 bg-white p-6 shadow-sm transition hover:-translate-y-1.5 hover:border-[#5852FF]/20 hover:shadow-xl"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#5852FF]/8 text-[#5852FF] transition group-hover:bg-[#5852FF] group-hover:text-white">
                  {icon}
                </div>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-black/60">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA ── */}
      <section id="como-funciona" className="bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#5852FF]">
                <span className="h-px w-6 bg-[#5852FF]" />
                Fluxo
              </p>
              <h2 className="mt-2 text-4xl font-black">Como funciona</h2>
            </div>
            <p className="max-w-xs text-sm text-black/50">
              <em className="font-bold">Três passos e você ja tem o preco ideal na tela.</em>
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {steps.map(({ number, title, text, icon }, idx) => (
              <article key={number} className="relative rounded-[12px] border border-black/10 bg-[#F9FAFB] p-7 shadow-sm">
                <div className="flex items-start justify-between">
                  <span className="text-6xl font-black leading-none text-[#5852FF]/15">{number}</span>
                  <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#5852FF]/10 text-[#5852FF]">
                    {icon}
                  </div>
                </div>
                <h3 className="mt-5 text-xl font-bold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-black/60">{text}</p>
                {idx < steps.length - 1 && (
                  <div className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-black/10 bg-white p-1.5 shadow-md lg:block">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5852FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── REDES SOCIAIS ── */}
      <section id="redes" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 flex flex-col gap-2">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#BA4A00]">
              <span className="h-px w-6 bg-[#BA4A00]" />
              Comunidade
            </p>
            <h2 className="text-4xl font-black">Nossas redes</h2>
            <p className="max-w-md text-base leading-7 text-black/55">
              Acompanhe a Modulus no TikTok, Instagram e WhatsApp — conteudos, dicas e bastidores.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {socialLinks.map(({ name, handle, description, href, color, textColor, icon, stat }) => (
              <article key={name} className="group overflow-hidden rounded-[16px] border border-black/10 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                {/* Colored header band */}
                <div className={`bg-gradient-to-br ${color} relative flex items-start justify-between p-5`}>
                  <div className={`${textColor}`}>
                    <div className="mb-3 opacity-90">{icon}</div>
                    <h3 className="text-lg font-black">{name}</h3>
                    <p className="text-xs font-semibold opacity-75">{handle}</p>
                  </div>
                  <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm">
                    {stat}
                  </span>
                </div>

                {/* Card body */}
                <div className="p-5">
                  <p className="text-sm leading-6 text-black/60">{description}</p>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 flex items-center justify-between rounded-[8px] border border-black/10 px-4 py-3 text-sm font-bold text-black/70 transition hover:border-[#5852FF]/30 hover:text-[#5852FF]"
                  >
                    <span>Seguir {name}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <Footer></Footer>

      {/* ── MODAL ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-[16px] border border-white/20 bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#BA4A00]">
                  <span className="h-px w-5 bg-[#BA4A00]" />
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
                  className="group rounded-[12px] border border-black/10 bg-[#F9FAFB] p-5 shadow-sm transition hover:border-[#5852FF]/20 hover:shadow-md"
                >
                  <span className="text-4xl">{calculator.icon}</span>
                  <h3 className="mt-5 text-xl font-bold">{calculator.title}</h3>
                  <p className="mt-3 min-h-[88px] text-sm leading-6 text-black/60">{calculator.description}</p>
                  <Link
                    href={calculator.href}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-[8px] bg-[#5852FF] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#4741e8]"
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

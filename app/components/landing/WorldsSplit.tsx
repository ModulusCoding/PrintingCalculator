"use client";

import Link from "next/link";
import MMark from "./MMark";

const WHATSAPP_HREF =
  "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A";

export default function WorldsSplit({ onOpenCalculators }: { onOpenCalculators: () => void }) {
  return (
    <section className="relative bg-[var(--modulus-dark)] text-white">
      <div className="grid lg:grid-cols-2">
        {/* CRIAR — makers */}
        <div className="group relative flex min-h-[70vh] flex-col justify-between overflow-hidden border-b border-white/10 px-6 py-16 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-16">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(43,0,255,0.35),transparent_55%)] transition-opacity duration-500 group-hover:opacity-80" />
          <MMark
            solidity={0}
            glow={false}
            className="absolute -bottom-10 -left-10 h-64 w-64 opacity-[0.12] sm:h-80 sm:w-80"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--modulus-light)]">
              Um dos dois mundos
            </p>
            <h2 className="mt-4 text-5xl font-black leading-[0.95] sm:text-6xl">Criar</h2>
            <p className="mt-6 max-w-sm text-base leading-7 text-white/60">
              Para quem faz, projeta e fabrica. Makers, criadores e negócios que
              enxergam na manufatura digital uma nova forma de produzir.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCalculators}
            className="mt-12 inline-flex w-fit items-center gap-2 rounded-[10px] border border-white/20 px-6 py-4 text-sm font-bold text-white transition hover:border-[var(--modulus-light)] hover:text-[var(--modulus-light)]"
          >
            Comece a produzir
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* SOLICITAR — consumers */}
        <div className="group relative flex min-h-[70vh] flex-col justify-between overflow-hidden px-6 py-16 sm:px-10 lg:min-h-screen lg:px-16">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_30%,rgba(255,78,38,0.28),transparent_55%)] transition-opacity duration-500 group-hover:opacity-80" />
          <MMark
            solidity={1}
            glow={false}
            className="absolute -bottom-10 -right-10 h-64 w-64 opacity-[0.14] sm:h-80 sm:w-80"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--modulus-accent)]">
              O outro mundo
            </p>
            <h2 className="mt-4 text-5xl font-black leading-[0.95] sm:text-6xl">Viver</h2>
            <p className="mt-6 max-w-sm text-base leading-7 text-white/60">
              Para quem quer um produto que não existe em prateleira nenhuma —
              pensado, desenvolvido e fabricado sob medida.
            </p>
          </div>
          <Link
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-12 inline-flex w-fit items-center gap-2 rounded-[10px] bg-[var(--modulus-accent)] px-6 py-4 text-sm font-bold text-white shadow-lg shadow-[var(--modulus-accent)]/25 transition hover:-translate-y-0.5"
          >
            Solicitar projeto
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

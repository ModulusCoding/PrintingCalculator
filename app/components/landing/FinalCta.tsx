"use client";

import Link from "next/link";
import MMark from "./MMark";

const WHATSAPP_HREF =
  "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A";

export default function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[var(--modulus-dark)] px-6 py-32 text-center text-white sm:px-10 lg:px-16">
      <MMark
        solidity={1}
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 opacity-[0.08]"
        glow={false}
      />
      <div className="relative mx-auto max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--modulus-light)]">
          Modulus
        </p>
        <h2 className="mt-6 text-4xl font-black leading-[1.05] sm:text-6xl">
          Isso é apenas o começo.
        </h2>
        <p className="mt-6 text-base leading-7 text-white/55 sm:text-lg">
          Desenvolvimento de produtos, tecnologia e manufatura digital — em uma
          única marca, para os dois lados de quem cria e de quem vive o que foi criado.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-[10px] bg-[var(--modulus-primary)] px-8 py-4 text-base font-bold text-white shadow-lg shadow-[var(--modulus-primary)]/30 transition hover:-translate-y-0.5"
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

"use client";

import React, { JSX, useEffect, useRef } from "react";

/**
 * Modulus - 404 "Malha Não Encontrada"
 * Converted from static HTML/Tailwind markup to a React (TSX) component.
 *
 * Notes on the conversion:
 * - Inline <style> rules became a <style jsx global>-style block via a plain
 *   <style> tag (works with any bundler; swap for CSS Modules/styled-jsx if preferred).
 * - The vanilla `mousemove` listener became a `useEffect` + `useRef` pair.
 * - `class` -> `className`, and the couple of self-closing tags were kept HTML-valid for JSX.
 */

const MODULUS_COLORS = {
    primary: "#3d32e6",
    onPrimary: "#ffffff",
    primaryFixed: "#e2dfff",
    onSurface: "#191c1d",
    onSurfaceVariant: "#464556",
    secondary: "#5e5e5e",
    surface: "#f8f9fa",
    surfaceContainer: "#edeeef",
    outlineVariant: "#c7c4d9",
};

export default function Modulus404(): JSX.Element {
    const floatingRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const card = floatingRef.current;
        if (!card) return;

        const handleMouseMove = (e: MouseEvent) => {
            const xAxis = (window.innerWidth / 2 - e.pageX) / 25;
            const yAxis = (window.innerHeight / 2 - e.pageY) / 25;
            card.style.transform = `translate(${xAxis}px, ${yAxis}px)`;
        };

        document.addEventListener("mousemove", handleMouseMove);
        return () => document.removeEventListener("mousemove", handleMouseMove);
    }, []);

    return (
        <div
            className="min-h-screen flex flex-col overflow-x-hidden"
            style={{ backgroundColor: MODULUS_COLORS.surface, color: MODULUS_COLORS.onSurface }}
        >
            <style>{`
        .material-symbols-outlined {
          font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
          display: inline-block;
          line-height: 1;
        }
        .modulus-bento-grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 24px;
        }
        .modulus-glass-card {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(8px);
          border: 1px solid #e5e7eb;
        }
        @keyframes modulus-float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0px); }
        }
        .modulus-floating { animation: modulus-float 2s ease-in-out infinite; }
        .modulus-mesh-bg {
          background-image: radial-gradient(#e5e7eb 1px, transparent 1px);
          background-size: 32px 32px;
        }
      `}</style>

            {/* Top nav (minimal brand presence) */}
            <header
                className="flex justify-between items-center w-full px-6 h-16 sticky  z-50 border-b"
                style={{ borderColor: MODULUS_COLORS.outlineVariant, backgroundColor: MODULUS_COLORS.surface }}
            >
                <img src="./logo_Horizontal.png" alt="Modulus" className="h-10 mt-4 mb-4" />
            </header>

            <main className="flex-grow flex items-center justify-center p-4 md:p-10 modulus-mesh-bg relative">
                <div className="max-w-[1200px] w-full mx-auto modulus-bento-grid">
                    {/* Hero 404 Section */}
                    <div className="col-span-12 lg:col-span-8 flex flex-col justify-center items-start space-y-6">
                        <div className="flex flex-col gap-1">
                            <span
                                className="font-medium text-xs uppercase tracking-widest px-2 py-1 rounded w-fit"
                                style={{ color: MODULUS_COLORS.primary, backgroundColor: MODULUS_COLORS.primaryFixed }}
                            >
                                Erro 404
                            </span>
                            <h1 className="font-bold leading-tight text-4xl md:text-5xl" style={{ letterSpacing: "-0.04em" }}>
                                Página Não Encontrada
                            </h1>
                        </div>

                        <p className="text-base max-w-xl" style={{ color: MODULUS_COLORS.onSurfaceVariant }}>
                            A página que você está tentando acessar não está disponível. O
                            link pode estar quebrado ou a página foi removida.
                        </p>

                        <div className="flex flex-wrap gap-4">
                            <a
                                href="/"
                                className="px-6 py-4 rounded-xl font-medium flex items-center gap-2 hover:brightness-110 active:scale-95 transition-all"

                                style={{ backgroundColor: MODULUS_COLORS.primary, color: MODULUS_COLORS.onPrimary }}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                                </svg>
                                Voltar para a Página Inicial
                            </a>

                        </div>
                    </div>

                    {/* Visual Abstraction Card */}
                    <div className="col-span-12 lg:col-span-4 modulus-glass-card p-10 rounded-xl flex items-center justify-center relative overflow-hidden h-64 md:h-auto min-h-[320px]">
                        <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none">
                            <span className="text-[180px] font-bold text-gray-400">404</span>
                        </div>
                        <div ref={floatingRef} className="relative modulus-floating">
                            <div
                                className="w-48 h-48 rounded-full flex items-center justify-center"
                                style={{ border: `2px solid ${MODULUS_COLORS.primary}33` }}
                            >
                                <div
                                    className="w-32 h-32 rounded-full flex items-center justify-center animate-spin"
                                    style={{ border: `2px solid ${MODULUS_COLORS.primary}66`, animationDuration: "1.5s" }}
                                >
                                    <span
                                        className="material-symbols-outlined text-[64px]"
                                        style={{ color: MODULUS_COLORS.primary, fontVariationSettings: "'FILL' 2" }}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-16">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                                        </svg>

                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>



                    
                </div>
            </main>

            {/* Footer */}
            <footer
                className="w-full px-6 py-4 border-t flex flex-col md:flex-row justify-between items-center gap-4 text-indigo-600"
                style={{ borderColor: MODULUS_COLORS.outlineVariant, backgroundColor: MODULUS_COLORS.surface }}
            >
                <p className="text-xs" style={{ color: MODULUS_COLORS.onSurfaceVariant }}>
                    © 2024 Modulus MVP. Todos os direitos reservados.
                </p>
                <div className="flex gap-6">
                    {["Termos", "Privacidade", "Status"].map((label) => (
                        <a
                            key={label}
                            href="#"
                            className="text-xs hover:text-[color:var(--modulus-primary)] transition-colors"
                            style={{ color: MODULUS_COLORS.onSurfaceVariant }}
                        >
                            {label}
                        </a>
                    ))}
                </div>
            </footer>
        </div>
    );
}
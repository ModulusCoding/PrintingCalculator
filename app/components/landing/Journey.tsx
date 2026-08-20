"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import { M_SOLID_PATH_D, M_VIEWBOX } from "./MMark";

// Assets gerados via Higgsfield — plates atmosféricos para cada estágio da fabricação
const PLATE_LAYERS =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3I0MyWcQW44uGL9pqLRpisOn3km/hf_20260817_132553_2826bc6a-7623-4288-bc07-27f40e3a2ed4.png";
const PLATE_OBJECT_FORMING =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3I0MyWcQW44uGL9pqLRpisOn3km/hf_20260817_132553_a276a280-99aa-494f-ab76-6b526cbe5a66.png";
const PLATE_M_ABSTRACT =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3I0MyWcQW44uGL9pqLRpisOn3km/hf_20260816_172349_5b286589-0043-4e20-9f81-b7161ed2b17b.png";
const PLATE_FINAL_PIECE =
  "https://d8j0ntlcm91z4.cloudfront.net/user_3I0MyWcQW44uGL9pqLRpisOn3km/hf_20260817_132553_9fb576d2-ee0a-47b8-8712-50838d439744.png";

// Curva do filamento entrando em cena, no mesmo espaço de coordenadas do M (0 0 190 190)
const FILAMENT_PATH =
  "M -40,4 C 30,-16 8,64 78,48 S 150,86 96,146";

const chapters = [
  { at: [0, 0.03, 0.13, 0.17], kicker: "Desenvolvimento de produtos", title: "Uma ideia começa como matéria." },
  { at: [0.17, 0.2, 0.3, 0.34], kicker: "Desenvolvimento de produtos", title: "" },
  { at: [0.36, 0.4, 0.48, 0.52], kicker: "Tecnologia", title: "Camada por camada, uma forma ganha corpo." },
  { at: [0.54, 0.58, 0.66, 0.7], kicker: "Tecnologia", title: "" },
  { at: [0.72, 0.75, 0.85, 0.89], kicker: "Manufatura digital", title: "Ah. Era isso que estava sendo criado." },
  { at: [0.9, 0.93, 0.99, 1], kicker: "Manufatura digital", title: "Um objeto real, nascido da fabricação." },
];

export default function Journey() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // ── Câmera: macro (filamento) → médio (camadas/objeto) → pullback (peça final) ──
  const camScale = useTransform(
    scrollYProgress,
    [0, 0.17, 0.36, 0.7, 0.86, 1],
    [2.4, 2.0, 1.35, 1.15, 1, 0.86]
  );
  const camY = useTransform(scrollYProgress, [0, 0.17, 0.36, 1], [18, 10, 0, -2]);

  // ── Filamento entrando em cena (fase 1) ──
  const filamentDraw = useTransform(scrollYProgress, [0, 0.15], [0, 1]);
  const filamentOpacity = useTransform(scrollYProgress, [0, 0.02, 0.32, 0.4], [0, 1, 1, 0]);

  // ── Bico/nozzle (fase 2) ──
  const nozzleOpacity = useTransform(scrollYProgress, [0.14, 0.19, 0.62, 0.7], [0, 1, 1, 0]);

  // ── Preenchimento por camadas dentro do contorno do M (fases 3, 4, 5) ──
  const fillHeight = useTransform(scrollYProgress, [0.3, 0.78], [0, 190], { clamp: true });
  const fillY = useTransform(fillHeight, (h) => 190 - h);
  const fillBlur = useTransform(scrollYProgress, [0.3, 0.55, 0.78], [3, 1.4, 0]);
  const fillFilter = useTransform(fillBlur, (b) => `blur(${b}px)`);

  // ghost guide do contorno do M — muito sutil, só sugere a forma, não revela
  const guideOpacity = useTransform(scrollYProgress, [0.42, 0.6, 0.78, 0.86], [0.05, 0.16, 0.9, 1]);

  // pulso de "revelação" quando o M se completa
  const revealPulse = useTransform(scrollYProgress, [0.78, 0.82, 0.88], [1, 1.045, 1]);
  const revealGlow = useTransform(scrollYProgress, [0.76, 0.84], [0, 1]);

  // objeto final: leve rotação residual + escala de apresentação, com o pulso de revelação embutido
  const objectPresentScale = useTransform(scrollYProgress, [0.82, 1], [1, 0.92]);
  const objectScale = useTransform(
    [revealPulse, objectPresentScale],
    ([pulse, present]: number[]) => pulse * present
  );
  const objectRotate = useTransform(scrollYProgress, [0.3, 1], [-4, 2]);

  // ── Plates atmosféricos ──
  const plateLayersOpacity = useTransform(scrollYProgress, [0.28, 0.38, 0.5, 0.58], [0, 0.4, 0.4, 0]);
  const plateObjectOpacity = useTransform(scrollYProgress, [0.5, 0.58, 0.72, 0.78], [0, 0.4, 0.4, 0]);
  const plateAbstractOpacity = useTransform(scrollYProgress, [0.74, 0.82, 0.92, 0.98], [0, 0.35, 0.3, 0]);
  const plateFinalOpacity = useTransform(scrollYProgress, [0.86, 0.96], [0, 0.5]);

  return (
    <section
      ref={containerRef}
      className="relative bg-[var(--modulus-dark)]"
      style={{ height: "650vh" }}
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        {/* Plates atmosféricos */}
        <motion.div className="pointer-events-none absolute inset-0" style={{ opacity: plateLayersOpacity }}>
          <Image src={PLATE_LAYERS} alt="" fill sizes="100vw" className="object-cover" />
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-0" style={{ opacity: plateObjectOpacity }}>
          <Image src={PLATE_OBJECT_FORMING} alt="" fill sizes="100vw" className="object-cover" />
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-0" style={{ opacity: plateAbstractOpacity }}>
          <Image src={PLATE_M_ABSTRACT} alt="" fill sizes="100vw" className="object-cover" />
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-0" style={{ opacity: plateFinalOpacity }}>
          <Image src={PLATE_FINAL_PIECE} alt="" fill sizes="100vw" className="object-cover" />
        </motion.div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_0%,rgba(21,35,54,0.6)_55%,rgba(21,35,54,0.97)_100%)]" />

        {/* Palco de fabricação */}
        <div className="absolute inset-0 grid place-items-center" style={{ perspective: 1200 }}>
          <motion.div
            style={{ scale: camScale, y: camY }}
            className="relative h-[46vh] w-[46vh] max-h-[420px] max-w-[420px] sm:h-[50vh] sm:w-[50vh]"
          >
            <motion.svg
              viewBox={M_VIEWBOX}
              className="absolute inset-0 h-full w-full overflow-visible"
              style={{ rotate: objectRotate, scale: objectScale }}
            >
              <defs>
                <clipPath id="mFabricationClip">
                  <path d={M_SOLID_PATH_D} />
                </clipPath>
                <linearGradient id="filamentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6d4bff" />
                  <stop offset="55%" stopColor="var(--modulus-primary)" />
                  <stop offset="100%" stopColor="#1a00b8" />
                </linearGradient>
                <linearGradient id="layerFillGrad" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#1a00b8" />
                  <stop offset="55%" stopColor="var(--modulus-primary)" />
                  <stop offset="100%" stopColor="#6d4bff" />
                </linearGradient>
                <pattern id="layerLines" width="190" height="3.2" patternUnits="userSpaceOnUse">
                  <rect width="190" height="1.4" fill="rgba(255,255,255,0.10)" />
                </pattern>
                <filter id="fabricationGlow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="7" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Fase 1 — filamento entrando em cena */}
              <motion.path
                d={FILAMENT_PATH}
                fill="none"
                stroke="url(#filamentGrad)"
                strokeWidth={4}
                strokeLinecap="round"
                style={{
                  opacity: filamentOpacity,
                  pathLength: filamentDraw,
                }}
              />
              <motion.path
                d={FILAMENT_PATH}
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={1}
                strokeLinecap="round"
                style={{ opacity: filamentOpacity, pathLength: filamentDraw }}
              />

              {/* Fase 2 — bico / nozzle depositando material no topo da estrutura */}
              <motion.g style={{ opacity: nozzleOpacity }} className="animate-[modulus-drift_2.4s_ease-in-out_infinite]">
                <path
                  d="M 82,118 L 110,118 L 96,138 Z"
                  fill="var(--modulus-dark)"
                  stroke="var(--modulus-light)"
                  strokeWidth={0.8}
                />
                <circle cx={96} cy={138} r={2.2} fill="var(--modulus-accent)" />
              </motion.g>

              {/* Contorno-fantasma do M — sugestão sutil da forma final */}
              <motion.path
                d={M_SOLID_PATH_D}
                fill="none"
                stroke="var(--modulus-light)"
                strokeWidth={1}
                style={{ opacity: guideOpacity }}
              />

              {/* Fases 3–5 — preenchimento por camadas dentro do contorno do M */}
              <g clipPath="url(#mFabricationClip)">
                <motion.rect
                  x={0}
                  width={190}
                  height={190}
                  fill="url(#layerFillGrad)"
                  style={{ y: fillY, filter: fillFilter }}
                />
                <motion.rect
                  x={0}
                  width={190}
                  height={190}
                  fill="url(#layerLines)"
                  style={{ y: fillY }}
                />
              </g>

              {/* Contorno final nítido no momento da revelação */}
              <motion.path
                d={M_SOLID_PATH_D}
                fill="none"
                stroke="white"
                strokeWidth={0.6}
                style={{ opacity: revealGlow }}
                filter="url(#fabricationGlow)"
              />
            </motion.svg>
          </motion.div>
        </div>

        {/* Legendas de capítulo */}
        <div className="absolute inset-x-0 bottom-0 px-6 pb-14 sm:px-10 sm:pb-16 lg:px-16">
          <div className="mx-auto max-w-7xl">
            {chapters.map((chapter, i) => {
              const opacity = useTransform(scrollYProgress, chapter.at, [0, 1, 1, 0]);
              const y = useTransform(scrollYProgress, [chapter.at[0], chapter.at[1]], [18, 0]);
              return (
                <motion.div
                  key={i}
                  style={{ opacity, y }}
                  className="absolute inset-x-6 bottom-14 sm:inset-x-10 sm:bottom-16 lg:inset-x-16"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-[var(--modulus-light)]">
                    {chapter.kicker}
                  </p>
                  {chapter.title && (
                    <h3 className="mt-3 max-w-2xl font-[Space_Grotesk] text-3xl font-black leading-[1.05] text-white sm:text-5xl">
                      {chapter.title}
                    </h3>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

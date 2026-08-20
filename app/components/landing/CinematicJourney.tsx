"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * CinematicJourney
 * ------------------------------------------------------------------
 * Replaces the earlier SVG-illustration hero with a photoreal,
 * cinematic frame sequence generated via Higgsfield: a real 3D-printer
 * nozzle depositing glossy Modulus-blue filament, building layer by
 * layer into the Modulus "M" as a physical printed object.
 *
 * Video generation was gated behind a paid Higgsfield plan on this
 * workspace, so the sequence is delivered as graded photoreal stills
 * (frame-sequence scroll-scrubbing) instead of a single video —
 * the explicit fallback the brief allows when it reads better than
 * forcing SVG. Frames crossfade and get a slow cinematic Ken-Burns
 * drift; nothing here is a drawn/vector logo.
 * ------------------------------------------------------------------
 */

const FRAMES = [
  {
    // 0 — filament + nozzle, establishing shot
    src: "https://d8j0ntlcm91z4.cloudfront.net/user_3I3T6YbNcylosbfzrIzIvGHVn9v/hf_20260819_225843_9c6d2329-08c3-4cc4-b98c-f7d6e532b805.png",
    range: [0.0, 0.24],
    label: "Desenvolvimento de produtos",
    caption: "Um filamento para começar.",
  },
  {
    // 1 — first layer depositing
    src: "https://d8j0ntlcm91z4.cloudfront.net/user_3I3T6YbNcylosbfzrIzIvGHVn9v/hf_20260819_230309_cd9a450e-f416-46ca-9802-812003a65df1.png",
    range: [0.16, 0.42],
    label: "Tecnologia",
    caption: "A extrusão começa.",
  },
  {
    // 2 — layers building
    src: "https://d8j0ntlcm91z4.cloudfront.net/user_3I3T6YbNcylosbfzrIzIvGHVn9v/hf_20260819_230309_52f98059-df72-4a42-8ad9-7eddad5ec578.png",
    range: [0.36, 0.6],
    label: "Manufatura digital",
    caption: "Camada sobre camada.",
  },
  {
    // 3 — M nearly complete
    src: "https://d8j0ntlcm91z4.cloudfront.net/user_3I3T6YbNcylosbfzrIzIvGHVn9v/hf_20260819_230309_9961c78c-2540-426e-9982-2c53050f4a4f.png",
    range: [0.56, 0.82],
    label: "Precisão",
    caption: "A forma se revela.",
  },
  {
    // 4 — final hero object
    src: "https://d8j0ntlcm91z4.cloudfront.net/user_3I3T6YbNcylosbfzrIzIvGHVn9v/hf_20260819_230309_410bf6b8-e250-46c3-882b-caf8cab8ad7d.png",
    range: [0.78, 1.0],
    label: "Modulus",
    caption: "Do digital para o real.",
  },
];

function band(p: number, start: number, end: number) {
  if (end === start) return p >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (p - start) / (end - start)));
}
function ease(t: number) {
  return t * t * (3 - 2 * t);
}
function frameOpacity(p: number, range: [number, number], isLast: boolean) {
  const [start, end] = range;
  if (p < start || p > end) return 0;
  const fadeIn = ease(band(p, start, Math.min(end, start + (end - start) * 0.35)));
  if (isLast) return fadeIn;
  const fadeOut = ease(band(p, Math.max(start, end - (end - start) * 0.35), end));
  return Math.min(fadeIn, 1 - fadeOut);
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export default function CinematicJourney() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (reducedMotion) {
      const t = requestAnimationFrame(() => setProgress(1));
      return () => cancelAnimationFrame(t);
    }
    let frame = 0;
    let ticking = false;

    const measure = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const raw = total > 0 ? -rect.top / total : 0;
      const clamped = Math.min(1, Math.max(0, raw));
      setProgress((prev) => (Math.abs(prev - clamped) > 0.0012 ? clamped : prev));
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        frame = requestAnimationFrame(measure);
      }
    };

    frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  const finalStage = ease(band(progress, 0.9, 1.0));

  return (
    <section
      ref={sectionRef}
      aria-label="A fabricação da Modulus: de filamento a produto, em filme"
      style={{ height: isMobile ? "380vh" : "560vh" }}
      className="relative"
    >
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#FBFBFE]">
        {/* Frame stack — cinematic crossfade, each with a slow Ken Burns drift */}
        {FRAMES.map((f, i) => {
          const opacity = frameOpacity(progress, f.range as [number, number], i === FRAMES.length - 1);
          const localT = ease(band(progress, f.range[0], f.range[1]));
          const scale = 1.06 - localT * 0.06;
          const shiftX = (1 - localT) * (i % 2 === 0 ? 1.2 : -1.2);
          return (
            <Image
              key={f.src}
              src={f.src}
              alt=""
              aria-hidden="true"
              fill
              sizes="100vw"
              priority={i === 0}
              loading={i === 0 ? undefined : "eager"}
              className="object-cover"
              style={{
                opacity,
                transform: `scale(${scale}) translateX(${shiftX}%)`,
                transition: "opacity 0.05s linear",
                willChange: "opacity, transform",
              }}
            />
          );
        })}

        {/* Soft light scrim (not a dark filter) so dark text stays legible over bright studio photos */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.15)_0%,transparent_20%,transparent_62%,rgba(255,255,255,0.92)_100%)]" />

        {/* Caption stack, cross-fades with each frame */}
        <div className="relative z-10 mx-auto flex h-full max-w-xl flex-col items-center justify-end px-6 pb-24 text-center sm:pb-28">
          {FRAMES.map((f, i) => {
            const opacity = frameOpacity(progress, f.range as [number, number], i === FRAMES.length - 1);
            return (
              <div key={f.label} className="absolute inset-x-0 bottom-24 sm:bottom-28" style={{ opacity }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#2B00FF]">{f.label}</p>
                <p className="mt-2 text-xl font-medium text-[#152336] sm:text-2xl">{f.caption}</p>
              </div>
            );
          })}
        </div>

        {/* Final identity reveal, layered above the last frame */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 px-6 pb-10 text-center sm:pb-14"
          style={{ opacity: finalStage, transform: `translateY(${(1 - finalStage) * 18}px)` }}
        >
          <p className="text-2xl font-black tracking-tight text-[#152336] sm:text-3xl">MODULUS</p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#152336]/60 sm:text-sm">
            <span>Desenvolvimento de produtos</span>
            <span className="text-[#2B00FF]">·</span>
            <span>Tecnologia</span>
            <span className="text-[#2B00FF]">·</span>
            <span>Manufatura digital</span>
          </div>
        </div>

        {/* Scroll cue, visible only at the very start */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2"
          style={{ opacity: Math.max(0, 1 - progress * 14) }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#152336]/50">
            Role para começar
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2B00FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>
    </section>
  );
}
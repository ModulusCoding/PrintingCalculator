"use client";

import { useEffect, useRef } from "react";

export function ExclusiveProductAnimation() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const mediaQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    if (mediaQuery.matches) {
      svg.style.animationPlayState = "paused";
    }

    const handleChange = (e: MediaQueryListEvent) => {
      svg.style.animationPlayState = e.matches ? "paused" : "running";
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full max-w-[480px] aspect-square select-none"
      viewBox="0 0 540 540"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Animação da Modulus: Ideia → Impressão → Seu"
    >
      <defs>
        {/* Gradiente principal */}
        <linearGradient
          id="primaryGradient"
          x1="0%"
          x2="100%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f2f2f2" />
        </linearGradient>

        {/* Fluxo da ideia */}
        <linearGradient
          id="ideaStreamGrad"
          x1="0%"
          x2="100%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>

        {/* Glow do scanner */}
        <linearGradient
          id="scanGlowGrad"
          x1="0%"
          x2="0%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        {/* Corpo do produto */}
        <linearGradient
          id="ceramicShading"
          x1="20%"
          x2="80%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.99" />
          <stop offset="60%" stopColor="#fbfbfa" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#eceff4" stopOpacity="0.92" />
        </linearGradient>

        {/* Aura geral */}
        <filter
          id="subtleAura"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="14" result="blur" />
          <feComposite
            in="SourceGraphic"
            in2="blur"
            operator="over"
          />
        </filter>

        {/* Glow */}
        <filter
          id="softGlow"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite
            in="SourceGraphic"
            in2="blur"
            operator="over"
          />
        </filter>

        {/* Sombra do produto */}
        <filter
          id="tangibleShadow"
          x="-20%"
          y="-10%"
          width="140%"
          height="130%"
        >
          <feDropShadow
            dx="0"
            dy="16"
            floodColor="#801c00"
            floodOpacity="0.3"
            stdDeviation="20"
          />
        </filter>

        {/* Sombra neutra específica da logo */}
        <filter
          id="ownershipShadow"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feDropShadow
            dx="0"
            dy="5"
            floodColor="#152336"
            floodOpacity="0.10"
            stdDeviation="7"
          />
        </filter>
      </defs>

      <style>{`
        /* ============================================
           IDEIA
           ============================================ */

        .idea-spark-ring {
          transform-origin: 270px 250px;
          animation: ideaAmbient 11.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes ideaAmbient {
          0% {
            opacity: 0;
            transform: scale(0.65);
          }

          6% {
            opacity: 0.85;
            transform: scale(0.9);
          }

          26% {
            opacity: 0.95;
            transform: scale(1.05);
          }

          34% {
            opacity: 0.3;
            transform: scale(1.1);
          }

          70% {
            opacity: 0.15;
          }

          92% {
            opacity: 0.1;
          }

          100% {
            opacity: 0;
            transform: scale(0.8);
          }
        }

        .freehand-sketch {
          stroke-dasharray: 800;
          stroke-dashoffset: 800;
          animation: sketchThought 11.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes sketchThought {
          0% {
            stroke-dashoffset: 800;
            opacity: 0;
          }

          4% {
            opacity: 1;
          }

          22% {
            stroke-dashoffset: 0;
            opacity: 0.95;
          }

          32% {
            stroke-dashoffset: 0;
            opacity: 0.7;
          }

          45% {
            opacity: 0.2;
          }

          65% {
            opacity: 0;
          }

          100% {
            stroke-dashoffset: 800;
            opacity: 0;
          }
        }

        .idea-seed-node {
          animation: seedPulse 11.5s ease-in-out infinite;
          transform-origin: 110px 310px;
        }

        @keyframes seedPulse {
          0% {
            opacity: 0;
            transform: scale(0);
          }

          6% {
            opacity: 1;
            transform: scale(1.2);
          }

          16% {
            opacity: 0.9;
            transform: scale(1);
          }

          28% {
            opacity: 0.8;
          }

          36% {
            opacity: 0;
            transform: scale(0.5);
          }

          100% {
            opacity: 0;
          }
        }

        .particle-coalesce-1 {
          animation: coalesce1 11.5s cubic-bezier(0.25, 1, 0.5, 1) infinite;
        }

        @keyframes coalesce1 {
          0% {
            opacity: 0;
            transform: translate(-40px, -30px);
          }

          8% {
            opacity: 0.8;
            transform: translate(-20px, -15px);
          }

          24% {
            opacity: 1;
            transform: translate(0, 0);
          }

          34% {
            opacity: 0.3;
          }

          40% {
            opacity: 0;
          }

          100% {
            opacity: 0;
          }
        }

        .particle-coalesce-2 {
          animation: coalesce2 11.5s cubic-bezier(0.25, 1, 0.5, 1) infinite;
        }

        @keyframes coalesce2 {
          0% {
            opacity: 0;
            transform: translate(45px, 20px);
          }

          10% {
            opacity: 0.8;
            transform: translate(15px, 5px);
          }

          26% {
            opacity: 1;
            transform: translate(0, 0);
          }

          34% {
            opacity: 0.3;
          }

          40% {
            opacity: 0;
          }

          100% {
            opacity: 0;
          }
        }

        /* ============================================
           IMPRESSÃO
           ============================================ */

        .process-scan-line {
          animation: scanMovement 11.5s
            cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes scanMovement {
          0%,
          28% {
            opacity: 0;
            transform: translateY(370px);
          }

          32% {
            opacity: 1;
            transform: translateY(360px);
          }

          60% {
            opacity: 1;
            transform: translateY(145px);
          }

          66% {
            opacity: 0.4;
            transform: translateY(135px);
          }

          70%,
          100% {
            opacity: 0;
            transform: translateY(130px);
          }
        }

        .print-layer {
          opacity: 0;
          animation: layerMaterialize 11.5s
            cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        }

        @keyframes layerMaterialize {
          0%,
          30% {
            opacity: 0;
            stroke-dashoffset: 200;
          }

          35% {
            opacity: 0.4;
          }

          55% {
            opacity: 0.9;
            stroke-dashoffset: 0;
          }

          72% {
            opacity: 0.4;
          }

          88% {
            opacity: 0.25;
          }

          96% {
            opacity: 0;
          }

          100% {
            opacity: 0;
          }
        }

        .layer-1 {
          animation-delay: 0s;
        }

        .layer-2 {
          animation-delay: 0.25s;
        }

        .layer-3 {
          animation-delay: 0.55s;
        }

        .layer-4 {
          animation-delay: 0.85s;
        }

        .layer-5 {
          animation-delay: 1.15s;
        }

        .layer-6 {
          animation-delay: 1.45s;
        }

        .layer-7 {
          animation-delay: 1.75s;
        }

        .layer-8 {
          animation-delay: 2.05s;
        }

        .precision-contour {
          stroke-dasharray: 900;
          stroke-dashoffset: 900;
          animation: formContour 11.5s
            cubic-bezier(0.35, 0, 0.2, 1) infinite;
        }

        @keyframes formContour {
          0%,
          28% {
            stroke-dashoffset: 900;
            opacity: 0;
          }

          32% {
            opacity: 0.95;
          }

          58% {
            stroke-dashoffset: 0;
            opacity: 0.85;
          }

          88% {
            opacity: 0.4;
          }

          96% {
            opacity: 0;
          }

          100% {
            stroke-dashoffset: 900;
            opacity: 0;
          }
        }

        /* ============================================
           PRODUTO FINAL
           ============================================ */

        .tangible-body {
          animation: revealTangible 11.5s
            cubic-bezier(0.25, 1, 0.5, 1) infinite;
          transform-origin: 270px 248px;
        }

        @keyframes revealTangible {
          0%,
          45% {
            opacity: 0;
            transform: scale(0.97);
          }

          62% {
            opacity: 0.75;
            transform: scale(1);
          }

          70% {
            opacity: 1;
            transform: scale(1);
          }

          90% {
            opacity: 1;
            transform: scale(1);
          }

          96% {
            opacity: 0;
            transform: scale(0.98);
          }

          100% {
            opacity: 0;
          }
        }

        .ownership-crest {
          transform-origin: 270px 248px;
          animation: revealOwnership 11.5s
            cubic-bezier(0.34, 1.3, 0.64, 1) infinite;
        }

        @keyframes revealOwnership {
          0%,
          64% {
            opacity: 0;
            transform: scale(0.55) translateY(8px);
          }

          72% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }

          90% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }

          96% {
            opacity: 0;
            transform: scale(1.02);
          }

          100% {
            opacity: 0;
          }
        }

        .belonging-halo {
          transform-origin: 270px 248px;
          animation: haloPulse 11.5s ease-in-out infinite;
        }

        @keyframes haloPulse {
          0%,
          66% {
            opacity: 0;
            transform: scale(0.75);
          }

          74% {
            opacity: 0.95;
            transform: scale(1.1);
          }

          84% {
            opacity: 0.7;
            transform: scale(1);
          }

          90% {
            opacity: 0.8;
          }

          96% {
            opacity: 0;
          }

          100% {
            opacity: 0;
          }
        }

        /* ============================================
           FLUXO IDEIA → IMPRESSÃO → SEU
           ============================================ */

        .flow-badge {
          animation: badgePresence 11.5s
            cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        @keyframes badgePresence {
          0%,
          4% {
            opacity: 0;
            transform: translateY(8px);
          }

          8%,
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /*
          A cápsula começa exatamente sobre "IDEIA":
          left inicial = 14px

          IDEIA:
          width = 68px
          center = 48px

          IMPRESSÃO:
          width = 102px
          left ≈ 88px
          translateX ≈ 74px

          SEU:
          width = 60px
          left = 208px
          translateX = 194px

          Antes estava usando 208px, fazendo a cápsula passar
          do centro de "SEU". Também havia opacity: 0 no
          final, fazendo a cápsula desaparecer.
        */
        .state-indicator-pill {
          animation: moveIndicator 11.5s
            cubic-bezier(0.45, 0, 0.2, 1) infinite;
        }

        @keyframes moveIndicator {
          0%,
          28% {
            transform: translateX(0px);
            width: 68px;
            opacity: 1;
          }

          33%,
          63% {
            transform: translateX(74px);
            width: 102px;
            opacity: 1;
          }

          68%,
          100% {
            transform: translateX(194px);
            width: 60px;
            opacity: 1;
          }
        }

        .text-state-1 {
          animation: textFadeState1 11.5s infinite;
        }

        .text-state-2 {
          animation: textFadeState2 11.5s infinite;
        }

        .text-state-3 {
          animation: textFadeState3 11.5s infinite;
        }

        @keyframes textFadeState1 {
          0%,
          28% {
            fill: #ff4e26;
            font-weight: 700;
            opacity: 1;
          }

          33%,
          100% {
            fill: #152336;
            font-weight: 500;
            opacity: 0.55;
          }
        }

        @keyframes textFadeState2 {
          0%,
          28% {
            fill: #152336;
            font-weight: 500;
            opacity: 0.55;
          }

          33%,
          63% {
            fill: #ff4e26;
            font-weight: 700;
            opacity: 1;
          }

          68%,
          100% {
            fill: #152336;
            font-weight: 500;
            opacity: 0.55;
          }
        }

        @keyframes textFadeState3 {
          0%,
          63% {
            fill: #152336;
            font-weight: 500;
            opacity: 0.55;
          }

          68%,
          100% {
            fill: #ff4e26;
            font-weight: 700;
            opacity: 1;
          }

          /*
            Mantém "SEU" ativo até o fim do ciclo.
            Antes ele perdia destaque junto com a cápsula.
          */
          96%,
          100% {
            fill: #ff4e26;
            font-weight: 700;
            opacity: 1;
          }
        }

        .connector-beam {
          stroke-dasharray: 24;
          animation: beamTravel 11.5s linear infinite;
        }

        @keyframes beamTravel {
          0% {
            stroke-dashoffset: 48;
          }

          100% {
            stroke-dashoffset: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .idea-spark-ring,
          .freehand-sketch,
          .idea-seed-node,
          .particle-coalesce-1,
          .particle-coalesce-2,
          .process-scan-line,
          .print-layer,
          .precision-contour,
          .tangible-body,
          .ownership-crest,
          .belonging-halo,
          .flow-badge,
          .state-indicator-pill,
          .text-state-1,
          .text-state-2,
          .text-state-3,
          .connector-beam {
            animation: none !important;
          }

          .state-indicator-pill {
            opacity: 1;
            transform: translateX(194px);
            width: 60px;
          }

          .text-state-1,
          .text-state-2 {
            fill: #152336;
            font-weight: 500;
            opacity: 0.55;
          }

          .text-state-3 {
            fill: #ff4e26;
            font-weight: 700;
            opacity: 1;
          }
        }
      `}</style>

      {/* ==========================================
          IDEIA
          ========================================== */}

      <g className="idea-spark-ring">
        <circle
          cx="270"
          cy="250"
          fill="url(#scanGlowGrad)"
          opacity="0.65"
          r="175"
        />

        <circle
          cx="270"
          cy="250"
          fill="none"
          r="130"
          stroke="#ffffff"
          strokeDasharray="3 6"
          strokeOpacity="0.3"
          strokeWidth="1"
        />

        <circle
          cx="270"
          cy="250"
          fill="none"
          r="82"
          stroke="#ffffff"
          strokeOpacity="0.25"
          strokeWidth="1"
        />
      </g>

      {/* ==========================================
          PRODUTO
          ========================================== */}

      <g
        className="tangible-body"
        filter="url(#tangibleShadow)"
      >
        <ellipse
          cx="270"
          cy="382"
          fill="#801c00"
          fillOpacity="0.2"
          filter="url(#softGlow)"
          rx="75"
          ry="12"
        />

        <path
          d="M 216,365 C 216,378 324,378 324,365 C 342,324 352,275 344,228 C 334,185 306,160 300,126 C 298,118 242,118 240,126 C 234,160 206,185 196,228 C 188,275 198,324 216,365 Z"
          fill="url(#ceramicShading)"
          stroke="#ffffff"
          strokeWidth="1.2"
        />

        <path
          d="M 240,126 C 243,168 222,204 216,246 C 208,294 222,336 238,367"
          fill="none"
          stroke="#2b00ff"
          strokeOpacity="0.2"
          strokeWidth="1.8"
        />

        <path
          d="M 300,126 C 297,168 318,204 324,246 C 332,294 318,336 302,367"
          fill="none"
          stroke="#2b00ff"
          strokeOpacity="0.18"
          strokeWidth="1.8"
        />

        <path
          d="M 270,122 C 274,180 272,280 270,371"
          fill="none"
          stroke="#2b00ff"
          strokeDasharray="3 4"
          strokeOpacity="0.22"
          strokeWidth="1.2"
        />
      </g>

      {/* ==========================================
          HALO
          ========================================== */}

      <g className="belonging-halo">
        <circle
          cx="270"
          cy="248"
          fill="url(#scanGlowGrad)"
          filter="url(#subtleAura)"
          r="46"
        />
      </g>

      {/* ==========================================
          LOGO OFICIAL MODULUS
          ========================================== */}

      <g className="ownership-crest">
        <rect
          x="244"
          y="222"
          width="52"
          height="52"
          rx="14"
          fill="#ffffff"
          filter="url(#ownershipShadow)"
          stroke="#e0e4ec"
          strokeOpacity="0.9"
          strokeWidth="1.2"
        />

        <svg
          x="254"
          y="232"
          width="32"
          height="32"
          viewBox="0 0 190 190"
        >
          <path
            fill="#2d03ff"
            stroke="#2d03ff"
            strokeWidth="0.5"
            d="M 122.64,171.85 c 0.27,-2.43 0.4,-4.88 0.37,-7.35 c 0.07,-7.78 0,-15.56 -0.23,-23.32 c 4.11,-5.05 15.83,-9.78 21.72,-13.16 c 2.03,-0.82 2.96,-2.32 2.8,-4.51 c -0.68,-12.05 0.3,-26.48 -0.23,-38.09 c -0.24,-0.7 -0.72,-0.97 -1.45,-0.81 c -16.48,9.23 -32.93,18.53 -49.35,27.89 c -0.51,0.26 -1.05,0.35 -1.62,0.28 c -17.02,-9.56 -34.07,-19.06 -51.14,-28.51 c -1.18,0.29 -0.82,1.24 -0.95,2.19 c 0.03,15.01 0.04,30.03 0.04,45.04 c 0.27,2.29 -0.76,3.46 -3.09,3.51 c -7.79,1.34 -15.34,-0.61 -23.02,0.4 c -2.73,0.11 -4.11,-1.2 -4.13,-3.94 c 0.02,-25.35 0.41,-50.65 -0.31,-75.97 c 0.05,-3.07 -0.23,-7.13 2.99,-8.79 c 20.09,-11.53 41.1,-23.08 60.78,-35.18 c 1.59,-0.88 4.29,-2.41 5.82,-0.72 c 1.28,4.35 0.24,27.44 0.12,31.57 c -2.94,4.86 -16.85,9.2 -21.81,13.15 c -1.38,1.13 -1.29,2.11 0.28,2.97 c 10.37,5.83 20.6,11.9 30.69,18.21 c 1.84,1.39 3.81,1.66 5.91,0.82 c 20.06,-11.71 39.77,-23.82 60.25,-34.84 c 5.46,-3.67 11.13,-6.97 17.02,-9.89 c 2.96,-1.11 3.4,2.74 3.52,4.74 c -0.32,28.98 -0.42,57.97 -0.32,86.96 c -0.44,5.72 3.12,18.82 -3.65,21.67 c -15.49,8.12 -31.79,18.08 -47.05,26.9 c -1.86,1.22 -3.18,0.81 -3.96,-1.22 Z"
          />
        </svg>

        <path
          d="M 258,266 C 264,268 276,268 282,266"
          fill="none"
          stroke="#2b00ff"
          strokeLinecap="round"
          strokeOpacity="0.25"
          strokeWidth="1.2"
        />
      </g>

      {/* ==========================================
          CONTORNO DE PRECISÃO
          ========================================== */}

      <g className="precision-contour">
        <path
          d="M 216,365 C 216,378 324,378 324,365 C 342,324 352,275 344,228 C 334,185 306,160 300,126 C 298,118 242,118 240,126 C 234,160 206,185 196,228 C 188,275 198,324 216,365 Z"
          fill="none"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="2.2"
        />
      </g>

      {/* ==========================================
          CAMADAS DE IMPRESSÃO
          ========================================== */}

      <g stroke="#ffffff">
        <ellipse
          className="print-layer layer-1"
          cx="270"
          cy="358"
          fill="none"
          rx="46"
          ry="8"
          strokeDasharray="3 3"
          strokeWidth="1.8"
        />

        <ellipse
          className="print-layer layer-2"
          cx="270"
          cy="328"
          fill="none"
          rx="64"
          ry="11"
          strokeWidth="1.6"
        />

        <ellipse
          className="print-layer layer-3"
          cx="270"
          cy="298"
          fill="none"
          rx="72"
          ry="12"
          strokeDasharray="4 3"
          strokeWidth="1.5"
        />

        <ellipse
          className="print-layer layer-4"
          cx="270"
          cy="265"
          fill="none"
          rx="74"
          ry="12"
          strokeWidth="1.8"
        />

        <ellipse
          className="print-layer layer-5"
          cx="270"
          cy="232"
          fill="none"
          rx="68"
          ry="11"
          strokeDasharray="3 3"
          strokeWidth="1.5"
        />

        <ellipse
          className="print-layer layer-6"
          cx="270"
          cy="200"
          fill="none"
          rx="55"
          ry="9"
          strokeWidth="1.6"
        />

        <ellipse
          className="print-layer layer-7"
          cx="270"
          cy="168"
          fill="none"
          rx="38"
          ry="7"
          strokeWidth="1.8"
        />

        <ellipse
          className="print-layer layer-8"
          cx="270"
          cy="132"
          fill="none"
          rx="28"
          ry="5"
          strokeWidth="1.5"
        />
      </g>

      {/* ==========================================
          SCANNER / IMPRESSÃO
          ========================================== */}

      <g className="process-scan-line">
        <ellipse
          cx="270"
          cy="0"
          fill="url(#scanGlowGrad)"
          rx="105"
          ry="14"
        />

        <line
          filter="url(#softGlow)"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="2.2"
          x1="165"
          x2="375"
          y1="0"
          y2="0"
        />

        <circle
          cx="270"
          cy="0"
          fill="#ffffff"
          r="3.5"
          stroke="#ff4e26"
          strokeWidth="1.5"
        />

        <circle
          cx="195"
          cy="0"
          fill="#ffffff"
          r="2.2"
        />

        <circle
          cx="345"
          cy="0"
          fill="#ffffff"
          r="2.2"
        />
      </g>

      {/* ==========================================
          TRAÇO DA IDEIA
          ========================================== */}

      <path
        className="freehand-sketch"
        d="M 110,310 C 145,215 180,105 270,118 C 360,130 395,245 345,315 C 295,385 195,370 205,285 C 215,200 335,175 320,138 C 305,100 240,105 240,135"
        fill="none"
        filter="url(#softGlow)"
        stroke="url(#ideaStreamGrad)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.6"
      />

      {/* ==========================================
          SEMENTE DA IDEIA
          ========================================== */}

      <g className="idea-seed-node">
        <circle
          cx="110"
          cy="310"
          fill="#ffffff"
          filter="url(#softGlow)"
          r="5"
        />

        <circle
          cx="110"
          cy="310"
          fill="#ff4e26"
          r="2"
        />
      </g>

      {/* ==========================================
          PARTÍCULAS
          ========================================== */}

      <g className="particle-coalesce-1">
        <circle
          cx="160"
          cy="180"
          fill="#ffffff"
          filter="url(#softGlow)"
          r="3.5"
        />

        <circle
          cx="160"
          cy="180"
          fill="#ff4e26"
          r="1.5"
        />

        <line
          stroke="#ffffff"
          strokeDasharray="2 3"
          strokeOpacity="0.6"
          strokeWidth="1"
          x1="160"
          x2="195"
          y1="180"
          y2="215"
        />
      </g>

      <g className="particle-coalesce-2">
        <circle
          cx="380"
          cy="240"
          fill="#ffffff"
          filter="url(#softGlow)"
          r="4"
        />

        <circle
          cx="380"
          cy="240"
          fill="#ff4e26"
          r="1.8"
        />

        <line
          stroke="#ffffff"
          strokeDasharray="2 3"
          strokeOpacity="0.6"
          strokeWidth="1"
          x1="380"
          x2="340"
          y1="240"
          y2="270"
        />
      </g>

      {/* ==========================================
          MARCADORES DE EIXO
          ========================================== */}

      <g
        opacity="0.35"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeWidth="1"
      >
        <line
          x1="270"
          x2="270"
          y1="75"
          y2="92"
        />

        <line
          x1="270"
          x2="270"
          y1="405"
          y2="422"
        />

        <line
          x1="95"
          x2="112"
          y1="250"
          y2="250"
        />

        <line
          x1="428"
          x2="445"
          y1="250"
          y2="250"
        />
      </g>

      {/* ==========================================
          FLUXO
          ========================================== */}

      <g
        className="flow-badge"
        transform="translate(118, 462)"
      >
        <rect
          x="0"
          y="0"
          width="304"
          height="42"
          rx="21"
          fill="#ffffff"
          stroke="#f0e2dd"
          strokeWidth="1.2"
        />

        {/* Conector 1 */}
        <line
          stroke="#e5e8f0"
          strokeLinecap="round"
          strokeWidth="1.5"
          x1="72"
          x2="88"
          y1="21"
          y2="21"
        />

        <line
          className="connector-beam"
          stroke="#ff4e26"
          strokeLinecap="round"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          x1="72"
          x2="88"
          y1="21"
          y2="21"
        />

        {/* Conector 2 */}
        <line
          stroke="#e5e8f0"
          strokeLinecap="round"
          strokeWidth="1.5"
          x1="190"
          x2="206"
          y1="21"
          y2="21"
        />

        <line
          className="connector-beam"
          stroke="#ff4e26"
          strokeLinecap="round"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          x1="190"
          x2="206"
          y1="21"
          y2="21"
        />

        {/* Indicador ativo */}
        <rect
          className="state-indicator-pill"
          x="14"
          y="6"
          width="68"
          height="30"
          rx="15"
          fill="#fff1ed"
          stroke="#ff4e26"
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        {/* Textos */}
        <g
          fontFamily="'Space Grotesk', Geist, sans-serif"
          fontSize="11px"
          letterSpacing="0.08em"
          textAnchor="middle"
        >
          <text
            className="text-state-1"
            x="48"
            y="25"
          >
            IDEIA
          </text>

          <text
            className="text-state-2"
            x="139"
            y="25"
          >
            IMPRESSÃO
          </text>

          <text
            className="text-state-3"
            x="238"
            y="25"
          >
            SEU
          </text>
        </g>
      </g>
    </svg>
  );
}
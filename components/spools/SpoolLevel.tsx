"use client";

import styles from "./SpoolLevel.module.css";

export type SpoolLevelProps = {
  remainingGrams: number | null;
  referenceGrams: number | null;
  lowThresholdPercent: number | null;
  filamentColor?: string | null;
  label?: string;
};
const RADIUS = 67;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
function validHexColor(color?: string | null): string | null {
  return color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : null;
}
export function SpoolLevel({ remainingGrams, referenceGrams, lowThresholdPercent, filamentColor, label = "Carretel" }: SpoolLevelProps) {
  const validRemaining = typeof remainingGrams === "number" && Number.isFinite(remainingGrams) && remainingGrams >= 0;
  const validReference = typeof referenceGrams === "number" && Number.isFinite(referenceGrams) && referenceGrams > 0;
  const rawPercentage = validRemaining && validReference ? remainingGrams / referenceGrams * 100 : null;
  const percentage = rawPercentage !== null && Number.isFinite(rawPercentage) ? rawPercentage : null;
  const visualPercentage = percentage === null ? null : Math.min(100, Math.max(0, percentage));
  const validThreshold = typeof lowThresholdPercent === "number" && Number.isFinite(lowThresholdPercent) && lowThresholdPercent >= 0 && lowThresholdPercent <= 100;
  const isEmpty = validRemaining && remainingGrams === 0;
  // SQL low filter uses the actual ratio <= enterprise threshold, excluding empty spools.
  const isLow = percentage !== null && !isEmpty && validThreshold && percentage <= lowThresholdPercent;
  const color = validHexColor(filamentColor) ?? "#2B00FF";
  const statusColor = isEmpty ? "#DC493A" : isLow ? "#FF4E26" : !validRemaining || percentage === null || !validThreshold ? "#64748B" : "#16835D";
  const status = !validRemaining ? "Saldo indisponível" : isEmpty ? "Esgotado" : percentage === null ? "Percentual indisponível" : isLow ? "Estoque baixo" : !validThreshold ? "Alerta indisponível" : "Saldo disponível";
  const formattedRemaining = validRemaining ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(remainingGrams)} g` : "Saldo indisponível";
  const formattedPercentage = percentage === null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(percentage)}%`;
  const offset = visualPercentage === null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - visualPercentage / 100);
  return <div className={styles.root}>
    <div className={styles.visual} role={visualPercentage === null ? "img" : "progressbar"} aria-label={`${label}: ${status}`} aria-valuemin={visualPercentage === null ? undefined : 0} aria-valuemax={visualPercentage === null ? undefined : 100} aria-valuenow={visualPercentage === null ? undefined : visualPercentage} aria-valuetext={`${formattedRemaining}; ${percentage === null ? "percentual indisponível" : formattedPercentage}; ${status}`}>
      <svg viewBox="0 0 220 220" className={styles.svg} aria-hidden="true" focusable="false">
        <circle cx="110" cy="110" r="89" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="7" />
        <circle cx="110" cy="110" r={RADIUS} fill="none" stroke="#E5EAF4" strokeWidth="25" />
        {visualPercentage !== null && <>
          <circle className={styles.progress} cx="110" cy="110" r={RADIUS} fill="none" stroke="#94A3B8" strokeWidth="28" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset} strokeLinecap={visualPercentage === 0 ? "butt" : "round"} transform="rotate(-90 110 110)" />
          <circle className={styles.progress} cx="110" cy="110" r={RADIUS} fill="none" stroke={color} strokeWidth="25" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset} strokeLinecap={visualPercentage === 0 ? "butt" : "round"} transform="rotate(-90 110 110)" />
        </>}
        <circle cx="110" cy="110" r="46" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="3" />
        <circle cx="110" cy="110" r="30" fill="#EEF2F8" stroke="#D5DCE8" strokeWidth="2" />
        <circle cx="110" cy="110" r="12" fill="#152336" /><circle cx="110" cy="110" r="5" fill="#FFFFFF" />
      </svg>
    </div>
    <div className={styles.details}><strong className={styles.percentage}>{formattedPercentage}</strong><span className={styles.remaining}>{formattedRemaining}</span><span className={styles.remaining}><span className={styles.filamentSwatch} style={{ backgroundColor: color }} aria-hidden="true" />{filamentColor || "Cor ilustrativa"}</span><span className={styles.status}><span className={styles.statusDot} style={{ backgroundColor: statusColor }} aria-hidden="true" />{status}</span>{percentage !== null && percentage > 100 && <span className={styles.remaining}>Acima do peso original; indicador limitado a 100%.</span>}</div>
  </div>;
}

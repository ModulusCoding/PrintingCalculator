"use client";

import { useEffect, useRef, useState } from "react";
import { resolveSpoolHex } from "@/lib/spools/color";
import { spoolVisual } from "@/lib/spools/visual";
import { createSpoolRenderer } from "./spool-webgl";
import styles from "./Spool3D.module.css";

export type Spool3DProps = {
  remainingGrams: number | null;
  referenceGrams: number | null;
  colorHex: string | null;
  lowThresholdPercent: number | null;
  interactive?: boolean;
  label?: string;
};
// Defensive ownership even if two detail trees overlap during navigation.
let active: { dispose: () => void } | null = null;
const format = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(n);

export function Spool3D({ remainingGrams, referenceGrams, colorHex, lowThresholdPercent, interactive = true, label = "Carretel" }: Spool3DProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createSpoolRenderer>>(null);
  const [failed, setFailed] = useState(false);
  const visual = spoolVisual(remainingGrams, referenceGrams, lowThresholdPercent);
  const color = resolveSpoolHex(colorHex) ?? "#2B00FF";
  const latest = useRef({ level: visual.level, color });
  useEffect(() => { latest.current = { level: visual.level, color }; }, [visual.level, color]);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let disposed = false;
    const fail = () => { if (!disposed) setFailed(true); };
    active?.dispose();
    const instance = createSpoolRenderer(target, { interactive, onFailure: fail });
    renderer.current = instance;
    const owner = { dispose: () => { instance?.dispose(); fail(); } };
    active = owner;
    if (!instance) fail();
    else instance.update(latest.current.level, latest.current.color);
    return () => {
      disposed = true;
      instance?.dispose();
      if (active === owner) active = null;
      renderer.current = null;
    };
  }, [interactive]);
  useEffect(() => { renderer.current?.update(visual.level, color); }, [visual.level, color]);

  const remaining = visual.validBalance ? `${format(remainingGrams!)} g` : "Saldo indisponível";
  const percent = visual.percentage === null ? "—" : `${format(visual.percentage)}%`;
  return <figure className={styles.root} aria-label={`${label}: ${remaining}; ${percent}; ${visual.status}`}>
    <div className={styles.stage}>
      <canvas ref={canvas} className={styles.interactive} aria-hidden="true" hidden={failed} />
      {failed && <p className={styles.fallback} role="status">Visualização 3D indisponível neste dispositivo. Os dados do carretel continuam disponíveis abaixo.</p>}
    </div>
    {interactive && !failed && <div className={styles.rotation}><span>Arraste na horizontal para girar; no toque, deslize verticalmente para rolar.</span><button type="button" onClick={() => renderer.current?.rotate(-0.3)} aria-label="Girar carretel para a esquerda">Girar à esquerda</button><button type="button" onClick={() => renderer.current?.rotate(0.3)} aria-label="Girar carretel para a direita">Girar à direita</button></div>}
    <figcaption className={styles.details}>
      <strong>{percent}</strong><span>{remaining}</span>
      <span className={visual.empty || visual.low ? styles.alert : styles.status}>{visual.status}</span>
      {visual.percentage !== null && visual.percentage > 100 && <small>Volume limitado a 100%; peso real preservado.</small>}
      {visual.level === null && <small>Volume indeterminado; somente a estrutura é exibida.</small>}
      {!resolveSpoolHex(colorHex) && <small>Cor visual ilustrativa; {colorHex ? `cor cadastrada: ${colorHex}.` : "cor não cadastrada."}</small>}
    </figcaption>
  </figure>;
}

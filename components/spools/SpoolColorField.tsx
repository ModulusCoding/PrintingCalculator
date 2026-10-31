"use client";

import { useId, useState } from "react";
import { normalizeSpoolColor, resolveSpoolHex } from "@/lib/spools/color";
import { SpoolLevel2D } from "./SpoolLevel2D";
import styles from "./SpoolForms.module.css";

type Props = {
  defaultValue?: string;
  disabled?: boolean;
  errors?: string[];
  remainingGrams: number | null;
  referenceGrams: number | null;
  lowThresholdPercent: number | null;
};

const colorError = "Informe um HEX válido (#RRGGBB ou #RGB), com #, ou um nome de cor (texto legado, até 80 caracteres).";

export function SpoolColorField({ defaultValue = "", disabled = false, errors, remainingGrams, referenceGrams, lowThresholdPercent }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(() => resolveSpoolHex(defaultValue) ?? defaultValue);
  const [lastHex, setLastHex] = useState<string | null>(() => resolveSpoolHex(defaultValue));
  const hex = resolveSpoolHex(draft);
  const invalid = normalizeSpoolColor(draft) === null;
  const localErrors = [...(invalid ? [colorError] : []), ...(errors ?? [])];
  const describedBy = [`${id}-hint`, ...(localErrors.length ? [`${id}-error`] : [])].join(" ");

  function change(value: string) {
    const nextHex = resolveSpoolHex(value);
    // Keep incomplete drafts editable, including the intermediate three-digit shorthand.
    setDraft(nextHex ? value.toUpperCase() : value);
    if (nextHex) setLastHex(nextHex);
    else if (normalizeSpoolColor(value) !== null) setLastHex(null);
  }

  return <div className={`${styles.field} ${styles.colorField}`}>
    <label htmlFor={id}>Cor HEX ou nome (texto legado)</label>
    <div className={styles.colorInputs}>
      <input type="color" value={hex ?? lastHex ?? "#2B00FF"} onChange={event => change(event.target.value)} disabled={disabled} className={styles.colorPicker} aria-label="Escolher cor HEX do filamento" aria-describedby={`${id}-hint`} />
      <input id={id} name="color" type="text" value={draft} onChange={event => change(event.target.value)} onBlur={() => { if (hex) setDraft(hex); }} maxLength={80} placeholder="#RRGGBB ou nome da cor" disabled={disabled} className={styles.input} aria-invalid={!!localErrors.length} aria-describedby={describedBy} autoComplete="off" spellCheck={false} />
    </div>
    <p id={`${id}-hint`} className={styles.hint}>HEX com # ou texto legado de até 80 caracteres. Sem HEX válido, o seletor usa a última cor válida ou roxo ilustrativo (#2B00FF); nenhuma cor padrão será salva.</p>
    {!!localErrors.length && <div id={`${id}-error`} className={styles.error} role="alert">{localErrors.map((error, index) => <p key={`${index}-${error}`}>{error}</p>)}</div>}
    <div className={styles.colorPreview}>
      <SpoolLevel2D remainingGrams={remainingGrams} referenceGrams={referenceGrams} filamentColor={hex ?? lastHex} lowThresholdPercent={lowThresholdPercent} label="Prévia do carretel — alterações ainda não salvas" />
      <p className={styles.hint}>{invalid ? "Rascunho de cor incompleto ou inválido, ainda não salvo. A prévia mantém a última cor válida, quando disponível." : !hex ? "Cor ilustrativa na prévia: o texto legado ou campo vazio será preservado, sem conversão automática." : "Prévia da cor selecionada. Alterações ainda não salvas."}</p>
    </div>
  </div>;
}

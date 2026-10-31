"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { selectInitialFreePlan, type SelectFreePlanResult } from "@/lib/plans/actions";
import styles from "./Plans.module.css";

export function FreePlanChoice() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SelectFreePlanResult | null>(null);
  const success = result?.status === "selected" || result?.status === "no_change";

  function choose() {
    startTransition(async () => {
      setResult(null);
      try {
        const response = await selectInitialFreePlan();
        setResult(response);
        if (response.status === "conflict") router.refresh();
      } catch {
        setResult({ status: "uncertain", message: "A conexão foi interrompida e o resultado não pôde ser confirmado. Consulte Meu plano ou repita a escolha com segurança, sem cobrança." });
      }
    });
  }

  return (
    <div className={styles.choice}>
      <button type="button" disabled={pending || success} aria-busy={pending} onClick={choose}
        className={`${styles.button} ${styles.secondary}`}>
        {pending ? "Confirmando escolha…" : success ? "Escolha registrada" : "Começar grátis"}
      </button>
      {pending && <p role="status" className={styles.feedback}>Registrando sua escolha com segurança…</p>}
      {result && <p role={success ? "status" : "alert"} className={`${styles.feedback} ${success ? styles.success : styles.error}`}>{result.message}</p>}
      {result && <div className={styles.choiceLinks}>
        <Link className={styles.textLink} href="/meu-plano">Consultar Meu plano</Link>
        {success && <Link className={styles.textLink} href="/home">Ir para o início</Link>}
      </div>}
    </div>
  );
}

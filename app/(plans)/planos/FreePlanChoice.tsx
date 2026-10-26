"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { selectInitialFreePlan, type SelectFreePlanResult } from "@/lib/plans/actions";

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
    <div className="mt-6 space-y-3">
      <button type="button" disabled={pending || success} onClick={choose}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
        {pending ? "Confirmando escolha…" : success ? "Escolha registrada" : "Escolher Aprendiz grátis"}
      </button>
      {result && <p role={success ? "status" : "alert"} className={`text-sm ${success ? "text-emerald-700" : "text-amber-800"}`}>{result.message}</p>}
      {result && <div className="flex flex-wrap gap-4 text-sm font-semibold">
        <Link className="underline" href="/meu-plano">Consultar Meu plano</Link>
        {success && <Link className="underline" href="/home">Ir para o início</Link>}
      </div>}
    </div>
  );
}

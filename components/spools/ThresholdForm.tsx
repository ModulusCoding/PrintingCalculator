"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSpoolThreshold } from "@/lib/spools/actions";
import type { Config } from "@/lib/spools/schemas";

export function ThresholdForm({ config }: { config: Config }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string } | null>(null);

  async function save(fd: FormData) {
    setBusy(true);
    try {
      const r = await updateSpoolThreshold({ threshold: fd.get("threshold"), expected_version: config.version });
      setResult(r);
      if (r.status === "updated") router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const t = config.low_spool_threshold_percent.toString().replace(".", ",");

  return (
    <form action={save} className="space-y-3 rounded border bg-white p-5" noValidate>
      <p className="text-sm text-slate-600">Percentual do peso original abaixo do qual o carretel aparece em &ldquo;Baixo saldo&rdquo;.</p>
      <label className="block">
        Limite (0 a 100)
        <input required name="threshold" defaultValue={t} inputMode="decimal" className="mt-1 block w-full rounded border p-2" disabled={busy} />
      </label>
      <button disabled={busy} className="rounded bg-indigo-700 px-4 py-2 text-white">{busy ? "Salvando…" : "Salvar"}</button>
      {result && (
        <p role="status" className="text-sm text-red-700">
          {result.status === "updated" && "Limite salvo."}
          {result.status === "version_conflict" && "Configuração alterada. Atualize a página e tente novamente."}
          {result.status === "no_change" && "Nenhuma alteração necessária."}
          {result.status === "permission_denied" && "Sem permissão para alterar."}
          {result.status === "invalid_input" && "Valor inválido."}
          {result.status === "technical" && "Falha técnica. Tente novamente."}
          {result.status === "uncertain" && "Não foi possível confirmar. Atualize a página e repita a mesma tentativa."}
        </p>
      )}
    </form>
  );
}
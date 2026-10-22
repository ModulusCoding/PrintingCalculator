"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSpool } from "@/lib/spools/actions";

const messages: Record<string, string> = {
  permission_denied: "Você não tem permissão.",
  spool_unavailable: "Carretel indisponível.",
  version_conflict: "O carretel foi alterado. Atualize a página.",
  invalid_input: "Dados inválidos.",
  technical: "Erro técnico. Tente novamente.",
  session_expired: "Sessão expirada. Entre novamente.",
  uncertain: "Não foi possível confirmar o resultado. Repita a exclusão.",
  unknown: "Erro inesperado.",
  balance_not_zero: "Carretel tem saldo não zero. Zere antes de excluir.",
  idempotency_conflict: "Esta tentativa já foi usada com dados diferentes.",
};

export function SpoolDeleteButton({ id, version, returnTo }: { id: string; version: number; returnTo: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [attempt] = useState(() => ({ attempt_id: crypto.randomUUID(), expected_version: version }));
  const attemptId = attempt.attempt_id;

  function deleteSpoolAction() {
    if (!window.confirm("Excluir este carretel? Ele ficará indisponível para operações, o histórico será preservado e o espaço será liberado. Não há restauração comum.")) return;
    setMessage("");
    startTransition(async () => {
      const result = await deleteSpool({ id, attempt_id: attemptId, expected_version: attempt.expected_version });
      if (result.status === "deleted") {
        router.push(returnTo);
        router.refresh();
        return;
      }
      setMessage(messages[result.status] || messages.unknown);
    });
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={deleteSpoolAction}
        disabled={pending}
        className="text-sm underline text-red-600 disabled:opacity-50"
      >
        {pending ? "Excluindo..." : "Excluir"}
      </button>
      {message && <p role="alert" className="text-xs text-red-700">{message}</p>}
    </div>
  );
}
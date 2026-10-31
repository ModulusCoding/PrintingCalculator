"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteGeneralMaterial } from "@/lib/general-materials/actions";

const messages: Record<string, string> = {
  permission_denied: "Você não tem permissão.",
  material_unavailable: "Material indisponível.",
  version_conflict: "O material foi alterado. Atualize a página.",
  invalid_input: "Dados inválidos.",
  technical: "Erro técnico. Tente novamente.",
  session_expired: "Sessão expirada. Entre novamente.",
  uncertain: "Não foi possível confirmar o resultado. Repita a exclusão.",
  unknown: "Erro inesperado.",
  balance_not_zero: "Material tem saldo não zero. Zere antes de excluir.",
  idempotency_conflict: "Esta tentativa já foi usada com dados diferentes.",
};

export function GeneralMaterialDeleteButton({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [attempt] = useState(() => ({ attempt_id: crypto.randomUUID(), expected_version: version }));

  function deleteMaterial() {
    if (!window.confirm("Excluir este material? Ele ficará indisponível para operações, o histórico será preservado e o espaço será liberado. Não há restauração comum.")) return;
    setMessage("");
    startTransition(async () => {
      const result = await deleteGeneralMaterial({ id, attempt_id: attempt.attempt_id, expected_version: attempt.expected_version });
      if (result.status === "deleted") {
        router.push("/estoque/materiais-gerais");
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
        onClick={deleteMaterial}
        disabled={pending}
        className="min-h-11 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50"
      >
        {pending ? "Excluindo..." : "Excluir"}
      </button>
      {message && <p role="alert" className="text-xs text-red-700">{message}</p>}
    </div>
  );
}
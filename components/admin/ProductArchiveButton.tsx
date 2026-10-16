"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInternalProductActive } from "@/lib/products/actions";

const messages: Record<string, string> = {
  permission_denied: "Você não tem permissão.",
  product_unavailable: "Produto indisponível.",
  version_conflict: "O produto foi alterado. Atualize a página.",
  technical: "Erro técnico. Tente novamente.",
  session_expired: "Sessão expirada. Entre novamente.",
  unknown: "Erro inesperado. Verifique a lista.",
  invalid_input: "Dados inválidos.",
};

function productsListReturnTo(value: string) {
  // Only retain the validated list-state parameters; never navigate to an arbitrary URL.
  const source = value.startsWith("/admin/products") ? value : "/admin/products";
  const url = new URL(source, "http://internal.local");
  if (url.pathname !== "/admin/products") return "/admin/products";

  const params = new URLSearchParams();
  const search = url.searchParams.get("search")?.trim();
  const status = url.searchParams.get("status");
  const page = url.searchParams.get("page");
  if (search && search.length <= 200) params.set("search", search);
  if (status === "active" || status === "archived" || status === "all") params.set("status", status);
  if (page && /^(?:[1-9]\d{0,3}|10000)$/.test(page)) params.set("page", page);
  return params.size ? `/admin/products?${params}` : "/admin/products";
}

export function ProductArchiveButton({ id, version, active, returnTo }: { id: string; version: number; active: boolean; returnTo: string }) {
  const router = useRouter();
  const safeReturnTo = productsListReturnTo(returnTo);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const label = active ? "Arquivar" : "Restaurar";

  function changeState() {
    if (!window.confirm(active ? "Arquivar este produto?" : "Restaurar este produto?")) return;
    setMessage("");
    startTransition(async () => {
      const result = await setInternalProductActive(id, version, !active);
      if (result.status === "success") {
        router.push(safeReturnTo);
        router.refresh();
        return;
      }
      setMessage(messages[result.status] || messages.unknown);
    });
  }

  return <div className="inline-block">
    <button type="button" onClick={changeState} disabled={pending} className="text-sm underline text-red-600 disabled:opacity-50">
      {pending ? "Processando..." : label}
    </button>
    {message && <p role="alert" className="text-xs text-red-700">{message}</p>}
  </div>;
}

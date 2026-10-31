"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInternalProductActive } from "@/lib/products/actions";
import Link from "next/link";
import { productMessage, productPlanAction } from "@/lib/products/messages";

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
  const [status, setStatus] = useState("");
  const label = active ? "Arquivar" : "Restaurar";

  function changeState() {
    if (!window.confirm(active ? "Arquivar este produto?" : "Restaurar este produto?")) return;
    setMessage("");
    startTransition(async () => {
      try {
      const result = await setInternalProductActive(id, version, !active);
      if (result.status === "success") {
        router.push(safeReturnTo);
        router.refresh();
        return;
      }
      setStatus(result.status);
      setMessage(productMessage(result.status, "reference" in result ? result.reference : undefined));
      } catch { setStatus("unknown"); setMessage(productMessage("unknown")); }
    });
  }

  return <div className="inline-block">
    <button type="button" onClick={changeState} disabled={pending} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-[#152336] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B00FF] disabled:opacity-50">
      {pending ? "Processando..." : label}
    </button>
    {message && <p role="alert" className="text-xs text-red-700">{message} {productPlanAction(status) && <Link href="/planos" className="underline">Consultar planos</Link>}</p>}
  </div>;
}

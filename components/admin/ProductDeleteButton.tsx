"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInternalProduct } from "@/lib/products/actions";
import Link from "next/link";
import { productMessage, productPlanAction } from "@/lib/products/messages";

function productsListReturnTo(value: string) {
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

export function ProductDeleteButton({ id, version, returnTo }: { id: string; version: number; returnTo: string }) {
  const router = useRouter();
  const safeReturnTo = productsListReturnTo(returnTo);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [attempt] = useState(() => ({ attemptId: crypto.randomUUID(), expectedVersion: version }));

  function deleteProduct() {
    if (!window.confirm("Excluir este produto? Ele ficará indisponível para operações, o histórico será preservado e o espaço será liberado. Não há restauração comum.")) return;
    setMessage("");
    startTransition(async () => {
      const result = await deleteInternalProduct(id, attempt.expectedVersion, attempt.attemptId);
      if (result.status === "deleted") {
        router.push(safeReturnTo);
        router.refresh();
        return;
      }
      setStatus(result.status);
      setMessage(productMessage(result.status, "reference" in result ? result.reference : undefined));
    });
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={deleteProduct}
        disabled={pending}
        className="text-sm underline text-red-600 disabled:opacity-50"
      >
        {pending ? "Excluindo..." : "Excluir"}
      </button>
      {message && <p role="alert" className="text-xs text-red-700">{message} {productPlanAction(status) && <Link href="/planos" className="underline">Consultar planos</Link>}</p>}
    </div>
  );
}
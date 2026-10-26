"use client";

import { useRef, useState } from "react";
import { applyFdmPricingPriceAction, getPricingReviewAction } from "@/lib/pricing/persistence-actions";

export function ApplyPricingButton({ pricingId }: { pricingId: string; productVersion?: number }) {
  const lock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const [review, setReview] = useState<{ version: number; name: string; price: number | null; suggested: number } | null>(null);

  const loadReview = async () => {
    if (lock.current) return;
    lock.current = true; setLoading(true); setMessage("");
    try {
    const result = await getPricingReviewAction(pricingId);
    if (!result.ok) return setMessage(result.error);
    if (!result.data.currentProduct?.active) return setMessage("O produto não está mais disponível.");
    const snapshot = result.data.calculation.snapshot.product_snapshot as { version?: unknown } | undefined;
    if (snapshot?.version !== undefined && Number(snapshot.version) !== result.data.currentProduct.version) setMessage("O produto foi alterado desde esta precificação. Revise os dados e o preço atuais antes de confirmar.");
    setReview({ version: result.data.currentProduct.version, name: result.data.currentProduct.name, price: result.data.currentProduct.price, suggested: result.data.calculation.price_suggested_unit });
    } catch {
      setReview(null);
      setMessage("Não foi possível carregar a revisão. Tente novamente.");
    } finally { lock.current = false; setLoading(false); }
  };
  const apply = async () => {
    if (!review || lock.current) return;
    lock.current = true; setLoading(true); setMessage("");
    const expected = review.version;
    try {
      const result = await applyFdmPricingPriceAction(pricingId, expected);
      if (result.ok) { setReview(null); setCompleted(true); setMessage("Preço aplicado ao produto."); return; }
      const conflict = result.code === "conflict" || String(result.code) === "PRC001";
      setMessage(conflict ? "O produto mudou enquanto você revisava. Carregue a revisão novamente." : result.error);
      if (conflict || result.code === "unknown") setReview(null);
    } catch {
      setReview(null);
      setMessage("Resultado da aplicação não confirmado. Carregue a revisão novamente antes de tentar aplicar.");
    } finally { lock.current = false; setLoading(false); }
  };
  const money = (v: number | null) => v == null ? "não definido" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  return <div className="space-y-3 rounded border bg-white p-5">
    <h2 className="text-xl font-semibold">Aplicar ao produto atual</h2>
    {completed ? null : !review ? <button type="button" disabled={loading} onClick={loadReview} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{loading ? "Carregando…" : "Revisar produto e preço atuais"}</button> : <>
      <p><strong>{review.name}</strong>: preço atual {money(review.price)} → preço sugerido {money(review.suggested)}.</p>
      <p className="text-sm text-amber-800">Confirme explicitamente. A aplicação usa a versão atual exibida e será recusada se outra alteração ocorrer.</p>
      <div className="flex gap-2"><button type="button" disabled={loading} onClick={apply} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{loading ? "Aplicando…" : "Confirmar aplicação"}</button><button type="button" disabled={loading} onClick={() => setReview(null)} className="rounded border px-4 py-2">Cancelar</button></div>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}

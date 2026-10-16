"use client";
import { useRef, useState } from "react";
import { applyFdmPricingPriceAction } from "@/lib/pricing/persistence-actions";
export function ApplyPricingButton({ pricingId, productVersion }: { pricingId: string; productVersion: number }) {
  const lock = useRef(false); const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");
  const apply = async () => { if (lock.current) return; lock.current = true; setLoading(true); const result = await applyFdmPricingPriceAction(pricingId, productVersion); setLoading(false); lock.current = false; setMessage(result.ok ? "Preço aplicado ao produto." : result.error); };
  return <div><button type="button" disabled={loading} onClick={apply} className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50">{loading ? "Aplicando…" : "Aplicar preço ao produto"}</button>{message && <p role="status" className="mt-2">{message}</p>}</div>;
}

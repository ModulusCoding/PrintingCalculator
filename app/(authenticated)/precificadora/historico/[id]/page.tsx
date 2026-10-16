import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPricingDetailAction } from "@/lib/pricing/persistence-actions";
import { ApplyPricingButton } from "@/components/pricing/ApplyPricingButton";

export const dynamic = "force-dynamic";
const brl = (value: unknown) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
export default async function PricingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const result = await fetchPricingDetailAction((await params).id);
  if (!result.ok && result.code === "not_found") notFound();
  if (!result.ok) return <main className="mx-auto max-w-4xl"><p role="alert">{result.error}</p></main>;
  const snapshot = result.data.snapshot as { result?: Record<string, unknown>; input?: Record<string, unknown>; product_snapshot?: { name?: string; version?: number } };
  return <main className="mx-auto max-w-4xl space-y-6"><Link href="/precificadora/historico" className="underline">Voltar ao histórico</Link><h1 className="text-3xl font-bold">Precificação salva</h1><section className="rounded border bg-white p-5"><h2 className="text-xl font-semibold">Resultado (somente leitura)</h2>{Object.entries(snapshot.result ?? {}).map(([key, value]) => <p key={key}>{key}: <strong>{typeof value === "number" ? brl(value) : String(value)}</strong></p>)}</section><section className="rounded border bg-white p-5"><h2 className="text-xl font-semibold">Fontes e entradas</h2><p>Produto: {snapshot.product_snapshot?.name ?? "—"}</p><pre className="mt-3 overflow-auto text-sm">{JSON.stringify(snapshot.input ?? {}, null, 2)}</pre></section>{typeof snapshot.product_snapshot?.version === "number" && <ApplyPricingButton pricingId={result.data.id} productVersion={snapshot.product_snapshot.version}/>}</main>;
}

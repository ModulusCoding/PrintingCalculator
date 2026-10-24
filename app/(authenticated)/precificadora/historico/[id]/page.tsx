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
  const snapshot = result.data.snapshot as { schema_version?: string | number; result?: Record<string, unknown>; input?: Record<string, unknown>; product_snapshot?: { name?: string; version?: number }; spool_snapshots?: Array<{ internal_identifier: string; material_type?: string; brand?: string }>; general_material_snapshots?: Array<{ name: string }> };
  return <main className="mx-auto max-w-4xl space-y-6"><Link href="/precificadora/historico" className="underline">Voltar ao histórico</Link><h1 className="text-3xl font-bold">Precificação salva (Versão {String(snapshot.schema_version)})</h1><section className="rounded border bg-white p-5"><h2 className="text-xl font-semibold">Resultado</h2>{Object.entries(snapshot.result ?? {}).map(([key, value]) => <p key={key}>{key}: <strong>{typeof value === "number" ? brl(value) : String(value)}</strong></p>)}</section><section className="rounded border bg-white p-5"><h2 className="text-xl font-semibold">Entradas e fontes</h2><p>Produto: {snapshot.product_snapshot?.name ?? "—"}</p>{snapshot.spool_snapshots && <p>Carretéis: {snapshot.spool_snapshots.map(s => s.internal_identifier).join(", ") || "nenhum"}</p>}{snapshot.general_material_snapshots && <p>Materiais gerais: {snapshot.general_material_snapshots.map(m => m.name).join(", ") || "nenhum"}</p>}<pre className="mt-3 overflow-auto text-sm">{JSON.stringify(snapshot.input ?? {}, null, 2)}</pre></section><ApplyPricingButton pricingId={result.data.id}/></main>;
}

import Link from "next/link";
import { listPricingHistoryAction } from "@/lib/pricing/persistence-actions";
import { isManualPricingSnapshot, PricingSnapshotSources } from "@/components/pricing/PricingSnapshotSources";

export const dynamic = "force-dynamic";
const brl = (value: string | number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export default async function PricingHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await listPricingHistoryAction({ page, limit: 20 });
  return <main className="mx-auto max-w-5xl space-y-6"><header><Link href="/precificadora" className="underline">Voltar à precificadora</Link><h1 className="mt-3 text-3xl font-bold">Histórico de precificações</h1></header>{!result.ok ? <p role="alert" className="rounded bg-red-50 p-4 text-red-700">{result.error}</p> : <><section className="space-y-2">{result.data.items.length === 0 ? <p className="rounded border bg-white p-6">Nenhuma precificação salva ainda.</p> : result.data.items.map((item) => <Link key={item.id} href={`/precificadora/historico/${item.id}`} className="flex justify-between rounded border bg-white p-4"><div><span>{new Date(item.created_at).toLocaleString("pt-BR")}</span>{isManualPricingSnapshot(item.snapshot) && <p className="text-sm font-semibold">V3 manual</p>}<PricingSnapshotSources snapshot={item.snapshot} /></div><strong>{brl(item.price_suggested_unit)}</strong></Link>)}</section><nav className="flex justify-between"><Link aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : "underline"} href={`?page=${page - 1}`}>Anterior</Link><span>Página {result.data.page} de {result.data.totalPages}</span><Link aria-disabled={page >= result.data.totalPages} className={page >= result.data.totalPages ? "pointer-events-none opacity-50" : "underline"} href={`?page=${page + 1}`}>Próxima</Link></nav></>}</main>;
}

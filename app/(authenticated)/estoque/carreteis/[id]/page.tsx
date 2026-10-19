import Link from "next/link";
import { notFound } from "next/navigation";
import { SpoolControls } from "@/components/spools/SpoolForms";
import { getSpool } from "@/lib/spools/actions";
import { formatCurrency, formatGrams, formatDate, formatPercent } from "@/lib/spools/format";
import { normalizeReturnTo } from "@/lib/spools/navigation";

type Query = { page?: string; returnTo?: string };

export default async function SpoolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params, q = await searchParams, page = Math.max(1, Number(q.page) || 1);
  const back = normalizeReturnTo(q.returnTo);
  const r = await getSpool(id, page);
  if (!r.spool) notFound();

  const s = r.spool, m = r.material, c = r.consumption, ctx = r.context;
  const pages = Math.max(1, Math.ceil(r.total / 20));
  const canWrite = ctx.role !== "operator" || true; // spools.write is in operator
  const canArchive = ctx.role === "owner" || ctx.role === "admin";
  
  const costPerGram = Number(s.purchase_price) / Number(s.original_filament_grams);
  const pct = (Number(s.current_balance_grams) / Number(s.original_filament_grams)) * 100;

  const translated: Record<string, string> = { opening: "Abertura", consumption: "Consumo", replenishment: "Reposição", adjustment: "Ajuste" };

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <Link className="text-sm text-indigo-700 underline" href={back}>← Voltar</Link>
          <h1 className="text-2xl font-bold">{s.internal_identifier}</h1>
          <p className="text-slate-600">
            {s.active ? "Ativo" : "Arquivado"} · {m.name} ({m.material_type}) {m.brand && `/ ${m.brand}`} {m.color && `/ ${m.color}`}
          </p>
        </div>

        <div className="rounded border bg-white p-5 space-y-4">
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold">{formatPercent(pct)}</span>
            <span className="text-slate-500 pb-1">restante</span>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t pt-4">
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Saldo atual</dt><dd className="text-lg font-medium">{formatGrams(s.current_balance_grams)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Peso original</dt><dd className="text-lg">{formatGrams(s.original_filament_grams)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Custo/g</dt><dd className="text-lg">{formatCurrency(costPerGram)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Preço pago</dt><dd className="text-lg">{formatCurrency(s.purchase_price)}</dd></div>
            <div className="col-span-2 border-t pt-3 mt-1">
              <dt className="text-xs font-semibold uppercase text-slate-500">Consumo total acumulado</dt>
              <dd className="text-xl font-semibold text-indigo-900">{formatGrams(c.total_consumed_grams)} ({formatCurrency(c.total_consumption_cost)})</dd>
            </div>
          </dl>
        </div>

        <div className="rounded border bg-white p-5">
          <h2 className="font-semibold mb-3">Histórico · {r.total} movimento(s)</h2>
          <div className="space-y-4">
            {r.movements.map(mov => (
              <div key={mov.id} className="text-sm border-b pb-3 last:border-0">
                <div className="flex justify-between font-medium">
                  <span>{translated[mov.movement_type] || mov.movement_type}</span>
                  <span className={mov.quantity_grams < 0 ? "text-red-600" : "text-emerald-600"}>
                    {mov.quantity_grams > 0 ? "+" : ""}{formatGrams(mov.quantity_grams)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>{mov.actor_id === ctx.userId ? "Você" : "Membro da equipe"} · {formatDate(mov.created_at)}</span>
                  <span>Saldo: {formatGrams(mov.balance_after_grams)}</span>
                </div>
                {mov.reason && <p className="mt-1 text-slate-700 italic">&ldquo;{mov.reason}&rdquo;</p>}
                {mov.movement_cost > 0 && <p className="mt-1 text-xs font-semibold">Custo: {formatCurrency(mov.movement_cost)}</p>}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <nav className="mt-4 flex gap-2">
              {page > 1 && <Link className="underline" href={`/estoque/carreteis/${s.id}?page=${page - 1}&returnTo=${encodeURIComponent(back)}`}>Anterior</Link>}
              <span>{page} / {pages}</span>
              {page < pages && <Link className="underline" href={`/estoque/carreteis/${s.id}?page=${page + 1}&returnTo=${encodeURIComponent(back)}`}>Próxima</Link>}
            </nav>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <SpoolControls spool={s} canWrite={canWrite} canArchive={canArchive} />
        <div className="rounded border bg-slate-50 p-5 text-sm">
          <h3 className="font-semibold mb-2">Detalhes do Material</h3>
          <p>Referência: {m.name}</p>
          <p>Peso ref.: {formatGrams(m.reference_weight_grams)}</p>
          <p>Preço ref.: {formatCurrency(m.reference_price)}</p>
        </div>
      </div>
    </section>
  );
}

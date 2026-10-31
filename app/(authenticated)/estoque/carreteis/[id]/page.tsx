import Link from "next/link";
import { notFound } from "next/navigation";
import { SpoolControls } from "@/components/spools/SpoolForms";
import { SpoolDeleteButton } from "@/components/spools/SpoolDeleteButton";
import { getSpool, getSpoolConfig } from "@/lib/spools/actions";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/auth/context";
import { SpoolDetail3D } from "@/components/spools/SpoolDetail3D";
import styles from "@/components/spools/SpoolPages.module.css";
import { formatCurrency, formatGrams, formatDate, formatPercent } from "@/lib/spools/format";
import { normalizeReturnTo } from "@/lib/spools/navigation";

type Query = { page?: string; returnTo?: string };

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidSpoolPage(props: Parameters<typeof SpoolPage>[0]) {
  return renderPaidModule("spools", "spools.read", () => SpoolPage(props));
}

async function SpoolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params, q = await searchParams, page = Math.min(5001, Math.max(1, Math.floor(Number(q.page) || 1)));
  const back = normalizeReturnTo(q.returnTo);
  const [r, config] = await Promise.all([getSpool(id, page), getSpoolConfig()]);
  if (!r.spool) {
    if (r.error === "spool_unavailable") notFound();
    return <section className={styles.page}><Link className={styles.textLink} href={back}>Voltar aos carretéis</Link><div className={styles.panel} role="alert"><h1>Não foi possível carregar o carretel</h1><p>Falha ao consultar os dados e o histórico. Tente novamente; o registro não foi considerado inexistente.</p></div></section>;
  }
  const threshold = config.error ? null : config.config?.low_spool_threshold_percent ?? null;

  const s = r.spool, c = r.consumption, ctx = r.context;
  const deleted = Boolean((s as typeof s & { deleted_at?: string | null }).deleted_at);
  const pages = Math.max(1, Math.ceil(r.total / 20));
  const canWrite = (ROLE_PERMISSIONS[ctx.role] as readonly Permission[]).includes("spools.write");
  const canArchive = ctx.role === "owner" || ctx.role === "admin";
  
  const costPerGram = Number(s.purchase_price) / Number(s.original_filament_grams);
  const pct = (Number(s.current_balance_grams) / Number(s.original_filament_grams)) * 100;

  const translated: Record<string, string> = { opening: "Abertura", consumption: "Consumo", replenishment: "Reposição", adjustment: "Ajuste" };

  return (
    <section className={`${styles.page} ${styles.detail}`}>
      <div className="space-y-4">
        <div>
          <Link className={styles.textLink} href={`${back}#spool-${s.id}`}>Fechar detalhes</Link>
          <h1 className="text-2xl font-bold">{s.internal_identifier}</h1>
          <p className="text-slate-600">
            {s.active ? "Ativo" : "Arquivado"} · {s.material_type ?? "tipo não informado"} {s.brand && `· ${s.brand}`} {s.color && `· ${s.color}`}
          </p>
        </div>

        <div className={styles.panel}>
          <SpoolDetail3D remainingGrams={s.current_balance_grams} referenceGrams={s.original_filament_grams} lowThresholdPercent={threshold} colorHex={s.color} label={s.internal_identifier} />
          {config.error && <p role="alert" className={styles.notice}>Limite de estoque baixo indisponível. Não foi aplicado um limite estimado.</p>}
          <p className={styles.muted}>{formatPercent(pct)} restante{threshold !== null && ` · Alerta com saldo positivo de até ${threshold}% do peso original.`}</p>
          <dl className="grid grid-cols-2 gap-4 border-t pt-4">
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Saldo atual</dt><dd className="text-lg font-medium">{formatGrams(s.current_balance_grams)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Peso original</dt><dd className="text-lg">{formatGrams(s.original_filament_grams)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-slate-500">Custo/g</dt><dd className="text-lg">{costPerGram.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 9 })}</dd></div>
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
            {r.movements.length === 0 && <p className={styles.muted}>Nenhuma movimentação nesta página.</p>}
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
            <nav className={styles.pagination} aria-label="Paginação de movimentações">
              {page > 1 && <Link className="underline" href={`/estoque/carreteis/${s.id}?page=${page - 1}&returnTo=${encodeURIComponent(back)}`}>Anterior</Link>}
              <span>{page} / {pages}</span>
              {page < pages && <Link className="underline" href={`/estoque/carreteis/${s.id}?page=${page + 1}&returnTo=${encodeURIComponent(back)}`}>Próxima</Link>}
            </nav>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {!deleted && <SpoolControls key={`${s.id}:${s.version}`} spool={s} canWrite={canWrite} canArchive={canArchive} />}
        {canArchive && s.active && !deleted && <SpoolDeleteButton id={s.id} version={s.version} returnTo={back} />}
        <div className="rounded border bg-slate-50 p-5 text-sm">
          <h3 className="font-semibold mb-2">Dados próprios do filamento</h3>
          <p>Identificação: {s.internal_identifier}</p>
          <p>Tipo: {s.material_type ?? "Não informado"}</p>
          <p>Marca: {s.brand ?? "Não informada"}</p>
          <p>Cor: {s.color ?? "Não informada"}</p>
          {s.material_id && <p className="mt-2 text-slate-500">Vínculo histórico com material de referência preservado.</p>}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { listSpools, getSpoolConfig } from "@/lib/spools/actions";
import { getDeletionCounts } from "@/lib/deletion/actions";
import { formatCurrency, formatGrams } from "@/lib/spools/format";
import { spoolDetailHref } from "@/lib/spools/navigation";
import { SpoolLevel2D } from "@/components/spools/SpoolLevel2D";
import { SpoolListFocus } from "@/components/spools/SpoolListFocus";
import styles from "@/components/spools/SpoolPages.module.css";
import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidSpoolsPage(props: Parameters<typeof SpoolsPage>[0]) {
  return renderPaidModule("spools", "spools.read", () => SpoolsPage(props));
}

async function SpoolsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const search = (q.search ?? "").trim().slice(0, 120);
  const statuses = { active: "Com saldo", low: "Estoque baixo", empty: "Esgotados", archived: "Arquivados", all: "Todos" };
  const status = q.status && Object.hasOwn(statuses, q.status) ? q.status as keyof typeof statuses : "active";
  const page = Math.min(5001, Math.max(1, Math.floor(Number(q.page) || 1)));
  const [r, config, deletionCounts] = await Promise.all([
    listSpools({ search, status, page: String(page) }), getSpoolConfig(), getDeletionCounts(),
  ]);
  const threshold = config.error ? null : config.config?.low_spool_threshold_percent ?? null;
  const registeredSpools = deletionCounts.counts?.filament_spools ?? null;
  const href = (nextPage: number) => `/estoque/carreteis?${new URLSearchParams({ search, status, page: String(nextPage) })}`;
  const pages = Math.max(1, Math.ceil(r.total / 20));

  return (
    <section className={styles.page}>
      <SpoolListFocus />
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Recursos FDM</p><h1>Carretéis</h1><p className={styles.muted}>Organize seus filamentos e acompanhe o saldo disponível na oficina.</p></div>
        <div className={styles.actions}><Link className={styles.secondary} href="/estoque/carreteis/configuracao">Configurar alerta</Link><Link className={styles.primary} href="/estoque/carreteis/novo">Novo carretel</Link></div>
      </header>
      <nav className={styles.tabs} aria-label="Recursos"><Link href="/materiais">Materiais</Link><Link href="/estoque/carreteis" aria-current="page">Carretéis{!r.error && <span>{r.total}</span>}</Link></nav>
      {deletionCounts.error && <p role="alert" className={styles.notice}>Falha técnica ao carregar a contagem geral de carretéis.</p>}
      {registeredSpools !== null && registeredSpools > 0 && !deletionCounts.error && <p role="status" className={styles.notice}>{registeredSpools} carretel(is) cadastrado(s), incluindo arquivados e esgotados, sem contar excluídos.</p>}
      {config.error && <p role="alert" className={styles.notice}>Não foi possível carregar o limite de estoque baixo. Os saldos continuam disponíveis, sem classificação por limite.</p>}
      <form className={styles.filters}>
        <label className={styles.search}>Buscar carretel<input name="search" defaultValue={search} maxLength={120} placeholder="Identificador, tipo, marca ou cor" /></label>
        <label>Status<select name="status" defaultValue={status}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className={styles.secondary} type="submit">Filtrar</button>
      </form>
      {r.error ? <div role="alert" className={styles.panel}><h2>Não foi possível carregar os carretéis</h2><p>Ocorreu uma falha ao consultar o estoque. Tente novamente.</p><Link className={styles.textLink} href={href(page)}>Tentar novamente</Link></div> : <>
        <p className={styles.muted}>{r.total} carretel(is) encontrado(s)</p>
        <div className={styles.cards}>
          {r.spools.map(s => {
            const low = s.active && s.current_balance_grams > 0 && threshold !== null && s.percent_remaining <= threshold;
            return <article key={s.id} className={styles.card}>
              <div className={styles.cardHeading}><span className={!s.active ? styles.badge : low || s.current_balance_grams === 0 ? styles.warningBadge : styles.badge}>{!s.active ? "Arquivado" : s.current_balance_grams === 0 ? "Esgotado" : low ? "Estoque baixo" : "Com saldo"}</span><h2>{s.internal_identifier}</h2><p className={styles.muted}>{s.material_type ?? "Tipo não informado"} · {s.brand ?? "Marca não informada"}</p></div>
              <SpoolLevel2D remainingGrams={s.current_balance_grams} referenceGrams={s.original_filament_grams} lowThresholdPercent={threshold} filamentColor={s.color} label={s.internal_identifier} />
              <div className={styles.cardMeta}><span>{s.color ?? "Cor não informada"}</span><span>Original: {formatGrams(s.original_filament_grams)}</span></div>
              <footer className={styles.cardFooter}><span>Total: {formatCurrency(s.purchase_price)}</span><Link id={`spool-${s.id}`} className={styles.textLink} href={spoolDetailHref(s.id, href(page))} prefetch={false}>Detalhes</Link></footer>
            </article>;
          })}
        </div>
        {r.spools.length === 0 && <div className={styles.empty}><h2>Nenhum carretel encontrado</h2><p>Altere os filtros ou cadastre um novo carretel para começar.</p><Link className={styles.textLink} href="/estoque/carreteis">Limpar filtros</Link></div>}
        {pages > 1 && <nav className={styles.pagination} aria-label="Paginação de carretéis">{page > 1 && <Link href={href(page - 1)}>Anterior</Link>}<span>Página {page} de {pages}</span>{page < pages && <Link href={href(page + 1)}>Próxima</Link>}</nav>}
        <aside className={styles.notice}>O saldo numérico informa a quantidade disponível. Registre consumo, reposição ou ajuste no detalhe de cada carretel.{threshold !== null && <> Estoque baixo: saldo positivo de até {threshold}% do peso original.</>}</aside>
      </>}
    </section>
  );
}

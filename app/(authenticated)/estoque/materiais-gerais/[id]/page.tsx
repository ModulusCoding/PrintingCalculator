import Link from "next/link";
import { notFound } from "next/navigation";
import { GeneralMaterialControls } from "@/components/general-materials/GeneralMaterialForms";
import { GeneralMaterialDeleteButton } from "@/components/general-materials/GeneralMaterialDeleteButton";
import { getGeneralMaterial } from "@/lib/general-materials/actions";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/general-materials/format";
import { normalizeReturnTo } from "@/lib/general-materials/navigation";
import { renderPaidModule } from "@/components/plans/PaidModuleGate";
import styles from "@/components/general-materials/GeneralMaterials.module.css";

type Query = { page?: string; returnTo?: string };
const movementLabels = { opening: "Saldo inicial", entry: "Entrada", consumption: "Consumo", adjustment: "Ajuste" };

export default function PaidGeneralMaterialPage(props: Parameters<typeof GeneralMaterialPage>[0]) {
  return renderPaidModule("generalMaterials", "stock.materials.read", () => GeneralMaterialPage(props));
}

async function GeneralMaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params, q = await searchParams, page = Math.min(5001, Math.max(1, Math.floor(Number(q.page) || 1)));
  const back = normalizeReturnTo(q.returnTo);
  const pageHref = (value: number) => `/estoque/materiais-gerais/${id}?returnTo=${encodeURIComponent(back)}&page=${value}`;
  const r = await getGeneralMaterial(id, page);
  if (!r.material) {
    if (r.error === "material_unavailable") notFound();
    return (
      <section className={styles.page}>
        <Link className={styles.link} href={back}>Voltar aos materiais</Link>
        <h1 className={styles.title}>Não foi possível carregar o material</h1>
        <div className={`${styles.notice} ${styles.error}`}>
          <p role="alert">{r.error === "permission_denied" ? "Sem permissão para ver este material." : r.error === "session_expired" ? "Sua sessão expirou." : `Erro técnico ao consultar o material. Código de suporte: ${r.correlation_id}.`}</p>
          <Link className={styles.link} href={pageHref(page)}>Tentar novamente</Link>
        </div>
      </section>
    );
  }

  const m = r.material, movs = r.movements, hist = r.history, ctx = r.context;
  const deleted = Boolean((m as typeof m & { deleted_at?: string | null }).deleted_at);
  const canWrite = ["owner", "admin", "operator"].includes(ctx.role);
  const canArchive = ["owner", "admin"].includes(ctx.role);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Estoque / Materiais gerais</p>
          <Link className={styles.link} href={back}>Voltar aos materiais</Link>
          <h1 className={styles.title}>{m.name}</h1>
          <p className={styles.subtitle}>Saldo, referência de custo e histórico do material.</p>
        </div>
        <span className={`${styles.badge} ${!m.active ? styles.archived : ""}`}>{m.active ? "Ativo" : "Arquivado"}</span>
      </header>

      <div className={styles.stats}>
        <dl className={styles.stat}><dt>Saldo atual</dt><dd>{formatQuantity(m.current_balance, m.control_unit)}</dd></dl>
        <dl className={styles.stat}><dt>Referência de custo</dt><dd>{formatCurrency(m.reference_price)}</dd><dd className={styles.statHint}>Para {m.reference_quantity} {m.control_unit}</dd></dl>
        <dl className={styles.stat}><dt>Unidade de controle</dt><dd>{m.control_unit}</dd></dl>
      </div>

      <div className={styles.actions}>
        {!deleted && canWrite && <GeneralMaterialControls key={`${m.id}:${m.version}`} material={m} canArchive={canArchive} />}
        {canArchive && m.active && !deleted && <GeneralMaterialDeleteButton id={m.id} version={m.version} />}
      </div>

      <section className={styles.panel} aria-labelledby="movements-heading">
        <div className={styles.panelHeading}><h2 id="movements-heading">Histórico de movimentações</h2><span className={styles.badge}>Página {page}</span></div>
        {movs.length === 0 ? (
          <div className={styles.empty}><strong>Nenhuma movimentação registrada nesta página</strong>{page > 1 ? "Volte à página anterior para consultar os registros disponíveis." : "As movimentações do material aparecerão aqui."}</div>
        ) : (
          <>
            <div className={styles.cards}>
              {movs.map((mv) => (
                <article key={mv.id} className={styles.card}>
                  <div className={styles.cardHeader}><h3 className={styles.cardTitle}>{movementLabels[mv.movement_type]}</h3><span className={styles.badge}>{formatCurrency(Number(mv.cost_signed))}</span></div>
                  <dl className={styles.cardData}>
                    <div className={styles.wide}><dt>Data</dt><dd>{formatDate(mv.created_at)}</dd></div>
                    <div><dt>Informado</dt><dd>{formatQuantity(mv.supplied_quantity, mv.supplied_unit)}</dd></div>
                    <div><dt>Na unidade de controle</dt><dd>{formatQuantity(mv.quantity_control, m.control_unit)}</dd></div>
                    <div><dt>Saldo antes</dt><dd>{formatQuantity(mv.balance_before, m.control_unit)}</dd></div>
                    <div><dt>Saldo depois</dt><dd>{formatQuantity(mv.balance_after, m.control_unit)}</dd></div>
                    <div className={styles.wide}><dt>Motivo</dt><dd>{mv.reason || "Não informado"}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th scope="col">Tipo</th><th scope="col">Informado</th><th scope="col">Na unidade de controle</th><th scope="col" className={styles.right}>Saldo antes</th><th scope="col" className={styles.right}>Saldo depois</th><th scope="col" className={styles.right}>Custo</th><th scope="col">Motivo</th><th scope="col">Data</th></tr></thead>
                <tbody>
                  {movs.map((mv) => (
                    <tr key={mv.id}>
                      <td>{movementLabels[mv.movement_type]}</td>
                      <td className={styles.numeric}>{formatQuantity(mv.supplied_quantity, mv.supplied_unit)}</td>
                      <td className={styles.numeric}>{formatQuantity(mv.quantity_control, m.control_unit)}</td>
                      <td className={`${styles.numeric} ${styles.right}`}>{formatQuantity(mv.balance_before, m.control_unit)}</td>
                      <td className={`${styles.numeric} ${styles.right}`}>{formatQuantity(mv.balance_after, m.control_unit)}</td>
                      <td className={`${styles.numeric} ${styles.right}`}>{formatCurrency(Number(mv.cost_signed))}</td>
                      <td>{mv.reason || "Não informado"}</td>
                      <td className={styles.numeric}>{formatDate(mv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <footer className={styles.pagination}>
          <span>{movs.length} movimentação(ões) nesta página · Até 20 por página</span>
          <nav aria-label="Paginação de movimentações">
            {page > 1 && <Link className={styles.secondary} href={pageHref(page - 1)}>Anterior</Link>}
            {movs.length === 20 && <Link className={styles.secondary} href={pageHref(page + 1)}>Próxima</Link>}
          </nav>
        </footer>
      </section>

      <section className={styles.panel} aria-labelledby="cost-heading">
        <div className={styles.panelHeading}><h2 id="cost-heading">Histórico de referência de custo</h2></div>
        <p className={`${styles.historyNote} ${styles.costNote}`}>Exibindo até 20 alterações mais recentes de referência de custo.</p>
        {hist.length === 0 ? (
          <div className={styles.empty}><strong>Sem alterações de referência registradas</strong>As atualizações de custo aparecerão aqui.</div>
        ) : (
          <>
            <div className={styles.cards}>
              {hist.map((h) => (
                <article key={h.id} className={styles.card}>
                  <h3 className={`${styles.cardTitle} ${styles.historyDate}`}>{formatDate(h.created_at)}</h3>
                  <dl className={styles.cardData}>
                    <div><dt>Antiga referência</dt><dd>{h.old_quantity} {m.control_unit} = {formatCurrency(h.old_price)}</dd></div>
                    <div><dt>Nova referência</dt><dd>{h.new_quantity} {m.control_unit} = {formatCurrency(h.new_price)}</dd></div>
                    <div className={styles.wide}><dt>Ator</dt><dd>{h.actor_id}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th scope="col">Antiga referência</th><th scope="col">Nova referência</th><th scope="col">Ator</th><th scope="col">Data</th></tr></thead>
                <tbody>
                  {hist.map((h) => (
                    <tr key={h.id}>
                      <td className={styles.numeric}>{h.old_quantity} {m.control_unit} = {formatCurrency(h.old_price)}</td>
                      <td className={styles.numeric}>{h.new_quantity} {m.control_unit} = {formatCurrency(h.new_price)}</td>
                      <td>{h.actor_id}</td>
                      <td className={styles.numeric}>{formatDate(h.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

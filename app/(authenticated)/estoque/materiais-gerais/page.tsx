import Link from "next/link";
import { listGeneralMaterials } from "@/lib/general-materials/actions";
import { getDeletionCounts } from "@/lib/deletion/actions";
import { formatQuantity, formatCurrency } from "@/lib/general-materials/format";
import { renderPaidModule } from "@/components/plans/PaidModuleGate";
import styles from "@/components/general-materials/GeneralMaterials.module.css";

export default function PaidGeneralMaterialsPage(props: Parameters<typeof GeneralMaterialsPage>[0]) {
  return renderPaidModule("generalMaterials", "stock.materials.read", () => GeneralMaterialsPage(props));
}

async function GeneralMaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const search = (q.search ?? "").trim().slice(0, 120);
  const status = ["active", "archived", "all"].includes(q.status ?? "") ? q.status! : "active";
  const page = Math.min(5001, Math.max(1, Math.floor(Number(q.page) || 1)));
  const [r, deletionCounts] = await Promise.all([
    listGeneralMaterials({ search, status, page: String(page) }),
    getDeletionCounts(),
  ]);
  const pageHref = (value: number) => `/estoque/materiais-gerais?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${value}`;
  const detailHref = (id: string) => `/estoque/materiais-gerais/${id}?returnTo=${encodeURIComponent(pageHref(page))}`;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Estoque / Insumos operacionais</p>
          <h1 className={styles.title}>Materiais gerais</h1>
          <p className={styles.subtitle}>Organize seus insumos e acompanhe saldos, custos e movimentações.</p>
        </div>
        <Link className={styles.primary} href="/estoque/materiais-gerais/novo">Novo material</Link>
      </header>

      {deletionCounts.error && <p role="alert" className={styles.notice}>Falha técnica ao carregar contagem de exclusões.</p>}
      {!deletionCounts.error && deletionCounts.counts && deletionCounts.counts.general_materials > 0 && (
        <p role="status" className={styles.notice}>{deletionCounts.counts.general_materials} material(is) excluído(s) (histórico preservado).</p>
      )}

      <div className={styles.panel}>
        <form className={styles.filters}>
          <label className={`${styles.field} ${styles.search}`} htmlFor="material-search">Buscar material
            <input id="material-search" name="search" defaultValue={search} placeholder="Buscar por nome" maxLength={120} />
          </label>
          <label className={styles.field} htmlFor="material-status">Situação
            <select id="material-status" name="status" defaultValue={status}>
              <option value="active">Ativos</option>
              <option value="archived">Arquivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <button className={styles.primary}>Filtrar</button>
        </form>
      </div>

      {r.error ? (
        <div className={`${styles.notice} ${styles.error}`}>
          <p role="alert">{r.error === "permission_denied" ? "Sem permissão para consultar materiais gerais." : r.error === "session_expired" ? "Sua sessão expirou." : `Não foi possível carregar os materiais. Código de suporte: ${r.correlation_id}.`}</p>
          <Link className={styles.link} href={pageHref(page)}>Tentar novamente</Link>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <h2>Materiais cadastrados</h2>
            <span className={styles.badge}>{r.total} resultado(s)</span>
          </div>
          {r.materials.length === 0 ? (
            <div className={styles.empty}><strong>Nenhum material encontrado</strong>Altere a busca ou a situação para consultar outros materiais.</div>
          ) : (
            <>
              <div className={styles.cards}>
                {r.materials.map((m) => (
                  <article key={m.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <h3 className={styles.cardTitle}><Link className={styles.link} href={detailHref(m.id)}>{m.name}</Link></h3>
                      <span className={`${styles.badge} ${!m.active ? styles.archived : ""}`}>{m.active ? "Ativo" : "Arquivado"}</span>
                    </div>
                    <dl className={styles.cardData}>
                      <div><dt>Unidade de controle</dt><dd>{m.control_unit}</dd></div>
                      <div><dt>Saldo atual</dt><dd>{formatQuantity(m.current_balance, m.control_unit)}</dd></div>
                      <div className={styles.wide}><dt>Referência de custo</dt><dd>{m.reference_quantity} {m.control_unit} = {formatCurrency(m.reference_price)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th scope="col">Material</th><th scope="col">Unidade</th><th scope="col">Referência de custo</th><th scope="col" className={styles.right}>Saldo atual</th><th scope="col">Situação</th><th scope="col">Ação</th></tr></thead>
                  <tbody>
                    {r.materials.map((m) => (
                      <tr key={m.id}>
                        <td><Link className={styles.link} href={detailHref(m.id)}>{m.name}</Link></td>
                        <td>{m.control_unit}</td>
                        <td className={styles.numeric}>{m.reference_quantity} {m.control_unit} = {formatCurrency(m.reference_price)}</td>
                        <td className={`${styles.numeric} ${styles.right}`}>{formatQuantity(m.current_balance, m.control_unit)}</td>
                        <td><span className={`${styles.badge} ${!m.active ? styles.archived : ""}`}>{m.active ? "Ativo" : "Arquivado"}</span></td>
                        <td><Link className={styles.link} href={detailHref(m.id)} aria-label={`Ver detalhes de ${m.name}`}>Ver detalhes</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <footer className={styles.pagination}>
            <span>Página {page} · {r.materials.length} material(is) nesta página</span>
            <nav aria-label="Paginação de materiais">
              {page > 1 && <Link className={styles.secondary} href={pageHref(page - 1)}>Anterior</Link>}
              {r.materials.length === 20 && <Link className={styles.secondary} href={pageHref(page + 1)}>Próxima</Link>}
            </nav>
          </footer>
        </div>
      )}
    </section>
  );
}

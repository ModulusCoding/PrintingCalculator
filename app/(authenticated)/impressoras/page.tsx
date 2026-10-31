import { Info, Plus, Printer, Search } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { listPrinters, type PrinterRecord } from "@/lib/printers/actions";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { renderPaidModule } from "@/components/plans/PaidModuleGate";
import styles from "@/components/printers/PrinterList.module.css";

export const dynamic = "force-dynamic";

export default function PaidPrintersPage(props: Parameters<typeof PrintersPage>[0]) {
  return renderPaidModule("printers", "printers.read", () => PrintersPage(props));
}

const currency = (value: string, maximumFractionDigits = 2) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits });

function PrinterCard({ printer }: { printer: PrinterRecord }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.printerIcon}><Printer size={28} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className={printer.active ? styles.active : styles.archived}>{printer.active ? "Ativa" : "Arquivada"}</span>
      </div>
      <h2 className={styles.cardTitle}>{printer.name}</h2>
      <dl className={styles.identity}>
        <div><dt>Marca</dt><dd>{printer.brand || "Não informada"}</dd></div>
        <div><dt>Modelo</dt><dd>{printer.model || "Não informado"}</dd></div>
      </dl>
      <dl className={styles.parameters}>
        <div><dt>Potência média</dt><dd>{printer.average_power_watts.replace(".", ",")} <span>W</span></dd></div>
        <div><dt>Valor de compra</dt><dd>{currency(printer.purchase_price)}</dd></div>
        <div><dt>Vida útil estimada</dt><dd>{Number(printer.estimated_life_hours).toLocaleString("pt-BR")} <span>h</span></dd></div>
        <div><dt>Manutenção por hora</dt><dd>{currency(printer.maintenance_cost_per_hour, 4)} <span>/ h</span></dd></div>
      </dl>
      <Link href={`/impressoras/${printer.id}`} className={styles.details} aria-label={`Ver detalhes de ${printer.name}`}>Ver detalhes</Link>
    </li>
  );
}

async function PrintersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const result = await listPrinters(p);
  const canWrite = await requireBusinessContext("printers.write").then(() => true).catch((error: unknown) => {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  });
  const pages = Math.max(1, Math.ceil(result.total / 20));
  const url = (page: number) => {
    const params = new URLSearchParams();
    Object.entries(p).forEach(([key, value]) => { if (value !== undefined) params.set(key, value); });
    params.set("page", String(page));
    return `/impressoras?${params}`;
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Recursos / Impressoras</p>
          <h1>Impressoras</h1>
          <p className={styles.subtitle}>Gerencie seu parque de impressão e os parâmetros técnicos de cada máquina.</p>
        </div>
        {canWrite && <Link href="/impressoras/nova" className={styles.primary}><Plus size={18} aria-hidden="true" />Nova impressora</Link>}
      </header>

      <form className={styles.filters} action="/impressoras" method="get" role="search" aria-label="Filtrar impressoras">
        {Object.entries(p).filter(([key, value]) => !["search", "status", "page"].includes(key) && value !== undefined).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <div className={styles.searchField}>
          <label htmlFor="printer-search">Pesquisar impressoras</label>
          <div className={styles.searchInput}><Search size={18} aria-hidden="true" /><input id="printer-search" name="search" type="search" defaultValue={result.search} maxLength={200} placeholder="Nome, marca ou modelo" /></div>
        </div>
        <div className={styles.statusField}>
          <label htmlFor="printer-status">Situação</label>
          <select id="printer-status" name="status" defaultValue={result.status}>
            <option value="active">Ativas</option>
            <option value="archived">Arquivadas</option>
            <option value="all">Todas</option>
          </select>
        </div>
        <button type="submit" className={styles.filterButton}>Buscar</button>
      </form>

      <p className={styles.advisory}><Info size={18} aria-hidden="true" /><span>Os parâmetros cadastrados de cada impressora estão disponíveis abaixo. Consulte os detalhes para gerenciar a máquina.</span></p>

      {result.error ? (
        <div role="alert" className={styles.error}><h2>Não foi possível carregar as impressoras.</h2><p>Tente buscar novamente em alguns instantes.</p><Link href={url(result.page)}>Tentar novamente</Link></div>
      ) : result.printers.length === 0 ? (
        <div className={styles.state}><Printer size={32} aria-hidden="true" /><h2>Nenhuma impressora encontrada.</h2><p>Revise o termo pesquisado ou selecione outra situação.</p></div>
      ) : (
        <section aria-label="Impressoras encontradas">
          <p className={styles.resultCount}>{result.total} {result.total === 1 ? "impressora encontrada" : "impressoras encontradas"}</p>
          <ul className={styles.grid}>{result.printers.map((printer) => <PrinterCard key={printer.id} printer={printer} />)}</ul>
        </section>
      )}

      {!result.error && <nav className={styles.pagination} aria-label="Paginação de impressoras">
        {result.page <= 1 ? <span className={styles.disabled} aria-disabled="true">Anterior</span> : <Link href={url(result.page - 1)} rel="prev">Anterior</Link>}
        <span className={styles.pageNumber}>Página {result.page} de {pages}</span>
        {result.page >= pages ? <span className={styles.disabled} aria-disabled="true">Próxima</span> : <Link href={url(result.page + 1)} rel="next">Próxima</Link>}
      </nav>}
    </div>
  );
}

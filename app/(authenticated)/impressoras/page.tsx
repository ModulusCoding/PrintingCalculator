import { listPrinters, type PrinterRecord } from "@/lib/printers/actions";
import Link from "next/link";
import { requireBusinessContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function PrintersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const result = await listPrinters(p);
  const canWrite = await requireBusinessContext("printers.write").then(() => true).catch(() => false);
  const pages = Math.max(1, Math.ceil(result.total / 20));
  const url = (page: number, overrides: Record<string, string> = {}) => `/impressoras?${new URLSearchParams({ ...p, ...overrides, page: String(page) })}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Impressoras</h1>
          <p className="text-slate-500">Gestão de parque de impressão.</p>
        </div>
        {canWrite && (
          <Link href="/impressoras/nova" className="rounded bg-violet-600 px-4 py-2 text-white">Nova impressora</Link>
        )}
      </header>

      <form className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="printer-search">Pesquisar</label><input id="printer-search" name="search" defaultValue={result.search} maxLength={200} placeholder="Nome, marca ou modelo" className="rounded border p-2" />
        <select name="status" defaultValue={result.status} className="rounded border p-2">
          <option value="active">Ativas</option>
          <option value="archived">Arquivadas</option>
          <option value="all">Todas</option>
        </select>
        <button className="rounded border px-4">Buscar</button>
      </form>

      {result.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-700">Não foi possível carregar as impressoras.</p>
      ) : result.printers.length === 0 ? (
        <p className="rounded border p-6 text-slate-600">Nenhuma impressora encontrada.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-50 text-sm">
                <th className="p-3 text-left">Nome</th>
                <th className="p-3 text-left">Marca/Modelo</th>
                <th className="p-3 text-right">Potência (W)</th>
                <th className="p-3">Status</th>
                <th className="p-3">Ação</th>
              </tr>
            </thead>
            <tbody>
              {result.printers.map((p: PrinterRecord) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 text-sm">{p.brand} {p.model}</td>
                  <td className="p-3 text-right">{p.average_power_watts.replace('.', ',')}</td>
                  <td className="p-3 text-center text-sm">{p.active ? "Ativa" : "Arquivada"}</td>
                  <td className="p-3 text-center">
                    <Link href={`/impressoras/${p.id}`} className="text-violet-700 underline">Detalhes</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="flex justify-between" aria-label="Paginação">
        <Link aria-disabled={result.page <= 1} className={result.page <= 1 ? "pointer-events-none opacity-50" : undefined} href={url(Math.max(1, result.page - 1))}>Anterior</Link>
        <span>Página {result.page} de {pages}</span>
        <Link aria-disabled={result.page >= pages} className={result.page >= pages ? "pointer-events-none opacity-50" : undefined} href={url(Math.min(pages, result.page + 1))}>Próxima</Link>
      </nav>
    </div>
  );
}

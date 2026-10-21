import Link from "next/link";
import { listSpools, getSpoolConfig } from "@/lib/spools/actions";
import { formatGrams, formatPercent } from "@/lib/spools/format";
import { spoolDetailHref } from "@/lib/spools/navigation";

export default async function SpoolsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const search = (q.search ?? "").trim().slice(0, 120);
  const status = q.status ?? "active";
  const page = Math.max(1, Number(q.page) || 1);
  const [r, config] = await Promise.all([listSpools({ search, status, page: String(page) }), getSpoolConfig()]);
  
  const threshold = config.config?.low_spool_threshold_percent ?? 10;
  
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Carretéis</h1>
          <p className="text-slate-600">Gestão física de estoque de filamento.</p>
        </div>
        <Link className="rounded bg-indigo-700 px-4 py-2 text-white" href="/estoque/carreteis/novo">Novo carretel</Link>
      </div>
      
      <form className="flex flex-wrap gap-2 rounded border bg-white p-4">
        <input name="search" defaultValue={search} placeholder="Identificador, nome, tipo, marca ou cor" className="rounded border p-2 flex-1" />
        <select name="status" defaultValue={status} className="rounded border p-2">
          {["active", "low", "empty", "archived", "all"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="rounded border px-3">Filtrar</button>
      </form>
      
      {r.error ? <p role="alert" className="text-red-700">Falha ao carregar lista.</p> : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                {["Identificador", "Filamento", "Saldo", "Status"].map(h => <th key={h} className="p-3">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.spools.map((s) => (
                <tr key={s.id} className="border-b hover:bg-slate-50">
                  <td className="p-3 font-medium">
                    <Link className="text-indigo-700 underline" href={spoolDetailHref(s.id, `/estoque/carreteis?search=${search}&status=${status}&page=${page}`)}>
                      {s.internal_identifier}
                    </Link>
                  </td>
                  <td className="p-3">{s.internal_identifier} · {s.material_type ?? "—"} <span className="text-slate-400">{s.brand} {s.color && `· ${s.color}`}</span></td>
                  <td className="p-3">
                    {formatGrams(s.current_balance_grams)}
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${Number(s.percent_remaining) <= threshold ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {formatPercent(s.percent_remaining)}
                    </span>
                  </td>
                  <td className="p-3 capitalize">{s.active ? "Ativo" : "Arquivado"}</td>
                </tr>
              ))}
              {r.spools.length === 0 && <tr><td colSpan={4} className="p-4 text-center">Nenhum registro encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

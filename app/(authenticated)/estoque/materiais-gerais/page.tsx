import Link from "next/link";
import { listGeneralMaterials } from "@/lib/general-materials/actions";
import { getDeletionCounts } from "@/lib/deletion/actions";
import { formatQuantity, formatCurrency } from "@/lib/general-materials/format";
import type { Material } from "@/lib/general-materials/schemas";

export default async function GeneralMaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const search = (q.search ?? "").trim().slice(0, 120);
  const status = q.status ?? "active";
  const page = Math.max(1, Number(q.page) || 1);
  const [r, deletionCounts] = await Promise.all([
    listGeneralMaterials({ search, status, page: String(page) }),
    getDeletionCounts(),
  ]);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Materiais gerais</h1>
          <p className="text-slate-600">Controle de insumos operacionais e estoque.</p>
        </div>
        <Link className="rounded bg-indigo-700 px-4 py-2 text-white" href="/estoque/materiais-gerais/novo">Novo material</Link>
      </div>

      {deletionCounts.error && <p role="alert" className="rounded bg-amber-50 p-2 text-xs text-amber-700">Falha técnica ao carregar contagem de exclusões.</p>}
      {!deletionCounts.error && deletionCounts.counts && deletionCounts.counts.general_materials > 0 && (
        <p role="status" className="rounded bg-indigo-50 p-2 text-xs text-indigo-700">{deletionCounts.counts.general_materials} material(is) excluído(s) (histórico preservado).</p>
      )}

      <form className="flex gap-2">
        <input name="search" defaultValue={search} placeholder="Buscar por nome" className="flex-1 rounded border p-2" maxLength={120} />
        <select name="status" defaultValue={status} className="rounded border p-2">
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </select>
        <button className="rounded bg-indigo-700 px-4 py-2 text-white">Filtrar</button>
      </form>

      {r.error && <div className="rounded bg-red-50 p-3 text-red-700"><p role="alert">{r.error === "permission_denied" ? "Sem permissão para consultar materiais gerais." : r.error === "session_expired" ? "Sua sessão expirou." : `Não foi possível carregar os materiais. Código de suporte: ${r.correlation_id}.`}</p><Link className="mt-2 inline-block underline" href={`/estoque/materiais-gerais?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${page}`}>Tentar novamente</Link></div>}

      {!r.error && r.materials.length === 0 ? (
        <p className="text-slate-500">Nenhum material encontrado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="p-3 text-left">Nome</th>
              <th className="p-3 text-left">Unidade</th>
              <th className="p-3 text-left">Referência</th>
              <th className="p-3 text-right">Saldo</th>
              <th className="p-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {r.materials.map((m: Material) => (
              <tr key={m.id} className="border-t">
                <td className="p-3"><Link className="text-indigo-700 underline" href={`/estoque/materiais-gerais/${m.id}`}>{m.name}</Link></td>
                <td className="p-3">{m.control_unit}</td>
                <td className="p-3">{m.reference_quantity} {m.control_unit} = {formatCurrency(m.reference_price)}</td>
                <td className="p-3 text-right">{formatQuantity(m.current_balance, m.control_unit)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-1 rounded ${m.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                    {m.active ? "Ativo" : "Arquivado"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-center gap-2">
        {page > 1 && (
          <Link className="rounded border p-2" href={`/estoque/materiais-gerais?search=${encodeURIComponent(search)}&status=${status}&page=${page - 1}`}>Anterior</Link>
        )}
        {r.materials.length === 20 && (
          <Link className="rounded border p-2" href={`/estoque/materiais-gerais?search=${encodeURIComponent(search)}&status=${status}&page=${page + 1}`}>Próxima</Link>
        )}
      </div>
    </section>
  );
}
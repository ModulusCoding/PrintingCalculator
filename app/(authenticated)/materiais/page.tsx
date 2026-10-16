import Link from "next/link";
import { requireBusinessContext } from "@/lib/auth/context";
import { listMaterials, type MaterialRecord } from "@/lib/materials/actions";

export const dynamic = "force-dynamic";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const result = await listMaterials(params);
  const canWrite = await requireBusinessContext("materials.write").then(() => true).catch(() => false);
  const canArchive = await requireBusinessContext("materials.archive").then(() => true).catch(() => false);
  const pages = Math.max(1, Math.ceil(result.total / 20));
  const query = new URLSearchParams();
  if (result.search) query.set("search", result.search);
  query.set("status", result.status);
  query.set("page", String(result.page));
  const returnTo = `/materiais?${query.toString()}`;
  const pageUrl = (page: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(page));
    return `/materiais?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-3xl font-bold">Materiais</h1><p className="text-slate-500">Referências de filamentos FDM da empresa.</p></div>
        {canWrite && <Link href={`/materiais/novo?returnTo=${encodeURIComponent(returnTo)}`} className="rounded bg-violet-600 px-4 py-2 text-white">Novo material</Link>}
      </header>

      <form className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="material-search">Pesquisar</label>
        <input id="material-search" name="search" defaultValue={result.search} maxLength={200} placeholder="Nome, tipo, marca ou cor" className="rounded border p-2" />
        <select name="status" defaultValue={result.status} className="rounded border p-2">
          <option value="active">Disponíveis</option><option value="archived">Arquivados</option><option value="all">Todos</option>
        </select>
        <button className="rounded border px-4">Buscar</button>
      </form>

      {result.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-700">Não foi possível carregar os materiais.</p>
      ) : result.materials.length === 0 ? (
        <p className="rounded border p-6 text-slate-600">Nenhum material encontrado.</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50"><th className="p-3 text-left">Nome</th><th className="p-3 text-left">Tipo</th><th className="p-3 text-left">Marca</th><th className="p-3 text-left">Cor</th><th className="p-3 text-right">Peso (g)</th><th className="p-3 text-right">Preço</th><th className="p-3 text-right">R$/g</th><th className="p-3">Situação</th><th className="p-3">Ação</th></tr></thead>
            <tbody>{result.materials.map((material: MaterialRecord) => (
              <tr key={material.id} className="border-t">
                <td className="p-3 font-medium">{material.name}</td><td className="p-3">{material.material_type}</td><td className="p-3">{material.brand || "—"}</td><td className="p-3">{material.color || "—"}</td><td className="p-3 text-right">{material.reference_weight_grams.replace(".", ",")}</td><td className="p-3 text-right">R$ {material.reference_price.replace(".", ",")}</td><td className="p-3 text-right">R$ {material.cost_per_gram.replace(".", ",")}</td><td className="p-3 text-center">{material.active ? "Disponível" : "Arquivado"}</td>
                <td className="p-3 text-center"><Link href={`/materiais/${material.id}?returnTo=${encodeURIComponent(returnTo)}`} className="text-violet-700 underline">{canWrite || canArchive ? "Detalhes" : "Consultar"}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <nav className="flex justify-between" aria-label="Paginação"><Link aria-disabled={result.page <= 1} className={result.page <= 1 ? "pointer-events-none opacity-50" : undefined} href={pageUrl(Math.max(1, result.page - 1))}>Anterior</Link><span>Página {result.page} de {pages} — {result.total} material(is)</span><Link aria-disabled={result.page >= pages} className={result.page >= pages ? "pointer-events-none opacity-50" : undefined} href={pageUrl(Math.min(pages, result.page + 1))}>Próxima</Link></nav>
    </div>
  );
}

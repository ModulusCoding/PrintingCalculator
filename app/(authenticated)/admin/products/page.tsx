import Link from "next/link";
import { requireBusinessContext } from "@/lib/auth/context";
import { listInternalProducts } from "@/lib/products/actions";
import { ProductArchiveButton } from "@/components/admin/ProductArchiveButton";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const result = await listInternalProducts(params);
  const canWrite = await requireBusinessContext("products.write").then(() => true).catch(() => false);
  const canDelete = await requireBusinessContext("products.delete").then(() => true).catch(() => false);
  const pages = Math.max(1, Math.ceil(result.total / 20));
  const query = new URLSearchParams({ ...(result.search ? { search: result.search } : {}), status: result.status, page: String(result.page) });
  const url = (page: number) => `/admin/products?${new URLSearchParams({ ...(result.search ? { search: result.search } : {}), status: result.status, page: String(page) })}`;

  return <div className="space-y-6">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-bold">Produtos</h1><p className="text-slate-500">Produtos internos da empresa.</p></div>{canWrite && <Link href="/admin/products/new" className="rounded bg-violet-600 px-4 py-2 text-white">Novo produto</Link>}</header>
    <form className="flex flex-wrap gap-2"><input name="search" defaultValue={result.search} maxLength={200} placeholder="Buscar por nome" aria-label="Buscar por nome" className="rounded border p-2"/><select name="status" defaultValue={result.status} aria-label="Status" className="rounded border p-2"><option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select><button className="rounded border px-4">Buscar</button></form>
    {result.error ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">Não foi possível carregar os produtos. Tente novamente.</p> : <>
      {result.products.length === 0 ? <p className="rounded border p-6 text-slate-600">Nenhum produto encontrado para os filtros selecionados.</p> : <div className="overflow-x-auto rounded border"><table className="w-full"><thead><tr><th className="p-3 text-left">Nome</th><th className="p-3 text-left">Preço</th><th className="p-3">Status</th><th className="p-3">Ação</th></tr></thead><tbody>{result.products.map(p => <tr key={p.id} className="border-t"><td className="p-3">{p.name}</td><td className="p-3">{p.price == null ? "Sob consulta" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(p.price))}</td><td className="p-3 text-center">{p.active ? "Ativo" : "Arquivado"}</td><td className="p-3"><div className="flex justify-center gap-3">{(p.active && canWrite) || (!p.active && canDelete) ? <Link href={`/admin/products/${p.id}`} className="underline">{p.active ? "Editar" : "Visualizar"}</Link> : <Link href={`/admin/products/${p.id}`} className="underline">Visualizar</Link>}{canDelete && <ProductArchiveButton id={p.id} version={p.version} active={p.active} returnTo={`/admin/products?${query}`} />}</div></td></tr>)}</tbody></table></div>}
      <nav className="flex justify-between" aria-label="Paginação"><Link aria-disabled={result.page <= 1} className={result.page <= 1 ? "pointer-events-none opacity-50" : undefined} href={url(Math.max(1, result.page - 1))}>Anterior</Link><span>Página {result.page} de {pages}</span><Link aria-disabled={result.page >= pages} className={result.page >= pages ? "pointer-events-none opacity-50" : undefined} href={url(Math.min(pages, result.page + 1))}>Próxima</Link></nav>
    </>}
  </div>;
}

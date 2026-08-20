import Link from "next/link";
import { Plus, Edit, CheckCircle2, XCircle } from "lucide-react";
import { getCatalogs } from "@/lib/catalogs/actions";
import { ShareLinkButton } from "@/components/admin/ShareLinkButton";
import { DeleteCatalogButton } from "@/components/admin/DeleteCatalogButton";

export default async function CatalogsPage() {
  const { catalogs, error } = await getCatalogs();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Administração</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Catálogos</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Gerencie suas vitrines públicas e links de compartilhamento.
          </p>
        </div>
        <Link
          href="/admin/catalogs/new"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-md shadow-blue-600/20"
        >
          <Plus className="h-4 w-4" />
          Novo Catálogo
        </Link>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          {error}
        </div>
      )}

      {catalogs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-12 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <svg className="h-7 w-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Nenhum catálogo cadastrado</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Crie seu primeiro catálogo para começar a exibir produtos.</p>
          <Link
            href="/admin/catalogs/new"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Criar Primeiro Catálogo
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Catálogo</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden md:table-cell">Produtos</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Link Público</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {catalogs.map((catalog) => (
                <tr key={catalog.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {catalog.logo_url ? (
                        <img
                          src={catalog.logo_url}
                          alt={catalog.name}
                          className="h-10 w-10 rounded-lg object-cover bg-slate-100 dark:bg-slate-800"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                          <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">
                            {catalog.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{catalog.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          /catalogo/{catalog.slug}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell text-sm text-slate-600 dark:text-slate-400">
                    {catalog.product_count || 0} produtos
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        catalog.active
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {catalog.active ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" /> Ativo
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3" /> Inativo
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <ShareLinkButton slug={catalog.slug} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/catalogs/${catalog.id}`}
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Editar"
                      >
                        <Edit className="h-4 w-4" />
                      </Link>
                      <DeleteCatalogButton catalogId={catalog.id} catalogName={catalog.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


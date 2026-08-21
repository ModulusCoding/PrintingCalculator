import Link from "next/link";
import { FolderKanban, Package, CheckCircle2, Plus } from "lucide-react";
import { getDashboardStats } from "@/lib/catalogs/actions";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats();
  const cards = [
    { label: "Catálogos", value: stats.totalCatalogs, icon: FolderKanban, color: "blue" },
    { label: "Catálogos ativos", value: stats.activeCatalogs, icon: CheckCircle2, color: "emerald" },
    { label: "Produtos", value: stats.totalProducts, icon: Package, color: "violet" },
    { label: "Produtos ativos", value: stats.activeProducts, icon: CheckCircle2, color: "amber" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Administração</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Visão geral</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Gerencie os catálogos e produtos da Modulus.</p>
        </div>
      </div>

      {stats.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{stats.error} Configure o Supabase para exibir os dados.</div> : null}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-${color}-100 text-${color}-600`}><Icon className="h-5 w-5" /></div>
            <p className="mt-4 text-3xl font-bold">{value}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{label}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <FolderKanban className="h-7 w-7 text-blue-600" />
          <h2 className="mt-4 text-xl font-bold">Catálogos</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Crie vitrines, defina links públicos e organize seus produtos.</p>
          <Link href="/admin/catalogs/new" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="h-4 w-4" />Novo catálogo</Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <Package className="h-7 w-7 text-violet-600" />
          <h2 className="mt-4 text-xl font-bold">Produtos</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Cadastre produtos uma única vez e associe-os a vários catálogos.</p>
          <Link href="/admin/products/new" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700"><Plus className="h-4 w-4" />Novo produto</Link>
        </div>
      </section>
    </div>
  );
}

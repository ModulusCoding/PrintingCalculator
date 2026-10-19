import Link from "next/link";
import { NewSpoolForm } from "@/components/spools/SpoolForms";
import { searchMaterials } from "@/lib/spools/actions";

export default async function NewSpoolPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string; returnTo?: string }> }) {
  const q = await searchParams, search = typeof q.search === "string" ? q.search : "", page = Math.max(1, Number(q.page) || 1);
  const r = await searchMaterials({ search, page }), pages = Math.max(1, Math.ceil(r.total / 20));

  return (
    <section className="max-w-xl space-y-4">
      <div>
        <Link className="text-sm text-indigo-700 underline" href="/estoque/carreteis">← Voltar</Link>
        <h1 className="text-2xl font-bold mt-1">Novo carretel</h1>
      </div>
      <p className="text-sm text-slate-600">
        Cadastre um carretel informando o material de referência, identificador interno, peso total do carretel cheio e o saldo com o qual o estoque físico inicia.
      </p>
      <form className="flex gap-2">
        <input name="search" defaultValue={search} placeholder="Buscar material" className="rounded border p-2 flex-1" />
        <button className="rounded border px-3">Buscar</button>
      </form>
      {r.error && <p role="alert" className="text-red-700">Falha ao buscar materiais.</p>}
      <NewSpoolForm materials={r.items} />
      {pages > 1 && (
        <nav className="flex gap-3 text-sm">
          {page > 1 && <Link className="underline" href={`/estoque/carreteis/novo?search=${encodeURIComponent(search)}&page=${page - 1}`}>Anterior</Link>}
          <span>Página {page} de {pages}</span>
          {page < pages && <Link className="underline" href={`/estoque/carreteis/novo?search=${encodeURIComponent(search)}&page=${page + 1}`}>Próxima</Link>}
        </nav>
      )}
    </section>
  );
}

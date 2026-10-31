export default function HomeLoading() {
  return <section aria-busy="true" aria-label="Carregando dashboard" className="space-y-6">
    <p role="status" className="text-sm text-slate-600">Carregando sua visão geral…</p>
    <div aria-hidden="true" className="grid gap-4 min-[560px]:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(key => <div key={key} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />)}</div>
    <div aria-hidden="true" className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
  </section>;
}

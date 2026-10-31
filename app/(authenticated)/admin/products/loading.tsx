export default function ProductsLoading() {
  return <section role="status" aria-live="polite" className="mx-auto max-w-[1440px] space-y-5"><span className="sr-only">Carregando produtos…</span><div aria-hidden="true" className="space-y-5"><div className="h-10 w-40 rounded-lg bg-slate-200" /><div className="h-24 rounded-xl border border-slate-200 bg-white" />{[0, 1, 2].map(row => <div key={row} className="h-28 rounded-xl border border-slate-200 bg-white p-5"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="mt-4 h-4 w-1/3 rounded bg-slate-100" /></div>)}</div></section>;
}

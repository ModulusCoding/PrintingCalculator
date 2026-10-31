export default function PrintersLoading() {
  return <section role="status" className="space-y-5 rounded-2xl bg-slate-50 p-5 text-[#152336]" aria-label="Carregando impressoras"><p className="font-medium">Carregando impressoras...</p><div aria-hidden="true" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(item => <div key={item} className="h-64 rounded-xl border border-slate-200 bg-white" />)}</div></section>;
}

export default function GeneralMaterialsLoading() {
  return <section role="status" aria-label="Carregando materiais gerais" className="space-y-5 rounded-2xl bg-slate-50 p-5 text-[#152336]">
    <p className="font-medium">Carregando materiais gerais...</p>
    <div aria-hidden="true" className="space-y-4">{[1, 2, 3].map(item => <div key={item} className="h-24 rounded-xl border border-slate-200 bg-white" />)}</div>
  </section>;
}

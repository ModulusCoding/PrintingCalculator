export default function CompanyLoading() {
  return (
    <div role="status" aria-label="Carregando dados da empresa" aria-busy="true" className="mx-auto w-full max-w-6xl space-y-6">
      <span className="sr-only">Carregando dados da empresa…</span>
      <div aria-hidden="true" className="rounded-3xl border border-[#e6e2f0] bg-white p-6 sm:p-8">
        <div className="mb-6 h-3 w-32 rounded bg-[#eeebf8] motion-safe:animate-pulse" />
        <div className="flex items-center gap-5">
          <div className="h-20 w-20 shrink-0 rounded-2xl bg-[#eeebf8] motion-safe:animate-pulse" />
          <div className="w-full max-w-md space-y-4">
            <div className="h-7 w-3/4 rounded bg-[#eeebf8] motion-safe:animate-pulse" />
            <div className="h-4 w-full rounded bg-[#f5f3fa] motion-safe:animate-pulse" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          {[0, 1].map(item => <div key={item} className="space-y-5 rounded-2xl border border-[#e6e2f0] bg-white p-6"><div className="h-5 w-48 rounded bg-[#eeebf8] motion-safe:animate-pulse" /><div className="h-12 rounded-xl bg-[#f5f3fa] motion-safe:animate-pulse" /><div className="h-10 w-36 rounded-xl bg-[#eeebf8] motion-safe:animate-pulse" /></div>)}
        </div>
        <div className="h-60 rounded-2xl border border-[#e6e2f0] bg-[#f8f7fc]" />
      </div>
    </div>
  );
}

import Link from "next/link";
import { Layers, Plus } from "lucide-react";

export function CreationLimitNotice({ moduleLabel, used, limit, backHref }: {
  moduleLabel: string;
  used: number;
  limit: number;
  backHref: string;
}) {
  return (
    <section className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-[#c7c4d9] bg-white p-6 shadow-sm sm:p-10" aria-labelledby="creation-limit-title">
      <div aria-hidden="true" className="flex h-28 items-center justify-center gap-4 rounded-xl bg-[#f2eeff] text-[#5852ff]">
        <Layers className="size-12" /><Plus className="size-7" />
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[#3d32e6]">Limite de novos cadastros atingido</p>
        <h1 id="creation-limit-title" className="text-3xl font-bold text-[#152336]">{moduleLabel}</h1>
        <p role="status" className="text-[#464556]">Você utiliza {used} de {limit} cadastros disponíveis no seu plano.</p>
        <p className="text-sm text-[#464556]">O limite se aplica apenas à criação. Seus registros continuam disponíveis para consulta e movimentação.</p>
      </div>
      <nav className="flex flex-wrap items-center gap-4">
        <Link href="/planos" className="rounded-xl bg-[#5852ff] px-5 py-3 font-semibold text-white">Comparar planos</Link>
        <Link href={backHref} className="font-medium text-[#3d32e6] underline">Voltar para {moduleLabel}</Link>
      </nav>
      <p className="text-xs text-[#464556]">Compare os planos sem alterar sua escolha atual. A contratação ainda está indisponível.</p>
    </section>
  );
}

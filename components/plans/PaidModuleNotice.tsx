import Link from "next/link";
import { Layers, LockKeyhole } from "lucide-react";

export const PAID_MODULES = {
  printers: { name: "Impressoras", benefit: "Cadastre os parâmetros das suas impressoras e reutilize potência, depreciação e manutenção na precificação integrada." },
  spools: { name: "Carretéis", benefit: "Organize saldo e custo por carretel e reutilize referências de preço e peso original na precificação." },
  generalMaterials: { name: "Materiais gerais", benefit: "Organize insumos, embalagens e referências de custo para uma precificação integrada aos seus cadastros." },
  materials: { name: "Materiais FDM", benefit: "Centralize as referências dos materiais de impressão para organizar seus cadastros e suas fontes de custo." },
  inventory: { name: "Estoque de produtos prontos", benefit: "Acompanhe produtos prontos e seus movimentos de estoque em um só lugar." },
} as const;
export type PaidModule = keyof typeof PAID_MODULES;

export function PaidModuleNotice({ module, downgraded = false }: { module: PaidModule; downgraded?: boolean }) {
  const content = PAID_MODULES[module];
  return <section className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-[#c7c4d9] bg-white p-6 shadow-sm sm:p-10" aria-labelledby="paid-module-title">
    <div aria-hidden="true" className="flex h-28 items-center justify-center gap-4 rounded-xl bg-[#f2eeff] text-[#5852ff]"><Layers className="size-12" /><LockKeyhole className="size-7" /></div>
    <div className="space-y-3"><p className="text-sm font-semibold text-[#3d32e6]">Disponível no Visionário</p><h1 id="paid-module-title" className="text-3xl font-bold text-[#152336]">{content.name}</h1><p className="text-[#464556]">{content.benefit}</p><p className="text-sm text-[#464556]">Este módulo não está incluído no Aprendiz. A precificadora manual continua disponível, sem precisar cadastrar fontes pagas.</p></div>
    {downgraded && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Seus cadastros estão preservados. Reative o Visionário para acessá-los.</p>}
    <nav className="flex flex-wrap items-center gap-4"><Link href="/planos" className="rounded-xl bg-[#5852ff] px-5 py-3 font-semibold text-white">Conhecer o Visionário</Link><Link href="/home" className="font-medium text-[#3d32e6] underline">Voltar ao Hub</Link></nav>
    <p className="text-xs text-[#464556]">Compare os planos sem alterar sua escolha atual. A contratação ainda está indisponível.</p>
  </section>;
}

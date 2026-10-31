import Link from "next/link";
import { NewGeneralMaterialForm } from "@/components/general-materials/GeneralMaterialForms";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";
import { CreationLimitNotice } from "@/components/plans/CreationLimitNotice";
import { getCreationCapacity } from "@/lib/plans/creation-access";

export default function PaidNewGeneralMaterialPage() {
  return renderPaidModule("generalMaterials", "stock.materials.write", () => NewGeneralMaterialPage());
}

async function NewGeneralMaterialPage() {
  const capacity = await getCreationCapacity("shared_materials");
  if (!capacity.canCreate && capacity.limit !== null) {
    return <CreationLimitNotice moduleLabel="Materiais gerais" used={capacity.used} limit={capacity.limit} backHref="/estoque/materiais-gerais" />;
  }

  return (
    <section className="mx-auto w-full min-w-0 max-w-3xl space-y-6 rounded-2xl bg-[#f8fafc] p-4 text-[#152336] sm:p-6">
      <div>
        <Link className="inline-flex min-h-11 items-center text-sm font-medium text-[#2B00FF] underline underline-offset-4" href="/estoque/materiais-gerais">Voltar</Link>
        <h1 className="text-2xl font-bold mt-1">Novo material geral</h1>
      </div>
      <p className="text-sm text-slate-600">
        Cadastre um material informando nome, unidade de controle, quantidade e preço de referência,
        e saldo inicial opcional.
      </p>
      <NewGeneralMaterialForm />
    </section>
  );
}
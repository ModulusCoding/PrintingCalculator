import Link from "next/link";
import { NewSpoolForm } from "@/components/spools/SpoolForms";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";
import { CreationLimitNotice } from "@/components/plans/CreationLimitNotice";
import { getCreationCapacity } from "@/lib/plans/creation-access";

export default function PaidNewSpoolPage() {
  return renderPaidModule("spools", "spools.write", () => NewSpoolPage());
}

async function NewSpoolPage() {
  const capacity = await getCreationCapacity("shared_materials");
  if (!capacity.canCreate && capacity.limit !== null) {
    return <CreationLimitNotice moduleLabel="Carretéis" used={capacity.used} limit={capacity.limit} backHref="/estoque/carreteis" />;
  }

  return (
    <section className="max-w-xl space-y-4">
      <div>
        <Link className="text-sm text-indigo-700 underline" href="/estoque/carreteis">← Voltar</Link>
        <h1 className="text-2xl font-bold mt-1">Novo carretel</h1>
      </div>
      <p className="text-sm text-slate-600">
        Cadastre um carretel informando tipo, marca, cor, identificador interno, peso total e saldo inicial.
      </p>
      <NewSpoolForm />
    </section>
  );
}
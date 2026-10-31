import Link from "next/link";
import styles from "@/components/spools/SpoolPages.module.css";
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
    <section className={`${styles.page} ${styles.formPage}`}>
      <div>
        <Link className="text-sm text-indigo-700 underline" href="/estoque/carreteis">Voltar</Link>
        <h1 className="text-2xl font-bold mt-1">Novo carretel</h1>
      </div>
      <p className="text-sm text-slate-600">
        Cadastre um carretel informando tipo, marca, cor, identificador interno, peso total e saldo inicial.
      </p>
      <p className={styles.notice}>Materiais e carretéis compartilham a capacidade do plano. O peso original será a referência para acompanhar o saldo e o alerta de estoque baixo.</p>
      <NewSpoolForm />
    </section>
  );
}
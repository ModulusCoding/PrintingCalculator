import Link from "next/link";
import { EmployeeProvisioningForm } from "./EmployeeProvisioningForm";

type Props = { canCreateAdmin: boolean; initialOperationId?: string };

export function NewEmployeeContent({ canCreateAdmin, initialOperationId }: Props) {
  return (
    <div className="text-gray-900">
      <div className="mx-auto max-w-xl">
        <Link href="/empresa/equipe" className="text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500">← Voltar para equipe</Link>
        <section className="mt-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl font-bold text-white shadow-lg shadow-indigo-500/30">M</div>
            <div><h1 className="text-2xl font-bold sm:text-3xl">Cadastrar funcionário</h1><p className="mt-1 text-sm text-gray-600">Crie o acesso administrativo da equipe.</p></div>
          </div>
          <EmployeeProvisioningForm canCreateAdmin={canCreateAdmin} initialOperationId={initialOperationId} />
        </section>
      </div>
    </div>
  );
}

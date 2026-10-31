import Link from "next/link";
import { EmployeeProvisioningForm } from "./EmployeeProvisioningForm";

type Props = { initialOperationId?: string };

export function NewEmployeeContent({ initialOperationId }: Props) {
  return (
    <div className="text-[#152336]">
      <div className="mx-auto max-w-xl">
        <Link href="/empresa/equipe" className="text-sm font-medium text-[#2B00FF] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2B00FF]">Voltar para equipe</Link>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#2B00FF] text-xl font-bold text-white shadow-lg shadow-[#2B00FF]/30">M</div>
            <div><h1 className="text-2xl font-bold sm:text-3xl">Cadastrar funcionário</h1><p className="mt-1 text-sm text-slate-600">Crie o acesso administrativo da equipe.</p></div>
          </div>
          <EmployeeProvisioningForm initialOperationId={initialOperationId} />
        </section>
      </div>
    </div>
  );
}

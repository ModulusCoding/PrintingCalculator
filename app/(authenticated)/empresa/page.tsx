import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { getCompany } from "@/lib/enterprise/management";
import { CompanyForm } from "./CompanyForm";

export default async function CompanyPage() {
  try {
    await requireBusinessContext("enterprise.manage");
  } catch (error) {
    if (error instanceof AuthContextError) {
      return (
        <section role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-8">
          <h1 className="text-2xl font-bold">Acesso indisponível</h1>
          <p className="mt-3">Não foi possível carregar os dados da empresa.</p>
        </section>
      );
    }
    return (
      <section role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-8">
        <h1 className="text-2xl font-bold">Erro técnico</h1>
        <p className="mt-3">Não foi possível carregar os dados. Tente novamente.</p>
      </section>
    );
  }

  let company;
  try {
    company = await getCompany();
  } catch {
    return (
      <section role="alert" className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-8">
        <h1 className="text-2xl font-bold">Erro técnico</h1>
        <p className="mt-3">Não foi possível carregar os dados. Tente novamente.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-[#c7c4d9] bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-bold">Dados da empresa</h1>
      <p className="mt-2 text-[#464556]">Gerencie o nome e a tarifa de energia da empresa.</p>
      <CompanyForm company={company} />
    </section>
  );
}

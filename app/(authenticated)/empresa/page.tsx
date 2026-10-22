import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { getCompany } from "@/lib/enterprise/management";
import { CompanyForm } from "./CompanyForm";
import { getConfig } from "@/lib/enterprise/config";
import type { Company } from "@/lib/enterprise/management";

export default async function CompanyPage() {
  let canManageEnterprise = true;
  try {
    await requireBusinessContext("enterprise.manage");
  } catch {
    canManageEnterprise = false;
    try {
      await requireBusinessContext("enterprise.pricing_loss.write");
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
  }

  let company: Company;
  try {
    if (canManageEnterprise) {
      company = await getCompany();
    } else {
      const config = await getConfig();
      company = { name: "Empresa", created_at: "", version: config.version, electricity_rate_per_kwh: config.electricity_rate_per_kwh, default_filament_loss_percent: config.default_filament_loss_percent };
    }
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
      <p className="mt-2 text-[#464556]">Gerencie os dados empresariais e a perda padrão de filamento.</p>
      <CompanyForm company={company} canManageEnterprise={canManageEnterprise} />
    </section>
  );
}

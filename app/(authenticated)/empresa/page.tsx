import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { unstable_rethrow } from "next/navigation";
import { diagnoseCompany } from "@/lib/enterprise/diagnostics";
import { getCompany } from "@/lib/enterprise/management";
import { CompanyForm } from "./CompanyForm";
import { getConfig } from "@/lib/enterprise/config";
import type { Company } from "@/lib/enterprise/management";

function CompanyNotice({ denied = false }: { denied?: boolean }) {
  return (
    <section role="alert" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#2B00FF]">Dados da empresa</p>
      <h1 className="mt-3 text-2xl font-bold text-[#152336]">{denied ? "Acesso indisponível" : "Erro técnico"}</h1>
      <p className="mt-3 leading-relaxed text-slate-600">{denied ? "Não foi possível carregar os dados da empresa. Verifique seu acesso antes de continuar." : "Não foi possível carregar os dados. Tente novamente. Suas informações não foram alteradas."}</p>
      {!denied && <a href="/empresa" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-5 py-2 text-sm font-semibold text-[#152336] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B00FF]">Tentar novamente</a>}
    </section>
  );
}

export default async function CompanyPage() {
  let canManageEnterprise = true;
  try {
    await requireBusinessContext("enterprise.manage");
  } catch (error) {
    unstable_rethrow(error);
    // Only an actual role denial permits the existing admin loss-only branch.
    // Technical/blocked identity failures must never masquerade as that denial.
    if (!(error instanceof AuthContextError) || error.code !== "AUTH_PERMISSION_DENIED") {
      diagnoseCompany("CompanyPage", "context", error);
      return <CompanyNotice denied={error instanceof AuthContextError && !["AUTH_TECHNICAL_FAILURE", "AUTH_CONTEXT_INVALID_RESPONSE"].includes(error.code)} />;
    }
    canManageEnterprise = false;
    try {
      await requireBusinessContext("enterprise.pricing_loss.write");
    } catch (error) {
      unstable_rethrow(error);
      diagnoseCompany("CompanyPage", "context", error);
      if (error instanceof AuthContextError && !["AUTH_TECHNICAL_FAILURE", "AUTH_CONTEXT_INVALID_RESPONSE"].includes(error.code)) {
        return <CompanyNotice denied />;
      }
      return <CompanyNotice />;
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
  } catch (error) {
    unstable_rethrow(error);
    diagnoseCompany("CompanyPage", "rpc", error);
    const permissionDenied = error instanceof Error && error.message === "permission_denied";
    return <CompanyNotice denied={permissionDenied} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <CompanyForm company={company} canManageEnterprise={canManageEnterprise} />
    </div>
  );
}

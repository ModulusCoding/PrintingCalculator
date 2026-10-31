import { ROLE_PERMISSIONS, resolveMinimalIdentity, type Permission } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { AuthenticatedShell } from "./AuthenticatedShell";
import { getMyPlanAccess, PlanAccessError } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  let context;
  try {
    context = await resolveMinimalIdentity();
  } catch (error) {
    return planAccessNotice(error);
  }

  if (context.state === "unauthenticated") {
    redirect("/admin/login");
  }

  if (context.state !== "business_ready") {
    redirect("/conta");
  }

  // Plan/account routes live outside this operational layout to avoid redirect loops.
  let plan;
  try { plan = await getMyPlanAccess(); }
  catch (error) { return planAccessNotice(error); }
  if (!plan || plan.selection_required) redirect("/planos");
  if (plan.effective_plan === "free" && context.role !== "owner") return planAccessNotice(new PlanAccessError("member_plan_blocked"));

  const permissions: readonly Permission[] = ROLE_PERMISSIONS[context.role];
  const canManageEnterprise = permissions.includes("enterprise.manage");
  const canManageMembers = permissions.includes("members.manage_operators");
  const canReadPrinters = permissions.includes("printers.read");
  const canReadMaterials = permissions.includes("materials.read");
  const canReadGeneralMaterials = permissions.includes("stock.materials.read");
  const canReadSpools = permissions.includes("spools.read");
  const canReadInventory = permissions.includes("inventory.read");
  const canReadPricing = permissions.includes("pricing.read");
  const paidModulesLocked = plan.effective_plan === "free" && context.role === "owner";

  return (
    <AuthenticatedShell
      canManageEnterprise={canManageEnterprise}
      canManageMembers={canManageMembers}
      canReadPrinters={canReadPrinters}
      canReadMaterials={canReadMaterials}
      canReadGeneralMaterials={canReadGeneralMaterials}
      canReadSpools={canReadSpools}
      canReadInventory={canReadInventory}
      canReadPricing={canReadPricing}
      paidModulesLocked={paidModulesLocked}
    >
      {plan.effective_plan === "free" && context.role === "owner" && <aside className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">O Aprendiz permite operação somente pelo master. Se houver membros legados, seus vínculos são preservados, mas não permitem operação empresarial. <a href="/empresa/equipe" className="underline">Revisar equipe</a> · <a href="/meu-plano" className="underline">Meu plano</a></aside>}
      {children}
    </AuthenticatedShell>
  );
}

import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { requirePlanBusinessAccess } from "@/lib/plans";
import { planAccessNotice } from "@/components/plans/PlanAccessNotice";
import Link from "next/link";
import { PricingSimulator } from "@/components/pricing/PricingSimulator";
import { fetchElectricityConfigAction, searchPrintersAction, searchPricingSpoolsAction, searchPricingGeneralMaterialsAction } from "@/lib/pricing/actions";
import { searchProductsAction } from "@/lib/pricing/persistence-actions";

export const dynamic = "force-dynamic";

async function hasPermission(permission: Parameters<typeof requireBusinessContext>[0]) {
  try {
    await requireBusinessContext(permission);
    return true;
  } catch (error) {
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  }
}

export default async function PricingPage() {
  try { return await renderPricingPage(); }
  catch (error) { return planAccessNotice(error); }
}

async function renderPricingPage() {
  let access;
  try {
    access = await requirePlanBusinessAccess();
  } catch (error) {
    return planAccessNotice(error);
  }
  const products = await searchProductsAction({ page: 1, limit: 10 });
  if (!products.ok) {
    const reference = products.error.match(/Referência: ([0-9a-f-]{8})/i)?.[1] ?? "UNKNOWN0";
    return <section role="alert" className="rounded border bg-white p-6"><p>Não foi possível carregar a precificadora. Tente novamente. Referência: {reference}.</p><nav className="mt-4 flex gap-4"><a href="/precificadora">Tentar novamente</a><Link href="/">Sair</Link></nav></section>;
  }
  if (access.effective_plan === "free") {
    const [canSave, canCreateProduct] = await Promise.all([hasPermission("pricing.write"), hasPermission("products.write")]);
    return <PricingSimulator mode="manual" initialProducts={products.data} canSave={canSave} canCreateProduct={canCreateProduct} effectivePlan="free" />;
  }
  if (access.effective_plan !== "intermediate") return <section role="status" className="rounded border bg-white p-6">Plano Magnata indisponível no momento.</section>;

  await requireBusinessContext("printers.read");
  await requireBusinessContext("materials.read");
  const [printers, spools, generalMaterials, config] = await Promise.all([
    searchPrintersAction({ page: 1, limit: 10 }),
    searchPricingSpoolsAction({ page: 1, limit: 10 }),
    searchPricingGeneralMaterialsAction({ page: 1, limit: 10 }),
    fetchElectricityConfigAction(),
  ]);
  if (!printers.ok || !spools.ok || !generalMaterials.ok || !config.ok) {
    const failures = [printers, spools, generalMaterials, config].filter(result => !result.ok);
    const references = failures.map(result => "correlationId" in result ? result.correlationId : result.error.match(/Referência: ([0-9a-f-]{8})/i)?.[1]).filter(Boolean);
    return <section role="alert" className="rounded border bg-white p-6"><p>Não foi possível carregar a precificadora. Tente novamente. Referência: {references[0] ?? "UNKNOWN0"}.</p><nav className="mt-4 flex gap-4"><a href="/precificadora">Tentar novamente</a><Link href="/">Sair</Link></nav></section>;
  }
  const [canManageEnterprise, canSave] = await Promise.all([hasPermission("enterprise.manage"), hasPermission("products.write")]);
  return <PricingSimulator mode="integrated" effectivePlan="intermediate" initialPrinters={printers.data} initialSpools={spools.data} initialGeneralMaterials={generalMaterials.data} initialProducts={products.data} electricityRate={config.data.rate} defaultLoss={config.data.defaultLoss} configVersion={config.data.version} canManageEnterprise={canManageEnterprise} canSave={canSave} canCreateProduct={canSave} />;
}

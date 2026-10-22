import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import Link from "next/link";
import { PricingSimulator } from "@/components/pricing/PricingSimulator";
import {
  fetchElectricityConfigAction,
  searchPrintersAction,
  searchPricingSpoolsAction,
  searchPricingGeneralMaterialsAction,
} from "@/lib/pricing/actions";
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
  await requireBusinessContext("printers.read");
  await requireBusinessContext("materials.read");

  const [printers, spools, generalMaterials, config, products] = await Promise.all([
    searchPrintersAction({ page: 1, limit: 10 }),
    searchPricingSpoolsAction({ page: 1, limit: 10 }),
    searchPricingGeneralMaterialsAction({ page: 1, limit: 10 }),
    fetchElectricityConfigAction(),
    searchProductsAction({ page: 1, limit: 10 }),
  ]);
  const canManageEnterprise = await hasPermission("enterprise.manage");

  if (!printers.ok || !spools.ok || !generalMaterials.ok || !config.ok || !products.ok) {
    const failures = [printers, spools, generalMaterials, config, products].filter(result => !result.ok);
    const references = failures.map(result => "correlationId" in result ? result.correlationId : result.error.match(/Referência: ([0-9a-f-]{8})/i)?.[1]).filter(Boolean);
    const reference = references[0] ?? "UNKNOWN0";
    return <section role="alert" className="rounded border bg-white p-6"><p>Não foi possível carregar a precificadora. Tente novamente. Referência: {reference}.</p><nav className="mt-4 flex gap-4"><a href="/precificadora">Tentar novamente</a><Link href="/">Sair</Link></nav></section>;
  }

  const canSave = await hasPermission("products.write");
  return <PricingSimulator initialPrinters={printers.data} initialSpools={spools.data} initialGeneralMaterials={generalMaterials.data} initialProducts={products.data} electricityRate={config.data.rate} defaultLoss={config.data.defaultLoss} configVersion={config.data.version} canManageEnterprise={canManageEnterprise} canSave={canSave} />;
}

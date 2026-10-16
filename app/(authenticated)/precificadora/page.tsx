import { requireBusinessContext } from "@/lib/auth/context";
import { PricingSimulator } from "@/components/pricing/PricingSimulator";
import {
  fetchElectricityConfigAction,
  searchMaterialsAction,
  searchPrintersAction,
} from "@/lib/pricing/actions";
import { searchProductsAction } from "@/lib/pricing/persistence-actions";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  await requireBusinessContext("printers.read");
  await requireBusinessContext("materials.read");

  const [printers, materials, config, products] = await Promise.all([
    searchPrintersAction({ page: 1, limit: 10 }),
    searchMaterialsAction({ page: 1, limit: 10 }),
    fetchElectricityConfigAction(),
    searchProductsAction({ page: 1, limit: 10 }),
  ]);
  const canManageEnterprise = await requireBusinessContext("enterprise.manage").then(() => true).catch(() => false);

  if (!printers.ok || !materials.ok || !config.ok || !products.ok) {
    return <section role="alert" className="rounded border bg-white p-6"><h1 className="text-2xl font-bold">Não foi possível carregar a precificadora</h1><p className="mt-2">Tente novamente. Nenhuma lista vazia foi assumida para esta falha.</p></section>;
  }

  const canSave = await requireBusinessContext("products.write").then(() => true).catch(() => false);
  return <PricingSimulator initialPrinters={printers.data} initialMaterials={materials.data} initialProducts={products.data} electricityRate={config.data.rate} configVersion={config.data.version} canManageEnterprise={canManageEnterprise} canSave={canSave} />;
}

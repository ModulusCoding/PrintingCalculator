import { MaterialForm } from "@/components/materials/MaterialForm";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidNewMaterialPage(props: Parameters<typeof NewMaterialPage>[0]) {
  return renderPaidModule("materials", "materials.write", () => NewMaterialPage(props));
}

async function NewMaterialPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const canWrite = true; // The page gate already requires materials.write.
  const { returnTo } = await searchParams;
  return <MaterialForm canWrite={canWrite} canArchive={false} returnTo={returnTo} />;
}

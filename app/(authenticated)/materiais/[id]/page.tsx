import { MaterialForm } from "@/components/materials/MaterialForm";
import { unstable_rethrow } from "next/navigation";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { getMaterial } from "@/lib/materials/actions";

import { renderPaidModule } from "@/components/plans/PaidModuleGate";

export default function PaidMaterialPage(props: Parameters<typeof MaterialPage>[0]) {
  return renderPaidModule("materials", "materials.read", () => MaterialPage(props));
}

async function MaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const result = await getMaterial(id);
  if (!result.material) {
    const unavailable = result.error === "material_unavailable";
    return <section role="alert" className="rounded border bg-white p-6"><h1 className="text-2xl font-bold">{unavailable ? "Material indisponível" : "Não foi possível carregar o material"}</h1><p className="mt-2">{unavailable ? "Este material não está disponível para sua empresa." : "Ocorreu um erro técnico. Tente novamente."}</p></section>;
  }
  const canWrite = await requireBusinessContext("materials.write").then(() => true).catch((error: unknown) => {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  });
  const canArchive = await requireBusinessContext("materials.archive").then(() => true).catch((error: unknown) => {
    unstable_rethrow(error);
    if (error instanceof AuthContextError && error.code === "AUTH_PERMISSION_DENIED") return false;
    throw error;
  });
  return <MaterialForm material={result.material} canWrite={canWrite} canArchive={canArchive} returnTo={returnTo} />;
}

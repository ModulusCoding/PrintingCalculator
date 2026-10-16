import { MaterialForm } from "@/components/materials/MaterialForm";
import { requireBusinessContext } from "@/lib/auth/context";
import { getMaterial } from "@/lib/materials/actions";

export default async function MaterialPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const result = await getMaterial(id);
  if (!result.material) {
    const unavailable = result.error === "material_unavailable";
    return <section role="alert" className="rounded border bg-white p-6"><h1 className="text-2xl font-bold">{unavailable ? "Material indisponível" : "Não foi possível carregar o material"}</h1><p className="mt-2">{unavailable ? "Este material não está disponível para sua empresa." : "Ocorreu um erro técnico. Tente novamente."}</p></section>;
  }
  const canWrite = await requireBusinessContext("materials.write").then(() => true).catch(() => false);
  const canArchive = await requireBusinessContext("materials.archive").then(() => true).catch(() => false);
  return <MaterialForm material={result.material} canWrite={canWrite} canArchive={canArchive} returnTo={returnTo} />;
}

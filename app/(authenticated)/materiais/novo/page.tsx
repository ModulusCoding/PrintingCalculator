import { MaterialForm } from "@/components/materials/MaterialForm";
import { requireBusinessContext } from "@/lib/auth/context";

export default async function NewMaterialPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const canWrite = await requireBusinessContext("materials.write").then(() => true).catch(() => false);
  const { returnTo } = await searchParams;
  return <MaterialForm canWrite={canWrite} canArchive={false} returnTo={returnTo} />;
}

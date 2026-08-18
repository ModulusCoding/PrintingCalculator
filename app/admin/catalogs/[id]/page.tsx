import { CatalogForm } from "@/components/admin/CatalogForm";
import { getCatalogById } from "@/lib/catalogs/actions";
import { notFound } from "next/navigation";

export default async function EditCatalogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { catalog, error } = await getCatalogById(id);

  if (error || !catalog) {
    notFound();
  }

  return (
    <div className="max-w-5xl mx-auto">
      <CatalogForm catalog={catalog} />
    </div>
  );
}
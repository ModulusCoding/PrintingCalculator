import { CatalogForm } from "@/components/admin/CatalogForm";
import { CatalogProductReorder } from "@/components/admin/CatalogProductReorder";
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

  const orderedProducts = (catalog.orderedProducts || []).map((p: {
    id: string;
    name: string;
    slug: string;
    image_url?: string | null;
    category?: string | null;
    price?: number | null;
  }) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    image_url: p.image_url,
    category: p.category,
    price: p.price,
  }));

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <CatalogForm catalog={catalog} />

      <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
        <CatalogProductReorder
          catalogId={catalog.id}
          initialProducts={orderedProducts}
        />
      </div>
    </div>
  );
}

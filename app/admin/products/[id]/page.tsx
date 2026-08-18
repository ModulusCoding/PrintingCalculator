import { ProductForm } from "@/components/admin/ProductForm";
import { getProductById, getAllCatalogsForSelect } from "@/lib/products/actions";
import { notFound } from "next/navigation";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [productRes, catalogsRes] = await Promise.all([
    getProductById(id),
    getAllCatalogsForSelect(),
  ]);

  if (productRes.error || !productRes.product) {
    notFound();
  }

  return (
    <div className="max-w-5xl mx-auto">
      <ProductForm product={productRes.product} availableCatalogs={catalogsRes.catalogs} />
    </div>
  );
}
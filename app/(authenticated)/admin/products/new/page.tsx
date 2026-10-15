import { ProductForm } from "@/components/admin/ProductForm";
import { getAllCatalogsForSelect } from "@/lib/products/actions";

export default async function NewProductPage() {
  const { catalogs } = await getAllCatalogsForSelect();
  return (
    <div className="max-w-5xl mx-auto">
      <ProductForm availableCatalogs={catalogs} />
    </div>
  );
}
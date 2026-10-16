import { ProductForm } from "@/components/admin/ProductForm";
import { getInternalProduct } from "@/lib/products/actions";
import { requireBusinessContext } from "@/lib/auth/context";
import { getInternalProductImages } from "@/lib/products/image-actions";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getInternalProduct(id);
  if (!result.product) return <section role="alert" className="mx-auto max-w-xl rounded border border-red-200 bg-red-50 p-6 text-red-800"><h1 className="font-bold">Produto indisponível</h1><p className="mt-2">Não foi possível carregar este produto. Verifique a lista de produtos e tente novamente.</p></section>;
  const canWrite = await requireBusinessContext("products.write").then(() => true).catch(() => false);
  const canDelete = await requireBusinessContext("products.delete").then(() => true).catch(() => false);
  const imageResult = await getInternalProductImages(result.product.id);
  return <div className="max-w-xl mx-auto"><ProductForm product={result.product} canWrite={canWrite} canDelete={canDelete} imageResult={imageResult} /></div>;
}

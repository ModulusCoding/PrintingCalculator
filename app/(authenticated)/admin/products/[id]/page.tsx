import { ProductForm } from "@/components/admin/ProductForm";
import { getInternalProduct } from "@/lib/products/actions";
import Link from "next/link";
import { productPermission } from "@/lib/products/access";
import { productMessage, productPlanAction } from "@/lib/products/messages";
import { getInternalProductImages } from "@/lib/products/image-actions";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getInternalProduct(id);
  if (!result.product) return <section role="alert" className="mx-auto max-w-xl space-y-3 rounded border border-red-200 bg-red-50 p-6 text-red-800"><h1 className="font-bold">{result.error === "product_unavailable" ? "Produto indisponível" : "Não foi possível carregar o produto"}</h1><p>{productMessage(result.error || "technical", result.reference)}</p>{productPlanAction(result.error || "") && <Link href="/planos" className="underline">Consultar planos</Link>}<p><Link href="/admin/products" className="underline">Voltar para produtos</Link></p></section>;
  const canWrite = await productPermission("products.write");
  const canDelete = await productPermission("products.delete");
  const imageResult = await getInternalProductImages(result.product.id);
  return <div className="max-w-xl mx-auto"><ProductForm product={result.product} canWrite={canWrite} canDelete={canDelete} imageResult={imageResult} /></div>;
}

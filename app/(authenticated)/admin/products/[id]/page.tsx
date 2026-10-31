import { randomUUID } from "node:crypto";
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
  return <section className="mx-auto max-w-[1440px] space-y-6 text-[#152336]"><header><Link href="/admin/products" className="inline-flex min-h-11 items-center text-sm text-[#2B00FF] underline">Voltar para produtos</Link><p className="mt-3 text-xs uppercase tracking-widest text-slate-500">Operação / Produtos / {canWrite && result.product.active ? "Edição" : "Detalhes"}</p><div className="mt-2 flex flex-wrap items-start justify-between gap-3"><h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight">{result.product.name}</h1><span className={`rounded-full border px-3 py-1 text-xs font-medium ${result.product.active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-600"}`}>{result.product.active ? "Ativo" : "Arquivado"}</span></div><p className="mt-2 text-sm text-slate-600">Informações do catálogo e imagens do produto. Alterações de preço não recalculam precificações anteriores.</p></header><ProductForm product={result.product} canWrite={canWrite} canDelete={canDelete} imageResult={imageResult} galleryRefreshKey={randomUUID()} /></section>;
}

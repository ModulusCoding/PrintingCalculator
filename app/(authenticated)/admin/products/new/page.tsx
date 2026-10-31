import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";
import { CreationLimitNotice } from "@/components/plans/CreationLimitNotice";
import { productCreationCapacity, productFailure, productPermission } from "@/lib/products/access";
import { productMessage, productPlanAction } from "@/lib/products/messages";

export default async function NewProductPage() {
  let canWrite = false;
  let accessFailure: ReturnType<typeof productFailure> | null = null;
  try {
    canWrite = await productPermission("products.write");
  } catch (error) {
    accessFailure = productFailure(error);
  }
  if (accessFailure) return <section role="alert"><p>{productMessage(accessFailure.status, "reference" in accessFailure ? accessFailure.reference : undefined)}</p>{productPlanAction(accessFailure.status) && <Link href="/planos">Consultar planos</Link>} <Link href="/conta">Minha conta e saída</Link></section>;
  if (!canWrite) return <p role="alert">{productMessage("permission_denied")}</p>;
  const { capacity, failure } = await productCreationCapacity();
  if (failure) return <section role="alert"><p>{productMessage(failure.status, "reference" in failure ? failure.reference : undefined)}</p>{productPlanAction(failure.status) && <Link href="/planos">Consultar planos</Link>} <Link href="/conta">Minha conta e saída</Link></section>;
  if (!capacity.canCreate && capacity.limit !== null) return <CreationLimitNotice moduleLabel="Produtos" used={capacity.used} limit={capacity.limit} backHref="/admin/products" />;
  return <section className="mx-auto max-w-[1440px] space-y-6 text-[#152336]"><header><Link href="/admin/products" className="inline-flex min-h-11 items-center text-sm text-[#2B00FF] underline">Voltar para produtos</Link><p className="mt-3 text-xs uppercase tracking-widest text-slate-500">Operação / Produtos / Cadastro</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Novo produto</h1><p className="mt-2 text-sm text-slate-600">Comece pelas informações do catálogo. As imagens podem ser adicionadas após salvar.</p></header><ProductForm /></section>;
}

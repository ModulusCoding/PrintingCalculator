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
  return <div className="max-w-xl mx-auto"><ProductForm /></div>;
}

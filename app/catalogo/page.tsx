import { notFound } from "next/navigation";
import CatalogoModulus from "@/components/catalog/CatalogoModulus";
import { getCatalogBySlug } from "@/lib/catalogs/getCatalogBySlug";

export default async function DefaultCatalogPage() {
  const catalog = await getCatalogBySlug("modulus");

  if (!catalog) {
    notFound();
  }

  return <CatalogoModulus catalog={catalog} />;
}

import { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogoModulus from "@/components/catalog/CatalogoModulus";
import { getCatalogBySlug } from "@/lib/catalogs/getCatalogBySlug";

interface CatalogPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: CatalogPageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await getCatalogBySlug(slug);

  if (!catalog) {
    return {
      title: "Catálogo não encontrado | Modulus",
    };
  }

  const description =
    catalog.heroCopy ||
    catalog.eyebrow ||
    "Uma seleção de objetos úteis, duráveis e produzidos sob demanda pela Modulus.";

  return {
    title: `${catalog.title} | Modulus`,
    description: description,
    openGraph: {
      title: `${catalog.title} | Modulus`,
      description: description,
      type: "website",
    },
  };
}

export default async function DynamicCatalogPage({ params }: CatalogPageProps) {
  const { slug } = await params;
  const catalog = await getCatalogBySlug(slug);

  if (!catalog) {
    notFound();
  }

  return <CatalogoModulus catalog={catalog} />;
}

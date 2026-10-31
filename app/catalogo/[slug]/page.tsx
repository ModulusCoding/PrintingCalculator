import { isLegacyEnabled } from "@/lib/legacy-gate";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogoModulus from "@/components/catalog/CatalogoModulus";
import { getCatalogBySlug } from "@/lib/catalogs/getCatalogBySlug";
import "./catalog.css";

interface CatalogPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({
  params,
}: CatalogPageProps): Promise<Metadata> {
  if (!(await isLegacyEnabled())) return { title: "Unavailable", robots: { index: false, follow: false } };

  const { slug } = await params;
  const catalog = await getCatalogBySlug(slug);

  if (!catalog) {
    return {
      title: "Catálogo não encontrado | Catálogo de Produtos Modulus",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const catalogName = catalog.title?.trim()
    ? catalog.title.trim()
    : slug;

  const title = `${catalogName} | Catálogo de Produtos Modulus`;

  const description =
    `Confira os produtos do catálogo ${catalogName} da Modulus. ` +
    "Encontre peças impressas em 3D e criações feitas sob demanda.";

  return {
    title,
    description,

    openGraph: {
      title,
      description,
      type: "website",
      locale: "pt_BR",
      siteName: "Modulus 3D Calculator",
      images: [
        {
          url: "/opengraph-image.png",
          width: 1200,
          height: 630,
          alt: `${catalogName} | Modulus`,
        },
      ],
    },

    icons: {
      icon: "/favicon.ico",
    },

    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image.png"],
    },

    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function DynamicCatalogPage({
  params,
}: CatalogPageProps) {
  if (!(await isLegacyEnabled())) return <p className="p-8 text-center">Unavailable</p>;

  const { slug } = await params;
  const catalog = await getCatalogBySlug(slug);

  if (!catalog) {
    notFound();
  }

  return <CatalogoModulus catalog={catalog} />;
}
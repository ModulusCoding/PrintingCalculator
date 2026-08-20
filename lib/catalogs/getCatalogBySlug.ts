import { createClient } from "@/lib/supabase/server";
import type { CatalogView, CatalogProductView } from "@/types/catalog";
import { TEMPORARY_CATALOG_MOCKS } from "./temporaryCatalogMocks";

/**
 * Busca os dados públicos de um catálogo pelo seu slug, juntamente com seus produtos associados (relação N:N).
 *
 * FLUXO DE FUNCIONAMENTO:
 * 1. Tenta buscar no Supabase se as variáveis de ambiente estiverem configuradas.
 * 2. Se o Supabase estiver indisponível/desconfigurado ou o catálogo não for encontrado no banco,
 *    recorre ao fallback do mock temporário (TEMPORARY_CATALOG_MOCKS).
 * 3. Se não encontrar nem no banco nem no mock, retorna null (permitindo que a rota acione notFound()).
 *
 * @param slug Identificador público da URL (ex: 'deuses-gregos', 'maker-home', 'modulus')
 */
export async function getCatalogBySlug(slug: string): Promise<CatalogView | null> {
  const sanitizedSlug = slug?.trim().toLowerCase();
  if (!sanitizedSlug) return null;

  const hasSupabaseConfig =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://placeholder.supabase.co" &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (hasSupabaseConfig) {
    try {
      const supabase = await createClient();

      // 1. Busca os dados do catálogo
      const { data: catalog, error: catalogError } = await supabase
        .from("catalogs")
        .select("*")
        .eq("slug", sanitizedSlug)
        .eq("active", true)
        .single();

      if (!catalogError && catalog) {
        // 2. Busca a relação N:N (catalog_products) com ordenação por display_order
        const { data: catalogProducts, error: cpError } = await supabase
          .from("catalog_products")
          .select("display_order, product:products(*)")
          .eq("catalog_id", catalog.id)
          .order("display_order", { ascending: true });

        const products: CatalogProductView[] = [];

        if (!cpError && catalogProducts) {
          for (const item of catalogProducts) {
            // Suporte quando o produto associado é um objeto populado pela query
            const rawProd = Array.isArray(item.product) ? item.product[0] : item.product;
            if (rawProd && rawProd.active !== false) {
              products.push({
                id: rawProd.id,
                index: rawProd.slug ? `MOD—${rawProd.slug.slice(0, 3).toUpperCase()}` : "MOD—000",
                name: rawProd.name,
                category: "Geral",
                format: "Unitário",
                detail: "Impresso sob demanda",
                description: rawProd.description,
                photo: rawProd.image_url || "/images/catalogo/mod-001-luminaria-shoji.webp",
                photoSecondary: null,
                photoAlt: rawProd.name,
                photoSecondaryAlt: null,
                photoNote: null,
                price: rawProd.price ?? null,
                displayOrder: item.display_order ?? 0,
              });
            }
          }
        }

        return {
          id: catalog.id,
          slug: catalog.slug,
          title: catalog.name,
          eyebrow: catalog.description || "Objetos funcionais · impressão 3D",
          heroCopy: catalog.description || "Uma seleção de objetos úteis, duráveis e produzidos sob demanda.",
          heroStrongText: "Projetados para o uso real.",
          manifestoLabel: "Nosso princípio",
          manifestoTitle: "Menos descartável.\nMais essencial.",
          manifestoFormula: "E = σ / ε",
          manifestoDescription: "Módulo de elasticidade: E igual a sigma sobre epsilon",
          products,
        };
      }
    } catch {
      // Falha silenciosa para fallback do mock durante desenvolvimento
    }
  }

  // FALLBACK: Mock temporário local para demonstração/desenvolvimento
  const mockMatch = TEMPORARY_CATALOG_MOCKS.find((item) => item.slug === sanitizedSlug);
  if (mockMatch) {
    return mockMatch;
  }

  return null;
}

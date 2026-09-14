import { createClient } from "@/lib/supabase/server";
import type { CatalogView, CatalogProductView, CatalogFilterView } from "@/types/catalog";
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
          .select("display_order, product:products(*, product_images(id, url, display_order))")
          .eq("catalog_id", catalog.id)
          .order("display_order", { ascending: true });

        const products: CatalogProductView[] = [];

        if (!cpError && catalogProducts) {
          for (const item of catalogProducts) {
            const rawProd = Array.isArray(item.product) ? item.product[0] : item.product;
            if (rawProd && rawProd.active !== false) {
              const rawImages = rawProd.product_images || [];
              const sortedDbImages = [...rawImages]
                .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
                .map((img) => img.url)
                .filter(Boolean);

              const imageList =
                sortedDbImages.length > 0
                  ? sortedDbImages
                  : rawProd.image_url
                  ? [rawProd.image_url]
                  : ["/images/catalogo/mod-001-luminaria-shoji.webp"];

              products.push({
                id: rawProd.id,
                index: rawProd.slug ? `MOD—${rawProd.slug.slice(0, 3).toUpperCase()}` : "MOD—000",
                name: rawProd.name,
                category: "Geral",
                format: "Unitário",
                detail: "Impresso sob demanda",
                description: rawProd.description,
                photo: imageList[0],
                photoSecondary: imageList[1] || null,
                photoAlt: rawProd.name,
                photoSecondaryAlt: rawProd.name,
                photoNote: null,
                images: imageList,
                price: rawProd.price ?? null,
                displayOrder: item.display_order ?? 0,
              });
            }
          }
        }

        let filters: CatalogFilterView[] = [];
        let filterProductMap = new Map<string, { ids: string[]; slugs: string[] }>();
        try {
          const { data: filterRows } = await supabase
            .from("catalog_filters")
            .select("id, name, slug, description, display_order")
            .eq("catalog_id", catalog.id)
            .order("display_order", { ascending: true })
            .order("created_at", { ascending: true });

          if (filterRows && filterRows.length > 0) {
            filters = filterRows.map((f: { id: string; name: string; slug: string; description: string | null; display_order: number | null }) => ({
              id: f.id,
              name: f.name,
              slug: f.slug,
              description: f.description,
              displayOrder: f.display_order ?? 0,
            }));

            const filterIds = filters.map((f) => f.id);
            const { data: assocRows } = await supabase
              .from("catalog_filter_products")
              .select("catalog_filter_id, product_id")
              .in("catalog_filter_id", filterIds);

            const slugById = new Map(filters.map((f) => [f.id, f.slug]));
            for (const row of (assocRows || []) as { catalog_filter_id: string; product_id: string }[]) {
              const entry = filterProductMap.get(row.product_id) || { ids: [], slugs: [] };
              entry.ids.push(row.catalog_filter_id);
              const slug = slugById.get(row.catalog_filter_id);
              if (slug) entry.slugs.push(slug);
              filterProductMap.set(row.product_id, entry);
            }

            for (const p of products) {
              const mapped = filterProductMap.get(p.id);
              if (mapped) {
                p.filterIds = mapped.ids;
                p.filterSlugs = mapped.slugs;
              } else {
                p.filterIds = [];
                p.filterSlugs = [];
              }
            }
          } else {
            for (const p of products) {
              p.filterIds = [];
              p.filterSlugs = [];
            }
          }
        } catch {
          for (const p of products) {
            p.filterIds = [];
            p.filterSlugs = [];
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
          filters,
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

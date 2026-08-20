"use server";

import { createClient } from "@/lib/supabase/server";
import { catalogSchema } from "@/lib/validations";
import {
  rateLimitCatalogCreate,
  rateLimitCatalogUpdate,
  rateLimitCatalogDelete,
} from "@/lib/rate-limit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function getDashboardStats() {
  try {
    const supabase = await createClient();

    const [
      { count: totalCatalogs },
      { count: activeCatalogs },
      { count: totalProducts },
      { count: activeProducts },
    ] = await Promise.all([
      supabase.from("catalogs").select("*", { count: "exact", head: true }),
      supabase
        .from("catalogs")
        .select("*", { count: "exact", head: true })
        .eq("active", true),
      supabase.from("products").select("*", { count: "exact", head: true }),
      supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("active", true),
    ]);

    return {
      totalCatalogs: totalCatalogs || 0,
      activeCatalogs: activeCatalogs || 0,
      totalProducts: totalProducts || 0,
      activeProducts: activeProducts || 0,
      error: null,
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return {
      totalCatalogs: 0,
      activeCatalogs: 0,
      totalProducts: 0,
      activeProducts: 0,
      error: "Erro ao carregar estatísticas do painel.",
    };
  }
}

export async function getCatalogs() {
  try {
    const supabase = await createClient();

    const { data: catalogs, error } = await supabase
      .from("catalogs")
      .select("*, catalog_products(count)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching catalogs:", error);
      return { catalogs: [], error: "Erro ao carregar os catálogos." };
    }

    const formattedCatalogs = catalogs.map((item) => ({
      ...item,
      product_count: item.catalog_products?.[0]?.count || 0,
    }));

    return { catalogs: formattedCatalogs, error: null };
  } catch (err) {
    console.error("Unexpected error in getCatalogs:", err);
    return { catalogs: [], error: "Erro inesperado ao buscar catálogos." };
  }
}

export async function getCatalogById(id: string) {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("catalogs")
      .select(`
        *,
        catalog_products (
          display_order,
          product:products (
            id,
            name,
            slug,
            image_url,
            category,
            format,
            price,
            active
          )
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      return { catalog: null, error: "Catálogo não encontrado." };
    }

    const orderedProducts = (data.catalog_products || [])
      .sort((a: { display_order: number | null }, b: { display_order: number | null }) => (a.display_order || 0) - (b.display_order || 0))
      .map((cp: { product: { id: string; name: string; slug: string; image_url?: string | null; category?: string | null; format?: string | null; price?: number | null; active?: boolean } | null }) => cp.product)
      .filter(Boolean);

    return { catalog: { ...data, orderedProducts }, error: null };
  } catch (err) {
    console.error("Error fetching catalog by ID:", err);
    return { catalog: null, error: "Erro ao buscar detalhes do catálogo." };
  }
}

export async function createCatalogAction(payload: unknown) {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado. Faça login para continuar." };
  }

  const rl = rateLimitCatalogCreate(ip, user.id);
  if (!rl.allowed) {
    return { error: "Muitas criações recentes. Por favor, aguarde alguns minutos." };
  }

  const parseResult = catalogSchema.safeParse(payload);
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0]?.message || "Dados inválidos.";
    return { error: firstError };
  }

  const data = parseResult.data;

  // Check unique slug
  const { data: existing } = await supabase
    .from("catalogs")
    .select("id")
    .eq("slug", data.slug)
    .maybeSingle();

  if (existing) {
    return { error: "Este slug já está sendo utilizado por outro catálogo." };
  }

  const { data: created, error } = await supabase
    .from("catalogs")
    .insert([
      {
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        logo_url: data.logo_url || null,
        banner_url: data.banner_url || null,
        whatsapp: data.whatsapp || null,
        active: data.active ?? true,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("Error creating catalog:", error);
    if (error.code === "23505") {
      return { error: "Este slug já está sendo utilizado." };
    }
    return { error: "Erro ao salvar o catálogo no banco de dados." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/catalogs");

  return { success: true, catalog: created };
}

export async function updateCatalogAction(id: string, payload: unknown) {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado. Faça login para continuar." };
  }

  const rl = rateLimitCatalogUpdate(ip, user.id);
  if (!rl.allowed) {
    return { error: "Muitas edições recentes. Aguarde alguns minutos." };
  }

  const parseResult = catalogSchema.safeParse(payload);
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0]?.message || "Dados inválidos.";
    return { error: firstError };
  }

  const data = parseResult.data;

  // Check slug uniqueness excluding current catalog
  const { data: existing } = await supabase
    .from("catalogs")
    .select("id")
    .eq("slug", data.slug)
    .neq("id", id)
    .maybeSingle();

  if (existing) {
    return { error: "Este slug já está sendo utilizado por outro catálogo." };
  }

  const { data: updated, error } = await supabase
    .from("catalogs")
    .update({
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      logo_url: data.logo_url || null,
      banner_url: data.banner_url || null,
      whatsapp: data.whatsapp || null,
      active: data.active ?? true,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating catalog:", error);
    return { error: "Erro ao atualizar o catálogo." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/catalogs");
  revalidatePath(`/admin/catalogs/${id}`);

  return { success: true, catalog: updated };
}

export async function toggleCatalogActiveAction(id: string, active: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado." };
  }

  const { error } = await supabase
    .from("catalogs")
    .update({ active })
    .eq("id", id);

  if (error) {
    return { error: "Erro ao alterar status do catálogo." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/catalogs");
  return { success: true };
}

export async function deleteCatalogAction(id: string) {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado." };
  }

  const rl = rateLimitCatalogDelete(ip, user.id);
  if (!rl.allowed) {
    return { error: "Muitas exclusões recentes. Por favor, aguarde." };
  }

  // Deleting catalog will automatically CASCADE delete catalog_products junction rows (due to FK constraint)
  // Products themselves REMAIN intact in the `products` table.
  const { error } = await supabase.from("catalogs").delete().eq("id", id);

  if (error) {
    console.error("Error deleting catalog:", error);
    return { error: "Erro ao excluir o catálogo." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/catalogs");

  return { success: true };
}

export async function reorderCatalogProductsAction(
  catalogId: string,
  orderedProductIds: string[]
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "Não autorizado." };
    }

    for (let index = 0; index < orderedProductIds.length; index++) {
      const productId = orderedProductIds[index];
      const { error } = await supabase
        .from("catalog_products")
        .update({ display_order: index })
        .eq("catalog_id", catalogId)
        .eq("product_id", productId);

      if (error) {
        console.error("Error reordering catalog product:", error);
        return { error: "Erro ao salvar a nova ordenação dos produtos." };
      }
    }

    revalidatePath("/admin/catalogs");
    revalidatePath(`/admin/catalogs/${catalogId}`);

    return { success: true };
  } catch (err) {
    console.error("Unexpected error reordering products:", err);
    return { error: "Erro inesperado ao reordenar produtos." };
  }
}
"use server";

import { createClient } from "@/lib/supabase/server";
import { catalogFilterSchema } from "@/lib/validations";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function requireAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autorizado. Faça login para continuar.", supabase: null as unknown as Awaited<ReturnType<typeof createClient>> };
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";
  void ip;
  return { supabase, error: null as string | null };
}

function toSlugErrorMessage(code?: string | null) {
  if (code === "23505") return "Já existe um filtro com esse nome ou slug neste catálogo.";
  return null;
}

export async function getFiltersByCatalog(catalogId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("catalog_filters")
      .select("*, catalog_filter_products(count)")
      .eq("catalog_id", catalogId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return { filters: [], error: "Erro ao carregar filtros." };
    const filters = (data || []).map((f: Record<string, unknown>) => ({
      ...f,
      product_count: (f.catalog_filter_products as { count: number }[] | undefined)?.[0]?.count ?? 0,
    }));
    return { filters, error: null };
  } catch {
    return { filters: [], error: "Erro inesperado ao buscar filtros." };
  }
}

export async function getFiltersForPublicCatalog(catalogId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("catalog_filters")
      .select("id, catalog_id, name, slug, description, display_order")
      .eq("catalog_id", catalogId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return { filters: [], error: "Erro ao carregar filtros." };
    return { filters: data || [], error: null };
  } catch {
    return { filters: [], error: "Erro inesperado ao buscar filtros." };
  }
}

export async function createFilterAction(catalogId: string, payload: unknown) {
  const auth = await requireAuth();
  if (auth.error || !auth.supabase) return { error: auth.error };
  const parsed = catalogFilterSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  const data = parsed.data;

  const { data: existingCatalog } = await auth.supabase.from("catalogs").select("id").eq("id", catalogId).maybeSingle();
  if (!existingCatalog) return { error: "Catálogo não encontrado." };

  const { count } = await auth.supabase.from("catalog_filters").select("*", { count: "exact", head: true }).eq("catalog_id", catalogId);
  const nextOrder = data.display_order ?? (count ?? 0);

  const { data: created, error } = await auth.supabase
    .from("catalog_filters")
    .insert({
      catalog_id: catalogId,
      name: data.name.trim(),
      slug: data.slug,
      description: (data.description as string | undefined)?.trim() ? (data.description as string).trim() : null,
      display_order: nextOrder,
    })
    .select()
    .single();

  if (error) {
    const msg = toSlugErrorMessage(error.code);
    return { error: msg || "Erro ao criar filtro." };
  }

  revalidatePath(`/admin/catalogs/${catalogId}`);
  revalidatePath("/admin/catalogs");
  return { success: true, filter: created };
}

export async function updateFilterAction(filterId: string, payload: unknown) {
  const auth = await requireAuth();
  if (auth.error || !auth.supabase) return { error: auth.error };
  const parsed = catalogFilterSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  const data = parsed.data;

  const { data: current } = await auth.supabase.from("catalog_filters").select("id, catalog_id").eq("id", filterId).maybeSingle();
  if (!current) return { error: "Filtro não encontrado." };

  const { data: updated, error } = await auth.supabase
    .from("catalog_filters")
    .update({
      name: data.name.trim(),
      slug: data.slug,
      description: (data.description as string | undefined)?.trim() ? (data.description as string).trim() : null,
      display_order: data.display_order ?? 0,
    })
    .eq("id", filterId)
    .select()
    .single();

  if (error) {
    const msg = toSlugErrorMessage(error.code);
    return { error: msg || "Erro ao atualizar filtro." };
  }

  revalidatePath(`/admin/catalogs/${current.catalog_id}`);
  return { success: true, filter: updated };
}

export async function deleteFilterAction(filterId: string) {
  const auth = await requireAuth();
  if (auth.error || !auth.supabase) return { error: auth.error };

  const { data: current } = await auth.supabase.from("catalog_filters").select("id, catalog_id").eq("id", filterId).maybeSingle();
  if (!current) return { error: "Filtro não encontrado." };

  const { error } = await auth.supabase.from("catalog_filters").delete().eq("id", filterId);
  if (error) return { error: "Erro ao excluir filtro." };

  revalidatePath(`/admin/catalogs/${current.catalog_id}`);
  return { success: true };
}

export async function reorderFiltersAction(catalogId: string, orderedIds: string[]) {
  const auth = await requireAuth();
  if (auth.error || !auth.supabase) return { error: auth.error };

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await auth.supabase
      .from("catalog_filters")
      .update({ display_order: i })
      .eq("id", orderedIds[i])
      .eq("catalog_id", catalogId);
    if (error) return { error: "Erro ao salvar nova ordem dos filtros." };
  }

  revalidatePath(`/admin/catalogs/${catalogId}`);
  return { success: true };
}

export async function getFilterProductIds(filterId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("catalog_filter_products")
      .select("product_id")
      .eq("catalog_filter_id", filterId);
    if (error) return { productIds: [], error: "Erro ao carregar produtos do filtro." };
    return { productIds: (data || []).map((r: { product_id: string }) => r.product_id), error: null };
  } catch {
    return { productIds: [], error: "Erro inesperado ao buscar produtos do filtro." };
  }
}

export async function getProductsForFilterModal(catalogId: string, opts?: { search?: string; page?: number; pageSize?: number }) {
  try {
    const supabase = await createClient();
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts?.pageSize ?? 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const search = opts?.search?.trim() || "";

    const { data: catalogProductRows, error: cpError } = await supabase
      .from("catalog_products")
      .select("product_id")
      .eq("catalog_id", catalogId);

    if (cpError) return { products: [], total: 0, error: "Erro ao carregar produtos do catálogo." };

    const catalogProductIds = (catalogProductRows || []).map((r: { product_id: string }) => r.product_id);
    if (catalogProductIds.length === 0) return { products: [], total: 0, error: null };

    let query = supabase
      .from("products")
      .select("id, name, slug, price, image_url, active", { count: "exact" })
      .in("id", catalogProductIds)
      .eq("active", true)
      .order("name", { ascending: true });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) return { products: [], total: 0, error: "Erro ao carregar produtos." };

    const products = (data || []).map((p: Record<string, unknown>) => ({
      ...p,
      price: p.price == null ? null : Number(p.price as number),
    }));

    return { products, total: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize), error: null };
  } catch {
    return { products: [], total: 0, error: "Erro inesperado ao buscar produtos." };
  }
}

export async function syncFilterProductsAction(filterId: string, productIds: string[]) {
  const auth = await requireAuth();
  if (auth.error || !auth.supabase) return { error: auth.error };

  const { data: filter } = await auth.supabase.from("catalog_filters").select("id, catalog_id").eq("id", filterId).maybeSingle();
  if (!filter) return { error: "Filtro não encontrado." };

  if (productIds.length > 0) {
    const { data: catalogProductRows } = await auth.supabase
      .from("catalog_products")
      .select("product_id")
      .eq("catalog_id", filter.catalog_id)
      .in("product_id", productIds);

    const allowed = new Set((catalogProductRows || []).map((r: { product_id: string }) => r.product_id));
    const invalid = productIds.filter((id) => !allowed.has(id));
    if (invalid.length > 0) {
      return { error: "Alguns produtos não pertencem a este catálogo e não podem ser associados ao filtro." };
    }
  }

  const { data: currentRows } = await auth.supabase
    .from("catalog_filter_products")
    .select("product_id")
    .eq("catalog_filter_id", filterId);

  const currentIds = new Set((currentRows || []).map((r: { product_id: string }) => r.product_id));
  const nextIds = new Set(productIds);

  const toAdd = productIds.filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !nextIds.has(id));

  if (toRemove.length > 0) {
    const { error } = await auth.supabase
      .from("catalog_filter_products")
      .delete()
      .eq("catalog_filter_id", filterId)
      .in("product_id", toRemove);
    if (error) return { error: "Erro ao remover produtos do filtro." };
  }

  if (toAdd.length > 0) {
    const inserts = toAdd.map((product_id) => ({ catalog_filter_id: filterId, product_id }));
    const { error } = await auth.supabase.from("catalog_filter_products").insert(inserts);
    if (error) return { error: "Erro ao adicionar produtos ao filtro." };
  }

  revalidatePath(`/admin/catalogs/${filter.catalog_id}`);
  return { success: true };
}

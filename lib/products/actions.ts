"use server";

import { createClient } from "@/lib/supabase/server";
import { productSchema } from "@/lib/validations";
import { rateLimitProductCreate, rateLimitProductUpdate, rateLimitProductDelete } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function getAllCatalogsForSelect() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalogs").select("id, name").order("name");
  return { catalogs: data || [], error: error ? "Erro ao buscar catálogos." : null };
}

export async function getProducts() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("products").select("*, catalog_products(catalog_id)").order("created_at", { ascending: false });
    if (error) return { products: [], error: "Erro ao carregar os produtos." };
    return { products: (data || []).map((item) => ({ ...item, price: Number(item.price), catalog_ids: item.catalog_products.map((cp: { catalog_id: string }) => cp.catalog_id), catalog_count: item.catalog_products.length })), error: null };
  } catch { return { products: [], error: "Erro inesperado ao buscar produtos." }; }
}

export async function getProductById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("*, catalog_products(catalog_id)").eq("id", id).single();
  if (error || !data) return { product: null, error: "Produto não encontrado." };
  return { product: { ...data, price: Number(data.price), catalog_ids: data.catalog_products.map((cp: { catalog_id: string }) => cp.catalog_id) }, error: null };
}

async function getAuthorizedContext(type: "create" | "update" | "delete") {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autorizado. Faça login para continuar.", supabase: null };
  const checks = { create: rateLimitProductCreate, update: rateLimitProductUpdate, delete: rateLimitProductDelete };
  if (!checks[type](ip, user.id).allowed) return { error: "Muitas operações recentes. Por favor, aguarde alguns minutos.", supabase: null };
  return { supabase, error: null };
}

function refreshPaths(id?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/catalogs");
  if (id) revalidatePath(`/admin/products/${id}`);
}

export async function createProductAction(payload: unknown) {
  const context = await getAuthorizedContext("create");
  if (context.error || !context.supabase) return { error: context.error };
  const parsed = productSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  const data = parsed.data;
  const { data: product, error } = await context.supabase.from("products").insert({ name: data.name, slug: data.slug, description: data.description || null, price: data.price, image_url: data.image_url || null, active: data.active }).select().single();
  if (error || !product) return { error: "Erro ao criar o produto." };
  if (data.catalog_ids.length) {
    const { error: relationError } = await context.supabase.from("catalog_products").insert(data.catalog_ids.map((catalog_id, display_order) => ({ catalog_id, product_id: product.id, display_order })));
    if (relationError) { await context.supabase.from("products").delete().eq("id", product.id); return { error: "Erro ao associar os catálogos selecionados." }; }
  }
  refreshPaths();
  return { success: true, product };
}

export async function updateProductAction(id: string, payload: unknown) {
  const context = await getAuthorizedContext("update");
  if (context.error || !context.supabase) return { error: context.error };
  const parsed = productSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  const data = parsed.data;
  const { data: product, error } = await context.supabase.from("products").update({ name: data.name, slug: data.slug, description: data.description || null, price: data.price, image_url: data.image_url || null, active: data.active }).eq("id", id).select().single();
  if (error || !product) return { error: "Erro ao atualizar o produto." };
  const { error: deleteError } = await context.supabase.from("catalog_products").delete().eq("product_id", id);
  if (deleteError) return { error: "Erro ao atualizar as associações de catálogo." };
  if (data.catalog_ids.length) {
    const { error: insertError } = await context.supabase.from("catalog_products").insert(data.catalog_ids.map((catalog_id, display_order) => ({ catalog_id, product_id: id, display_order })));
    if (insertError) return { error: "Erro ao salvar as novas associações de catálogo." };
  }
  refreshPaths(id);
  return { success: true, product };
}

export async function deleteProductAction(id: string) {
  const context = await getAuthorizedContext("delete");
  if (context.error || !context.supabase) return { error: context.error };
  const { error } = await context.supabase.from("products").delete().eq("id", id);
  if (error) return { error: "Erro ao excluir o produto." };
  refreshPaths();
  return { success: true };
}

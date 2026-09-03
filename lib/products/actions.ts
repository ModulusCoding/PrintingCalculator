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
    const { data, error } = await supabase
      .from("products")
      .select("*, catalog_products(catalog_id), product_images(id, url, display_order)")
      .order("created_at", { ascending: false });
    if (error) return { products: [], error: "Erro ao carregar os produtos." };
    return {
      products: (data || []).map((item) => {
        const sortedImages = (item.product_images || []).sort(
          (a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order
        );
        return {
          ...item,
          price: item.price == null ? null : Number(item.price),
          images: sortedImages,
          catalog_ids: item.catalog_products.map((cp: { catalog_id: string }) => cp.catalog_id),
          catalog_count: item.catalog_products.length,
        };
      }),
      error: null,
    };
  } catch {
    return { products: [], error: "Erro inesperado ao buscar produtos." };
  }
}

export async function getProductById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, catalog_products(catalog_id), product_images(id, url, display_order)")
    .eq("id", id)
    .single();
  if (error || !data) return { product: null, error: "Produto não encontrado." };
  const sortedImages = (data.product_images || []).sort(
    (a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order
  );
  return {
    product: {
      ...data,
      price: data.price == null ? null : Number(data.price),
      images: sortedImages,
      catalog_ids: data.catalog_products.map((cp: { catalog_id: string }) => cp.catalog_id),
    },
    error: null,
  };
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

  if (data.images && data.images.length > 3) {
    return { error: "O limite máximo por produto é de 3 imagens." };
  }

  const primaryImage = data.images && data.images.length > 0 ? data.images[0] : data.image_url || null;

  const { data: product, error } = await context.supabase
    .from("products")
    .insert({
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      price: data.price,
      image_url: primaryImage,
      active: data.active,
    })
    .select()
    .single();

  if (error || !product) return { error: "Erro ao criar o produto." };

  if (data.images && data.images.length > 0) {
    const imageRows = data.images.slice(0, 3).map((url, idx) => ({
      product_id: product.id,
      url,
      display_order: idx + 1,
    }));
    const { error: imgError } = await context.supabase.from("product_images").insert(imageRows);
    if (imgError) {
      await context.supabase.from("products").delete().eq("id", product.id);
      return { error: "Erro ao salvar as imagens do produto." };
    }
  }

  if (data.catalog_ids.length) {
    const { error: relationError } = await context.supabase
      .from("catalog_products")
      .insert(data.catalog_ids.map((catalog_id, display_order) => ({ catalog_id, product_id: product.id, display_order })));
    if (relationError) {
      await context.supabase.from("products").delete().eq("id", product.id);
      return { error: "Erro ao associar os catálogos selecionados." };
    }
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

  if (data.images && data.images.length > 3) {
    return { error: "O limite máximo por produto é de 3 imagens." };
  }

  const primaryImage = data.images && data.images.length > 0 ? data.images[0] : data.image_url || null;

  const { data: product, error } = await context.supabase
    .from("products")
    .update({
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      price: data.price,
      image_url: primaryImage,
      active: data.active,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !product) return { error: "Erro ao atualizar o produto." };

  const { error: deleteImgErr } = await context.supabase.from("product_images").delete().eq("product_id", id);
  if (deleteImgErr) return { error: "Erro ao atualizar imagens existentes." };

  if (data.images && data.images.length > 0) {
    const imageRows = data.images.slice(0, 3).map((url, idx) => ({
      product_id: id,
      url,
      display_order: idx + 1,
    }));
    const { error: insertImgErr } = await context.supabase.from("product_images").insert(imageRows);
    if (insertImgErr) return { error: "Erro ao salvar as novas imagens do produto." };
  }

  const { error: deleteError } = await context.supabase.from("catalog_products").delete().eq("product_id", id);
  if (deleteError) return { error: "Erro ao atualizar as associações de catálogo." };
  if (data.catalog_ids.length) {
    const { error: insertError } = await context.supabase
      .from("catalog_products")
      .insert(data.catalog_ids.map((catalog_id, display_order) => ({ catalog_id, product_id: id, display_order })));
    if (insertError) return { error: "Erro ao salvar as novas associações de catálogo." };
  }

  refreshPaths(id);
  return { success: true, product };
}

export async function deleteProductAction(id: string) {
  const context = await getAuthorizedContext("delete");
  if (context.error || !context.supabase) return { error: context.error };

  // Buscar imagens para limpar Storage sem deixar arquivos órfãos
  const { data: images } = await context.supabase
    .from("product_images")
    .select("url")
    .eq("product_id", id);

  const { error } = await context.supabase.from("products").delete().eq("id", id);
  if (error) return { error: "Erro ao excluir o produto." };

  if (images && images.length > 0) {
    const filePaths = images
      .map((img) => {
        try {
          const url = new URL(img.url);
          const pathParts = url.pathname.split("/");
          const bucketIndex = pathParts.indexOf("products");
          if (bucketIndex >= 0 && pathParts.length > bucketIndex + 1) {
            return pathParts.slice(bucketIndex + 1).join("/");
          }
        } catch {
          return null;
        }
        return null;
      })
      .filter((p): p is string => Boolean(p));

    if (filePaths.length > 0) {
      await context.supabase.storage.from("products").remove(filePaths);
    }
  }

  refreshPaths();
  return { success: true };
}

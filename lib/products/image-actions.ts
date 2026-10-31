"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { processImageToWebP } from "@/lib/image/process";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const version = z.number().int().nonnegative().finite();
const order = z.number().int().min(1).max(3);
const path = z.string().regex(/^enterprise\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/);

export type ProductImageStatus =
  | "invalid_input"
  | "permission_denied"
  | "product_unavailable"
  | "version_conflict"
  | "image_unavailable"
  | "image_limit_reached"
  | "image_conflict"
  | "cleanup_pending"
  | "technical"
  | "unknown"
  | "success";
export type ProductImageResult = { status: ProductImageStatus; version?: number; storagePath?: string };
export type ProductImage = { id: string; productId: string; displayOrder: number; url: string };
export type ProductImagesReadResult =
  | { status: "success"; images: ProductImage[] }
  | { status: "technical" | "invalid_input" | "permission_denied" };

const imageRow = z.object({
  id: uuid,
  product_id: uuid,
  storage_path: path,
  display_order: order,
}).strict();

export async function getInternalProductImages(productId: string): Promise<ProductImagesReadResult> {
  if (!uuid.safeParse(productId).success) return { status: "invalid_input" };
  try {
    const context = await requireBusinessContext("products.read");
    const supabase = await createClient();
    const { data, error } = await supabase.from("product_images")
      .select("id,product_id,storage_path,display_order")
      .eq("enterprise_id", context.enterpriseId)
      .eq("product_id", productId)
      .order("display_order", { ascending: true });
    if (error || !Array.isArray(data)) return { status: "technical" };
    const parsed = z.array(imageRow).max(3).safeParse(data);
    if (!parsed.success || parsed.data.some((row) => row.product_id !== productId || !row.storage_path.startsWith(`enterprise/${context.enterpriseId}/products/${productId}/`))) return { status: "technical" };
    const images: ProductImage[] = [];
    for (const row of parsed.data) {
      const { data: signed, error: signError } = await supabase.storage.from("internal-product-images").createSignedUrl(row.storage_path, 300);
      if (signError || !signed?.signedUrl) return { status: "technical" };
      images.push({ id: row.id, productId: row.product_id, displayOrder: row.display_order, url: signed.signedUrl });
    }
    return { status: "success", images };
  } catch (error) {
    if (error instanceof AuthContextError && (error.code === "AUTH_PERMISSION_DENIED" || error.code === "AUTH_ACCESS_BLOCKED" || error.code === "AUTH_UNAUTHENTICATED")) return { status: "permission_denied" };
    return { status: "technical" };
  }
}

const linkRemoveReorderRow = z.object({ status: z.enum(["invalid_input", "permission_denied", "product_unavailable", "version_conflict", "image_unavailable", "image_limit_reached", "image_conflict", "cleanup_pending", "technical", "unknown", "success"]), version: z.number().int().nonnegative().finite().nullable(), storage_path: z.string().nullable().optional() }).strict();
const prepareRow = z.object({ status: z.enum(["invalid_input", "permission_denied", "product_unavailable", "version_conflict", "success"]), version: z.number().int().nonnegative().finite().nullable(), storage_path: z.string() }).strict();

function refresh(productId: string) {
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
}

async function rpcLinkRemoveReorder(fn: "link_internal_product_image" | "remove_internal_product_image" | "reorder_internal_product_image", args: Record<string, unknown>): Promise<ProductImageResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !Array.isArray(data) || data.length !== 1) return { status: "unknown" };
  const row = linkRemoveReorderRow.safeParse(data[0]);
  if (!row.success) return { status: "unknown" };
  return { status: row.data.status, version: row.data.version ?? undefined, storagePath: row.data.storage_path ?? undefined };
}

async function rpcPrepare(args: Record<string, unknown>): Promise<{ status: ProductImageStatus; version?: number; storagePath?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_internal_product_image_upload", args);
  if (error || !Array.isArray(data) || data.length !== 1) return { status: "unknown" };
  const row = prepareRow.safeParse(data[0]);
  if (!row.success) return { status: "unknown" };
  return { status: row.data.status, version: row.data.version ?? undefined, storagePath: row.data.storage_path };
}

export async function uploadInternalProductImage(productId: string, expectedVersion: number, displayOrder: number, formData: FormData): Promise<ProductImageResult> {
  if (!uuid.safeParse(productId).success || !version.safeParse(expectedVersion).success || !order.safeParse(displayOrder).success) return { status: "invalid_input" };
  const file = formData.get("file");
  if (!(file instanceof File)) return { status: "invalid_input" };
  try {
    await requireBusinessContext("products.write");
    // Validate and convert before creating an upload reservation. This avoids
    // leaving a server-side reservation for files rejected by the processor.
    const processed = await processImageToWebP(file);
    if ("error" in processed) return { status: "invalid_input" };

    const supabase = await createClient();
    const prepare = await rpcPrepare({ p_product_id: productId, p_expected_version: expectedVersion });
    if (prepare.status !== "success" || !prepare.storagePath || !path.safeParse(prepare.storagePath).success) return { status: prepare.status };
    const { error: uploadError } = await supabase.storage.from("internal-product-images").upload(prepare.storagePath, processed.buffer, { contentType: "image/webp", cacheControl: "3600", upsert: false });
    if (uploadError) return { status: "image_unavailable" };
    const result = await rpcLinkRemoveReorder("link_internal_product_image", { p_product_id: productId, p_expected_version: expectedVersion, p_storage_path: prepare.storagePath, p_display_order: displayOrder });
    if (result.status === "success") {
      refresh(productId);
    }
    // Association failure/unknown is not proof that the object is unlinked.
    // Do not delete it automatically; an authorized follow-up must reconcile it.
    return result;
  } catch {
    return { status: "unknown" };
  }
}

export async function removeInternalProductImage(productId: string, expectedVersion: number, imageId: string): Promise<ProductImageResult> {
  if (!uuid.safeParse(productId).success || !uuid.safeParse(imageId).success || !version.safeParse(expectedVersion).success) return { status: "invalid_input" };
  try {
    await requireBusinessContext("products.write");
    const result = await rpcLinkRemoveReorder("remove_internal_product_image", { p_product_id: productId, p_expected_version: expectedVersion, p_image_id: imageId });
    if (result.status !== "success" || result.version === undefined || !result.storagePath || !path.safeParse(result.storagePath).success) return result.status === "success" ? { status: "unknown" } : result;
    refresh(productId);
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from("internal-product-images").remove([result.storagePath]);
      if (error || !Array.isArray(data) || data.length !== 1 || data[0]?.name !== result.storagePath) return { status: "cleanup_pending", version: result.version };
    } catch {
      return { status: "cleanup_pending", version: result.version };
    }
    return result;
  } catch {
    return { status: "unknown" };
  }
}

export async function reorderInternalProductImage(productId: string, expectedVersion: number, imageId: string, newOrder: number): Promise<ProductImageResult> {
  if (!uuid.safeParse(productId).success || !uuid.safeParse(imageId).success || !version.safeParse(expectedVersion).success || !order.safeParse(newOrder).success) return { status: "invalid_input" };
  try {
    await requireBusinessContext("products.write");
    const result = await rpcLinkRemoveReorder("reorder_internal_product_image", { p_product_id: productId, p_expected_version: expectedVersion, p_image_id: imageId, p_new_order: newOrder });
    if (result.status === "success") refresh(productId);
    return result;
  } catch {
    return { status: "unknown" };
  }
}

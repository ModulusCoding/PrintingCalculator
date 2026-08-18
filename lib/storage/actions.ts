"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimitImageUpload } from "@/lib/rate-limit";
import { headers } from "next/headers";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function uploadImageAction(formData: FormData, bucket: "catalogs" | "products") {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado. Faça login para enviar arquivos." };
  }

  const rl = rateLimitImageUpload(ip, user.id);
  if (!rl.allowed) {
    return { error: "Muitos uploads recentes. Aguarde alguns minutos." };
  }

  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) {
    return { error: "Nenhum arquivo enviado." };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      error: "Tipo de arquivo não permitido. Apenas JPEG, PNG, WEBP, GIF e SVG são aceitos.",
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { error: "O tamanho do arquivo excede o limite máximo de 5MB." };
  }

  // Generate safe sanitized filename
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const uniqueId = crypto.randomUUID();
  const filePath = `${uniqueId}.${extension}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return { error: "Erro ao fazer upload da imagem no Supabase Storage." };
  }

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(filePath);

  return {
    success: true,
    url: publicUrlData.publicUrl,
  };
}

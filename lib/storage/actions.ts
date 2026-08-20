"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimitImageUpload } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { processImageToWebP, generateSafeFilePath } from "@/lib/image/process";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function deleteImageAction(
  bucket: "catalogs" | "products",
  filePath: string
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: "Não autorizado." };
    }

    const { error } = await supabase.storage.from(bucket).remove([filePath]);

    if (error) {
      console.error("Storage delete error:", error);
      return { error: "Erro ao excluir a imagem do Storage." };
    }

    return { success: true };
  } catch (err) {
    console.error("Unexpected error deleting image:", err);
    return { error: "Erro inesperado ao excluir imagem." };
  }
}

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

  if (file.size > MAX_FILE_SIZE) {
    return { error: "O tamanho do arquivo excede o limite máximo de 5MB." };
  }

  const processResult = await processImageToWebP(file);
  if ("error" in processResult) {
    return { error: processResult.error };
  }

  const filePath = generateSafeFilePath(file.name, processResult.extension);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, processResult.buffer, {
      contentType: processResult.contentType,
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

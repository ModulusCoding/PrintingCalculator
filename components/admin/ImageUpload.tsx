"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { uploadImageAction, deleteImageAction } from "@/lib/storage/actions";
import { Upload, Loader2, Trash2, RotateCcw, Image as ImageIcon } from "lucide-react";

interface ImageUploadProps {
  bucket: "catalogs" | "products";
  value: string;
  onChange: (url: string) => void;
  label: string;
  aspectRatio?: "square" | "banner";
  onDelete?: () => void;
}

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const MAGIC_BYTES: Record<string, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46], [0x57, 0x45, 0x42, 0x50]], // RIFF + WEBP at offset 8
};

function validateFile(file: File): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    const allowedTypes = ALLOWED_MIME_TYPES as readonly string[];
    if (!allowedTypes.includes(file.type)) {
      return resolve({ valid: false, error: "Tipo de arquivo não permitido. Apenas JPEG, PNG e WEBP são aceitos." });
    }

    if (file.size > MAX_FILE_SIZE) {
      return resolve({ valid: false, error: "O tamanho do arquivo excede o limite máximo de 5MB." });
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = new Uint8Array(e.target?.result as ArrayBuffer);
      
      const matched = Object.entries(MAGIC_BYTES).some(([, signatures]) =>
        signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte))
      );
      
      if (!matched) {
        resolve({ valid: false, error: "Arquivo não é uma imagem válida (assinatura inválida)." });
      } else {
        resolve({ valid: true });
      }
    };
    reader.onerror = () => resolve({ valid: false, error: "Falha ao ler o arquivo." });
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

export function ImageUpload({
  bucket,
  value,
  onChange,
  label,
  aspectRatio = "square",
  onDelete,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validation = await validateFile(file);
    if (!validation.valid) {
      setError(validation.error!);
      if (event.target) event.target.value = "";
      return;
    }

    const previousUrl = value;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadImageAction(formData, bucket);
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        onChange(result.url);
        if (previousUrl) {
          try {
            const url = new URL(previousUrl);
            const pathParts = url.pathname.split("/");
            const bucketIndex = pathParts.indexOf("public");
            if (bucketIndex >= 0 && pathParts.length > bucketIndex + 1) {
              const filePath = pathParts.slice(bucketIndex + 2).join("/");
              await deleteImageAction(bucket, filePath);
            }
          } catch {
            console.warn("Falha ao excluir imagem anterior do Storage:", previousUrl);
          }
        }
      }
    } catch {
      setError("Erro inesperado ao fazer upload.");
    } finally {
      setUploading(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleDelete = async () => {
    if (!value) return;
    setDeleting(true);
    setError(null);
    try {
      const url = new URL(value);
      const pathParts = url.pathname.split("/");
      const bucketIndex = pathParts.indexOf("public");
      if (bucketIndex >= 0 && pathParts.length > bucketIndex + 1) {
        const filePath = pathParts.slice(bucketIndex + 2).join("/");
        const result = await deleteImageAction(bucket, filePath);
        if (result.error) {
          setError(result.error);
        } else {
          onChange("");
          onDelete?.();
        }
      } else {
        onChange("");
        onDelete?.();
      }
    } catch {
      setError("Erro ao excluir a imagem.");
    } finally {
      setDeleting(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      {value ? (
        <div className="relative w-full max-w-xs rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          <div
            className={aspectRatio === "banner" ? "aspect-[16/4]" : "aspect-square"}
            onClick={triggerFileInput}
            style={{ cursor: "pointer" }}
            title="Clique para substituir a imagem"
          >
            <Image
              src={value}
              alt={`${label} preview`}
              fill
              sizes="(max-width: 768px) 100vw, 320px"
              className="object-cover transition-opacity duration-200 hover:opacity-80"
              unoptimized
            />
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity duration-200">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/90 dark:bg-slate-900/90 rounded-lg shadow-lg">
                <ImageIcon className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Substituir
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400 truncate flex-1">
              {value.split("/").pop()}
            </span>
            <div className="flex items-center gap-1">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-500 dark:text-slate-400" />
              ) : deleting ? (
                <Loader2 className="h-4 w-4 animate-spin text-red-500" />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={triggerFileInput}
                    className="p-1 rounded-lg text-blue-600 hover:bg-blue-600/10 transition-colors"
                    title="Substituir imagem"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="p-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Remover do Storage"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading || deleting}
          />
        </div>
      ) : (
        <label
          className={`relative flex items-center justify-center w-full max-w-xs rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 cursor-pointer transition-colors ${aspectRatio === "banner" ? "aspect-[16/4]" : "aspect-square"}`}
        >
          <div className="text-center px-4 py-6">
            {uploading ? (
              <>
                <Loader2 className="mx-auto h-8 w-8 text-blue-500 animate-spin" />
                <p className="mt-2 text-xs text-slate-500">Enviando...</p>
              </>
            ) : (
              <>
                <Upload className="mx-auto h-7 w-7 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  Clique para enviar
                </p>
                <p className="mt-1 text-xs text-slate-500">PNG, JPG, WEBP (máx. 5MB)</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
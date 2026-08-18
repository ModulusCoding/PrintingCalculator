"use client";

import { useState } from "react";
import Image from "next/image";
import { uploadImageAction } from "@/lib/storage/actions";
import { Upload, Loader2, Trash2 } from "lucide-react";

interface ImageUploadProps {
  bucket: "catalogs" | "products";
  value: string;
  onChange: (url: string) => void;
  label: string;
  aspectRatio?: "square" | "banner";
}

export function ImageUpload({
  bucket,
  value,
  onChange,
  label,
  aspectRatio = "square",
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
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
      }
    } catch {
      setError("Erro inesperado ao fazer upload.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      {value ? (
        <div className="relative w-full max-w-xs rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
          <div className={aspectRatio === "banner" ? "aspect-[16/4]" : "aspect-square"}>
            <Image
              src={value}
              alt={`${label} preview`}
              fill
              sizes="(max-width: 768px) 100vw, 320px"
              className="object-cover"
              unoptimized
            />
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400 truncate flex-1">
              {value.split("/").pop()}
            </span>
            <div className="flex items-center gap-1">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-500 dark:text-slate-400" />
              ) : (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="p-1 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                  title="Remover"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
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
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
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

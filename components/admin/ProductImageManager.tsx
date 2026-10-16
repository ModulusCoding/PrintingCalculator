"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadInternalProductImage,
  removeInternalProductImage,
  reorderInternalProductImage,
  type ProductImage,
  type ProductImageResult,
  type ProductImageStatus,
} from "@/lib/products/image-actions";

const messages: Record<ProductImageStatus, string> = {
  success: "Imagens atualizadas.",
  invalid_input: "Selecione uma imagem JPEG, PNG ou WebP válida (até 5 MB).",
  permission_denied: "Você não tem permissão para alterar imagens.",
  product_unavailable: "Este produto não está disponível para alterações.",
  version_conflict: "O produto foi alterado. Atualize a página antes de tentar novamente.",
  image_unavailable: "A imagem não está disponível. Atualize a página e tente novamente.",
  image_limit_reached: "O limite é de 3 imagens por produto.",
  image_conflict: "A ordem das imagens mudou. Atualize a página antes de tentar novamente.",
  cleanup_pending: "Imagem removida do produto. A limpeza do arquivo está pendente.",
  technical: "Não foi possível concluir a operação. Atualize a página e tente novamente.",
  unknown: "Não foi possível confirmar a operação. Atualize a página antes de tentar novamente.",
};

type Props = {
  productId: string;
  version: number;
  active: boolean;
  canWrite: boolean;
  initialImages: ProductImage[];
  initialError?: string;
};

export function ProductImageManager({ productId, version, active, canWrite, initialImages, initialError }: Props) {
  const router = useRouter();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editable = active && canWrite;
  const disabled = pending || awaitingRefresh || Boolean(initialError);

  function run(operation: () => Promise<ProductImageResult>) {
    if (!editable || disabled || inFlight.current) return;
    inFlight.current = true;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await operation();
        setMessage(messages[result.status] ?? messages.unknown);
        if ((result.status === "success" || result.status === "cleanup_pending") && result.version !== undefined) {
          setCurrentVersion(result.version);
          setAwaitingRefresh(true);
          setFile(null);
          if (input.current) input.current.value = "";
          // The parent keys this component by the server product version so
          // refreshed image props replace local state, rather than going stale.
          router.refresh();
        }
      } catch {
        setMessage(messages.unknown);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="product-images-heading" className="space-y-3 border-t pt-5">
      <h3 id="product-images-heading" className="font-semibold">Imagens do produto</h3>
      <p className="text-sm text-slate-500">Até 3 imagens. A primeira imagem é a principal.</p>
      {initialError ? <p role="alert" className="text-sm text-red-600">{initialError}</p> : initialImages.length === 0 ? (
        <p className="text-sm text-slate-500">Este produto ainda não tem imagens.</p>
      ) : (
        <ul className="space-y-3">
          {initialImages.map((image, index) => (
            <li key={image.id} className="flex flex-wrap items-center gap-3 rounded border p-2">
              {/* Signed private URLs expire; do not cache them through an image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`Imagem ${index + 1} do produto`} className="h-20 w-20 rounded object-cover" />
              <span className="text-sm">{index === 0 ? "Principal" : `Imagem ${index + 1}`}</span>
              {editable && <div className="flex flex-wrap gap-2">
                <button type="button" disabled={disabled || index === 0} className="rounded border px-2 py-1 text-sm disabled:opacity-50" aria-label={`Mover imagem ${index + 1} para cima`} onClick={() => run(() => reorderInternalProductImage(productId, currentVersion, image.id, initialImages[index - 1].displayOrder))}>Subir</button>
                <button type="button" disabled={disabled || index === initialImages.length - 1} className="rounded border px-2 py-1 text-sm disabled:opacity-50" aria-label={`Mover imagem ${index + 1} para baixo`} onClick={() => run(() => reorderInternalProductImage(productId, currentVersion, image.id, initialImages[index + 1].displayOrder))}>Descer</button>
                <button type="button" disabled={disabled} className="rounded border px-2 py-1 text-sm text-red-600 disabled:opacity-50" onClick={() => {
                  if (window.confirm("Remover esta imagem do produto?")) run(() => removeInternalProductImage(productId, currentVersion, image.id));
                }}>Remover</button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      {editable && initialImages.length < 3 && <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="product-image-file">Adicionar imagem (JPEG, PNG ou WebP, até 5 MB)</label>
        <input ref={input} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full text-sm" />
        <button type="button" disabled={disabled || !file} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => {
          if (!file) return;
          const formData = new FormData();
          formData.set("file", file);
          const freeOrder = [1, 2, 3].find((position) => !initialImages.some((image) => image.displayOrder === position));
          if (freeOrder) run(() => uploadInternalProductImage(productId, currentVersion, freeOrder, formData));
        }}>{pending ? "Processando..." : "Adicionar imagem"}</button>
      </div>}
      {!editable && <p className="text-sm text-slate-500">{active ? "Imagens disponíveis apenas para visualização." : "Produto arquivado: imagens disponíveis apenas para visualização."}</p>}
      <div role="status" aria-live="polite" className="text-sm">{message}{awaitingRefresh && " Atualizando imagens; se necessário, recarregue a página."}</div>
      <button type="button" disabled={pending} onClick={() => router.refresh()} className="text-sm underline disabled:opacity-50">Atualizar imagens</button>
    </section>
  );
}

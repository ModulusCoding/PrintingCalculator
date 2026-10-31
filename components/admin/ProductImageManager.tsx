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
  const [needsReview, setNeedsReview] = useState(false);
  const disabled = pending || awaitingRefresh || needsReview || Boolean(initialError);
  const button = "min-h-11 min-w-11 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium transition motion-reduce:transition-none hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-modulus-primary focus-visible:ring-offset-2 disabled:opacity-40";

  function run(operation: () => Promise<ProductImageResult>) {
    if (!editable || disabled || inFlight.current) return;
    inFlight.current = true;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await operation();
        setMessage(messages[result.status] ?? messages.unknown);
        if (["unknown", "technical", "version_conflict", "image_conflict", "image_unavailable"].includes(result.status)) setNeedsReview(true);
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
        setNeedsReview(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <section aria-labelledby="product-images-heading" aria-busy={pending || awaitingRefresh} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="product-images-heading" className="text-lg font-semibold tracking-tight">Galeria do produto</h3><span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-600">{initialImages.length}/3 imagens</span></div>
      <p className="text-sm text-slate-500">Até 3 imagens. A primeira é a principal. As alterações na galeria são salvas separadamente.</p>
      {initialError ? <p role="alert" className="text-sm text-red-600">{initialError}</p> : initialImages.length === 0 ? (
        <p className="text-sm text-slate-500">Este produto ainda não tem imagens.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {initialImages.map((image, index) => (
            <li key={image.id} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {/* Signed private URLs expire; do not cache them through an image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`Imagem ${index + 1} do produto`} className="aspect-square w-full rounded-lg bg-slate-100 object-contain" />
              <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${index === 0 ? "bg-modulus-primary text-white" : "bg-slate-200 text-slate-700"}`}>{index === 0 ? "Principal" : `Imagem ${index + 1}`}</span>
              {editable && <div className="flex flex-wrap gap-2">
                <button type="button" disabled={disabled || index === 0} className={button} aria-label={`Mover imagem ${index + 1} para cima`} onClick={() => run(() => reorderInternalProductImage(productId, currentVersion, image.id, initialImages[index - 1].displayOrder))}>Subir</button>
                <button type="button" disabled={disabled || index === initialImages.length - 1} className={button} aria-label={`Mover imagem ${index + 1} para baixo`} onClick={() => run(() => reorderInternalProductImage(productId, currentVersion, image.id, initialImages[index + 1].displayOrder))}>Descer</button>
                <button type="button" disabled={disabled} aria-label={`Remover imagem ${index + 1}`} className={`${button} text-red-600`} onClick={() => {
                  if (window.confirm("Remover esta imagem do produto?")) run(() => removeInternalProductImage(productId, currentVersion, image.id));
                }}>Remover</button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      {editable && initialImages.length < 3 && <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
        <label className="block text-sm font-medium" htmlFor="product-image-file">Adicionar imagem (JPEG, PNG ou WebP, até 5 MB)</label>
        <input ref={input} id="product-image-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-describedby="product-image-help" className="block min-h-11 w-full min-w-0 rounded-lg text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-modulus-primary disabled:opacity-50" />
        <button type="button" disabled={disabled || !file} className="min-h-11 rounded-xl bg-modulus-primary px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-modulus-primary focus-visible:ring-offset-2 disabled:opacity-50" onClick={() => {
          if (!file) return;
          const formData = new FormData();
          formData.set("file", file);
          const freeOrder = [1, 2, 3].find((position) => !initialImages.some((image) => image.displayOrder === position));
          if (freeOrder) run(() => uploadInternalProductImage(productId, currentVersion, freeOrder, formData));
        }}>{pending ? "Processando..." : "Adicionar imagem"}</button>
        <p id="product-image-help" className="text-xs leading-relaxed text-slate-500">Selecione um arquivo por vez. O envio só começa ao clicar em Adicionar imagem.</p>
      </div>}
      {!editable && <p className="text-sm text-slate-500">{active ? "Imagens disponíveis apenas para visualização." : "Produto arquivado: imagens disponíveis apenas para visualização."}</p>}
      <div role="status" aria-live="polite" className="text-sm text-slate-600">{pending ? "Processando a alteração. Aguarde..." : message}{awaitingRefresh && " Atualizando imagens; se necessário, use Atualizar imagens."}</div>
      <button type="button" disabled={pending} onClick={() => router.refresh()} className={button}>Atualizar imagens</button>
    </section>
  );
}

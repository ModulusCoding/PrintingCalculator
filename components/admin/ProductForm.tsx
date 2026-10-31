"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { productMessage, productPlanAction } from "@/lib/products/messages";
import { createInternalProduct, updateInternalProduct, type ProductRecord } from "@/lib/products/actions";
import { ProductArchiveButton } from "@/components/admin/ProductArchiveButton";
import { ProductImageManager } from "@/components/admin/ProductImageManager";
import type { ProductImagesReadResult } from "@/lib/products/image-actions";

type Payload = { attempt_id: string; name: string; description: string | null; price: string };
const control = "min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-base text-[#152336] outline-none transition motion-reduce:transition-none focus:border-modulus-primary focus:ring-2 focus:ring-modulus-primary/20 disabled:opacity-60 read-only:bg-slate-100";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-modulus-primary focus-visible:ring-offset-2";

// Mirrors the public input contract only; the server remains authoritative.
function validate(name: string, description: string, price: string) {
  const errors: Record<string, string[]> = {};
  if (name.trim().length < 2 || name.trim().length > 255) errors.name = ["Informe um nome entre 2 e 255 caracteres."];
  if (description.length > 3000) errors.description = ["Use até 3.000 caracteres na descrição."];
  const raw = price.trim().replace(/^R\$\s*/i, "");
  if (price.trim()) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(raw)) {
      errors.price = ["Use um valor em reais, como 1.250,50 ou R$ 1.250,50."];
    } else {
      const amount = Number(raw.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount > 1_000_000) errors.price = ["O valor máximo é R$ 1.000.000,00."];
    }
  }
  return errors;
}

export function ProductForm({ product, canWrite = true, canDelete = true, imageResult, galleryRefreshKey = "initial" }: { product?: ProductRecord; canWrite?: boolean; canDelete?: boolean; imageResult?: ProductImagesReadResult; galleryRefreshKey?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [baseline] = useState(product);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [price, setPrice] = useState(product?.price != null ? String(product.price).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [attemptId] = useState(() => crypto.randomUUID());
  const [frozenPayload, setFrozenPayload] = useState<Payload | null>(null);
  const editable = canWrite && (!product || product.active);
  const locked = isPending || Boolean(frozenPayload);
  // Image-only refreshes may advance the version, but a concurrent text edit must
  // still conflict. Never reset the user's draft from refreshed server props.
  const version = product && baseline && product.name === baseline.name && product.description === baseline.description && product.price === baseline.price ? product.version : baseline?.version;

  function showFieldErrors(errors: Record<string, string[]>) {
    setFieldErrors(errors);
    const first = ["name", "description", "price"].find((field) => errors[field]?.length);
    requestAnimationFrame(() => {
      if (first) form.current?.querySelector<HTMLElement>(`#product-${first}`)?.focus();
      else form.current?.querySelector<HTMLElement>("[data-form-error]")?.focus();
    });
  }

  function submit() {
    if (!editable || inFlight.current) return;
    setError(null);
    setErrorStatus("");
    setFieldErrors({});
    const payload = frozenPayload ?? { attempt_id: attemptId, name, description: description || null, price };
    const errors = validate(payload.name, payload.description || "", payload.price);
    if (Object.keys(errors).length) { showFieldErrors(errors); return; }
    inFlight.current = true;
    if (!product) setFrozenPayload(payload);
    startTransition(async () => {
      try {
        const res = product
          ? await updateInternalProduct(product.id, version!, payload)
          : await createInternalProduct(payload);
        if (res.status === "success") {
          router.push("/admin/products");
          router.refresh();
        } else if (res.status === "invalid_input") {
          setFrozenPayload(null);
          setError("Revise os dados do produto e tente novamente.");
          showFieldErrors(res.fieldErrors);
        } else {
          // An uncertain create must reuse exactly the same attempt and payload.
          if (res.status !== "unknown" && res.status !== "technical") setFrozenPayload(null);
          setErrorStatus(res.status);
          setError(productMessage(res.status, "reference" in res ? res.reference : undefined));
        }
      } catch {
        setErrorStatus("unknown");
        setError("Não foi possível confirmar o salvamento. Verifique sua conexão e tente novamente. Seus dados foram preservados.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} aria-busy={isPending} className="grid min-w-0 gap-6 text-[#152336] [color-scheme:light] lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-6">
        {!editable && <p role="status" className="rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-600">{product && !product.active ? "Produto arquivado. As informações estão disponíveis apenas para consulta." : "Você tem acesso de leitura a este produto."}</p>}
        {error && <div data-form-error tabIndex={-1} role="alert" className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 ${focus}`}>
          {error} {productPlanAction(errorStatus) && <Link href="/planos" className="underline">Consultar planos</Link>}
        </div>}
        <section aria-labelledby="product-data-heading" className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <h2 id="product-data-heading" className="text-lg font-semibold tracking-tight">Informações do produto</h2>
            <span className="font-mono text-xs text-slate-500">* Obrigatório</span>
          </div>
          <div className="space-y-2">
            <label htmlFor="product-name" className="block text-sm font-semibold">Nome do produto <span className="text-modulus-primary">*</span></label>
            <input id="product-name" name="name" type="text" value={name} readOnly={!editable} disabled={locked} required aria-invalid={Boolean(fieldErrors.name?.length)} aria-describedby="product-name-help product-name-error" onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vaso Voronoi 18 cm" className={control} />
            <p id="product-name-help" className="text-xs text-slate-500">De 2 a 255 caracteres. <span className="font-mono">{name.trim().length}/255</span></p>
            <p id="product-name-error" className="text-sm text-red-600">{fieldErrors.name?.[0]}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="product-description" className="block text-sm font-semibold">Descrição <span className="font-normal text-slate-500">(opcional)</span></label>
            <textarea id="product-description" name="description" value={description} readOnly={!editable} disabled={locked} aria-invalid={Boolean(fieldErrors.description?.length)} aria-describedby="product-description-help product-description-error" onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Descreva o acabamento, as características e os cuidados com o produto." className={`${control} resize-y`} />
            <p id="product-description-help" className="text-xs text-slate-500">Detalhes que ajudam a identificar o produto. <span className="font-mono">{description.length}/3.000</span></p>
            <p id="product-description-error" className="text-sm text-red-600">{fieldErrors.description?.[0]}</p>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <label htmlFor="product-price" className="block text-sm font-semibold">Preço de venda (R$) <span className="font-normal text-slate-500">(opcional)</span></label>
            <input id="product-price" name="price" type="text" inputMode="decimal" value={price} readOnly={!editable} disabled={locked} aria-invalid={Boolean(fieldErrors.price?.length)} aria-describedby="product-price-help product-price-error" onChange={(e) => setPrice(e.target.value)} placeholder="Ex.: 79,90" className={control} />
            <p id="product-price-help" className="text-xs leading-relaxed text-slate-500">Deixe em branco para manter o preço sob consulta. Até R$ 1.000.000,00, com no máximo duas casas decimais.</p>
            <p id="product-price-error" className="text-sm text-red-600">{fieldErrors.price?.[0]}</p>
          </div>
        </section>
        {product && imageResult && <ProductImageManager key={`${galleryRefreshKey}:${product.version}:${imageResult.status === "success" ? imageResult.images.map((image) => image.url).join("|") : imageResult.status}`} productId={product.id} version={product.version} active={product.active} canWrite={canWrite} initialImages={imageResult.status === "success" ? imageResult.images : []} initialError={imageResult.status === "success" ? undefined : imageResult.status === "permission_denied" ? "Você não tem permissão para visualizar as imagens." : "Não foi possível carregar as imagens do produto."} />}
      </div>
      <aside className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <div><p className="font-mono text-xs uppercase tracking-wider text-slate-500">{product ? "Gerenciar produto" : "Novo cadastro"}</p><h2 className="mt-2 text-lg font-semibold">{product ? "Revise suas alterações" : "Organize seu catálogo"}</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">{product ? "As informações e as imagens são salvas separadamente. Atualizar a galeria mantém seu texto em edição." : "Comece pelos dados básicos. Após salvar, você poderá adicionar até 3 imagens ao produto."}</p></div>
        {frozenPayload && !isPending && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">A confirmação está pendente. Os campos foram preservados para reenviar a mesma tentativa sem duplicar o produto.</p>}
        <div className="flex flex-col gap-3">
          {editable && <button type={frozenPayload ? "button" : "submit"} onClick={frozenPayload ? submit : undefined} disabled={isPending} className={`min-h-12 rounded-xl bg-modulus-primary px-5 py-3 text-sm font-semibold text-white transition motion-reduce:transition-none hover:opacity-90 disabled:opacity-50 ${focus}`}>{isPending ? "Salvando..." : frozenPayload ? "Tentar confirmar novamente" : product ? "Salvar alterações" : "Cadastrar produto"}</button>}
          <Link href="/admin/products" className={`flex min-h-12 items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-medium hover:bg-slate-50 ${focus}`}>{editable ? "Cancelar" : "Voltar para produtos"}</Link>
        </div>
        {product && canDelete && <div className="border-t border-slate-100 pt-4"><ProductArchiveButton id={product.id} version={product.version} active={product.active} returnTo="/admin/products" /></div>}
      </aside>
    </form>
  );
}

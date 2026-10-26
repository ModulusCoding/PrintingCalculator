"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { productMessage, productPlanAction } from "@/lib/products/messages";
import { createInternalProduct, updateInternalProduct, type ProductRecord } from "@/lib/products/actions";

import { ProductArchiveButton } from "@/components/admin/ProductArchiveButton";
import { ProductImageManager } from "@/components/admin/ProductImageManager";
import type { ProductImagesReadResult } from "@/lib/products/image-actions";

export function ProductForm({ product, canWrite = true, canDelete = true, imageResult }: { product?: ProductRecord; canWrite?: boolean; canDelete?: boolean; imageResult?: ProductImagesReadResult }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(product?.name || "");
  const [description, setDescription] = useState(product?.description || "");
  const [price, setPrice] = useState(product?.price != null ? String(product.price).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [attemptId] = useState(() => crypto.randomUUID());
  const [frozenPayload, setFrozenPayload] = useState<{ attempt_id: string; name: string; description: string | null; price: string } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = !product && frozenPayload ? frozenPayload : { attempt_id: attemptId, name, description: description || null, price };
      if (!product) setFrozenPayload(payload);
      const res = product
        ? await updateInternalProduct(product.id, product.version, payload)
        : await createInternalProduct(payload);

      if (res.status === "success") {
        router.push("/admin/products");
        router.refresh();
      } else if (res.status === "invalid_input") {
        setFieldErrors(res.fieldErrors);
      } else {
        setErrorStatus(res.status);
        setError(productMessage(res.status, "reference" in res ? res.reference : undefined));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
      <div>
        <h2 className="text-xl font-bold">{product ? "Editar Produto" : "Novo Produto"}</h2>
      </div>

      {error && <div role="alert" className="p-3 bg-red-100 text-red-800 rounded">{error} {productPlanAction(errorStatus) && <Link href="/planos" className="underline">Consultar planos</Link>}</div>}

      <div>
        <label className="block text-sm font-medium mb-1">Nome *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border p-2 rounded"
        />
        {fieldErrors.name && <p className="text-red-500 text-xs mt-1">{fieldErrors.name[0]}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Descrição</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border p-2 rounded"
          rows={3}
        />
        {fieldErrors.description && <p className="text-red-500 text-xs mt-1">{fieldErrors.description[0]}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Preço (R$)</label>
        <input
          type="text"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Ex: 10,50"
          className="w-full border p-2 rounded"
        />
        {fieldErrors.price && <p className="text-red-500 text-xs mt-1">{fieldErrors.price[0]}</p>}
      </div>

      {!product && <p className="text-sm text-slate-500">Salve o produto para poder adicionar imagens.</p>}
      {product && imageResult && <ProductImageManager key={product.version} productId={product.id} version={product.version} active={product.active} canWrite={canWrite} initialImages={imageResult.status === "success" ? imageResult.images : []} initialError={imageResult.status === "success" ? undefined : imageResult.status === "permission_denied" ? "Você não tem permissão para visualizar as imagens." : "Não foi possível carregar as imagens do produto."} />}

      <div className="flex gap-4 flex-wrap">
        {canWrite && (!product || product.active) && <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>}
        <Link href="/admin/products" className="px-4 py-2 border rounded">
          Cancelar
        </Link>
        {product && canDelete && <ProductArchiveButton id={product.id} version={product.version} active={product.active} returnTo="/admin/products" />}
      </div>
    </form>
  );
}

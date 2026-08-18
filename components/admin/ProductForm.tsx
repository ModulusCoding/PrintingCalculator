"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Product } from "@/types/product";
import { createProductAction, updateProductAction } from "@/lib/products/actions";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { Loader2, ArrowLeft, Save, AlertCircle, CheckSquare, Square } from "lucide-react";
import Link from "next/link";

interface ProductFormProps {
  product?: Product;
  availableCatalogs: { id: string; name: string }[];
}

export function ProductForm({ product, availableCatalogs }: ProductFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(product?.name || "");
  const [slug, setSlug] = useState(product?.slug || "");
  const [isSlugAuto, setIsSlugAuto] = useState(!product);
  const [description, setDescription] = useState(product?.description || "");
  const [price, setPrice] = useState<string>(product ? String(product.price) : "");
  const [imageUrl, setImageUrl] = useState(product?.image_url || "");
  const [active, setActive] = useState(product ? product.active : true);
  const [selectedCatalogs, setSelectedCatalogs] = useState<string[]>(
    product?.catalog_ids || []
  );

  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (val: string) => {
    setName(val);
    if (isSlugAuto) {
      const generated = val
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      setSlug(generated);
    }
  };

  const handleSlugChange = (val: string) => {
    setIsSlugAuto(false);
    setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  };

  const toggleCatalog = (id: string) => {
    setSelectedCatalogs((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedPrice = parseFloat(price.replace(",", "."));
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setError("Por favor, informe um preço válido maior ou igual a zero.");
      return;
    }

    const payload = {
      name,
      slug,
      description,
      price: parsedPrice,
      image_url: imageUrl,
      active,
      catalog_ids: selectedCatalogs,
    };

    startTransition(async () => {
      const result = product
        ? await updateProductAction(product.id, payload)
        : await createProductAction(payload);

      if (result.error) {
        setError(result.error);
      } else {
        router.push("/admin/products");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/products"
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {product ? "Editar Produto" : "Novo Produto"}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {product
              ? `Atualizando ${product.name}`
              : "Cadastre um produto e associe a múltiplos catálogos"}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 text-sm text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-6 bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Nome do Produto *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="ex: Vaso Poligonal Zeus"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Slug do Produto *
            </label>
            <input
              type="text"
              required
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="vaso-poligonal-zeus"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* Preço */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Preço (R$) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="49.90"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
            />
          </div>

          {/* Ativo */}
          <div className="flex items-center gap-3 pt-6">
            <input
              type="checkbox"
              id="product-active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded-lg border-slate-300 focus:ring-blue-500 cursor-pointer"
            />
            <label
              htmlFor="product-active"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Produto Ativo (visível nos catálogos)
            </label>
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Descrição do Produto
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes, dimensões, material e especificações..."
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
          />
        </div>

        {/* Associação de múltiplos catálogos */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
            Catálogos onde este produto será exibido
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Um único produto pode aparecer em vários catálogos sem precisar ser recriado.
          </p>

          {availableCatalogs.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-500">
              Nenhum catálogo ativo disponível. Crie um catálogo primeiro em{" "}
              <Link href="/admin/catalogs/new" className="text-blue-600 underline">
                Criar Catálogo
              </Link>
              .
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {availableCatalogs.map((cat) => {
                const isSelected = selectedCatalogs.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCatalog(cat.id)}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left text-sm transition-all ${
                      isSelected
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-300 font-medium"
                        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-blue-600 shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                    <span className="truncate">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Imagem do Produto */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <ImageUpload
            bucket="products"
            label="Foto Principal do Produto"
            value={imageUrl}
            onChange={setImageUrl}
            aspectRatio="square"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-4">
        <Link
          href="/admin/products"
          className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold text-sm transition-colors shadow-md shadow-blue-600/20 disabled:opacity-50"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {product ? "Salvar Alterações" : "Criar Produto"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

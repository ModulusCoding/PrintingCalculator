"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Catalog } from "@/types/catalog";
import {
  createCatalogAction,
  updateCatalogAction,
} from "@/lib/catalogs/actions";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { ShareLinkButton } from "@/components/admin/ShareLinkButton";
import { Loader2, ArrowLeft, Save, AlertCircle } from "lucide-react";
import Link from "next/link";

interface CatalogFormProps {
  catalog?: Catalog;
}

export function CatalogForm({ catalog }: CatalogFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(catalog?.name || "");
  const [slug, setSlug] = useState(catalog?.slug || "");
  const [isSlugAuto, setIsSlugAuto] = useState(!catalog);
  const [description, setDescription] = useState(catalog?.description || "");
  const [logoUrl, setLogoUrl] = useState(catalog?.logo_url || "");
  const [bannerUrl, setBannerUrl] = useState(catalog?.banner_url || "");
  const [whatsapp, setWhatsapp] = useState(catalog?.whatsapp || "");
  const [active, setActive] = useState(catalog ? catalog.active : true);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = {
      name,
      slug,
      description,
      logo_url: logoUrl,
      banner_url: bannerUrl,
      whatsapp,
      active,
    };

    startTransition(async () => {
      const result = catalog
        ? await updateCatalogAction(catalog.id, payload)
        : await createCatalogAction(payload);

      if (result.error) {
        setError(result.error);
      } else {
        router.push("/admin/catalogs");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/catalogs"
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {catalog ? "Editar Catálogo" : "Novo Catálogo"}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {catalog
                ? `Atualizando as informações de ${catalog.name}`
                : "Cadastre uma nova vitrine pública para a Modulus"}
            </p>
          </div>
        </div>

        {catalog && catalog.slug && (
          <div className="hidden sm:block">
            <ShareLinkButton slug={catalog.slug} />
          </div>
        )}
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
              Nome do Catálogo *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="ex: Deuses Gregos"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Slug da URL Pública *
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="deuses-gregos"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              URL final: <span className="font-mono text-blue-600 dark:text-blue-400">/catalogo/{slug || "exemplo"}</span>
            </p>
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Descrição
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Apresente esta coleção de produtos..."
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
          />
        </div>

        {/* WhatsApp & Active */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              WhatsApp para Contato (opcional)
            </label>
            <input
              type="text"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="ex: 5511999999999"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          <div className="flex items-center gap-3 pt-6">
            <input
              type="checkbox"
              id="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded-lg border-slate-300 focus:ring-blue-500 cursor-pointer"
            />
            <label htmlFor="active" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              Catálogo Ativo (visível publicamente)
            </label>
          </div>
        </div>

        {/* Imagens (Logo e Banner) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 dark:border-slate-800">
          <ImageUpload
            bucket="catalogs"
            label="Logo do Catálogo"
            value={logoUrl}
            onChange={setLogoUrl}
            aspectRatio="square"
          />

          <ImageUpload
            bucket="catalogs"
            label="Banner de Capa"
            value={bannerUrl}
            onChange={setBannerUrl}
            aspectRatio="banner"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-4">
        <Link
          href="/admin/catalogs"
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
              {catalog ? "Salvar Alterações" : "Criar Catálogo"}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

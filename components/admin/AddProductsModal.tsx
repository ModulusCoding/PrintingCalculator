"use client";

import { useState, useEffect, useTransition } from "react";
import { X, Check, Loader2, Search, Package } from "lucide-react";
import { syncCatalogProductsAction, getProductsForCatalogModal, getCatalogProducts } from "@/lib/catalogs/actions";

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number | null;
  image_url: string | null;
  active: boolean;
}

interface AddProductsModalProps {
  catalogId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AddProductsModal({ catalogId, isOpen, onClose }: AddProductsModalProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [productsRes, catalogProductsRes] = await Promise.all([
        getProductsForCatalogModal(),
        getCatalogProducts(catalogId),
      ]);

      if (productsRes.error) {
        setError(productsRes.error);
      } else {
        setProducts(productsRes.products || []);
      }

      if (catalogProductsRes.error) {
        setError(catalogProductsRes.error);
      } else {
        setSelectedProductIds(catalogProductsRes.productIds || []);
      }
    } catch {
      setError("Erro inesperado ao carregar dados.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadData();
    }
  }, [isOpen, catalogId]);

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleSave = () => {
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const res = await syncCatalogProductsAction(catalogId, selectedProductIds);

      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    });
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} aria-hidden="true" />
        
        <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
            <h2 id="modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Adicionar produtos ao catálogo
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              aria-label="Fechar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" aria-hidden="true" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar produtos..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                  />
                </div>
              </div>

              <div className="max-h-[50vh] overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <div className="p-12 text-center">
                    <Package className="h-12 w-12 mx-auto text-slate-400 dark:text-slate-600 mb-4" />
                    <p className="text-slate-500 dark:text-slate-400">
                      {searchQuery ? "Nenhum produto encontrado com esse termo." : "Nenhum produto cadastrado no sistema."}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredProducts.map((product) => {
                      const isSelected = selectedProductIds.includes(product.id);
                      return (
                        <li key={product.id}>
                          <button
                            type="button"
                            onClick={() => toggleProduct(product.id)}
                            className={`w-full flex items-center gap-3 p-4 text-left transition-all ${
                              isSelected
                                ? "bg-blue-50/50 dark:bg-blue-950/30"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            }`}
                          >
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="h-12 w-12 rounded-lg object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
                              />
                            ) : (
                              <div className="h-12 w-12 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                <Package className="h-6 w-6 text-slate-400" />
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm text-slate-900 dark:text-white truncate">
                                {product.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                {product.price != null
                                  ? `R$ ${product.price.toFixed(2).replace(".", ",")}`
                                  : "Sob consulta"}
                                {!product.active && " · Inativo"}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isSelected ? (
                                <Check className="h-5 w-5 text-blue-600 shrink-0" />
                              ) : (
                                <div className="h-5 w-5 rounded-lg border-2 border-slate-300 dark:border-slate-600 shrink-0" />
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {error && (
                <div className="p-4 bg-red-50 dark:bg-red-950/50 border-t border-red-200 dark:border-red-900">
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors shadow-md shadow-blue-600/20 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : success ? (
                    <>
                      <Check className="h-4 w-4" />
                      Salvo!
                    </>
                  ) : (
                    "Salvar"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
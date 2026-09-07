"use client";

import { useCallback, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Trash2, Send } from "lucide-react";
import { useCart } from "@/context/CartContext";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  products: Array<{
    id: string;
    name: string;
    photo: string;
    price?: number | null;
  }>;
}

export function CartDrawer({ isOpen, onClose, products }: CartDrawerProps) {
  const { items, removeItem, updateQuantity, clearCart, totalItems } = useCart();
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.addEventListener("keydown", onKeyDown);
    }
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const getProduct = useCallback(
    (productId: string) => products.find((p) => p.id === productId),
    [products]
  );

  const validItems = items.filter((item) => getProduct(item.productId));

  const generateWhatsAppMessage = useCallback(() => {
    const lines = validItems
      .map((item) => {
        const product = getProduct(item.productId);
        return product
          ? `• ${product.name} — ${item.quantity} unidade${item.quantity > 1 ? "s" : ""}`
          : null;
      })
      .filter(Boolean) as string[];

    const message = `Olá! Gostaria de solicitar um orçamento:\n\n${lines.join(
      "\n"
    )}\n\nTotal: ${totalItems} unidade${totalItems > 1 ? "s" : ""}`;

    const encoded = encodeURIComponent(message);
    const waUrl = `https://wa.me/5511912000753?text=${encoded}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }, [validItems, getProduct, totalItems]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[49] bg-slate-900/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer Panel — fundo sempre branco conforme solicitado */}
          <motion.aside
            className="fixed top-0 right-0 z-[50] w-full sm:w-[430px] h-dvh flex flex-col bg-white !bg-white shadow-2xl border-l border-slate-200"
            style={{ backgroundColor: '#FFFFFF' }}
            role="dialog"
            aria-modal="true"
            aria-label="Carrinho"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 350, damping: 32 }}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 shrink-0" style={{ backgroundColor: '#FFFFFF' }}>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                Carrinho
              </h2>
              <motion.button
                className="p-2 rounded-full border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors"
                onClick={onClose}
                aria-label="Fechar carrinho"
                whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </motion.button>
            </div>

            {validItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500" style={{ backgroundColor: '#FFFFFF' }}>
                <p className="text-lg font-medium text-slate-900 mb-1">
                  Seu carrinho está vazio
                </p>
                <p className="text-sm">Adicione produtos do catálogo</p>
              </div>
            ) : (
              <>
                <motion.ul
                  className="flex-1 overflow-y-auto p-4 space-y-4"
                  style={{ backgroundColor: '#FFFFFF' }}
                  role="list"
                  initial="hidden"
                  animate="show"
                  variants={{
                    show: {
                      transition: { staggerChildren: shouldReduceMotion ? 0 : 0.05 },
                    },
                  }}
                >
                  <AnimatePresence mode="popLayout">
                    {validItems.map((item) => {
                      const product = getProduct(item.productId);
                      if (!product) return null;
                      return (
                        <motion.li
                          key={item.productId}
                          layout
                          variants={{
                            hidden: { opacity: 0, x: 20 },
                            show: { opacity: 1, x: 0 },
                          }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.2 }}
                          className="grid grid-cols-[72px_1fr_40px] gap-3 items-center p-2.5 rounded-xl border border-slate-100 bg-slate-50/50"
                        >
                          <div className="w-[72px] h-[90px] rounded-lg overflow-hidden bg-slate-200 relative shrink-0">
                            <Image
                              src={product.photo}
                              alt={product.name}
                              fill
                              sizes="72px"
                              className="object-cover"
                              loading="lazy"
                            />
                          </div>

                          <div className="min-w-0 space-y-1">
                            <h3 className="text-sm font-semibold text-slate-900 truncate">
                              {product.name}
                            </h3>
                            {product.price != null && (
                              <p className="text-xs font-semibold text-indigo-600">
                                {new Intl.NumberFormat("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                }).format(product.price)}
                              </p>
                            )}

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
                                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                aria-label={`Diminuir quantidade de ${product.name}`}
                                disabled={item.quantity <= 1}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-xs font-semibold min-w-[20px] text-center">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700"
                                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                aria-label={`Aumentar quantidade de ${product.name}`}
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <motion.button
                            type="button"
                            className="w-9 h-9 flex items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                            onClick={() => removeItem(item.productId)}
                            aria-label={`Remover ${product.name} do carrinho`}
                            whileHover={shouldReduceMotion ? {} : { scale: 1.1 }}
                            whileTap={shouldReduceMotion ? {} : { scale: 0.9 }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </motion.button>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </motion.ul>

                <div className="p-5 border-t border-slate-200 space-y-2.5 shrink-0" style={{ backgroundColor: '#FFFFFF' }}>
                  <button
                    type="button"
                    className="w-full py-2.5 rounded-xl border border-slate-300 font-semibold text-xs text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
                    onClick={clearCart}
                    disabled={validItems.length === 0}
                  >
                    Limpar carrinho
                  </button>

                  <motion.button
                    type="button"
                    className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 !text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                    onClick={generateWhatsAppMessage}
                    disabled={validItems.length === 0}
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Enviar pelo WhatsApp
                  </motion.button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

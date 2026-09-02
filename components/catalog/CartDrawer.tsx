"use client";

import { useCallback, useEffect } from "react";
import Image from "next/image";
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

export function CartDrawer({
  isOpen,
  onClose,
  products,
}: CartDrawerProps) {
  const { items, removeItem, updateQuantity, clearCart, totalItems } = useCart();

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
    (productId: string) =>
      products.find((p) => p.id === productId),
    [products]
  );

  const validItems = items.filter((item) => getProduct(item.productId));

  const generateWhatsAppMessage = useCallback(() => {
    const lines = validItems.map((item) => {
      const product = getProduct(item.productId);
      return product
        ? `• ${product.name} — ${item.quantity} unidade${item.quantity > 1 ? "s" : ""}`
        : null;
    }).filter(Boolean) as string[];

    const message =
      `Olá! Gostaria de solicitar um orçamento:\n\n${lines.join("\n")}\n\nTotal: ${totalItems} unidade${totalItems > 1 ? "s" : ""}`;

    const encoded = encodeURIComponent(message);
    const waUrl = `https://wa.me/5511912000753?text=${encoded}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }, [validItems, getProduct, totalItems]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className={`cart-overlay${isOpen ? " open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`cart-drawer${isOpen ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Carrinho">
        <div className="cart-header">
          <h2>Carrinho</h2>
          <button className="cart-close" onClick={onClose} aria-label="Fechar carrinho">
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {validItems.length === 0 ? (
          <div className="cart-empty">
            <p>Seu carrinho está vazio</p>
            <p className="cart-empty-hint">Adicione produtos do catálogo</p>
          </div>
        ) : (
          <>
            <ul className="cart-list" role="list">
              {validItems.map((item) => {
                const product = getProduct(item.productId);
                if (!product) return null;
                return (
                  <li key={item.productId} className="cart-item">
                    <div className="cart-item-image">
                      <Image
                        src={product.photo}
                        alt={product.name}
                        width={80}
                        height={100}
                        className="object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div className="cart-item-details">
                      <h3 className="cart-item-name">{product.name}</h3>
                      {product.price != null && (
                        <p className="cart-item-price">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          }).format(product.price)}
                        </p>
                      )}
                      <div className="cart-item-quantity">
                        <button
                          type="button"
                          className="qty-btn"
                          onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                          aria-label={`Diminuir quantidade de ${product.name}`}
                          disabled={item.quantity <= 1}
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <span className="qty-value" aria-live="polite">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          className="qty-btn"
                          onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                          aria-label={`Aumentar quantidade de ${product.name}`}
                        >
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cart-item-remove"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Remover ${product.name} do carrinho`}
                    >
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="cart-footer">
              <button
                type="button"
                className="cart-clear"
                onClick={clearCart}
                disabled={validItems.length === 0}
              >
                Limpar carrinho
              </button>
              <button
                type="button"
                className="cart-whatsapp"
                onClick={generateWhatsAppMessage}
                disabled={validItems.length === 0}
              >
                <Send className="h-5 w-5" aria-hidden="true" />
                Enviar pelo WhatsApp
              </button>
            </div>
          </>
        )}

        <style jsx>{`
          .cart-overlay {
            position: fixed;
            z-index: 49;
            inset: 0;
            background: rgba(21, 35, 54, 0.45);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s var(--ease);
          }
          .cart-drawer {
            position: fixed;
            z-index: 50;
            top: 0;
            right: 0;
            width: min(430px, 100%);
            height: 100dvh;
            display: flex;
            flex-direction: column;
            background: var(--white);
            transform: translateX(100%);
            transition: transform 0.4s var(--ease);
            box-shadow: -8px 0 32px rgba(21, 35, 54, 0.12);
          }
          .cart-overlay,
          .cart-drawer {
            animation: none;
          }
          .cart-drawer.open,
          .cart-overlay.open {
            transform: none;
            opacity: 1;
            pointer-events: auto;
          }
          .cart-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid var(--line);
            flex-shrink: 0;
          }
          .cart-header h2 {
            margin: 0;
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.03em;
          }
          .cart-close {
            width: 40px;
            height: 40px;
            display: grid;
            place-items: center;
            border: 1px solid var(--line);
            border-radius: 50%;
            background: transparent;
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s;
          }
          .cart-close:hover {
            background: var(--paper);
            border-color: var(--ink);
          }
          .cart-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 24px;
            text-align: center;
            color: var(--muted);
          }
          .cart-empty p:first-child {
            margin: 0 0 8px;
            font-size: 18px;
            font-weight: 500;
            color: var(--ink);
          }
          .cart-empty-hint {
            margin: 0;
            font-size: 14px;
          }
          .cart-list {
            flex: 1;
            overflow-y: auto;
            margin: 0;
            padding: 16px 20px;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          .cart-item {
            display: grid;
            grid-template-columns: 80px 1fr 44px;
            gap: 12px;
            align-items: start;
          }
          .cart-item-image {
            width: 80px;
            height: 100px;
            border-radius: 6px;
            overflow: hidden;
            background: #eaebe8;
            flex-shrink: 0;
          }
          .cart-item-details {
            min-width: 0;
          }
          .cart-item-name {
            margin: 0 0 4px;
            font-size: 15px;
            font-weight: 500;
            line-height: 1.3;
            letter-spacing: -0.02em;
          }
          .cart-item-price {
            margin: 0 0 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--ink);
          }
          .cart-item-quantity {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .qty-btn {
            width: 32px;
            height: 32px;
            display: grid;
            place-items: center;
            border: 1px solid var(--line);
            border-radius: 6px;
            background: var(--white);
            color: var(--ink);
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s, color 0.2s;
          }
          .qty-btn:hover:not(:disabled) {
            background: var(--paper);
            border-color: var(--ink);
          }
          .qty-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .qty-btn:focus-visible {
            outline: 2px solid var(--orange);
            outline-offset: 2px;
          }
          .qty-value {
            min-width: 28px;
            text-align: center;
            font-size: 15px;
            font-weight: 500;
          }
          .cart-item-remove {
            width: 40px;
            height: 40px;
            display: grid;
            place-items: center;
            border: 1px solid var(--line);
            border-radius: 50%;
            background: transparent;
            color: var(--muted);
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s, color 0.2s;
            flex-shrink: 0;
          }
          .cart-item-remove:hover {
            background: #fff0f0;
            border-color: var(--orange);
            color: var(--orange);
          }
          .cart-item-remove:focus-visible {
            outline: 2px solid var(--orange);
            outline-offset: 2px;
          }
          .cart-footer {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 20px 24px;
            border-top: 1px solid var(--line);
            flex-shrink: 0;
          }
          .cart-clear {
            min-height: 48px;
            border: 1px solid var(--ink);
            border-radius: 4px;
            background: var(--white);
            color: var(--ink);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s, color 0.2s;
          }
          .cart-clear:hover:not(:disabled) {
            background: var(--paper);
          }
          .cart-clear:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .cart-whatsapp {
            min-height: 48px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            border: 1px solid var(--electric);
            border-radius: 4px;
            background: var(--electric);
            color: var(--white);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s;
          }
          .cart-whatsapp:hover:not(:disabled) {
            background: #1a00cc;
            border-color: #1a00cc;
          }
          .cart-whatsapp:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .cart-whatsapp:focus-visible,
          .cart-clear:focus-visible {
            outline: 2px solid var(--orange);
            outline-offset: 2px;
          }

          @media (max-width: 560px) {
            .cart-drawer {
              width: 100%;
            }
            .cart-header {
              padding: 16px 18px;
            }
            .cart-list {
              padding: 12px 16px;
              gap: 12px;
            }
            .cart-item {
              grid-template-columns: 72px 1fr 40px;
              gap: 10px;
            }
            .cart-item-image {
              width: 72px;
              height: 90px;
            }
            .cart-footer {
              padding: 16px 18px;
            }
          }
        `}</style>
      </aside>
    </>
  );
}
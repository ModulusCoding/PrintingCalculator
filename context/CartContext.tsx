"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CartItem {
  productId: string;
  quantity: number;
}

const STORAGE_PREFIX = "modulus_cart_";

function getStorageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`;
}

function readCartFromStorage(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidCartItem) : [];
  } catch {
    return [];
  }
}

function isValidCartItem(item: unknown): item is CartItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "productId" in item &&
    "quantity" in item &&
    typeof (item as CartItem).productId === "string" &&
    typeof (item as CartItem).quantity === "number" &&
    (item as CartItem).quantity > 0
  );
}

function writeCartToStorage(slug: string, items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getStorageKey(slug), JSON.stringify(items));
  } catch {
    // Falha ao persistir não deve quebrar a UI
  }
}

interface CartContextValue {
  items: CartItem[];
  addItem: (productId: string) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  isHydrated: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);

interface CartProviderProps {
  children: ReactNode;
  catalogSlug: string;
}

export function CartProvider({ children, catalogSlug }: CartProviderProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const stored = readCartFromStorage(catalogSlug);
    setItems(stored);
    setIsHydrated(true);
  }, [catalogSlug]);

  useEffect(() => {
    if (!isHydrated) return;
    writeCartToStorage(catalogSlug, items);
  }, [items, catalogSlug, isHydrated]);

  const addItem = useCallback((productId: string) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (existing) {
        return prev.map((i) =>
          i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { productId, quantity: 1 }];
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.productId === productId ? { ...i, quantity } : i
      )
    );
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const totalItems = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      totalItems,
      isHydrated,
    }),
    [items, addItem, removeItem, updateQuantity, clearCart, totalItems, isHydrated]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart deve ser usado dentro de um CartProvider");
  }
  return ctx;
}

export { CartContext };
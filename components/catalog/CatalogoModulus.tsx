"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  useSpring,
  useTransform,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import type { CatalogView, CatalogProductView } from "@/types/catalog";
import { ProductCarousel } from "./ProductCarousel";
import { CartProvider, useCart } from "@/context/CartContext";
import { CartDrawer } from "./CartDrawer";
import { ExclusiveProductAnimation } from "./ExclusiveProductAnimation";
import { ShoppingCart, ShoppingCartPlus, Check, Sparkles } from "lucide-react";

type Category = "Todos" | string;
type Format = string;
type SortMode = "featured" | "name";

export interface CatalogoModulusProps {
  catalog: CatalogView;
}

interface FlyingItem {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  photo: string;
}

function CatalogoModulusInner({ catalog }: CatalogoModulusProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("Todos");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("featured");
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [formatFilters, setFormatFilters] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [addedProductIds, setAddedProductIds] = useState<Record<string, boolean>>({});
  const [flyingItems, setFlyingItems] = useState<FlyingItem[]>([]);
  const [cartBouncing, setCartBouncing] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const year = useMemo(() => new Date().getFullYear(), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeFiltersRef = useRef<HTMLButtonElement>(null);
  const cartBtnRef = useRef<HTMLButtonElement>(null);
  const customSectionRef = useRef<HTMLElement>(null);

  const { totalItems, isHydrated, addItem } = useCart();
  const shouldReduceMotion = useReducedMotion();

  // Legacy customProgress (não usado — removido para não interferir)
  const customProgress = useMotionValue(0);
  const step1Progress = useTransform(customProgress, [0.2, 0.4], [0, 1]);
  const step2Progress = useTransform(customProgress, [0.4, 0.7], [0, 1]);

  useEffect(() => {
    document.body.classList.toggle("panel-open", panelOpen || searchOpen || cartOpen);
  }, [panelOpen, searchOpen, cartOpen]);

  useEffect(() => {
    if (panelOpen) closeFiltersRef.current?.focus();
  }, [panelOpen]);

  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [searchOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPanelOpen(false);
        setSearchOpen(false);
        setCartOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Header scroll awareness
  useEffect(() => {
    const handleScroll = () => {
      setHeaderScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  const categories: Category[] = useMemo(() => {
    const unique = Array.from(
      new Set(
        (catalog.products || [])
          .map((product) => product.category)
          .filter((cat): cat is string => Boolean(cat && cat.trim()))
      )
    );
    return ["Todos", ...unique];
  }, [catalog.products]);

  const formats: Format[] = useMemo(() => {
    return Array.from(
      new Set(
        (catalog.products || [])
          .map((product) => product.format)
          .filter((fmt): fmt is string => Boolean(fmt && fmt.trim()))
      )
    );
  }, [catalog.products]);

  const validatedActiveCategory = useMemo(() => {
    if (activeCategory === "Todos") return "Todos";
    if (categories.includes(activeCategory)) return activeCategory;
    return "Todos";
  }, [activeCategory, categories]);

  const visibleProducts = useMemo(() => {
    const products = catalog.products || [];
    return products.filter((product) => {
      const tabOK = validatedActiveCategory === "Todos" || product.category === validatedActiveCategory;
      const categoryOK = !categoryFilters.length || categoryFilters.includes(product.category);
      const formatOK = !formatFilters.length || formatFilters.includes(product.format);
      const haystack = `${product.name ?? ""} ${product.detail ?? ""} ${product.description ?? ""}`.toLocaleLowerCase(
        "pt-BR"
      );
      const textOK = !normalizedQuery || haystack.includes(normalizedQuery);
      return tabOK && categoryOK && formatOK && textOK;
    });
  }, [catalog.products, validatedActiveCategory, categoryFilters, formatFilters, normalizedQuery]);

  const sortedProducts = useMemo(() => {
    if (sortMode === "name") {
      return [...visibleProducts].sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
    }
    return [...visibleProducts].sort((a, b) => {
      const orderA = a.displayOrder ?? 0;
      const orderB = b.displayOrder ?? 0;
      return orderA - orderB;
    });
  }, [visibleProducts, sortMode]);

  function toggleCategoryFilter(category: string) {
    setCategoryFilters((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  }

  function toggleFormatFilter(format: string) {
    setFormatFilters((prev) => (prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]));
  }

  function clearFilters() {
    setCategoryFilters([]);
    setFormatFilters([]);
  }

  function handleResetAll() {
    setQuery("");
    setActiveCategory("Todos");
    setCategoryFilters([]);
    setFormatFilters([]);
  }

  const hasActiveFilters = useMemo(() => {
    return Boolean(normalizedQuery || validatedActiveCategory !== "Todos" || categoryFilters.length || formatFilters.length);
  }, [normalizedQuery, validatedActiveCategory, categoryFilters.length, formatFilters.length]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setSearchOpen(false);
      document.querySelector("#catalogo")?.scrollIntoView();
    }
  }

  const handleAddToCart = useCallback(
    (product: CatalogProductView, event: React.MouseEvent<HTMLButtonElement>) => {
      addItem(product.id);

      // Microinteraction Feedback — botão reage por 1.8s (mais perceptível)
      setAddedProductIds((prev) => ({ ...prev, [product.id]: true }));
      setTimeout(() => {
        setAddedProductIds((prev) => ({ ...prev, [product.id]: false }));
      }, 1800);

      // Cart Icon Bounce — suave e elegante
      setCartBouncing(true);
      setTimeout(() => setCartBouncing(false), 650);

      // Fly to Cart — elegante, lento e perceptível (~1.1s)
      if (!shouldReduceMotion && cartBtnRef.current) {
        const btnRect = event.currentTarget.getBoundingClientRect();
        const cartRect = cartBtnRef.current.getBoundingClientRect();

        const flyingId = `${product.id}-${Date.now()}`;
        const newItem: FlyingItem = {
          id: flyingId,
          x: btnRect.left + btnRect.width / 2 - 24,
          y: btnRect.top + btnRect.height / 2 - 24,
          // Usa posição real do ícone do carrinho no header fixo (funciona com scroll)
          targetX: cartRect.left + cartRect.width / 2 - 14,
          targetY: cartRect.top + cartRect.height / 2 - 14,
          photo: product.photo,
        };

        setFlyingItems((prev) => [...prev, newItem]);
        setTimeout(() => {
          setFlyingItems((prev) => prev.filter((item) => item.id !== flyingId));
        }, 1100);
      }
    },
    [addItem, shouldReduceMotion]
  );

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        stiffness: 260,
        damping: 24,
      },
    },
  };

  const customProduct = useMemo(() => {
    return (catalog.products && catalog.products[0]?.photo)
      ? catalog.products[0].photo
      : "/images/catalogo/mod-001-luminaria-shoji.webp";
  }, [catalog.products]);

  const whatsappMessage = encodeURIComponent(
    "☺︎  ᐸ  Bem-vindo à *Modulus*  !  *⟯*\n  • Tudo começa com sua ideia\n  • Você pensa, nós fazemos\n→ Sem custo, me conte como vamos dar vida a seu projeto:"
  );

  return (
    <>
      {/* Flying Geometry — sutil, fora do fluxo */}

      {/* Floating Geometric Elements — lenta, quase imperceptível */}
      {!shouldReduceMotion && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-30 dark:opacity-10">
          <motion.div
            className="absolute top-1/4 left-10 text-slate-400 text-2xl font-mono select-none"
            animate={{ y: [0, -20, 0], rotate: [0, 90, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          >
            ◇
          </motion.div>
          <motion.div
            className="absolute top-2/3 right-12 text-slate-400 text-xl font-mono select-none"
            animate={{ y: [0, 25, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          >
            +
          </motion.div>
          <motion.div
            className="absolute bottom-1/4 left-1/3 text-slate-400 text-lg font-mono select-none"
            animate={{ x: [0, 30, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          >
            ○
          </motion.div>
        </div>
      )}

      {/* Fly-to-cart Portal Items — lento e elegante (1.1s) */}
      {flyingItems.map((item) => (
        <motion.div
          key={item.id}
          className="fixed z-[999] pointer-events-none w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-2xl ring-1 ring-indigo-600/20"
          initial={{
            x: item.x,
            y: item.y,
            scale: 1,
            opacity: 0.95,
          }}
          animate={{
            x: item.targetX,
            y: item.targetY,
            scale: 0.22,
            opacity: 0.75,
          }}
          transition={{
            duration: 1.1,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.photo} alt="" className="w-full h-full object-cover" />
        </motion.div>
      ))}

      <header className={`site-header ${headerScrolled ? "scrolled" : ""}`}>
        <motion.a
          className="brand"
          href="#top"
          aria-label="Modulus — página inicial"
          whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
          whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo_Horizontal.svg" alt="Modulus" />
        </motion.a>
        <nav className="main-nav" aria-label="Navegação principal">
          <a href="#catalogo">Catálogo</a>
          <a href="#principios">Princípios</a>
          <a href="#contato">Contato</a>
        </nav>
        <div className="header-actions">
          <motion.button
            className="icon-button"
            aria-label="Abrir busca"
            onClick={() => setSearchOpen(true)}
            whileHover={shouldReduceMotion ? {} : { scale: 1.08 }}
            whileTap={shouldReduceMotion ? {} : { scale: 0.94 }}
          >
            <span className="search-icon" aria-hidden="true" />
          </motion.button>

          <motion.button
            ref={cartBtnRef}
            className="cart-button"
            aria-label={totalItems > 0 ? `Abrir carrinho (${totalItems} itens)` : "Abrir carrinho (vazio)"}
            onClick={() => setCartOpen(true)}
            animate={cartBouncing && !shouldReduceMotion ? { scale: [1, 1.12, 0.97, 1.04, 1] } : {}}
            transition={{ duration: 0.65, ease: "easeOut" }}
            whileHover={shouldReduceMotion ? {} : { scale: 1.08 }}
            whileTap={shouldReduceMotion ? {} : { scale: 0.94 }}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            <AnimatePresence>
              {isHydrated && totalItems > 0 && (
                <motion.span
                  key={totalItems}
                  className="cart-badge"
                  aria-live="polite"
                  initial={{ scale: 0.6 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18 }}
                >
                  {totalItems}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          <button
            className="menu-button"
            aria-label="Abrir menu"
            onClick={() => document.querySelector("#catalogo")?.scrollIntoView()}
          >
            ↘
          </button>
        </div>
      </header>

      <main id="top" className="relative z-1">
        {/* HERO */}
        <motion.section
          className="hero"
          aria-labelledby="pageTitle"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          <div className="hero-title">
            {catalog.eyebrow && (
              <motion.p className="eyebrow" variants={itemVariants}>
                {catalog.eyebrow}
              </motion.p>
            )}

            <motion.h1 id="pageTitle" variants={itemVariants}>
              {catalog.title}
            </motion.h1>
          </div>

          {(catalog.heroStrongText || catalog.heroCopy) && (
            <motion.p className="hero-copy" variants={itemVariants}>
              {catalog.heroStrongText && <strong>{catalog.heroStrongText} </strong>}
              {catalog.heroCopy}
            </motion.p>
          )}

          {/* CTA PEÇA EXCLUSIVA */}
          <motion.div className="exclusive-piece-cta" variants={itemVariants}>
            <div className="exclusive-piece-content">
              <span className="exclusive-piece-tag inline-flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Quer uma peça exclusiva?
              </span>
              <p className="exclusive-piece-text">Conte sua ideia para a gente. Criamos sua peça do seu jeito.</p>
            </div>
            <motion.a
              href={`https://wa.me/5511912000753?text=${whatsappMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="exclusive-piece-btn"
              whileHover={shouldReduceMotion ? {} : { scale: 1.03 }}
              whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
            >
              Criar uma peça exclusiva →
            </motion.a>
          </motion.div>
        </motion.section>

        {/* CATÁLOGO / SEARCH & FILTERS */}
        <section className="catalogue" id="catalogo" aria-label="Produtos">
          <motion.div
            className="catalog-search-filter-bar"
            role="search"
            aria-label="Pesquisa e filtros"
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
          >
            <label className="catalog-search-wrap" htmlFor="catalogSearchInput">
              <span className="catalog-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                id="catalogSearchInput"
                type="search"
                placeholder="Pesquisar produtos..."
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Pesquisar produtos por nome"
              />
              {query && (
                <button
                  type="button"
                  className="catalog-search-clear"
                  aria-label="Limpar pesquisa"
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
            </label>

            <div className="catalog-filter-row">
              <label className="catalog-filter-select-wrap" htmlFor="catalogCategoryFilter">
                <select
                  id="catalogCategoryFilter"
                  value={validatedActiveCategory}
                  onChange={(e) => setActiveCategory(e.target.value)}
                  aria-label="Filtrar por categoria"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
              {hasActiveFilters && (
                <button type="button" className="catalog-clear-filters-btn" onClick={handleResetAll}>
                  Limpar filtros
                </button>
              )}
            </div>
          </motion.div>

          <div className="toolbar">
            <div className="categories" role="tablist" aria-label="Categorias de produto">
              {categories.map((category) => (
                <motion.button
                  key={category}
                  className={`category-chip${validatedActiveCategory === category ? " active" : ""}`}
                  role="tab"
                  aria-selected={validatedActiveCategory === category}
                  onClick={() => setActiveCategory(category)}
                  whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
                  whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
                >
                  {category}
                </motion.button>
              ))}
            </div>
            <motion.button
              className="filter-button"
              aria-haspopup="dialog"
              aria-controls="filterPanel"
              onClick={() => setPanelOpen(true)}
              whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
              whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
            >
              <span className="filter-lines" aria-hidden="true" />
              <span>Filtros</span>
            </motion.button>
          </div>

          <div className="result-line">
            <span>
              <strong>{sortedProducts.length}</strong> resultados
            </span>
            <label className="sort-inline">
              <span>Ordenar:</span>
              <select
                aria-label="Ordenar produtos"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="featured">Destaques</option>
                <option value="name">Nome A–Z</option>
              </select>
            </label>
          </div>

          {/* GRID DE PRODUTOS ANIMADO */}
          <motion.div
            className="product-grid"
            id="productGrid"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            <AnimatePresence mode="popLayout">
              {sortedProducts.map((product) => {
                const isAdded = Boolean(addedProductIds[product.id]);
                return (
                  <motion.article
                    key={product.id || product.index}
                    layout
                    variants={itemVariants}
                    initial="hidden"
                    animate="show"
                    exit={{ opacity: 0, scale: 0.92 }}
                    className="product-card group"
                    whileHover={shouldReduceMotion ? {} : { y: -4 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="product-visual rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      <span className="product-index">{product.index}</span>
                      <ProductCarousel
                        images={product.images && product.images.length > 0 ? product.images : [product.photo]}
                        productName={product.name}
                        productId={product.id || product.index}
                      />
                      {product.photoNote && <span className="photo-note">{product.photoNote}</span>}
                    </div>

                    <div className="product-meta">
                      <div>
                        <h2 className="product-name">{product.name}</h2>
                        {product.detail && <p className="product-detail">{product.detail}</p>}
                        {product.description && <p className="product-description">{product.description}</p>}
                      </div>

                      <div className="product-price-row mt-3">
                        <p className="product-price font-semibold">
                          {product.price != null
                            ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                                product.price
                              )
                            : "Sob consulta"}
                        </p>
                        <motion.button
                          type="button"
                          className={`add-to-cart-btn ${isAdded ? "bg-emerald-600 text-white border-emerald-600" : ""}`}
                          onClick={(e) => handleAddToCart(product, e)}
                          aria-label={`Adicionar ${product.name} ao carrinho`}
                          whileHover={shouldReduceMotion ? {} : { scale: 1.05 }}
                          whileTap={shouldReduceMotion ? {} : { scale: 0.93 }}
                        >
                          {isAdded ? (
                            <>
                              <Check className="h-4 w-4" aria-hidden="true" />
                              <span>Adicionado</span>
                            </>
                          ) : (
                            <>
                              <ShoppingCartPlus className="h-4 w-4" aria-hidden="true" />
                              <span>Adicionar</span>
                            </>
                          )}
                        </motion.button>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </motion.div>

          <AnimatePresence>
            {sortedProducts.length === 0 && (
              <motion.div
                className="empty-state visible"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <div>
                  <h2>Nenhum produto encontrado.</h2>
                  <p>Tente pesquisar por outro nome ou remover os filtros.</p>
                  {hasActiveFilters && (
                    <button type="button" className="empty-state-clear" onClick={handleResetAll}>
                      Limpar filtros
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* SEÇÃO EDITORIAL: UM PRODUTO FEITO PARA VOCÊ — Layout Stitch */}
        <section
          ref={customSectionRef}
          className="relative overflow-hidden "
          aria-labelledby="exclusive-title"
        >
          {/* Grid editorial: Azul (#2b00ff) à esquerda, Laranja (#FF4E26) à direita */}
          <div className="w-full mx-auto grid grid-cols-1 lg:grid-cols-12 min-h-[560px] lg:min-h-[640px]">
            {/* Bloco Esquerdo — Azul Vibrante Oficial Modulus (#2b00ff) */}
            <div className="lg:col-span-7 bg-[#2b00ff] text-white p-6 md:p-10 lg:p-14 flex flex-col justify-between relative overflow-hidden">
              {/* Eyebrow sutil */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] md:text-[12px] font-semibold uppercase tracking-[0.28em] text-white/80">
                  Criação sob demanda
                </span>
                <div className="h-[1px] w-10 bg-white/30 hidden md:block" />
              </div>

              {/* Tipografia Monumental */}
              <div className="my-8 lg:my-12 space-y-4">
                <motion.h1
                  id="exclusive-title"
                  initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                  className="text-3xl md:text-5xl lg:text-[64px] xl:text-[72px] font-bold leading-[0.94] letter-tightest text-white"
                >
                  Um produto<br />
                  <span className="text-white/95">feito para você.</span>
                </motion.h1>
                <motion.p
                  initial={shouldReduceMotion ? {} : { opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.15 }}
                  className="pt-3 text-base md:text-lg lg:text-xl text-white/85 max-w-xl font-normal leading-relaxed"
                >
                  Você viu o que já existe. Agora imagine algo que só pode nascer da sua ideia. A Modulus não é um catálogo fechado: é o meio entre a sua imaginação e a matéria.
                </motion.p>
              </div>

              {/* Linha de Ação Editorial / CTA */}
              <div className="flex items-center gap-4">
  <motion.a
    href={`https://wa.me/5511912000753?text=${whatsappMessage}`}
    target="_blank"
    rel="noopener noreferrer"
    className="group inline-flex items-center gap-3 bg-white text-[#2b00ff] px-6 py-3 text-sm md:text-base font-bold tracking-tight hover:bg-[#ff4e26] hover:text-white transition-all duration-300"
    whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
    whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
  >
    <span>Materializar minha ideia</span>

    <svg
      className="w-4 h-4 transform group-hover:translate-x-1 transition-transform"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M14 5l7 7m0 0l-7 7m7-7H3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  </motion.a>
</div>

              {/* Detalhe geométrico discreto */}
              <div className="absolute -bottom-12 -right-12 w-36 h-36 rounded-full border border-white/10 pointer-events-none" />
            </div>

            {/* Bloco Direito — Laranja Oficial Modulus (#FF4E26) */}
            <div className="lg:col-span-5 bg-[#FF4E26] text-white p-6 md:p-10 lg:p-12 flex flex-col justify-between relative overflow-hidden border-t lg:border-t-0 lg:border-l border-white/20">
              {/* Header da coluna direita */}
              <div className="flex items-center justify-between border-b border-white/25 pb-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-white">
                  Fluxo da Modulus
                </span>
                <span className="text-xs font-mono text-white/80 tracking-wider">
                  01 → 02 → 03
                </span>
              </div>

              {/* Área da Animação — Protagonismo Absoluto */}
              <motion.div
                initial={shouldReduceMotion ? {} : { opacity: 0, x: 30, scale: 0.97 }}
                whileInView={{ opacity: 1, x: 0, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.25 }}
                className="my-6 flex flex-col items-center justify-center relative min-h-[320px] sm:min-h-[360px] lg:min-h-[400px] flex-1"
              >
                <div className="relative z-10 w-full max-w-[420px] aspect-square flex items-center justify-center">
                  <ExclusiveProductAnimation />
                </div>
              </motion.div>

              {/* Três Sentenças Definidoras no Rodapé */}
              <motion.div
                initial={shouldReduceMotion ? {} : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="pt-4 border-t border-white/25 grid grid-cols-3 gap-2 text-center sm:text-left"
              >
                <div>
                  <span className="block text-[10px] font-mono text-white/75 uppercase tracking-wider">01</span>
                  <span className="text-xs sm:text-sm font-bold text-white leading-tight">Você imagina.</span>
                </div>
                <div>
                  <span className="block text-[10px] font-mono text-white/75 uppercase tracking-wider">02</span>
                  <span className="text-xs sm:text-sm font-bold text-white leading-tight">A gente cria.</span>
                </div>
                <div>
                  <span className="block text-[10px] font-mono text-white/75 uppercase tracking-wider">03</span>
                  <span className="text-xs sm:text-sm font-bold text-white leading-tight">Você recebe.</span>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Quebra branca limpa entre Um produto feito para você e Nosso princípio */}
        <div className="catalog-exclusive-break bg-[#152336]" aria-hidden="true" />

        {/* NOSSO PRINCÍPIO */}
        <motion.section
          className="manifesto"
          id="principios"
          initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="manifesto-copy">
            <span className="manifesto-label">{catalog.manifestoLabel || "Nosso princípio"}</span>
            <h2>
              {catalog.manifestoTitle ? (
                catalog.manifestoTitle.split("\n").map((line, index, arr) => (
                  <span key={index}>
                    {line}
                    {index < arr.length - 1 && <br />}
                  </span>
                ))
              ) : (
                <>
                  Menos descartável.
                  <br />
                  Mais essencial.
                </>
              )}
            </h2>
          </div>
          <div
            className="manifesto-art"
            aria-label={
              catalog.manifestoDescription ||
              (catalog.manifestoFormula ? `Fórmula: ${catalog.manifestoFormula}` : "Manifesto visual Modulus")
            }
          />
        </motion.section>
      </main>

      <footer id="contato">
        <div className="footer-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/modulus-logo-footer.svg" alt="Modulus" />
        </div>
        <div className="footer-meta">
          <p className="m-0">
            Objetos inteligentes para problemas <strong>reais</strong>.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Sua ideia pode ser a próxima.{" "}
            <a
              href={`https://wa.me/5511912000753?text=${whatsappMessage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline hover:text-indigo-300"
            >
              Criar uma peça exclusiva →
            </a>
          </p>
          <p className="mt-1">© {year ?? ""} Modulus</p>
        </div>
        <div className="mt-2 flex gap-2 justify-end-safe">
          {[
            {
              label: "TikTok",
              href: "https://www.tiktok.com/@modulus.studios?_r=1&_t=zs-95u3cwvuqep",
              path: "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.78 1.52V6.79a4.85 4.85 0 0 1-1.01-.1z",
            },
            {
              label: "Instagram",
              href: "https://www.instagram.com/modulus.studios?igsh=Zno4cTY2cG51aXR0&utm_source=qr",
              path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
            },
            {
              label: "WhatsApp",
              href: `https://wa.me/5511912000753?text=${whatsappMessage}`,
              path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z",
            },
          ].map(({ label, href, path }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-gray-700 text-black/40 transition hover:border-[var(--modulus-accent)]/30 hover:bg-[var(--modulus-accent)]/50 hover:text-[var(--modulus-primary)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d={path} />
              </svg>
            </a>
          ))}
        </div>
      </footer>

      {/* OVERLAYS & PANELS */}
      <div
        className={`overlay${panelOpen || searchOpen || cartOpen ? " visible" : ""}`}
        onClick={() => {
          setPanelOpen(false);
          setSearchOpen(false);
          setCartOpen(false);
        }}
      />

      <aside
        className={`filter-panel${panelOpen ? " open" : ""}`}
        id="filterPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filterTitle"
      >
        <div className="panel-head">
          <h2 id="filterTitle">Filtrar produtos</h2>
          <button
            className="close-button"
            aria-label="Fechar filtros"
            ref={closeFiltersRef}
            onClick={() => setPanelOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="filter-group">
          <h3>Categoria</h3>
          <div className="check-list">
            {categories
              .filter((c) => c !== "Todos")
              .map((category) => (
                <label key={category}>
                  <input
                    type="checkbox"
                    name="filter-category"
                    value={category}
                    checked={categoryFilters.includes(category)}
                    onChange={() => toggleCategoryFilter(category)}
                  />{" "}
                  {category}
                </label>
              ))}
          </div>
        </div>
        {formats.length > 0 && (
          <div className="filter-group">
            <h3>Formato</h3>
            <div className="check-list">
              {formats.map((format) => (
                <label key={format}>
                  <input
                    type="checkbox"
                    name="format"
                    value={format}
                    checked={formatFilters.includes(format)}
                    onChange={() => toggleFormatFilter(format)}
                  />{" "}
                  {format === "Unitário" ? "Produto unitário" : format}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="panel-actions">
          <button className="clear-button" onClick={clearFilters}>
            Limpar
          </button>
          <button className="apply-button" onClick={() => setPanelOpen(false)}>
            Ver resultados
          </button>
        </div>
      </aside>

      <div
        className={`search-layer${searchOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="searchLabel"
      >
        <div className="search-top">
          <button className="close-button" aria-label="Fechar busca" onClick={() => setSearchOpen(false)}>
            ×
          </button>
        </div>
        <div className="search-wrap">
          <label id="searchLabel" htmlFor="searchInput">
            Buscar no catálogo
          </label>
          <input
            id="searchInput"
            ref={searchInputRef}
            type="search"
            placeholder="O que você procura?"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
      </div>

      <CartDrawer
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        products={catalog.products.map((p) => ({
          id: p.id,
          name: p.name,
          photo: p.photo,
          price: p.price,
        }))}
      />
    </>
  );
}

export default function CatalogoModulus({ catalog }: CatalogoModulusProps) {
  return (
    <CartProvider catalogSlug={catalog.slug}>
      <CatalogoModulusInner catalog={catalog} />
    </CartProvider>
  );
}

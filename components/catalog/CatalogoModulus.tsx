"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogView } from "@/types/catalog";
import { ProductCarousel } from "./ProductCarousel";
import { CartProvider, useCart } from "@/context/CartContext";
import { CartDrawer } from "./CartDrawer";
import { ShoppingCart, ShoppingCartPlus } from "lucide-react";

type Category = "Todos" | string;
type Format = string;
type SortMode = "featured" | "name";

export interface CatalogoModulusProps {
  catalog: CatalogView;
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
  const year = useMemo(() => new Date().getFullYear(), []);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeFiltersRef = useRef<HTMLButtonElement>(null);

  const { totalItems, isHydrated, addItem } = useCart();

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

  function handleAddToCart(productId: string) {
    addItem(productId);
    setCartOpen(true);
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Modulus — página inicial">
          <img src={`/logo_Horizontal.svg`} alt="Modulus" />
        </a>
        <nav className="main-nav" aria-label="Navegação principal">
          <a href="#catalogo">Catálogo</a>
          <a href="#principios">Princípios</a>
          <a href="#contato">Contato</a>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Abrir busca" onClick={() => setSearchOpen(true)}>
            <span className="search-icon" aria-hidden="true" />
          </button>
          <button
            className="cart-button"
            aria-label={totalItems > 0 ? `Abrir carrinho (${totalItems} itens)` : "Abrir carrinho (vazio)"}
            onClick={() => setCartOpen(true)}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            {isHydrated && totalItems > 0 && (
              <span className="cart-badge" aria-live="polite">
                {totalItems}
              </span>
            )}
          </button>
          <button
            className="menu-button"
            aria-label="Abrir menu"
            onClick={() => document.querySelector("#catalogo")?.scrollIntoView()}
          >
            ↘
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="pageTitle">
  <div className="hero-title">
    {catalog.eyebrow && <p className="eyebrow">{catalog.eyebrow}</p>}

    <h1 id="pageTitle">
      {catalog.title}
    </h1>
  </div>

  {(catalog.heroStrongText || catalog.heroCopy) && (
    <p className="hero-copy">
      {catalog.heroStrongText && (
        <strong>{catalog.heroStrongText} </strong>
      )}
      {catalog.heroCopy}
    </p>
  )}
</section>  

        <section className="catalogue" id="catalogo" aria-label="Produtos">
          <div className="catalog-search-filter-bar" role="search" aria-label="Pesquisa e filtros">
            <label className="catalog-search-wrap" htmlFor="catalogSearchInput">
              <span className="catalog-search-icon" aria-hidden="true">⌕</span>
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
          </div>

          <div className="toolbar">
            <div className="categories" role="tablist" aria-label="Categorias de produto">
              {categories.map((category) => (
                <button
                  key={category}
                  className={`category-chip${validatedActiveCategory === category ? " active" : ""}`}
                  role="tab"
                  aria-selected={validatedActiveCategory === category}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <button
              className="filter-button"
              aria-haspopup="dialog"
              aria-controls="filterPanel"
              onClick={() => setPanelOpen(true)}
            >
              <span className="filter-lines" aria-hidden="true" />
              <span>Filtros</span>
            </button>
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

          <div className="product-grid" id="productGrid">
            {sortedProducts.map((product) => (
              <article
                key={product.id || product.index}
                className="product-card"
                data-name={product.name}
                data-category={product.category}
                data-format={product.format}
              >
                <div className="product-visual">
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
                  <div className="product-price-row">
                    <p className="product-price">
                      {product.price != null
                        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price)
                        : "Sob consulta"}
                    </p>
                    <button
                      type="button"
                      className="add-to-cart-btn"
                      onClick={() => handleAddToCart(product.id)}
                      aria-label={`Adicionar ${product.name} ao carrinho`}
                    >
                      
                      <ShoppingCartPlus className="h-4 w-4" aria-hidden="true" />
                      <span>Adicionar</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className={`empty-state${sortedProducts.length === 0 ? " visible" : ""}`}>
            <div>
              <h2>Nenhum produto encontrado.</h2>
              <p>Tente pesquisar por outro nome ou remover os filtros.</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="empty-state-clear"
                  onClick={handleResetAll}
                  style={{ marginTop: "18px", minHeight: "44px", padding: "0 18px", borderRadius: "999px", border: "1px solid var(--ink)", background: "white", cursor: "pointer" }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="manifesto" id="principios">
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
        </section>
      </main>

      <footer id="contato">
        <div className="footer-brand">
          <img src={`/modulus-logo-footer.svg`} alt="Modulus" />
        </div>
        <div className="footer-meta">
          Objetos inteligêntes para problemas <strong>reais</strong>.
          <br />© {year ?? ""} Modulus
        </div>
        <div className="mt-2 flex gap-2 justify-end-safe">
                {[
                  { label: "TikTok", href: "https://www.tiktok.com/@modulus.studios?_r=1&_t=zs-95u3cwvuqep", path: "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.78 1.52V6.79a4.85 4.85 0 0 1-1.01-.1z" },
                  { label: "Instagram", href: "https://www.instagram.com/modulus.studios?igsh=Zno4cTY2cG51aXR0&utm_source=qr", path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" },
                  { label: "WhatsApp", href: "https://wa.me/5511912000753?text=%E2%98%BA%EF%B8%8E%20%20%E1%90%B8%20%20Bem-vindo%20%C3%A0%20%20%2AM%E1%B4%8F%E1%B4%85%E1%B4%9C%CA%9F%E1%B4%9C%EA%9C%B1%2A%20%20%21%20%20%2A%E2%9F%AF%2A%0A%20%20%E2%80%A2%20Tudo%20come%C3%A7a%20com%20sua%20ideia%0A%20%20%E2%80%A2%20Voc%C3%AA%20pensa%2C%20n%C3%B3s%20fazemos%0A%E2%86%92%20Sem%20custo%2C%20me%20conte%20como%20vamos%20dar%20vida%20a%20seu%20projeto%3A", path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" },
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
      
      <div className={`overlay${panelOpen || searchOpen || cartOpen ? " visible" : ""}`} onClick={() => {
        setPanelOpen(false);
        setSearchOpen(false);
        setCartOpen(false);
      }} />

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
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogView } from "@/types/catalog";

type Category = "Todos" | string;
type Format = string;
type SortMode = "featured" | "name";

export interface CatalogoModulusProps {
  catalog: CatalogView;
}

export default function CatalogoModulus({ catalog }: CatalogoModulusProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("Todos");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("featured");
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [formatFilters, setFormatFilters] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [year, setYear] = useState<number | null>(() => new Date().getFullYear());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeFiltersRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.classList.toggle("panel-open", panelOpen || searchOpen);
  }, [panelOpen, searchOpen]);

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
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  // Categorias e Formatos derivados dinamicamente dos produtos deste catálogo específico
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

  // Se a categoria ativa atual não existir mais no catálogo (ex: troca de catálogo/props), reseta para "Todos"
  // Usamos useMemo para calcular a categoria ativa válida em vez de useEffect com setState
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
    // "featured" preserva a ordem definida (ex: displayOrder)
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

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setSearchOpen(false);
      document.querySelector("#catalogo")?.scrollIntoView();
    }
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
          <div>
            {catalog.eyebrow && <p className="eyebrow">{catalog.eyebrow}</p>}
            <h1 id="pageTitle">{catalog.title}</h1>
          </div>
          {(catalog.heroStrongText || catalog.heroCopy) && (
            <p className="hero-copy">
              {catalog.heroStrongText && <strong>{catalog.heroStrongText} </strong>}
              {catalog.heroCopy}
            </p>
          )}
        </section>

        <section className="catalogue" id="catalogo" aria-label="Produtos">
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
                <a className="product-link" href="#contato" aria-label={`Consultar ${product.name}`}>
                  <div className="product-visual">
                    <span className="product-index">{product.index}</span>
                    <img className="product-photo" src={product.photo} alt={product.photoAlt || product.name} loading="lazy" />
                    {product.photoSecondary && (
                      <img
                        className="product-photo product-photo-secondary"
                        src={product.photoSecondary}
                        alt={product.photoSecondaryAlt || product.name}
                        loading="lazy"
                      />
                    )}
                    {product.photoNote && <span className="photo-note">{product.photoNote}</span>}
                    <span className="quick-button" aria-hidden="true">
                      ↗
                    </span>
                  </div>
                  <div className="product-meta">
                    <div>
                      <h2 className="product-name">{product.name}</h2>
                      {product.detail && <p className="product-detail">{product.detail}</p>}
                      {product.description && <p className="product-description">{product.description}</p>}
                      <span className="product-cta">Consultar produto</span>
                    </div>
                    <p className="product-price">
                      {product.price != null
                        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price)
                        : "Sob consulta"}
                    </p>
                  </div>
                </a>
              </article>
            ))}
          </div>

          <div className={`empty-state${sortedProducts.length === 0 ? " visible" : ""}`}>
            <div>
              <h2>Nenhum objeto por aqui.</h2>
              <p>Tente remover um filtro ou buscar outro termo.</p>
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
          Objetos inteligentes para problemas reais.
          <br />© {year ?? ""} Modulus
        </div>
      </footer>

      <div className={`overlay${panelOpen ? " visible" : ""}`} onClick={() => setPanelOpen(false)} />

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

      <style jsx global>{`
        :root {
          --electric: #2b00ff;
          --ink: #152336;
          --periwinkle: #a6b4ff;
          --orange: #ff4e26;
          --paper: #f7f7f4;
          --white: #ffffff;
          --line: rgba(21, 35, 54, 0.16);
          --muted: #687383;
          --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        * {
          box-sizing: border-box;
        }
        html {
          scroll-behavior: smooth;
        }
        body {
          margin: 0;
          color: var(--ink);
          background: var(--paper);
          font-family: "Space Grotesk", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        body.panel-open {
          overflow: hidden;
        }
        button,
        input,
        select {
          font: inherit;
        }
        button {
          color: inherit;
        }
        a {
          color: inherit;
          text-decoration: none;
        }
        img {
          display: block;
          max-width: 100%;
        }
        ::selection {
          color: var(--white);
          background: var(--electric);
        }

        .site-header {
          position: sticky;
          z-index: 20;
          top: 0;
          height: 78px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          padding: 0 32px;
          background: rgba(247, 247, 244, 0.9);
          border-bottom: 1px solid var(--line);
          backdrop-filter: blur(16px);
        }
        .brand {
          width: max-content;
          display: inline-flex;
          align-items: center;
          height: 30px;
        }
        .brand img {
          display: block;
          width: 142px;
          height: auto;
        }
        .main-nav {
          display: flex;
          align-items: center;
          gap: 28px;
          font-size: 14px;
        }
        .main-nav a {
          position: relative;
        }
        .main-nav a::after {
          content: "";
          position: absolute;
          right: 0;
          bottom: -7px;
          left: 0;
          height: 1px;
          background: var(--ink);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.25s var(--ease);
        }
        .main-nav a:hover::after,
        .main-nav a:focus-visible::after {
          transform: scaleX(1);
        }
        .header-actions {
          justify-self: end;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .icon-button,
        .menu-button {
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid var(--line);
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .icon-button:hover {
          color: white;
          background: var(--ink);
          border-color: var(--ink);
        }
        .search-icon {
          width: 15px;
          height: 15px;
          border: 1.8px solid currentColor;
          border-radius: 50%;
          position: relative;
        }
        .search-icon::after {
          content: "";
          width: 6px;
          height: 1.8px;
          background: currentColor;
          position: absolute;
          right: -5px;
          bottom: -2px;
          transform: rotate(45deg);
        }
        .menu-button {
          display: none;
        }

        main {
          overflow: hidden;
        }
        .hero {
          min-height: 390px;
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(240px, 0.4fr);
          align-items: end;
          gap: 40px;
          padding: 78px 32px 52px;
          border-bottom: 1px solid var(--line);
        }
        .eyebrow {
          margin: 0 0 18px;
          color: var(--electric);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          font-size: clamp(72px, 11vw, 168px);
          font-weight: 500;
          line-height: 0.78;
          letter-spacing: -0.085em;
        }
        .hero-copy {
          max-width: 390px;
          justify-self: end;
          margin: 0 0 6px;
          color: var(--muted);
          font-size: clamp(15px, 1.4vw, 18px);
          line-height: 1.45;
        }
        .hero-copy strong {
          color: var(--ink);
          font-weight: 500;
        }

        .catalogue {
          padding: 0 32px 80px;
        }
        .toolbar {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 24px;
          align-items: center;
          min-height: 86px;
          border-bottom: 1px solid var(--line);
        }
        .categories {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
          padding-right: 24px;
        }
        .categories::-webkit-scrollbar {
          display: none;
        }
        .category-chip {
          flex: 0 0 auto;
          padding: 10px 15px;
          border: 1px solid transparent;
          border-radius: 999px;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          transition: 0.2s var(--ease);
        }
        .category-chip:hover {
          border-color: var(--line);
        }
        .category-chip.active {
          color: white;
          background: var(--ink);
          border-color: var(--ink);
        }
        .filter-button {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 44px;
          padding: 0 17px;
          border: 1px solid var(--ink);
          border-radius: 999px;
          background: transparent;
          cursor: pointer;
          transition: 0.2s var(--ease);
        }
        .filter-button:hover {
          color: white;
          background: var(--electric);
          border-color: var(--electric);
        }
        .filter-lines,
        .filter-lines::before,
        .filter-lines::after {
          width: 15px;
          height: 1px;
          background: currentColor;
          display: block;
          position: relative;
        }
        .filter-lines::before,
        .filter-lines::after {
          content: "";
          position: absolute;
          left: 0;
        }
        .filter-lines::before {
          top: -5px;
          width: 11px;
        }
        .filter-lines::after {
          top: 5px;
          width: 7px;
        }
        .result-line {
          min-height: 74px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--muted);
          font-size: 13px;
        }
        .result-line strong {
          color: var(--ink);
          font-weight: 500;
        }
        .sort-inline {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .sort-inline select {
          color: var(--ink);
          border: 0;
          background: transparent;
          outline: none;
          cursor: pointer;
        }

        .product-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 44px 16px;
        }
        .product-card {
          min-width: 0;
          animation: reveal 0.5s both;
        }
        @keyframes reveal {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        .product-link {
          display: block;
        }
        .product-visual {
          position: relative;
          aspect-ratio: 4 / 5;
          overflow: hidden;
          background: #eaebe8;
        }
        .product-visual::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(140deg, transparent 55%, rgba(255, 255, 255, 0.42));
          pointer-events: none;
        }
        .product-photo {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.65s var(--ease), opacity 0.45s var(--ease);
        }
        .product-photo-secondary {
          opacity: 0;
        }
        .product-card:hover .product-photo-secondary,
        .product-link:focus-visible .product-photo-secondary {
          opacity: 1;
        }
        .product-card:hover .product-photo:not(.product-photo-secondary),
        .product-link:focus-visible .product-photo:not(.product-photo-secondary) {
          transform: scale(1.025);
        }
        .product-card:hover .product-photo-secondary,
        .product-link:focus-visible .product-photo-secondary {
          transform: scale(1.025);
        }
        .photo-note {
          position: absolute;
          z-index: 3;
          right: 16px;
          top: 16px;
          padding: 7px 10px;
          border-radius: 999px;
          color: var(--ink);
          background: rgba(255, 255, 255, 0.82);
          backdrop-filter: blur(8px);
          font-size: 10px;
          letter-spacing: 0.04em;
          transition: opacity 0.25s;
        }
        .product-card:hover .photo-note {
          opacity: 0;
        }
        .product-index {
          position: absolute;
          top: 18px;
          left: 18px;
          z-index: 2;
          font-size: 11px;
          letter-spacing: 0.08em;
        }
        .quick-button {
          position: absolute;
          z-index: 3;
          right: 16px;
          bottom: 16px;
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 50%;
          color: white;
          background: var(--electric);
          font-size: 22px;
          cursor: pointer;
          opacity: 0;
          transform: translateY(8px);
          transition: 0.25s var(--ease);
        }
        .product-card:hover .quick-button,
        .product-link:focus-visible .quick-button {
          opacity: 1;
          transform: none;
        }
        .product-meta {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          padding-top: 16px;
        }
        .product-name {
          margin: 0;
          font-size: 17px;
          font-weight: 500;
          letter-spacing: -0.025em;
        }
        .product-detail {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 13px;
        }
        .product-description {
          max-width: 38ch;
          min-height: 3.8em;
          margin: 12px 0 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
        }
        .product-price {
          margin: 1px 0 0;
          font-size: 14px;
          white-space: nowrap;
        }
        .product-cta {
          display: inline-block;
          margin-top: 14px;
          padding-bottom: 3px;
          border-bottom: 1px solid currentColor;
          color: var(--electric);
          font-size: 13px;
          font-weight: 600;
        }
        .empty-state {
          display: none;
          place-items: center;
          min-height: 360px;
          text-align: center;
          border-top: 1px solid var(--line);
        }
        .empty-state.visible {
          display: grid;
        }
        .empty-state h2 {
          margin: 0 0 10px;
          font-size: 32px;
          letter-spacing: -0.05em;
        }
        .empty-state p {
          margin: 0;
          color: var(--muted);
        }

        .manifesto {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 420px;
          color: white;
          background: var(--electric);
        }
        .manifesto-copy {
          padding: 56px 32px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .manifesto-label {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .manifesto h2 {
          max-width: 700px;
          margin: 72px 0 0;
          font-size: clamp(42px, 6vw, 88px);
          font-weight: 500;
          line-height: 0.96;
          letter-spacing: -0.065em;
        }
        .manifesto-art {
          position: relative;
          overflow: hidden;
          background: var(--periwinkle);
        }
        .manifesto-art::before {
          content: "E = σ / ε";
          position: absolute;
          right: -3vw;
          bottom: -4vw;
          color: var(--electric);
          font-size: clamp(88px, 14vw, 220px);
          font-weight: 600;
          letter-spacing: -0.08em;
          white-space: nowrap;
        }
        .manifesto-art::after {
          content: "RIGIDEZ · RESISTÊNCIA · PROPÓSITO";
          position: absolute;
          top: 28px;
          left: 28px;
          color: var(--ink);
          font-size: 11px;
          letter-spacing: 0.12em;
        }

        footer {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 30px;
          align-items: end;
          padding: 48px 32px;
          background: var(--ink);
          color: white;
        }
        .footer-brand img {
          display: block;
          width: min(620px, 65vw);
          height: auto;
        }
        .footer-meta {
          text-align: right;
          color: #aeb7c3;
          font-size: 12px;
          line-height: 1.7;
        }

        .overlay {
          position: fixed;
          z-index: 29;
          inset: 0;
          background: rgba(21, 35, 54, 0.45);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.3s;
        }
        .overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }
        .filter-panel {
          position: fixed;
          z-index: 30;
          top: 0;
          right: 0;
          width: min(430px, 100%);
          height: 100dvh;
          display: flex;
          flex-direction: column;
          padding: 28px;
          background: var(--white);
          transform: translateX(100%);
          transition: transform 0.4s var(--ease);
        }
        .filter-panel.open {
          transform: none;
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 25px;
          border-bottom: 1px solid var(--line);
        }
        .panel-head h2 {
          margin: 0;
          font-size: 26px;
          letter-spacing: -0.04em;
        }
        .close-button {
          width: 38px;
          height: 38px;
          border: 1px solid var(--line);
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          font-size: 22px;
        }
        .filter-group {
          padding: 28px 0;
          border-bottom: 1px solid var(--line);
        }
        .filter-group h3 {
          margin: 0 0 16px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .check-list {
          display: grid;
          gap: 13px;
        }
        .check-list label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }
        .check-list input {
          accent-color: var(--electric);
          width: 17px;
          height: 17px;
        }
        .panel-actions {
          margin-top: auto;
          display: grid;
          grid-template-columns: 1fr 1.4fr;
          gap: 10px;
          padding-top: 24px;
        }
        .panel-actions button {
          min-height: 50px;
          border: 1px solid var(--ink);
          border-radius: 3px;
          cursor: pointer;
        }
        .clear-button {
          background: white;
        }
        .apply-button {
          color: white;
          background: var(--electric);
          border-color: var(--electric) !important;
        }

        .search-layer {
          position: fixed;
          z-index: 40;
          inset: 0;
          padding: 30px 32px;
          background: var(--paper);
          transform: translateY(-100%);
          transition: transform 0.4s var(--ease);
        }
        .search-layer.open {
          transform: none;
        }
        .search-top {
          display: flex;
          justify-content: flex-end;
        }
        .search-wrap {
          width: min(960px, 100%);
          margin: 12vh auto 0;
        }
        .search-wrap label {
          display: block;
          margin-bottom: 22px;
          color: var(--electric);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }
        .search-wrap input {
          width: 100%;
          padding: 0 0 20px;
          color: var(--ink);
          border: 0;
          border-bottom: 2px solid var(--ink);
          outline: none;
          background: transparent;
          font-size: clamp(36px, 7vw, 92px);
          letter-spacing: -0.06em;
        }
        .search-wrap input::placeholder {
          color: #b4bbc3;
        }

        :focus-visible {
          outline: 2px solid var(--orange);
          outline-offset: 3px;
        }

        @media (max-width: 900px) {
          .site-header {
            grid-template-columns: 1fr auto;
            height: 68px;
            padding: 0 20px;
          }
          .main-nav {
            display: none;
          }
          .menu-button {
            display: grid;
          }
          .hero {
            min-height: 330px;
            grid-template-columns: 1fr;
            gap: 35px;
            padding: 58px 20px 38px;
          }
          h1 {
            font-size: clamp(68px, 17vw, 124px);
          }
          .hero-copy {
            justify-self: start;
          }
          .catalogue {
            padding: 0 20px 64px;
          }
          .product-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .manifesto {
            grid-template-columns: 1fr;
          }
          .manifesto-art {
            min-height: 300px;
          }
          footer {
            padding: 40px 20px;
          }
        }

        @media (max-width: 560px) {
          .site-header {
            padding: 0 16px;
          }
          .brand img {
            width: 126px;
          }
          .header-actions {
            gap: 7px;
          }
          .hero {
            min-height: 310px;
            padding: 48px 16px 32px;
          }
          h1 {
            font-size: 20vw;
            line-height: 0.84;
          }
          .hero-copy {
            font-size: 15px;
            max-width: 330px;
          }
          .catalogue {
            padding: 0 16px 56px;
          }
          .toolbar {
            min-height: 76px;
            gap: 10px;
          }
          .filter-button {
            width: 44px;
            padding: 0;
            justify-content: center;
          }
          .filter-button span:last-child {
            display: none;
          }
          .result-line {
            min-height: 62px;
          }
          .sort-inline span {
            display: none;
          }
          .product-grid {
            grid-template-columns: 1fr;
            gap: 38px;
          }
          .product-visual {
            aspect-ratio: 5 / 6;
          }
          .quick-button {
            opacity: 1;
            transform: none;
          }
          .manifesto-copy {
            min-height: 330px;
            padding: 40px 20px;
          }
          .manifesto h2 {
            margin-top: 60px;
          }
          .manifesto-art {
            min-height: 240px;
          }
          footer {
            grid-template-columns: 1fr;
            align-items: start;
          }
          .footer-meta {
            text-align: left;
          }
          .filter-panel {
            padding: 22px 18px;
          }
          .search-layer {
            padding: 20px 16px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </>
  );
}

-- Migration: Catalog filters per catalog + N:N filter-product associations
-- Model: Catalog 1:N Filter N:N Product (scoped to catalog membership) + RLS + triggers

-- 1. catalog_filters
CREATE TABLE IF NOT EXISTS public.catalog_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT catalog_filters_name_catalog_unique UNIQUE (catalog_id, name),
    CONSTRAINT catalog_filters_slug_catalog_unique UNIQUE (catalog_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_catalog_filters_catalog_id ON public.catalog_filters(catalog_id);
CREATE INDEX IF NOT EXISTS idx_catalog_filters_slug ON public.catalog_filters(slug);
CREATE INDEX IF NOT EXISTS idx_catalog_filters_display_order ON public.catalog_filters(catalog_id, display_order);

DROP TRIGGER IF EXISTS set_catalog_filters_updated_at ON public.catalog_filters;
CREATE TRIGGER set_catalog_filters_updated_at
BEFORE UPDATE ON public.catalog_filters
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.catalog_filters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public users can view filters of active catalogs" ON public.catalog_filters;
DROP POLICY IF EXISTS "Authenticated users can do all on catalog_filters" ON public.catalog_filters;

CREATE POLICY "Public users can view filters of active catalogs"
    ON public.catalog_filters FOR SELECT
    TO public
    USING (
        EXISTS (
            SELECT 1 FROM public.catalogs c
            WHERE c.id = catalog_filters.catalog_id AND c.active = true
        )
    );

CREATE POLICY "Authenticated users can do all on catalog_filters"
    ON public.catalog_filters FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 2. catalog_filter_products (N:N Filter <-> Product)
CREATE TABLE IF NOT EXISTS public.catalog_filter_products (
    catalog_filter_id UUID NOT NULL REFERENCES public.catalog_filters(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (catalog_filter_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_filter_products_filter_id ON public.catalog_filter_products(catalog_filter_id);
CREATE INDEX IF NOT EXISTS idx_catalog_filter_products_product_id ON public.catalog_filter_products(product_id);

ALTER TABLE public.catalog_filter_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public users can view filter products of active catalogs" ON public.catalog_filter_products;
DROP POLICY IF EXISTS "Authenticated users can do all on catalog_filter_products" ON public.catalog_filter_products;

CREATE POLICY "Public users can view filter products of active catalogs"
    ON public.catalog_filter_products FOR SELECT
    TO public
    USING (
        EXISTS (
            SELECT 1 FROM public.catalog_filters cf
            JOIN public.catalogs c ON c.id = cf.catalog_id
            WHERE cf.id = catalog_filter_products.catalog_filter_id AND c.active = true
        )
        AND EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = catalog_filter_products.product_id AND p.active = true
        )
    );

CREATE POLICY "Authenticated users can do all on catalog_filter_products"
    ON public.catalog_filter_products FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 3. Enforce: product must belong to catalog of the filter
CREATE OR REPLACE FUNCTION public.check_filter_product_catalog_membership()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.catalog_filters cf
        JOIN public.catalog_products cp
            ON cp.catalog_id = cf.catalog_id
           AND cp.product_id = NEW.product_id
        WHERE cf.id = NEW.catalog_filter_id
    ) THEN
        RAISE EXCEPTION 'Product % does not belong to catalog of filter %', NEW.product_id, NEW.catalog_filter_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_filter_product_catalog_membership ON public.catalog_filter_products;
CREATE TRIGGER trg_check_filter_product_catalog_membership
BEFORE INSERT OR UPDATE ON public.catalog_filter_products
FOR EACH ROW
EXECUTE FUNCTION public.check_filter_product_catalog_membership();

-- 4. Cleanup orphan filter associations when product removed from catalog
CREATE OR REPLACE FUNCTION public.cleanup_filter_products_on_catalog_product_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.catalog_filter_products
    WHERE product_id = OLD.product_id
      AND catalog_filter_id IN (
          SELECT id FROM public.catalog_filters WHERE catalog_id = OLD.catalog_id
      );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_filter_products ON public.catalog_products;
CREATE TRIGGER trg_cleanup_filter_products
AFTER DELETE ON public.catalog_products
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_filter_products_on_catalog_product_delete();

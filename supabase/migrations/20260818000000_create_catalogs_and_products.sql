-- Migration: Create catalogs, products, catalog_products tables, indexes, RLS policies, and Storage buckets
-- Created for Modulus Catalog Admin System

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLES

-- Catalogs Table
CREATE TABLE IF NOT EXISTS public.catalogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    logo_url TEXT,
    banner_url TEXT,
    whatsapp VARCHAR(50),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    image_url TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-Many junction table: catalog_products
CREATE TABLE IF NOT EXISTS public.catalog_products (
    catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (catalog_id, product_id)
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_catalogs_slug ON public.catalogs(slug);
CREATE INDEX IF NOT EXISTS idx_catalogs_active ON public.catalogs(active);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_catalog_products_catalog_id ON public.catalog_products(catalog_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_product_id ON public.catalog_products(product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_products_order ON public.catalog_products(catalog_id, display_order);

-- 4. AUTOMATIC UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_catalogs_updated_at ON public.catalogs;
CREATE TRIGGER set_catalogs_updated_at
BEFORE UPDATE ON public.catalogs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_products_updated_at ON public.products;
CREATE TRIGGER set_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 5. ROW LEVEL SECURITY (RLS)

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

-- Clear existing policies if re-running
DROP POLICY IF EXISTS "Public users can view active catalogs" ON public.catalogs;
DROP POLICY IF EXISTS "Authenticated users can do all on catalogs" ON public.catalogs;

DROP POLICY IF EXISTS "Public users can view active products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can do all on products" ON public.products;

DROP POLICY IF EXISTS "Public users can view catalog products for active catalogs and products" ON public.catalog_products;
DROP POLICY IF EXISTS "Authenticated users can do all on catalog_products" ON public.catalog_products;

-- Catalogs RLS Policies
CREATE POLICY "Public users can view active catalogs"
    ON public.catalogs FOR SELECT
    TO public
    USING (active = true);

CREATE POLICY "Authenticated users can do all on catalogs"
    ON public.catalogs FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Products RLS Policies
CREATE POLICY "Public users can view active products"
    ON public.products FOR SELECT
    TO public
    USING (active = true);

CREATE POLICY "Authenticated users can do all on products"
    ON public.products FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Catalog Products RLS Policies
CREATE POLICY "Public users can view catalog products for active catalogs and products"
    ON public.catalog_products FOR SELECT
    TO public
    USING (
        EXISTS (
            SELECT 1 FROM public.catalogs c
            WHERE c.id = catalog_products.catalog_id AND c.active = true
        )
        AND EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.id = catalog_products.product_id AND p.active = true
        )
    );

CREATE POLICY "Authenticated users can do all on catalog_products"
    ON public.catalog_products FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 6. STORAGE BUCKET CREATION & POLICIES
-- Create public storage buckets for catalog and product images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('catalogs', 'catalogs', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']),
    ('products', 'products', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET 
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- Storage RLS Policies for 'catalogs' bucket
DROP POLICY IF EXISTS "Public Access to Catalogs Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload to Catalogs Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update to Catalogs Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete from Catalogs Bucket" ON storage.objects;

CREATE POLICY "Public Access to Catalogs Bucket"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'catalogs');

CREATE POLICY "Authenticated Upload to Catalogs Bucket"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'catalogs');

CREATE POLICY "Authenticated Update to Catalogs Bucket"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'catalogs');

CREATE POLICY "Authenticated Delete from Catalogs Bucket"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'catalogs');

-- Storage RLS Policies for 'products' bucket
DROP POLICY IF EXISTS "Public Access to Products Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload to Products Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update to Products Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete from Products Bucket" ON storage.objects;

CREATE POLICY "Public Access to Products Bucket"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'products');

CREATE POLICY "Authenticated Upload to Products Bucket"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'products');

CREATE POLICY "Authenticated Update to Products Bucket"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'products');

CREATE POLICY "Authenticated Delete from Products Bucket"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'products');

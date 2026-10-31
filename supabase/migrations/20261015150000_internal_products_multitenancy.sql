-- Modulus internal products MVP.
-- Prerequisites: the SaaS core only:
-- public.users, public.auth_identities, public.enterprises,
-- public.enterprise_members and private authorization helpers.
-- This migration intentionally does not create or require legacy catalog/filter/sales tables.
-- It is not a production-data migration and must abort if products already exist.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    RAISE EXCEPTION 'internal products migration aborted: public.products already exists; review manually, do not replace it';
  END IF;
  IF to_regclass('public.product_images') IS NOT NULL THEN
    RAISE EXCEPTION 'internal products migration aborted: public.product_images already exists; review manually, do not replace it';
  END IF;
END $$;

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  -- Kept only for compatibility with the current CRUD contract. It is not public
  -- and is not used for authorization or tenant resolution.
  slug TEXT NOT NULL DEFAULT (gen_random_uuid()::TEXT),
  description TEXT,
  price NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT true,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT products_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT products_name_check CHECK (
    pg_catalog.btrim(name) = name AND pg_catalog.length(name) BETWEEN 2 AND 255
  ),
  CONSTRAINT products_description_check CHECK (
    description IS NULL OR pg_catalog.length(description) <= 3000
  ),
  CONSTRAINT products_price_check CHECK (
    price IS NULL OR (price >= 0 AND price <= 1000000)
  )
);

CREATE INDEX products_enterprise_active_created_at_idx
  ON public.products (enterprise_id, active, created_at DESC);

CREATE TABLE public.product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL,
  product_id UUID NOT NULL,
  url TEXT NOT NULL,
  display_order SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT product_images_product_fk
    FOREIGN KEY (enterprise_id, product_id)
    REFERENCES public.products (enterprise_id, id) ON DELETE CASCADE,
  CONSTRAINT product_images_display_order_check CHECK (display_order BETWEEN 1 AND 3),
  CONSTRAINT product_images_product_order_key UNIQUE (product_id, display_order),
  CONSTRAINT product_images_product_url_key UNIQUE (product_id, url)
);

CREATE INDEX product_images_enterprise_product_idx
  ON public.product_images (enterprise_id, product_id);

CREATE OR REPLACE FUNCTION public.internal_products_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_products_increment_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_product_enterprise_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id THEN
    RAISE EXCEPTION 'product enterprise ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.internal_product_image_ownership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
    RAISE EXCEPTION 'product image ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.internal_products_set_updated_at();

CREATE TRIGGER internal_products_increment_version
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.internal_products_increment_version();

CREATE TRIGGER internal_product_enterprise_guard
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.internal_product_enterprise_guard();

CREATE TRIGGER internal_product_images_set_updated_at
BEFORE UPDATE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.internal_products_set_updated_at();

CREATE TRIGGER internal_product_image_ownership_guard
BEFORE UPDATE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.internal_product_image_ownership_guard();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_products_select
ON public.products FOR SELECT TO authenticated
USING (private.can_access_enterprise(enterprise_id, 'products.read'));

CREATE POLICY internal_product_images_select
ON public.product_images FOR SELECT TO authenticated
USING (private.can_access_enterprise(enterprise_id, 'products.read'));

REVOKE ALL ON TABLE public.products, public.product_images FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, enterprise_id, name, slug, description, price, active, created_at, updated_at, version)
  ON public.products TO authenticated;
GRANT SELECT (id, enterprise_id, product_id, url, display_order, created_at, updated_at)
  ON public.product_images TO authenticated;

CREATE OR REPLACE FUNCTION private.lock_internal_product_context(p_permission TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context RECORD;
  v_identity RECORD;
  v_user RECORD;
  v_member RECORD;
  v_enterprise RECORD;
  v_uid UUID;
  v_issuer TEXT;
BEGIN
  IF p_permission IS NULL OR p_permission NOT IN ('products.write', 'products.delete') THEN
    RETURN NULL;
  END IF;

  v_uid := auth.uid();
  v_issuer := auth.jwt() ->> 'iss';
  IF v_uid IS NULL OR v_issuer IS NULL OR pg_catalog.btrim(v_issuer) = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0)
  );
  SELECT context.* INTO v_context
  FROM public.get_my_access_context() AS context;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'modulus:employee-provisioning:actor:' || v_issuer || ':' || v_uid::TEXT, 0
    )
  );

  SELECT identity.* INTO v_identity
  FROM public.auth_identities AS identity
  JOIN private.auth_issuer_config AS issuer
    ON issuer.issuer = identity.issuer
   AND issuer.provider = 'supabase'
   AND issuer.status = 'active'
  WHERE identity.provider = 'supabase'
    AND identity.issuer = v_issuer
    AND identity.subject = v_uid::TEXT
    AND identity.status = 'active'
  FOR UPDATE OF identity;

  SELECT person.* INTO v_user
  FROM public.users AS person
  WHERE person.id = v_identity.user_id
  FOR UPDATE;

  SELECT member.* INTO v_member
  FROM public.enterprise_members AS member
  WHERE member.user_id = v_user.id
    AND member.enterprise_id = v_context.enterprise_id
    AND member.status = 'active'
  FOR UPDATE;

  SELECT enterprise.* INTO v_enterprise
  FROM public.enterprises AS enterprise
  WHERE enterprise.id = v_member.enterprise_id
    AND enterprise.status = 'active'
  FOR UPDATE;

  SELECT context.* INTO v_context
  FROM public.get_my_access_context() AS context;

  IF v_identity.user_id IS NULL
     OR v_user.status <> 'active'
     OR v_user.must_change_password
     OR v_member.id IS NULL
     OR v_enterprise.id IS NULL
     OR v_context.state <> 'business_ready'
     OR v_context.enterprise_id IS DISTINCT FROM v_enterprise.id
     OR NOT private.can_access_enterprise(v_enterprise.id, p_permission) THEN
    RETURN NULL;
  END IF;

  RETURN v_enterprise.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_internal_product(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_price NUMERIC DEFAULT NULL,
  p_images JSONB DEFAULT '[]'
)
RETURNS TABLE(status TEXT, product_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enterprise_id UUID; v_product public.products%ROWTYPE; v_name TEXT;
BEGIN
  v_name := pg_catalog.btrim(p_name);
  IF v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 255
     OR (p_description IS NOT NULL AND pg_catalog.length(p_description) > 3000)
     OR (p_price IS NOT NULL AND (p_price < 0 OR p_price > 1000000))
     OR p_images IS DISTINCT FROM '[]'::JSONB THEN
    RETURN QUERY SELECT 'invalid_input', NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_product_context('products.write');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied', NULL::UUID, NULL::BIGINT; RETURN;
  END IF;
  INSERT INTO public.products (enterprise_id, name, description, price)
  VALUES (v_enterprise_id, v_name, p_description, p_price)
  RETURNING * INTO v_product;
  RETURN QUERY SELECT 'success', v_product.id, v_product.version;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_internal_product(
  p_id UUID, p_expected_version BIGINT, p_name TEXT, p_description TEXT,
  p_price NUMERIC, p_images JSONB DEFAULT '[]'
)
RETURNS TABLE(status TEXT, product_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enterprise_id UUID; v_product public.products%ROWTYPE; v_name TEXT;
BEGIN
  v_name := pg_catalog.btrim(p_name);
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
     OR v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 255
     OR (p_description IS NOT NULL AND pg_catalog.length(p_description) > 3000)
     OR (p_price IS NOT NULL AND (p_price < 0 OR p_price > 1000000))
     OR p_images IS DISTINCT FROM '[]'::JSONB THEN
    RETURN QUERY SELECT 'invalid_input', p_id, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_product_context('products.write');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied', p_id, NULL::BIGINT; RETURN;
  END IF;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.id = p_id AND product.enterprise_id = v_enterprise_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_product.active THEN
    RETURN QUERY SELECT 'product_unavailable', p_id, NULL::BIGINT; RETURN;
  END IF;
  IF v_product.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict', v_product.id, v_product.version; RETURN;
  END IF;
  UPDATE public.products AS product
  SET name = v_name, description = p_description, price = p_price
  WHERE product.id = v_product.id
  RETURNING * INTO v_product;
  RETURN QUERY SELECT 'success', v_product.id, v_product.version;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_internal_product_active(
  p_id UUID, p_expected_version BIGINT, p_active BOOLEAN
)
RETURNS TABLE(status TEXT, product_id UUID, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enterprise_id UUID; v_product public.products%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_active IS NULL THEN
    RETURN QUERY SELECT 'invalid_input', p_id, NULL::BIGINT; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_product_context('products.delete');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied', p_id, NULL::BIGINT; RETURN;
  END IF;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.id = p_id AND product.enterprise_id = v_enterprise_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'product_unavailable', p_id, NULL::BIGINT; RETURN;
  END IF;
  IF v_product.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict', v_product.id, v_product.version; RETURN;
  END IF;
  IF v_product.active IS NOT DISTINCT FROM p_active THEN
    RETURN QUERY SELECT 'success', v_product.id, v_product.version; RETURN;
  END IF;
  UPDATE public.products AS product
  SET active = p_active
  WHERE product.id = v_product.id
  RETURNING * INTO v_product;
  RETURN QUERY SELECT 'success', v_product.id, v_product.version;
END;
$$;

ALTER FUNCTION public.internal_products_set_updated_at() OWNER TO postgres;
ALTER FUNCTION public.internal_products_increment_version() OWNER TO postgres;
ALTER FUNCTION public.internal_product_enterprise_guard() OWNER TO postgres;
ALTER FUNCTION public.internal_product_image_ownership_guard() OWNER TO postgres;
ALTER FUNCTION private.lock_internal_product_context(TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_internal_product(TEXT, TEXT, NUMERIC, JSONB) OWNER TO postgres;
ALTER FUNCTION public.update_internal_product(UUID, BIGINT, TEXT, TEXT, NUMERIC, JSONB) OWNER TO postgres;
ALTER FUNCTION public.set_internal_product_active(UUID, BIGINT, BOOLEAN) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.internal_products_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_products_increment_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_product_enterprise_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.internal_product_image_ownership_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lock_internal_product_context(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_internal_product(TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_internal_product(UUID, BIGINT, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_internal_product_active(UUID, BIGINT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_internal_product(TEXT, TEXT, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_internal_product(UUID, BIGINT, TEXT, TEXT, NUMERIC, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_internal_product_active(UUID, BIGINT, BOOLEAN) TO authenticated;

-- Storage is optional in this dev schema. If storage.objects exists, block writes
-- only for these bucket names and do not affect unrelated buckets. No bucket or
-- object is created, moved, renamed, deleted, or modified here.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Upload to Products Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Update to Products Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Delete from Products Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Upload to Catalogs Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Update to Catalogs Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated Delete from Catalogs Bucket" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS internal_storage_block_product_catalog_inserts ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS internal_storage_block_product_catalog_updates ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS internal_storage_block_product_catalog_deletes ON storage.objects';
    EXECUTE $policy$CREATE POLICY internal_storage_block_product_catalog_inserts
      ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id NOT IN ('products', 'catalogs'))$policy$;
    EXECUTE $policy$CREATE POLICY internal_storage_block_product_catalog_updates
      ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
      USING (bucket_id NOT IN ('products', 'catalogs'))
      WITH CHECK (bucket_id NOT IN ('products', 'catalogs'))$policy$;
    EXECUTE $policy$CREATE POLICY internal_storage_block_product_catalog_deletes
      ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
      USING (bucket_id NOT IN ('products', 'catalogs'))$policy$;
  END IF;
END $$;

COMMIT;

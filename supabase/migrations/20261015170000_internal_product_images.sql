-- Internal product images. Review and apply manually; this migration is never run by the app.
BEGIN;

DO $$
DECLARE v_bucket storage.buckets%ROWTYPE;
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'internal product images requires Supabase storage';
  END IF;
  SELECT bucket.* INTO v_bucket FROM storage.buckets AS bucket WHERE bucket.id = 'internal-product-images';
  IF FOUND AND (v_bucket.public IS DISTINCT FROM false OR v_bucket.file_size_limit IS DISTINCT FROM 5242880
    OR v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::text[]) THEN
    RAISE EXCEPTION 'internal-product-images has incompatible settings';
  END IF;
  IF NOT FOUND THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('internal-product-images', 'internal-product-images', false, 5242880, ARRAY['image/webp']::text[]);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id') THEN
    RAISE EXCEPTION 'storage.objects.owner_id is required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_images AS image WHERE image.url IS NOT NULL AND btrim(image.url) <> ''
    AND image.url !~ '^enterprise/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$') THEN
    RAISE EXCEPTION 'unsafe legacy product image URLs require manual review';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_images' AND column_name = 'storage_path') THEN
    ALTER TABLE public.product_images ADD COLUMN storage_path text;
  END IF;
  UPDATE public.product_images AS image SET storage_path = NULLIF(btrim(image.url), '') WHERE image.storage_path IS NULL;
  ALTER TABLE public.product_images DROP CONSTRAINT IF EXISTS product_images_product_url_key;
  ALTER TABLE public.product_images ALTER COLUMN storage_path SET NOT NULL;
  ALTER TABLE public.product_images DROP COLUMN IF EXISTS url;
END $$;

ALTER TABLE public.product_images DROP CONSTRAINT IF EXISTS product_images_product_order_key;
ALTER TABLE public.product_images ADD CONSTRAINT product_images_product_order_key UNIQUE (product_id, display_order) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.product_images DROP CONSTRAINT IF EXISTS product_images_storage_path_check;
ALTER TABLE public.product_images ADD CONSTRAINT product_images_storage_path_check CHECK (storage_path ~ '^enterprise/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$');
CREATE UNIQUE INDEX IF NOT EXISTS product_images_storage_path_key ON public.product_images(storage_path);

CREATE TABLE IF NOT EXISTS public.internal_product_image_uploads (
  storage_path text PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  product_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.internal_product_image_tombstones (
  storage_path text PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  product_id uuid NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid NOT NULL
);
ALTER TABLE public.internal_product_image_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_product_image_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_product_image_uploads, public.internal_product_image_tombstones FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.internal_product_image_path(p_path text)
RETURNS TABLE(enterprise_id uuid, product_id uuid, image_uuid uuid)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_path IS NULL OR p_path !~ '^enterprise/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$' THEN RETURN; END IF;
  enterprise_id := split_part(p_path, '/', 2)::uuid;
  product_id := split_part(p_path, '/', 4)::uuid;
  image_uuid := split_part(split_part(p_path, '/', 5), '.', 1)::uuid;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION private.check_internal_product_upload_auth(p_storage_path text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_upload public.internal_product_image_uploads%ROWTYPE; v_path record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_upload FROM public.internal_product_image_uploads
  WHERE storage_path = p_storage_path AND user_id = v_uid AND expires_at >= now();
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT parsed.* INTO v_path FROM private.internal_product_image_path(p_storage_path) AS parsed;
  IF NOT FOUND OR v_path.enterprise_id <> v_upload.enterprise_id OR v_path.product_id <> v_upload.product_id THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products AS product WHERE product.id = v_upload.product_id AND product.enterprise_id = v_upload.enterprise_id AND product.active) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.product_images AS image WHERE image.storage_path = p_storage_path) OR EXISTS (SELECT 1 FROM public.internal_product_image_tombstones AS tombstone WHERE tombstone.storage_path = p_storage_path) THEN RETURN false; END IF;
  RETURN private.can_access_enterprise(v_upload.enterprise_id, 'products.write');
END $$;

CREATE OR REPLACE FUNCTION private.check_internal_product_tombstone_auth(p_storage_path text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_tombstone public.internal_product_image_tombstones%ROWTYPE; v_path record;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_tombstone FROM public.internal_product_image_tombstones
  WHERE storage_path = p_storage_path AND removed_by = v_uid;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT parsed.* INTO v_path FROM private.internal_product_image_path(p_storage_path) AS parsed;
  IF NOT FOUND OR v_path.enterprise_id <> v_tombstone.enterprise_id OR v_path.product_id <> v_tombstone.product_id THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.product_images WHERE storage_path = p_storage_path) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products AS product WHERE product.id = v_tombstone.product_id AND product.enterprise_id = v_tombstone.enterprise_id AND product.active) THEN RETURN false; END IF;
  RETURN private.can_access_enterprise(v_tombstone.enterprise_id, 'products.write');
END $$;

CREATE OR REPLACE FUNCTION private.check_internal_product_image_read_auth(p_storage_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.product_images image WHERE image.storage_path = p_storage_path AND private.can_access_enterprise(image.enterprise_id, 'products.read'))
    OR private.check_internal_product_upload_auth(p_storage_path)
    OR private.check_internal_product_tombstone_auth(p_storage_path);
END $$;

CREATE OR REPLACE FUNCTION private.lock_internal_product_image_context(p_product_id uuid, p_permission text)
RETURNS TABLE(enterprise_id uuid, product_id uuid, version bigint, active boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_issuer text := auth.jwt() ->> 'iss'; v_identity public.auth_identities%ROWTYPE;
  v_user public.users%ROWTYPE; v_context record; v_member public.enterprise_members%ROWTYPE; v_enterprise public.enterprises%ROWTYPE; v_product public.products%ROWTYPE;
BEGIN
  IF p_product_id IS NULL OR p_permission IS NULL OR p_permission NOT IN ('products.write', 'products.delete') OR v_uid IS NULL OR coalesce(btrim(v_issuer), '') = '' THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || v_uid::text, 0));
  SELECT identity.* INTO v_identity FROM public.auth_identities AS identity JOIN private.auth_issuer_config AS issuer ON issuer.issuer = identity.issuer AND issuer.provider = 'supabase' AND issuer.status = 'active'
   WHERE identity.provider = 'supabase' AND identity.issuer = v_issuer AND identity.subject = v_uid::text AND identity.status = 'active' FOR UPDATE OF identity;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT person.* INTO v_user FROM public.users AS person WHERE person.id = v_identity.user_id FOR UPDATE;
  SELECT context.* INTO v_context FROM public.get_my_access_context() AS context;
  SELECT member.* INTO v_member FROM public.enterprise_members AS member WHERE member.user_id = v_user.id AND member.enterprise_id = v_context.enterprise_id AND member.status = 'active' FOR UPDATE;
  SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise WHERE enterprise.id = v_member.enterprise_id AND enterprise.status = 'active' FOR UPDATE;
  SELECT product.* INTO v_product FROM public.products AS product WHERE product.id = p_product_id AND product.enterprise_id = v_enterprise.id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.must_change_password OR v_context.state <> 'business_ready' OR NOT private.can_access_enterprise(v_enterprise.id, p_permission) THEN RETURN; END IF;
  enterprise_id := v_enterprise.id; product_id := v_product.id; version := v_product.version; active := v_product.active; RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_internal_product_image_upload(p_product_id uuid, p_expected_version bigint)
RETURNS TABLE(status text, storage_path text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record; v_path text;
BEGIN
  IF p_product_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 THEN RETURN QUERY SELECT 'invalid_input', NULL::text, NULL::bigint; RETURN; END IF;
  SELECT context.* INTO v_context FROM private.lock_internal_product_image_context(p_product_id, 'products.write') AS context;
  IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied', NULL::text, NULL::bigint; RETURN; END IF;
  IF NOT v_context.active THEN RETURN QUERY SELECT 'product_unavailable', NULL::text, NULL::bigint; RETURN; END IF;
  IF v_context.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict', NULL::text, v_context.version; RETURN; END IF;
  v_path := 'enterprise/' || v_context.enterprise_id || '/products/' || v_context.product_id || '/' || gen_random_uuid() || '.webp';
  INSERT INTO public.internal_product_image_uploads AS upload (storage_path, enterprise_id, product_id, user_id, expires_at)
  VALUES (v_path, v_context.enterprise_id, v_context.product_id, auth.uid(), now() + interval '10 minutes');
  RETURN QUERY SELECT 'success', v_path, v_context.version;
END $$;

CREATE OR REPLACE FUNCTION public.link_internal_product_image(p_product_id uuid, p_expected_version bigint, p_storage_path text, p_display_order smallint)
RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record; v_path record; v_object storage.objects%ROWTYPE; v_count integer; v_new_version bigint;
BEGIN
  SELECT path.* INTO v_path FROM private.internal_product_image_path(p_storage_path) AS path;
  IF p_product_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_display_order IS NULL OR p_display_order NOT BETWEEN 1 AND 3 OR NOT FOUND THEN RETURN QUERY SELECT 'invalid_input', NULL::bigint; RETURN; END IF;
  SELECT context.* INTO v_context FROM private.lock_internal_product_image_context(p_product_id, 'products.write') AS context;
  IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied', NULL::bigint; RETURN; END IF;
  IF NOT v_context.active THEN RETURN QUERY SELECT 'product_unavailable', NULL::bigint; RETURN; END IF;
  IF v_context.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict', v_context.version; RETURN; END IF;
  IF v_path.enterprise_id <> v_context.enterprise_id OR v_path.product_id <> v_context.product_id THEN RETURN QUERY SELECT 'invalid_input', NULL::bigint; RETURN; END IF;
  IF p_display_order IS NULL THEN RETURN QUERY SELECT 'invalid_input', NULL::bigint; RETURN; END IF;
  SELECT object.* INTO v_object FROM storage.objects AS object WHERE object.bucket_id = 'internal-product-images' AND object.name = p_storage_path FOR UPDATE;
  IF NOT FOUND OR v_object.owner_id IS DISTINCT FROM auth.uid()::text
     OR (v_object.metadata ->> 'mimetype') IS DISTINCT FROM 'image/webp' THEN
    RETURN QUERY SELECT 'image_unavailable', NULL::bigint; RETURN;
  END IF;
  -- Separate statements: never depend on boolean evaluation order for casts.
  IF (v_object.metadata ->> 'size') IS NULL
     OR (v_object.metadata ->> 'size') !~ '^[0-9]{1,7}$' THEN
    RETURN QUERY SELECT 'image_unavailable', NULL::bigint; RETURN;
  END IF;
  IF (v_object.metadata ->> 'size')::bigint NOT BETWEEN 1 AND 5242880 THEN
    RETURN QUERY SELECT 'image_unavailable', NULL::bigint; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.internal_product_image_tombstones AS tombstone WHERE tombstone.storage_path = p_storage_path) THEN RETURN QUERY SELECT 'image_conflict', NULL::bigint; RETURN; END IF;
  -- Validate order availability BEFORE consuming upload authorization
  SELECT count(*) INTO v_count FROM public.product_images AS image WHERE image.product_id = v_context.product_id;
  IF v_count >= 3 THEN RETURN QUERY SELECT 'image_limit_reached', NULL::bigint; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.product_images AS image WHERE image.product_id = v_context.product_id AND image.display_order = p_display_order) THEN RETURN QUERY SELECT 'image_conflict', NULL::bigint; RETURN; END IF;
  -- Consume upload authorization only after all validations pass
  DELETE FROM public.internal_product_image_uploads AS upload WHERE upload.storage_path = p_storage_path AND upload.user_id = auth.uid() AND upload.expires_at >= now();
  IF NOT FOUND THEN RETURN QUERY SELECT 'image_unavailable', NULL::bigint; RETURN; END IF;
  INSERT INTO public.product_images (enterprise_id, product_id, storage_path, display_order) VALUES (v_context.enterprise_id, v_context.product_id, p_storage_path, p_display_order);
  SET CONSTRAINTS public.product_images_product_order_key IMMEDIATE;
  UPDATE public.products AS product SET updated_at = now() WHERE product.id = v_context.product_id RETURNING product.version INTO v_new_version;
  RETURN QUERY SELECT 'success', v_new_version;
EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'image_conflict', NULL::bigint;
END $$;

CREATE OR REPLACE FUNCTION public.remove_internal_product_image(p_product_id uuid, p_expected_version bigint, p_image_id uuid)
RETURNS TABLE(status text, version bigint, storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record; v_image public.product_images%ROWTYPE; v_new_version bigint;
BEGIN
  IF p_product_id IS NULL OR p_image_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 THEN RETURN QUERY SELECT 'invalid_input', NULL::bigint, NULL::text; RETURN; END IF;
  SELECT context.* INTO v_context FROM private.lock_internal_product_image_context(p_product_id, 'products.write') AS context;
  IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied', NULL::bigint, NULL::text; RETURN; END IF;
  IF NOT v_context.active THEN RETURN QUERY SELECT 'product_unavailable', NULL::bigint, NULL::text; RETURN; END IF;
  IF v_context.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict', v_context.version, NULL::text; RETURN; END IF;
  SELECT image.* INTO v_image FROM public.product_images AS image WHERE image.id = p_image_id AND image.product_id = v_context.product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'image_unavailable', NULL::bigint, NULL::text; RETURN; END IF;
  DELETE FROM public.product_images AS image WHERE image.id = v_image.id;
  INSERT INTO public.internal_product_image_tombstones AS tombstone (storage_path, enterprise_id, product_id, removed_by) VALUES (v_image.storage_path, v_context.enterprise_id, v_context.product_id, auth.uid());
  UPDATE public.products AS product SET updated_at = now() WHERE product.id = v_context.product_id RETURNING product.version INTO v_new_version;
  RETURN QUERY SELECT 'success', v_new_version, v_image.storage_path;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_internal_product_image(p_product_id uuid, p_expected_version bigint, p_image_id uuid, p_new_order smallint)
RETURNS TABLE(status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_context record; v_image public.product_images%ROWTYPE; v_existing public.product_images%ROWTYPE; v_new_version bigint;
BEGIN
  IF p_product_id IS NULL OR p_image_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_new_order IS NULL OR p_new_order NOT BETWEEN 1 AND 3 THEN RETURN QUERY SELECT 'invalid_input', NULL::bigint; RETURN; END IF;
  SELECT context.* INTO v_context FROM private.lock_internal_product_image_context(p_product_id, 'products.write') AS context;
  IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied', NULL::bigint; RETURN; END IF;
  IF NOT v_context.active THEN RETURN QUERY SELECT 'product_unavailable', NULL::bigint; RETURN; END IF;
  IF v_context.version <> p_expected_version THEN RETURN QUERY SELECT 'version_conflict', v_context.version; RETURN; END IF;
  SELECT image.* INTO v_image FROM public.product_images AS image WHERE image.id = p_image_id AND image.product_id = v_context.product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'image_unavailable', NULL::bigint; RETURN; END IF;
  SELECT image.* INTO v_existing FROM public.product_images AS image WHERE image.product_id = v_context.product_id AND image.display_order = p_new_order FOR UPDATE;
  IF v_image.display_order <> p_new_order THEN
    IF FOUND THEN
      SET CONSTRAINTS public.product_images_product_order_key DEFERRED;
      UPDATE public.product_images AS image
      SET display_order = CASE
        WHEN image.id = v_image.id THEN p_new_order
        WHEN image.id = v_existing.id THEN v_image.display_order
      END
      WHERE image.id IN (v_image.id, v_existing.id);
    ELSE
      SET CONSTRAINTS public.product_images_product_order_key DEFERRED;
      UPDATE public.product_images AS image SET display_order = p_new_order WHERE image.id = v_image.id;
    END IF;
  END IF;
  SET CONSTRAINTS public.product_images_product_order_key IMMEDIATE;
  UPDATE public.products AS product SET updated_at = now() WHERE product.id = v_context.product_id RETURNING product.version INTO v_new_version;
  RETURN QUERY SELECT 'success', v_new_version;
EXCEPTION WHEN unique_violation THEN RETURN QUERY SELECT 'image_conflict', NULL::bigint;
END $$;

ALTER FUNCTION private.internal_product_image_path(text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_upload_auth(text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_tombstone_auth(text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_image_read_auth(text) OWNER TO postgres;
ALTER FUNCTION private.lock_internal_product_image_context(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.prepare_internal_product_image_upload(uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.link_internal_product_image(uuid,bigint,text,smallint) OWNER TO postgres;
ALTER FUNCTION public.remove_internal_product_image(uuid,bigint,uuid) OWNER TO postgres;
ALTER FUNCTION public.reorder_internal_product_image(uuid,bigint,uuid,smallint) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.internal_product_image_path(text), private.check_internal_product_upload_auth(text), private.check_internal_product_tombstone_auth(text), private.check_internal_product_image_read_auth(text), private.lock_internal_product_image_context(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.check_internal_product_upload_auth(text), private.check_internal_product_tombstone_auth(text), private.check_internal_product_image_read_auth(text) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_internal_product_image_upload(uuid,bigint), public.link_internal_product_image(uuid,bigint,text,smallint), public.remove_internal_product_image(uuid,bigint,uuid), public.reorder_internal_product_image(uuid,bigint,uuid,smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_internal_product_image_upload(uuid,bigint), public.link_internal_product_image(uuid,bigint,text,smallint), public.remove_internal_product_image(uuid,bigint,uuid), public.reorder_internal_product_image(uuid,bigint,uuid,smallint) TO authenticated;

REVOKE ALL ON TABLE public.product_images FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, enterprise_id, product_id, storage_path, display_order, created_at, updated_at) ON public.product_images TO authenticated;

DROP POLICY IF EXISTS internal_product_image_storage_select ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_insert ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_delete ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_no_update ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_select_scope ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_insert_scope ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_delete_scope ON storage.objects;
DROP POLICY IF EXISTS internal_product_image_storage_anon_deny ON storage.objects;

-- Permissive policies admit this bucket; restrictive policies constrain it even if
-- another migration adds a broad storage.objects policy. Bucket configuration
-- validates MIME type and size because preflight cannot safely rely on metadata.
CREATE POLICY internal_product_image_storage_select ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'internal-product-images');
CREATE POLICY internal_product_image_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'internal-product-images' AND owner_id = auth.uid()::text);
CREATE POLICY internal_product_image_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'internal-product-images');
CREATE POLICY internal_product_image_storage_select_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (bucket_id <> 'internal-product-images' OR private.check_internal_product_image_read_auth(name));
CREATE POLICY internal_product_image_storage_insert_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (bucket_id <> 'internal-product-images' OR (owner_id = auth.uid()::text AND private.check_internal_product_upload_auth(name)));
CREATE POLICY internal_product_image_storage_delete_scope ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING (bucket_id <> 'internal-product-images' OR private.check_internal_product_tombstone_auth(name));
CREATE POLICY internal_product_image_storage_anon_deny ON storage.objects AS RESTRICTIVE FOR ALL TO anon USING (bucket_id <> 'internal-product-images') WITH CHECK (bucket_id <> 'internal-product-images');
CREATE POLICY internal_product_image_storage_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (bucket_id <> 'internal-product-images') WITH CHECK (bucket_id <> 'internal-product-images');
COMMIT;

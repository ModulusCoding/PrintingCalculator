-- Product-window enforcement for SECURITY DEFINER CRUD and image entry points.
-- Existing SELECT RLS already hides old product URLs. Do not change the generic
-- context lock: it also serves creation and has no product id. Reuse its locks
-- unchanged, then evaluate the same predicate as SELECT RLS on the locked row.
-- No universal trigger: pricing/application/admin and fixture writes stay intact.
BEGIN;

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
  -- Before version disclosure or mutation; includes soft-deleted products.
  IF NOT private.stage6b_product_visible(v_enterprise_id, v_product.id) THEN
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
  IF NOT private.stage6b_product_visible(v_enterprise_id, v_product.id) THEN
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

CREATE OR REPLACE FUNCTION public.delete_internal_product(p_attempt_id uuid,p_id uuid,p_expected_version bigint)
RETURNS TABLE(status text,product_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;r jsonb;p jsonb:=jsonb_build_object('id',p_id,'expected_version',p_expected_version);x public.products%ROWTYPE;
BEGIN IF p_attempt_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_internal_product_context('products.write'); IF e IS NULL OR NOT private.can_access_enterprise(e,'products.delete') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); SELECT result INTO r FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product' FOR UPDATE; IF FOUND THEN IF (SELECT payload FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product')<>p THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT r->>'status',(r->>'product_id')::uuid,(r->>'version')::bigint; RETURN; END IF;
SELECT * INTO x FROM public.products WHERE enterprise_id=e AND id=p_id FOR UPDATE; IF NOT FOUND OR x.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF;
-- Receipt recovery above MUST precede visibility (the successful delete itself
-- removes the row from the window). New attempts cannot mutate hidden rows.
IF NOT private.stage6b_product_visible(e,x.id) THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF;
IF x.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
IF EXISTS(SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=e AND i.product_id=p_id AND i.balance<>0) THEN RAISE EXCEPTION 'balance_not_zero' USING ERRCODE='22023'; END IF;
IF EXISTS(SELECT 1 FROM public.internal_product_image_uploads u WHERE u.enterprise_id=e AND u.product_id=p_id AND u.expires_at>=now()) THEN RAISE EXCEPTION 'pending_image_upload' USING ERRCODE='55000'; END IF;
-- Tombstones represent already-removed objects and intentionally do not block deletion. Future reservation tables must add equivalent guards.
UPDATE public.products SET deleted_at=now(),deleted_by=a WHERE id=p_id AND enterprise_id=e RETURNING * INTO x; r:=jsonb_build_object('status','deleted','product_id',x.id,'version',x.version); INSERT INTO private.stage5_delete_receipts VALUES(e,a,p_attempt_id,'product',p,r,now()); RETURN QUERY SELECT 'deleted',x.id,x.version; END $$;

-- All four image mutation RPCs use this helper. Preserve its identity/tenant
-- checks and lock order instead of rewriting their independent upload/order logic.
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
  IF NOT private.stage6b_product_visible(v_enterprise.id, v_product.id) THEN RETURN; END IF;
  enterprise_id := v_enterprise.id; product_id := v_product.id; version := v_product.version; active := v_product.active; RETURN NEXT;
END $$;

-- Storage policies call these helpers, not products RLS. Pending upload grants
-- and tombstones must not become a bypass when a product leaves the window.
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
  IF NOT private.stage6b_product_visible(v_upload.enterprise_id, v_upload.product_id) THEN RETURN false; END IF;
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
  IF NOT private.stage6b_product_visible(v_tombstone.enterprise_id, v_tombstone.product_id) THEN RETURN false; END IF;
  RETURN private.can_access_enterprise(v_tombstone.enterprise_id, 'products.write');
END $$;

CREATE OR REPLACE FUNCTION private.check_internal_product_image_read_auth(p_storage_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.product_images image WHERE image.storage_path = p_storage_path AND private.can_access_enterprise(image.enterprise_id, 'products.read') AND private.stage6b_product_visible(image.enterprise_id, image.product_id))
    OR private.check_internal_product_upload_auth(p_storage_path)
    OR private.check_internal_product_tombstone_auth(p_storage_path);
END $$;

-- CREATE OR REPLACE preserves existing grants and signatures. Keep ownership
-- explicit without granting new capabilities to authenticated or service_role.
ALTER FUNCTION public.update_internal_product(uuid,bigint,text,text,numeric,jsonb) OWNER TO postgres;
ALTER FUNCTION public.set_internal_product_active(uuid,bigint,boolean) OWNER TO postgres;
ALTER FUNCTION public.delete_internal_product(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION private.lock_internal_product_image_context(uuid,text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_upload_auth(text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_tombstone_auth(text) OWNER TO postgres;
ALTER FUNCTION private.check_internal_product_image_read_auth(text) OWNER TO postgres;
COMMIT;

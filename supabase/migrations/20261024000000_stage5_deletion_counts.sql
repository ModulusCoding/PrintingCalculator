-- Etapa 5: soft deletion, idempotent delete receipts and authoritative dashboard counts.
-- Deliberately unexecuted. Deletion preserves all rows/FKs/history; archived (active=false)
-- remains a separate reversible state. Pending pricing/apply modules must not reference
-- a row at deletion time; future reservation tables must be added to these guards.
BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE RESTRICT;
ALTER TABLE public.filament_spools ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE RESTRICT;
ALTER TABLE public.general_materials ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS products_not_deleted_idx ON public.products(enterprise_id,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS filament_spools_not_deleted_idx ON public.filament_spools(enterprise_id,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS general_materials_not_deleted_idx ON public.general_materials(enterprise_id,id) WHERE deleted_at IS NULL;

-- Delete permissions are intentionally distinct from archive permissions.
CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id uuid,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT p_enterprise_id IS NOT NULL AND p_permission IS NOT NULL
 AND (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id WHERE em.user_id=private.current_internal_user_id() AND em.status='active' AND e.status='active')
 AND EXISTS(SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id JOIN public.enterprises e ON e.id=em.enterprise_id WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id() AND em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active' AND CASE p_permission
 WHEN 'products.read' THEN em.role IN('owner','admin','operator') WHEN 'products.write' THEN em.role IN('owner','admin','operator') WHEN 'products.delete' THEN em.role IN('owner','admin')
 WHEN 'catalogs.read' THEN em.role IN('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN('owner','admin') WHEN 'filters.read' THEN em.role IN('owner','admin','operator') WHEN 'filters.write' THEN em.role IN('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN('owner','admin')
 WHEN 'sales.read' THEN em.role IN('owner','admin','operator') WHEN 'sales.write' THEN em.role IN('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN('owner','admin') WHEN 'printers.read' THEN em.role IN('owner','admin','operator') WHEN 'printers.write' THEN em.role IN('owner','admin') WHEN 'printers.archive' THEN em.role IN('owner','admin')
 WHEN 'materials.read' THEN em.role IN('owner','admin','operator') WHEN 'materials.write' THEN em.role IN('owner','admin') WHEN 'materials.archive' THEN em.role IN('owner','admin') WHEN 'pricing.read' THEN em.role IN('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN('owner','admin','operator')
 WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'enterprise.pricing_loss.write' THEN em.role IN('owner','admin') WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN('owner','admin')
 WHEN 'spools.read' THEN em.role IN('owner','admin','operator') WHEN 'spools.write' THEN em.role IN('owner','admin','operator') WHEN 'spools.archive' THEN em.role IN('owner','admin') WHEN 'spools.delete' THEN em.role IN('owner','admin')
 WHEN 'inventory.read' THEN em.role IN('owner','admin','operator') WHEN 'inventory.write' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.read' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.write' THEN em.role IN('owner','admin','operator') WHEN 'stock.materials.archive' THEN em.role IN('owner','admin') WHEN 'stock.materials.delete' THEN em.role IN('owner','admin') ELSE false END);
$$;
ALTER FUNCTION private.can_access_enterprise(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_enterprise(uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION private.can_access_enterprise(uuid,text) TO authenticated;

CREATE TABLE IF NOT EXISTS private.stage5_delete_receipts(enterprise_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,attempt_id uuid NOT NULL,entity text NOT NULL CHECK(entity IN('product','spool','general_material')),payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(enterprise_id,actor_id,attempt_id,entity));
ALTER TABLE private.stage5_delete_receipts OWNER TO postgres; ALTER TABLE private.stage5_delete_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stage5_delete_receipts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.delete_internal_product(p_attempt_id uuid,p_id uuid,p_expected_version bigint)
RETURNS TABLE(status text,product_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;r jsonb;p jsonb:=jsonb_build_object('id',p_id,'expected_version',p_expected_version);x public.products%ROWTYPE;
BEGIN IF p_attempt_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_internal_product_context('products.write'); IF e IS NULL OR NOT private.can_access_enterprise(e,'products.delete') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); SELECT result INTO r FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product' FOR UPDATE; IF FOUND THEN IF (SELECT payload FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product')<>p THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT r->>'status',(r->>'product_id')::uuid,(r->>'version')::bigint; RETURN; END IF;
SELECT * INTO x FROM public.products WHERE enterprise_id=e AND id=p_id FOR UPDATE; IF NOT FOUND OR x.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF; IF x.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
IF EXISTS(SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=e AND i.product_id=p_id AND i.balance<>0) THEN RAISE EXCEPTION 'balance_not_zero' USING ERRCODE='22023'; END IF;
IF EXISTS(SELECT 1 FROM public.internal_product_image_uploads u WHERE u.enterprise_id=e AND u.product_id=p_id AND u.expires_at>=now()) THEN RAISE EXCEPTION 'pending_image_upload' USING ERRCODE='55000'; END IF;
-- Tombstones represent already-removed objects and intentionally do not block deletion. Future reservation tables must add equivalent guards.
UPDATE public.products SET deleted_at=now(),deleted_by=a WHERE id=p_id AND enterprise_id=e RETURNING * INTO x; r:=jsonb_build_object('status','deleted','product_id',x.id,'version',x.version); INSERT INTO private.stage5_delete_receipts VALUES(e,a,p_attempt_id,'product',p,r,now()); RETURN QUERY SELECT 'deleted',x.id,x.version; END $$;

CREATE OR REPLACE FUNCTION public.delete_filament_spool(p_attempt_id uuid,p_spool_id uuid,p_expected_version bigint)
RETURNS TABLE(status text,spool_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;r jsonb;p jsonb:=jsonb_build_object('spool_id',p_spool_id,'expected_version',p_expected_version);x public.filament_spools%ROWTYPE;
BEGIN IF p_attempt_id IS NULL OR p_spool_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_filament_spool_context('spools.archive'); IF e IS NULL OR NOT private.can_access_enterprise(e,'spools.delete') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); SELECT result INTO r FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='spool' FOR UPDATE; IF FOUND THEN IF (SELECT payload FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='spool')<>p THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT r->>'status',(r->>'spool_id')::uuid,(r->>'version')::bigint; RETURN; END IF;
SELECT * INTO x FROM public.filament_spools WHERE enterprise_id=e AND id=p_spool_id FOR UPDATE; IF NOT FOUND OR x.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE='P0002'; END IF; IF x.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; IF x.current_balance_grams<>0 THEN RAISE EXCEPTION 'balance_not_zero' USING ERRCODE='22023'; END IF;
UPDATE public.filament_spools SET deleted_at=now(),deleted_by=a WHERE id=p_spool_id AND enterprise_id=e RETURNING * INTO x; r:=jsonb_build_object('status','deleted','spool_id',x.id,'version',x.version); INSERT INTO private.stage5_delete_receipts VALUES(e,a,p_attempt_id,'spool',p,r,now()); RETURN QUERY SELECT 'deleted',x.id,x.version; END $$;

CREATE OR REPLACE FUNCTION public.delete_general_material(p_attempt_id uuid,p_material_id uuid,p_expected_version bigint)
RETURNS TABLE(status text,material_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid;a uuid;r jsonb;p jsonb:=jsonb_build_object('material_id',p_material_id,'expected_version',p_expected_version);x public.general_materials%ROWTYPE;
BEGIN IF p_attempt_id IS NULL OR p_material_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; e:=private.lock_general_material_context('stock.materials.archive'); IF e IS NULL OR NOT private.can_access_enterprise(e,'stock.materials.delete') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id(); SELECT result INTO r FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='general_material' FOR UPDATE; IF FOUND THEN IF (SELECT payload FROM private.stage5_delete_receipts WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='general_material')<>p THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; RETURN QUERY SELECT r->>'status',(r->>'material_id')::uuid,(r->>'version')::bigint; RETURN; END IF;
SELECT * INTO x FROM public.general_materials WHERE enterprise_id=e AND id=p_material_id FOR UPDATE; IF NOT FOUND OR x.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF; IF x.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; IF x.current_balance<>0 THEN RAISE EXCEPTION 'balance_not_zero' USING ERRCODE='22023'; END IF;
UPDATE public.general_materials SET deleted_at=now(),deleted_by=a WHERE id=p_material_id AND enterprise_id=e RETURNING * INTO x; r:=jsonb_build_object('status','deleted','material_id',x.id,'version',x.version); INSERT INTO private.stage5_delete_receipts VALUES(e,a,p_attempt_id,'general_material',p,r,now()); RETURN QUERY SELECT 'deleted',x.id,x.version; END $$;

-- Enforce deletion state even in pre-existing mutation RPCs (including pricing/inventory).
-- A row lock precedes all mutations in those RPCs; this guard rejects changes after deletion.
CREATE OR REPLACE FUNCTION public.stage5_product_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF; IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND (NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS stage5_product_guard ON public.products;
CREATE TRIGGER stage5_product_guard BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.stage5_product_guard();
CREATE OR REPLACE FUNCTION public.stage5_spool_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE='P0002'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage5_spool_guard BEFORE UPDATE ON public.filament_spools FOR EACH ROW EXECUTE FUNCTION public.stage5_spool_guard();
CREATE OR REPLACE FUNCTION public.stage5_general_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF; RETURN NEW; END $$;
CREATE TRIGGER stage5_general_guard BEFORE UPDATE ON public.general_materials FOR EACH ROW EXECUTE FUNCTION public.stage5_general_guard();

-- Guard product_inventory mutations against deleted products
CREATE OR REPLACE FUNCTION public.stage5_product_inventory_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_deleted timestamptz;
BEGIN
  SELECT deleted_at INTO v_deleted FROM public.products WHERE enterprise_id = NEW.enterprise_id AND id = NEW.product_id FOR SHARE;
  IF v_deleted IS NOT NULL THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stage5_product_inventory_guard ON public.product_inventory;
CREATE TRIGGER stage5_product_inventory_guard BEFORE INSERT OR UPDATE ON public.product_inventory FOR EACH ROW EXECUTE FUNCTION public.stage5_product_inventory_guard();

-- Guard pricing snapshot validation against deleted products/spools/materials
CREATE OR REPLACE FUNCTION public.stage5_pricing_guard(p_schema_version text, p_product_id uuid, p_spool_ids uuid[], p_general_material_ids uuid[])
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid; v_deleted timestamptz;
BEGIN
  SELECT deleted_at INTO v_deleted FROM public.products WHERE id = p_product_id FOR SHARE;
  IF v_deleted IS NOT NULL THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF;
  IF p_spool_ids IS NOT NULL THEN
    FOR v_id IN SELECT unnest(p_spool_ids) LOOP
      SELECT deleted_at INTO v_deleted FROM public.filament_spools WHERE id = v_id FOR SHARE;
      IF v_deleted IS NOT NULL THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE='P0002'; END IF;
    END LOOP;
  END IF;
  IF p_general_material_ids IS NOT NULL THEN
    FOR v_id IN SELECT unnest(p_general_material_ids) LOOP
      SELECT deleted_at INTO v_deleted FROM public.general_materials WHERE id = v_id FOR SHARE;
      IF v_deleted IS NOT NULL THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF;
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.stage5_pricing_calculation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products p WHERE p.enterprise_id=NEW.enterprise_id AND p.id=NEW.product_id AND p.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002'; END IF;
  FOR v_id IN SELECT q.id FROM jsonb_to_recordset(coalesce(NEW.snapshot->'spools','[]'::jsonb)) AS q(id uuid) LOOP
    IF EXISTS (SELECT 1 FROM public.filament_spools s WHERE s.enterprise_id=NEW.enterprise_id AND s.id=v_id AND s.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE='P0002'; END IF;
  END LOOP;
  FOR v_id IN SELECT q.id FROM jsonb_to_recordset(coalesce(NEW.snapshot->'general_materials','[]'::jsonb)) AS q(id uuid) LOOP
    IF EXISTS (SELECT 1 FROM public.general_materials m WHERE m.enterprise_id=NEW.enterprise_id AND m.id=v_id AND m.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'material_unavailable' USING ERRCODE='P0002'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stage5_pricing_calculation_guard ON public.pricing_calculations;
CREATE TRIGGER stage5_pricing_calculation_guard BEFORE INSERT ON public.pricing_calculations FOR EACH ROW EXECUTE FUNCTION public.stage5_pricing_calculation_guard();

-- Image upload/read eligibility must not authorize deleted products; tombstone cleanup remains eligible.
CREATE OR REPLACE FUNCTION private.check_internal_product_upload_auth(p_storage_path text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u public.internal_product_image_uploads%ROWTYPE; BEGIN SELECT * INTO u FROM public.internal_product_image_uploads WHERE storage_path=p_storage_path AND user_id=auth.uid() AND expires_at>=now(); RETURN FOUND AND EXISTS(SELECT 1 FROM public.products p WHERE p.id=u.product_id AND p.enterprise_id=u.enterprise_id AND p.active AND p.deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.product_images i WHERE i.storage_path=p_storage_path) AND NOT EXISTS(SELECT 1 FROM public.internal_product_image_tombstones t WHERE t.storage_path=p_storage_path) AND private.can_access_enterprise(u.enterprise_id,'products.write'); END $$;

-- Single SQL statement/snapshot. FDM reference materials (public.materials) are intentionally excluded.
CREATE OR REPLACE FUNCTION public.get_my_deletion_counts() RETURNS TABLE(products bigint,filament_spools bigint,general_materials bigint,shared_total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid; BEGIN SELECT c.enterprise_id INTO e FROM public.get_my_access_context() c WHERE c.state='business_ready'; IF e IS NULL OR NOT private.can_access_enterprise(e,'products.read') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; RETURN QUERY WITH counts AS (SELECT (SELECT count(*) FROM public.products p WHERE p.enterprise_id=e AND p.deleted_at IS NULL) AS products,(SELECT count(*) FROM public.filament_spools s WHERE s.enterprise_id=e AND s.deleted_at IS NULL) AS filament_spools,(SELECT count(*) FROM public.general_materials m WHERE m.enterprise_id=e AND m.deleted_at IS NULL) AS general_materials) SELECT counts.products,counts.filament_spools,counts.general_materials,counts.filament_spools+counts.general_materials FROM counts; END $$;

-- Enforce deleted_at implied operational exclusion in operational selectors and pricing paths
CREATE OR REPLACE FUNCTION public.list_filament_spools(p_search text DEFAULT '',p_status text DEFAULT 'active',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,material_id uuid,material_type text,brand text,color text,internal_identifier text,original_filament_grams numeric,current_balance_grams numeric,purchase_price numeric,active boolean,version bigint,created_at timestamptz,updated_at timestamptz,percent_remaining numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; t text:=btrim(coalesce(p_search,'')); threshold numeric;
BEGIN
 e:=private.read_filament_spool_context('spools.read'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_limit IS NULL OR p_offset IS NULL OR p_status NOT IN ('active','archived','all','low','empty') OR p_limit NOT BETWEEN 1 AND 50 OR p_offset NOT BETWEEN 0 AND 100000 OR length(t)>120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT en.low_spool_threshold_percent INTO threshold FROM public.enterprises AS en WHERE en.id=e;
 RETURN QUERY SELECT fs.id,fs.material_id,fs.material_type::text,fs.brand::text,fs.color::text,fs.internal_identifier::text,fs.original_filament_grams,fs.current_balance_grams,fs.purchase_price,fs.active,fs.version,fs.created_at,fs.updated_at,fs.current_balance_grams*100/fs.original_filament_grams FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.deleted_at IS NULL AND (t='' OR strpos(lower(fs.internal_identifier),lower(t))>0 OR strpos(lower(coalesce(fs.material_type,'')),lower(t))>0 OR strpos(lower(coalesce(fs.brand,'')),lower(t))>0 OR strpos(lower(coalesce(fs.color,'')),lower(t))>0) AND (p_status='all' OR (p_status='active' AND fs.active AND fs.current_balance_grams>0) OR (p_status='low' AND fs.active AND fs.current_balance_grams>0 AND fs.current_balance_grams*100/fs.original_filament_grams<=threshold) OR (p_status='empty' AND fs.active AND fs.current_balance_grams=0) OR (p_status='archived' AND NOT fs.active)) ORDER BY fs.created_at DESC,fs.id DESC LIMIT p_limit OFFSET p_offset;
END $$;
CREATE OR REPLACE FUNCTION public.count_filament_spools(p_search text DEFAULT '',p_status text DEFAULT 'active') RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid; t text:=btrim(coalesce(p_search,'')); threshold numeric; BEGIN e:=private.read_filament_spool_context('spools.read'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; IF p_status IS NULL OR p_status NOT IN ('active','archived','all','low','empty') OR length(t)>120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; SELECT en.low_spool_threshold_percent INTO threshold FROM public.enterprises AS en WHERE en.id=e; RETURN (SELECT count(*) FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.deleted_at IS NULL AND (t='' OR strpos(lower(fs.internal_identifier),lower(t))>0 OR strpos(lower(coalesce(fs.material_type,'')),lower(t))>0 OR strpos(lower(coalesce(fs.brand,'')),lower(t))>0 OR strpos(lower(coalesce(fs.color,'')),lower(t))>0) AND (p_status='all' OR (p_status='active' AND fs.active AND fs.current_balance_grams>0) OR (p_status='low' AND fs.active AND fs.current_balance_grams>0 AND fs.current_balance_grams*100/fs.original_filament_grams<=threshold) OR (p_status='empty' AND fs.active AND fs.current_balance_grams=0) OR (p_status='archived' AND NOT fs.active))); END $$;
CREATE OR REPLACE FUNCTION public.list_general_materials(p_search text DEFAULT '',p_status text DEFAULT 'active',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS SETOF public.general_materials LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT m.* FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND m.deleted_at IS NULL AND p_search IS NOT NULL AND p_status IN('all','active','archived') AND p_limit BETWEEN 1 AND 100 AND p_offset>=0 AND (p_search='' OR m.name ILIKE '%'||p_search||'%') AND (p_status='all' OR (p_status='active' AND m.active) OR (p_status='archived' AND NOT m.active)) ORDER BY m.created_at DESC,m.id LIMIT p_limit OFFSET p_offset $$;
CREATE OR REPLACE FUNCTION public.count_general_materials(p_search text DEFAULT '',p_status text DEFAULT 'active') RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT count(*) FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND m.deleted_at IS NULL AND p_search IS NOT NULL AND p_status IN('all','active','archived') AND (p_search='' OR m.name ILIKE '%'||p_search||'%') AND (p_status='all' OR (p_status='active' AND m.active) OR (p_status='archived' AND NOT m.active)) $$;
CREATE OR REPLACE FUNCTION public.get_general_material(p_material_id uuid) RETURNS SETOF public.general_materials LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT m.* FROM public.general_materials m WHERE private.read_general_material_context()=m.enterprise_id AND p_material_id IS NOT NULL AND m.id=p_material_id $$;


ALTER FUNCTION public.delete_internal_product(uuid,uuid,bigint) OWNER TO postgres; ALTER FUNCTION public.delete_filament_spool(uuid,uuid,bigint) OWNER TO postgres; ALTER FUNCTION public.delete_general_material(uuid,uuid,bigint) OWNER TO postgres; ALTER FUNCTION public.get_my_deletion_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_internal_product(uuid,uuid,bigint),public.delete_filament_spool(uuid,uuid,bigint),public.delete_general_material(uuid,uuid,bigint),public.get_my_deletion_counts() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.delete_internal_product(uuid,uuid,bigint),public.delete_filament_spool(uuid,uuid,bigint),public.delete_general_material(uuid,uuid,bigint),public.get_my_deletion_counts() TO authenticated;

-- Unexecuted SQL assertions (run in an isolated test database after migrations):
-- ASSERT deleted_at and deleted_by are nullable on all 3 domain tables.
-- ASSERT deleting does not DELETE domain/history rows, and attempted replay with different payload raises idempotency_conflict.
-- ASSERT nonzero balance and stale expected_version reject; deleted rows reject operational mutations.
-- ASSERT counts are one result/snapshot per tenant and exclude public.materials (FDM references).
COMMIT;

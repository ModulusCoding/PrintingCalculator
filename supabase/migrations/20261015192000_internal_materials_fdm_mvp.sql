-- Internal, tenant-owned FDM materials MVP. Review and apply explicitly; do not run automatically.
BEGIN;

DO $$ BEGIN
  IF pg_catalog.to_regclass('public.materials') IS NOT NULL THEN
    RAISE EXCEPTION 'internal materials migration aborted: public.materials already exists; review manually';
  END IF;
END $$;

CREATE TABLE public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  material_type VARCHAR(80) NOT NULL,
  brand VARCHAR(120),
  color VARCHAR(80),
  reference_weight_grams NUMERIC(12,3) NOT NULL,
  reference_price NUMERIC(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT materials_name_check CHECK (pg_catalog.btrim(name) = name AND pg_catalog.length(name) BETWEEN 2 AND 120),
  CONSTRAINT materials_type_check CHECK (pg_catalog.btrim(material_type) = material_type AND pg_catalog.length(material_type) BETWEEN 1 AND 80),
  CONSTRAINT materials_brand_check CHECK (brand IS NULL OR (pg_catalog.btrim(brand) = brand AND pg_catalog.length(brand) BETWEEN 1 AND 120)),
  CONSTRAINT materials_color_check CHECK (color IS NULL OR (pg_catalog.btrim(color) = color AND pg_catalog.length(color) BETWEEN 1 AND 80)),
  CONSTRAINT materials_weight_check CHECK (reference_weight_grams BETWEEN 0.001 AND 100000 AND reference_weight_grams::TEXT NOT IN ('NaN','Infinity','-Infinity')),
  CONSTRAINT materials_price_check CHECK (reference_price BETWEEN 0 AND 1000000 AND reference_price::TEXT NOT IN ('NaN','Infinity','-Infinity')),
  CONSTRAINT materials_version_check CHECK (version >= 0)
);
CREATE INDEX materials_enterprise_active_created_idx ON public.materials (enterprise_id, active, created_at DESC, id DESC);

CREATE FUNCTION public.internal_materials_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id THEN RAISE EXCEPTION 'material enterprise ownership is immutable' USING ERRCODE = '42501'; END IF;
  NEW.updated_at := pg_catalog.now(); NEW.version := OLD.version + 1; RETURN NEW;
END; $$;
CREATE TRIGGER materials_touch BEFORE UPDATE ON public.materials FOR EACH ROW EXECUTE FUNCTION public.internal_materials_touch();

-- Keep every existing permission and append only materials permissions.
CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN p_enterprise_id IS NULL OR p_permission IS NULL OR p_permission NOT IN (
  'products.read','products.write','products.delete','catalogs.read','catalogs.write','catalogs.delete','filters.read','filters.write','filters.delete','sales.read','sales.write','sales.delete','enterprise.manage','members.manage_admins','members.manage_operators','printers.read','printers.write','printers.archive','materials.read','materials.write','materials.archive','pricing.read','pricing.write','pricing.apply'
 ) THEN false ELSE (
   SELECT pg_catalog.count(*)=1 FROM public.enterprise_members AS eligible_em JOIN public.enterprises AS eligible_e ON eligible_e.id=eligible_em.enterprise_id
   WHERE eligible_em.user_id=private.current_internal_user_id() AND eligible_em.status='active' AND eligible_e.status='active'
 ) AND EXISTS (
   SELECT 1 FROM public.enterprise_members AS em JOIN public.users AS u ON u.id=em.user_id JOIN public.enterprises AS e ON e.id=em.enterprise_id
   WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id() AND em.status='active' AND u.status='active' AND e.status='active' AND u.must_change_password=false
   AND CASE p_permission
    WHEN 'products.read' THEN em.role IN ('owner','admin','operator') WHEN 'products.write' THEN em.role IN ('owner','admin','operator') WHEN 'products.delete' THEN em.role IN ('owner','admin')
    WHEN 'catalogs.read' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN ('owner','admin')
    WHEN 'filters.read' THEN em.role IN ('owner','admin','operator') WHEN 'filters.write' THEN em.role IN ('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN ('owner','admin')
    WHEN 'sales.read' THEN em.role IN ('owner','admin','operator') WHEN 'sales.write' THEN em.role IN ('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN ('owner','admin')
    WHEN 'printers.read' THEN em.role IN ('owner','admin','operator') WHEN 'printers.write' THEN em.role IN ('owner','admin') WHEN 'printers.archive' THEN em.role IN ('owner','admin')
    WHEN 'materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'materials.write' THEN em.role IN ('owner','admin') WHEN 'materials.archive' THEN em.role IN ('owner','admin')
    WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN ('owner','admin') ELSE false END
 ) END;
$$;

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY materials_read ON public.materials FOR SELECT TO authenticated USING (private.can_access_enterprise(enterprise_id,'materials.read'));
REVOKE ALL ON TABLE public.materials FROM PUBLIC, anon, authenticated;
GRANT SELECT (id,enterprise_id,name,material_type,brand,color,reference_weight_grams,reference_price,active,version,created_at,updated_at) ON public.materials TO authenticated;

-- Shared lock order: global management advisory -> actor advisory -> identity -> user -> membership -> enterprise -> material.
CREATE FUNCTION private.lock_internal_material_context(p_permission TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid UUID:=auth.uid(); v_issuer TEXT:=auth.jwt()->>'iss'; v_context RECORD; v_identity public.auth_identities%ROWTYPE; v_user public.users%ROWTYPE; v_member public.enterprise_members%ROWTYPE; v_enterprise public.enterprises%ROWTYPE;
BEGIN
 IF p_permission IS NULL OR p_permission NOT IN ('materials.write','materials.archive') OR v_uid IS NULL OR v_issuer IS NULL OR pg_catalog.btrim(v_issuer)='' THEN RETURN NULL; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT context.* INTO v_context FROM public.get_my_access_context() AS context; IF v_context.state IS DISTINCT FROM 'business_ready' THEN RETURN NULL; END IF;
 IF NOT EXISTS (SELECT 1 FROM private.auth_issuer_config AS issuer WHERE issuer.issuer=v_issuer AND issuer.provider='supabase' AND issuer.status='active') THEN RETURN NULL; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:'||v_issuer||':'||v_uid::TEXT,0));
 SELECT identity.* INTO v_identity FROM public.auth_identities AS identity JOIN private.auth_issuer_config AS issuer ON issuer.issuer=identity.issuer AND issuer.provider='supabase' AND issuer.status='active' WHERE identity.provider='supabase' AND identity.issuer=v_issuer AND identity.subject=v_uid::TEXT AND identity.status='active' FOR UPDATE OF identity;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT person.* INTO v_user FROM public.users AS person WHERE person.id=v_identity.user_id FOR UPDATE; IF NOT FOUND OR v_user.status<>'active' OR v_user.must_change_password THEN RETURN NULL; END IF;
 SELECT member.* INTO v_member FROM public.enterprise_members AS member WHERE member.user_id=v_user.id AND member.enterprise_id=v_context.enterprise_id AND member.status='active' FOR UPDATE; IF NOT FOUND THEN RETURN NULL; END IF;
 IF (SELECT pg_catalog.count(*) FROM public.enterprise_members AS other_member JOIN public.enterprises AS other_enterprise ON other_enterprise.id=other_member.enterprise_id WHERE other_member.user_id=v_user.id AND other_member.status='active' AND other_enterprise.status='active')<>1 THEN RETURN NULL; END IF;
 SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise WHERE enterprise.id=v_member.enterprise_id AND enterprise.status='active' FOR UPDATE; IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT context.* INTO v_context FROM public.get_my_access_context() AS context;
 IF v_context.state IS DISTINCT FROM 'business_ready' OR v_context.user_id IS DISTINCT FROM v_user.id OR v_context.membership_id IS DISTINCT FROM v_member.id OR v_context.enterprise_id IS DISTINCT FROM v_enterprise.id OR NOT private.can_access_enterprise(v_enterprise.id,p_permission) THEN RETURN NULL; END IF;
 RETURN v_enterprise.id;
END; $$;

CREATE FUNCTION private.material_args_ok(p_name TEXT,p_type TEXT,p_brand TEXT,p_color TEXT,p_weight NUMERIC,p_price NUMERIC) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF p_name IS NULL OR pg_catalog.length(p_name) NOT BETWEEN 2 AND 120 OR p_type IS NULL OR pg_catalog.length(p_type) NOT BETWEEN 1 AND 80 OR (p_brand IS NOT NULL AND pg_catalog.length(p_brand)>120) OR (p_color IS NOT NULL AND pg_catalog.length(p_color)>80) OR p_weight IS NULL OR p_price IS NULL THEN RETURN false; END IF;
 IF p_weight::TEXT IN ('NaN','Infinity','-Infinity') OR p_price::TEXT IN ('NaN','Infinity','-Infinity') OR p_weight<0.001 OR p_weight>100000 OR pg_catalog.scale(p_weight)>3 OR p_price<0 OR p_price>1000000 OR pg_catalog.scale(p_price)>2 THEN RETURN false; END IF;
 RETURN true;
END; $$;

CREATE FUNCTION public.create_my_material(p_name TEXT,p_material_type TEXT,p_brand TEXT,p_color TEXT,p_reference_weight_grams NUMERIC,p_reference_price NUMERIC) RETURNS TABLE(status TEXT,material_id UUID,version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enterprise_id UUID; v_material public.materials%ROWTYPE; v_name TEXT:=pg_catalog.btrim(p_name); v_type TEXT:=pg_catalog.btrim(p_material_type); v_brand TEXT:=NULLIF(pg_catalog.btrim(p_brand),''); v_color TEXT:=NULLIF(pg_catalog.btrim(p_color),'');
BEGIN
 IF auth.uid() IS NULL THEN RETURN QUERY SELECT 'session_expired'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 v_enterprise_id:=private.lock_internal_material_context('materials.write'); IF v_enterprise_id IS NULL THEN RETURN QUERY SELECT 'permission_denied'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF NOT private.material_args_ok(v_name,v_type,v_brand,v_color,p_reference_weight_grams,p_reference_price) THEN RETURN QUERY SELECT 'invalid_input'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 INSERT INTO public.materials(enterprise_id,name,material_type,brand,color,reference_weight_grams,reference_price) VALUES(v_enterprise_id,v_name,v_type,v_brand,v_color,p_reference_weight_grams,p_reference_price) RETURNING * INTO v_material;
 RETURN QUERY SELECT 'success'::TEXT,v_material.id,v_material.version;
END; $$;

CREATE FUNCTION public.update_my_material(p_id UUID,p_expected_version BIGINT,p_name TEXT,p_material_type TEXT,p_brand TEXT,p_color TEXT,p_reference_weight_grams NUMERIC,p_reference_price NUMERIC) RETURNS TABLE(status TEXT,material_id UUID,version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enterprise_id UUID; v_material public.materials%ROWTYPE; v_name TEXT:=pg_catalog.btrim(p_name); v_type TEXT:=pg_catalog.btrim(p_material_type); v_brand TEXT:=NULLIF(pg_catalog.btrim(p_brand),''); v_color TEXT:=NULLIF(pg_catalog.btrim(p_color),'');
BEGIN
 IF auth.uid() IS NULL THEN RETURN QUERY SELECT 'session_expired'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 v_enterprise_id:=private.lock_internal_material_context('materials.write'); IF v_enterprise_id IS NULL THEN RETURN QUERY SELECT 'permission_denied'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR NOT private.material_args_ok(v_name,v_type,v_brand,v_color,p_reference_weight_grams,p_reference_price) THEN RETURN QUERY SELECT 'invalid_input'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 SELECT material.* INTO v_material FROM public.materials AS material WHERE material.id=p_id AND material.enterprise_id=v_enterprise_id FOR UPDATE OF material;
 IF NOT FOUND OR NOT v_material.active THEN RETURN QUERY SELECT 'material_unavailable'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF v_material.version<>p_expected_version THEN RETURN QUERY SELECT 'version_conflict'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 UPDATE public.materials AS material SET name=v_name,material_type=v_type,brand=v_brand,color=v_color,reference_weight_grams=p_reference_weight_grams,reference_price=p_reference_price WHERE material.id=v_material.id RETURNING material.* INTO v_material;
 RETURN QUERY SELECT 'success'::TEXT,v_material.id,v_material.version;
END; $$;

CREATE FUNCTION public.set_my_material_active(p_id UUID,p_expected_version BIGINT,p_active BOOLEAN) RETURNS TABLE(status TEXT,material_id UUID,version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_enterprise_id UUID; v_material public.materials%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RETURN QUERY SELECT 'session_expired'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 v_enterprise_id:=private.lock_internal_material_context('materials.archive'); IF v_enterprise_id IS NULL THEN RETURN QUERY SELECT 'permission_denied'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_active IS NULL THEN RETURN QUERY SELECT 'invalid_input'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 SELECT material.* INTO v_material FROM public.materials AS material WHERE material.id=p_id AND material.enterprise_id=v_enterprise_id FOR UPDATE OF material;
 IF NOT FOUND THEN RETURN QUERY SELECT 'material_unavailable'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF v_material.version<>p_expected_version THEN RETURN QUERY SELECT 'version_conflict'::TEXT,NULL::UUID,NULL::BIGINT; RETURN; END IF;
 IF v_material.active IS NOT DISTINCT FROM p_active THEN RETURN QUERY SELECT 'success'::TEXT,v_material.id,v_material.version; RETURN; END IF;
 UPDATE public.materials AS material SET active=p_active WHERE material.id=v_material.id RETURNING material.* INTO v_material;
 RETURN QUERY SELECT 'success'::TEXT,v_material.id,v_material.version;
END; $$;

ALTER FUNCTION public.internal_materials_touch() OWNER TO postgres;
ALTER FUNCTION private.can_access_enterprise(UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION private.lock_internal_material_context(TEXT) OWNER TO postgres;
ALTER FUNCTION private.material_args_ok(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.create_my_material(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.update_my_material(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC) OWNER TO postgres;
ALTER FUNCTION public.set_my_material_active(UUID,BIGINT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.internal_materials_touch(),private.can_access_enterprise(UUID,TEXT),private.lock_internal_material_context(TEXT),private.material_args_ok(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC),public.create_my_material(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC),public.update_my_material(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC),public.set_my_material_active(UUID,BIGINT,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_material(TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC),public.update_my_material(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC),public.set_my_material_active(UUID,BIGINT,BOOLEAN) TO authenticated;
COMMIT;

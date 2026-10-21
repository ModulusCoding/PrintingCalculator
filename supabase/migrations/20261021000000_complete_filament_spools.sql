-- Complete physical filament spool registration.
-- A new spool is registered without a material; internal_identifier is its name.
BEGIN;

ALTER TABLE public.filament_spools
  ADD COLUMN IF NOT EXISTS material_type varchar(80),
  ADD COLUMN IF NOT EXISTS brand varchar(120),
  ADD COLUMN IF NOT EXISTS color varchar(80),
  ADD COLUMN IF NOT EXISTS create_profile jsonb,
  ALTER COLUMN material_id DROP NOT NULL;

-- Backfill current material attributes only; this is current material state, not
-- the original creation payload. Legacy creation profiles may remain NULL.
LOCK TABLE public.filament_spools IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.filament_spools DISABLE TRIGGER filament_spools_touch;
UPDATE public.filament_spools AS s
SET material_type = COALESCE(s.material_type, NULLIF(btrim(m.material_type), '')),
    brand = COALESCE(s.brand, NULLIF(btrim(m.brand), '')),
    color = COALESCE(s.color, NULLIF(btrim(m.color), ''))
FROM public.materials AS m
WHERE s.material_id = m.id AND s.enterprise_id = m.enterprise_id;
ALTER TABLE public.filament_spools ENABLE TRIGGER filament_spools_touch;

ALTER TABLE public.filament_spools
  ADD CONSTRAINT filament_spools_type_check CHECK (material_type IS NULL OR (btrim(material_type)=material_type AND length(material_type) BETWEEN 1 AND 80)),
  ADD CONSTRAINT filament_spools_brand_check CHECK (brand IS NULL OR (btrim(brand)=brand AND length(brand) BETWEEN 1 AND 120)),
  ADD CONSTRAINT filament_spools_color_check CHECK (color IS NULL OR (btrim(color)=color AND length(color) BETWEEN 1 AND 80)),
  ADD CONSTRAINT filament_spools_create_profile_object_check CHECK (create_profile IS NULL OR jsonb_typeof(create_profile) = 'object');

CREATE OR REPLACE FUNCTION public.internal_filament_spool_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id OR NEW.material_id IS DISTINCT FROM OLD.material_id
     OR NEW.original_filament_grams IS DISTINCT FROM OLD.original_filament_grams OR NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
     OR NEW.create_attempt_id IS DISTINCT FROM OLD.create_attempt_id OR NEW.create_actor_id IS DISTINCT FROM OLD.create_actor_id
     OR NEW.create_internal_identifier IS DISTINCT FROM OLD.create_internal_identifier OR NEW.create_initial_balance_grams IS DISTINCT FROM OLD.create_initial_balance_grams
     OR NEW.create_purchase_price IS DISTINCT FROM OLD.create_purchase_price OR NEW.create_profile IS DISTINCT FROM OLD.create_profile
  THEN RAISE EXCEPTION 'filament_spool_structural_fields_immutable' USING ERRCODE='42501'; END IF;
  NEW.updated_at := pg_catalog.now(); NEW.version := OLD.version + 1; RETURN NEW;
END $$;
ALTER FUNCTION public.internal_filament_spool_touch() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.create_filament_spool(
  p_attempt_id uuid, p_type text, p_brand text, p_color text, p_internal_identifier text,
  p_original_grams numeric, p_initial_balance_grams numeric, p_purchase_price numeric)
RETURNS TABLE(status text, spool_id uuid, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; a uuid; s public.filament_spools%ROWTYPE; ty text; br text; co text; ident text; payload jsonb; u numeric(21,9); c numeric(21,6);
BEGIN
  IF p_attempt_id IS NULL OR p_type IS NULL OR p_internal_identifier IS NULL OR p_original_grams IS NULL OR p_initial_balance_grams IS NULL OR p_purchase_price IS NULL
     OR p_type = btrim(p_type) IS NOT TRUE OR p_brand IS DISTINCT FROM btrim(p_brand) OR p_color IS DISTINCT FROM btrim(p_color) OR p_internal_identifier = btrim(p_internal_identifier) IS NOT TRUE OR p_original_grams::text IN ('NaN','Infinity','-Infinity') OR p_initial_balance_grams::text IN ('NaN','Infinity','-Infinity') OR p_purchase_price::text IN ('NaN','Infinity','-Infinity')
     OR p_original_grams NOT BETWEEN .001 AND 100000 OR p_initial_balance_grams NOT BETWEEN 0 AND p_original_grams OR p_purchase_price NOT BETWEEN 0 AND 1000000
     OR scale(p_original_grams)>3 OR scale(p_initial_balance_grams)>3 OR scale(p_purchase_price)>2 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  ty:=btrim(p_type); br:=nullif(btrim(p_brand),''); co:=nullif(btrim(p_color),''); ident:=btrim(p_internal_identifier);
  IF length(ty) NOT BETWEEN 1 AND 80 OR ident='' OR length(ident)>120 OR (br IS NOT NULL AND length(br) NOT BETWEEN 1 AND 120) OR (co IS NOT NULL AND length(co) NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  e:=private.lock_filament_spool_context('spools.write'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; a:=private.current_internal_user_id();
  payload:=jsonb_build_object('type',ty,'brand',br,'color',co,'internal_identifier',ident,'original_filament_grams',p_original_grams,'initial_balance_grams',p_initial_balance_grams,'purchase_price',p_purchase_price);
  SELECT fs.* INTO s FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.create_actor_id=a AND fs.create_attempt_id=p_attempt_id FOR UPDATE;
  IF FOUND THEN IF s.create_profile=payload THEN RETURN QUERY SELECT 'idempotent',s.id,0::bigint; RETURN; ELSE RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; END IF;
  IF EXISTS (SELECT 1 FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.internal_identifier=ident) THEN RAISE EXCEPTION 'identifier_conflict' USING ERRCODE='23505'; END IF;
  INSERT INTO public.filament_spools(enterprise_id,material_id,material_type,brand,color,internal_identifier,original_filament_grams,current_balance_grams,purchase_price,create_attempt_id,create_actor_id,create_internal_identifier,create_initial_balance_grams,create_purchase_price,create_profile)
  VALUES(e,NULL,ty,br,co,ident,p_original_grams,p_initial_balance_grams,p_purchase_price,p_attempt_id,a,ident,p_initial_balance_grams,p_purchase_price,payload) RETURNING * INTO s;
  u:=round(p_purchase_price/p_original_grams,9); c:=round(p_initial_balance_grams*p_purchase_price/p_original_grams,6);
  INSERT INTO public.filament_spool_movements(enterprise_id,spool_id,actor_id,movement_type,quantity_grams,balance_before_grams,balance_after_grams,unit_cost_per_gram,movement_cost,reason,attempt_id,request_expected_version,request_quantity_grams,result_version) VALUES(e,s.id,a,'opening',p_initial_balance_grams,0,p_initial_balance_grams,u,c,NULL,p_attempt_id,0,p_initial_balance_grams,0);
  RETURN QUERY SELECT 'created',s.id,s.version;
END $$;

DROP FUNCTION IF EXISTS public.create_filament_spool(uuid,uuid,text,numeric,numeric,numeric);

CREATE OR REPLACE FUNCTION public.update_filament_spool_profile(p_spool_id uuid,p_expected_version bigint,p_internal_identifier text,p_type text,p_brand text,p_color text)
RETURNS TABLE(status text,spool_id uuid,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; s public.filament_spools%ROWTYPE; ident text:=btrim(p_internal_identifier); ty text:=btrim(p_type); br text:=nullif(btrim(p_brand),''); co text:=nullif(btrim(p_color),'');
BEGIN
 IF p_spool_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_internal_identifier IS NULL OR p_type IS NULL OR ident='' OR length(ident)>120 OR length(ty) NOT BETWEEN 1 AND 80 OR (br IS NOT NULL AND length(br) NOT BETWEEN 1 AND 120) OR (co IS NOT NULL AND length(co) NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 e:=private.lock_filament_spool_context('spools.archive'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT fs.* INTO s FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND fs.id=p_spool_id FOR UPDATE;
 IF NOT FOUND OR NOT s.active THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE='P0002'; END IF; IF s.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
 IF s.internal_identifier=ident AND s.material_type=ty AND s.brand IS NOT DISTINCT FROM br AND s.color IS NOT DISTINCT FROM co THEN RETURN QUERY SELECT 'no_change',s.id,s.version; RETURN; END IF;
 IF EXISTS (SELECT 1 FROM public.filament_spools AS other WHERE other.enterprise_id=e AND other.internal_identifier=ident AND other.id<>s.id) THEN RAISE EXCEPTION 'identifier_conflict' USING ERRCODE='23505'; END IF;
 UPDATE public.filament_spools AS fs SET internal_identifier=ident,material_type=ty,brand=br,color=co WHERE fs.enterprise_id=e AND fs.id=s.id AND fs.version=p_expected_version RETURNING fs.id,fs.version INTO s.id,s.version;
 RETURN QUERY SELECT 'updated',s.id,s.version;
END $$;

DROP FUNCTION IF EXISTS public.list_filament_spools(text,text,integer,integer);
CREATE FUNCTION public.list_filament_spools(p_search text DEFAULT '',p_status text DEFAULT 'active',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,material_id uuid,material_type text,brand text,color text,internal_identifier text,original_filament_grams numeric,current_balance_grams numeric,purchase_price numeric,active boolean,version bigint,created_at timestamptz,updated_at timestamptz,percent_remaining numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e uuid; t text:=btrim(coalesce(p_search,'')); threshold numeric;
BEGIN
 e:=private.read_filament_spool_context('spools.read'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_limit IS NULL OR p_offset IS NULL OR p_status NOT IN ('active','archived','all','low','empty') OR p_limit NOT BETWEEN 1 AND 50 OR p_offset NOT BETWEEN 0 AND 100000 OR length(t)>120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT en.low_spool_threshold_percent INTO threshold FROM public.enterprises AS en WHERE en.id=e;
 RETURN QUERY SELECT fs.id,fs.material_id,fs.material_type::text,fs.brand::text,fs.color::text,fs.internal_identifier::text,fs.original_filament_grams,fs.current_balance_grams,fs.purchase_price,fs.active,fs.version,fs.created_at,fs.updated_at,fs.current_balance_grams*100/fs.original_filament_grams FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND (t='' OR strpos(lower(fs.internal_identifier),lower(t))>0 OR strpos(lower(coalesce(fs.material_type,'')),lower(t))>0 OR strpos(lower(coalesce(fs.brand,'')),lower(t))>0 OR strpos(lower(coalesce(fs.color,'')),lower(t))>0) AND (p_status='all' OR (p_status='active' AND fs.active AND fs.current_balance_grams>0) OR (p_status='low' AND fs.active AND fs.current_balance_grams>0 AND fs.current_balance_grams*100/fs.original_filament_grams<=threshold) OR (p_status='empty' AND fs.active AND fs.current_balance_grams=0) OR (p_status='archived' AND NOT fs.active)) ORDER BY fs.created_at DESC,fs.id DESC LIMIT p_limit OFFSET p_offset;
END $$;

CREATE OR REPLACE FUNCTION public.count_filament_spools(p_search text DEFAULT '',p_status text DEFAULT 'active') RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE e uuid; t text:=btrim(coalesce(p_search,'')); threshold numeric; BEGIN e:=private.read_filament_spool_context('spools.read'); IF e IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF; IF p_status IS NULL OR p_status NOT IN ('active','archived','all','low','empty') OR length(t)>120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF; SELECT en.low_spool_threshold_percent INTO threshold FROM public.enterprises AS en WHERE en.id=e; RETURN (SELECT count(*) FROM public.filament_spools AS fs WHERE fs.enterprise_id=e AND (t='' OR strpos(lower(fs.internal_identifier),lower(t))>0 OR strpos(lower(coalesce(fs.material_type,'')),lower(t))>0 OR strpos(lower(coalesce(fs.brand,'')),lower(t))>0 OR strpos(lower(coalesce(fs.color,'')),lower(t))>0) AND (p_status='all' OR (p_status='active' AND fs.active AND fs.current_balance_grams>0) OR (p_status='low' AND fs.active AND fs.current_balance_grams>0 AND fs.current_balance_grams*100/fs.original_filament_grams<=threshold) OR (p_status='empty' AND fs.active AND fs.current_balance_grams=0) OR (p_status='archived' AND NOT fs.active))); END $$;

ALTER FUNCTION public.create_filament_spool(uuid,text,text,text,text,numeric,numeric,numeric) OWNER TO postgres;
ALTER FUNCTION public.list_filament_spools(text,text,integer,integer) OWNER TO postgres;
ALTER FUNCTION public.count_filament_spools(text,text) OWNER TO postgres;
ALTER FUNCTION public.update_filament_spool_profile(uuid,bigint,text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_filament_spool(uuid,text,text,text,text,numeric,numeric,numeric),public.list_filament_spools(text,text,integer,integer),public.count_filament_spools(text,text),public.update_filament_spool_profile(uuid,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_filament_spool(uuid,text,text,text,text,numeric,numeric,numeric),public.list_filament_spools(text,text,integer,integer),public.count_filament_spools(text,text),public.update_filament_spool_profile(uuid,bigint,text,text,text,text) TO authenticated;
COMMIT;

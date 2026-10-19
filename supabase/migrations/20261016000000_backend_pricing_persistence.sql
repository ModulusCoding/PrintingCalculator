-- NEW / UNAPPLIED. Backend pricing persistence. No SQL execution is performed by this migration.
BEGIN;

CREATE TABLE public.pricing_calculations (
 id uuid PRIMARY KEY, enterprise_id uuid NOT NULL REFERENCES public.enterprises(id), product_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), attempt_id uuid NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'), snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
 product_version bigint NOT NULL CHECK (product_version >= 0), enterprise_version bigint NOT NULL CHECK (enterprise_version >= 0),
 electricity_rate_original numeric, electricity_rate_used numeric NOT NULL CHECK (electricity_rate_used BETWEEN 0 AND 100), price_suggested_unit numeric NOT NULL CHECK (price_suggested_unit BETWEEN 0 AND 1e30),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (enterprise_id, attempt_id), FOREIGN KEY (enterprise_id, product_id) REFERENCES public.products(enterprise_id,id)
);
CREATE INDEX pricing_calculations_history_idx ON public.pricing_calculations(enterprise_id,product_id,created_at DESC,id DESC);

CREATE TABLE public.pricing_price_applications (
 calculation_id uuid PRIMARY KEY REFERENCES public.pricing_calculations(id), enterprise_id uuid NOT NULL REFERENCES public.enterprises(id), product_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), previous_price numeric, applied_price numeric NOT NULL CHECK (applied_price BETWEEN 0 AND 1e30), product_version bigint NOT NULL CHECK (product_version >= 0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (enterprise_id,product_id) REFERENCES public.products(enterprise_id,id)
);

CREATE FUNCTION private.reject_pricing_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'pricing_history_is_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER pricing_calculations_immutable BEFORE UPDATE OR DELETE ON public.pricing_calculations FOR EACH ROW EXECUTE FUNCTION private.reject_pricing_mutation();
CREATE TRIGGER pricing_applications_immutable BEFORE UPDATE OR DELETE ON public.pricing_price_applications FOR EACH ROW EXECUTE FUNCTION private.reject_pricing_mutation();

ALTER TABLE public.pricing_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_price_applications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN p_enterprise_id IS NULL OR p_permission IS NULL OR p_permission NOT IN (
   'products.read','products.write','products.delete',
   'catalogs.read','catalogs.write','catalogs.delete',
   'filters.read','filters.write','filters.delete',
   'sales.read','sales.write','sales.delete',
   'enterprise.manage','members.manage_admins','members.manage_operators',
   'printers.read','printers.write','printers.archive',
   'materials.read','materials.write','materials.archive',
   'pricing.read','pricing.write','pricing.apply'
 ) THEN false ELSE
 (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id WHERE em.user_id=private.current_internal_user_id() AND em.status='active' AND e.status='active') AND EXISTS (
  SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id JOIN public.enterprises e ON e.id=em.enterprise_id
  WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id() AND em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active'
  AND CASE p_permission
    WHEN 'products.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'products.write' THEN em.role IN ('owner','admin','operator')
    WHEN 'products.delete' THEN em.role IN ('owner','admin')
    WHEN 'catalogs.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'catalogs.write' THEN em.role IN ('owner','admin','operator')
    WHEN 'catalogs.delete' THEN em.role IN ('owner','admin')
    WHEN 'filters.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'filters.write' THEN em.role IN ('owner','admin','operator')
    WHEN 'filters.delete' THEN em.role IN ('owner','admin')
    WHEN 'sales.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'sales.write' THEN em.role IN ('owner','admin','operator')
    WHEN 'sales.delete' THEN em.role IN ('owner','admin')
    WHEN 'printers.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'printers.write' THEN em.role IN ('owner','admin')
    WHEN 'printers.archive' THEN em.role IN ('owner','admin')
    WHEN 'materials.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'materials.write' THEN em.role IN ('owner','admin')
    WHEN 'materials.archive' THEN em.role IN ('owner','admin')
    WHEN 'pricing.read' THEN em.role IN ('owner','admin','operator')
    WHEN 'pricing.write' THEN em.role IN ('owner','admin','operator')
    WHEN 'pricing.apply' THEN em.role IN ('owner','admin','operator')
    WHEN 'enterprise.manage' THEN em.role='owner'
    WHEN 'members.manage_admins' THEN em.role='owner'
    WHEN 'members.manage_operators' THEN em.role IN ('owner','admin')
    ELSE false
  END
 ) END;
$$;
REVOKE ALL ON FUNCTION private.can_access_enterprise(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(UUID,TEXT) TO authenticated;

CREATE POLICY pricing_calculations_read ON public.pricing_calculations FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'pricing.read'));
CREATE POLICY pricing_applications_read ON public.pricing_price_applications FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'pricing.read'));
REVOKE ALL ON public.pricing_calculations, public.pricing_price_applications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pricing_calculations, public.pricing_price_applications TO authenticated;

CREATE FUNCTION private.pricing_actor(p_actor uuid,p_issuer text,p_permission text) RETURNS TABLE(uid uuid,enterprise_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.auth_identities%ROWTYPE; u public.users%ROWTYPE; m public.enterprise_members%ROWTYPE; e public.enterprises%ROWTYPE;
BEGIN
 IF p_actor IS NULL OR p_issuer IS NULL OR btrim(p_issuer)='' OR p_permission IS NULL OR p_permission NOT IN ('pricing.read','pricing.write','products.write') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:'||btrim(p_issuer)||':'||p_actor::text,0));
 SELECT ai.* INTO i FROM public.auth_identities ai JOIN private.auth_issuer_config ic ON ic.issuer=ai.issuer AND ic.provider='supabase' AND ic.status='active' WHERE ai.provider='supabase' AND ai.issuer=btrim(p_issuer) AND ai.subject=p_actor::text AND ai.status='active' FOR UPDATE OF ai;
 IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM public.users WHERE id=i.user_id FOR UPDATE;
 IF NOT FOUND OR u.status<>'active' OR u.must_change_password THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT em.* INTO m FROM public.enterprise_members em JOIN public.enterprises en ON en.id=em.enterprise_id WHERE em.user_id=u.id AND em.status='active' AND en.status='active' FOR UPDATE OF em,en;
 IF NOT FOUND OR (SELECT count(*) FROM public.enterprise_members em JOIN public.enterprises en ON en.id=em.enterprise_id WHERE em.user_id=u.id AND em.status='active' AND en.status='active') <> 1 THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.enterprises WHERE id=m.enterprise_id AND status='active' FOR UPDATE;
 IF NOT FOUND OR NOT (CASE p_permission WHEN 'pricing.read' THEN m.role IN ('owner','admin','operator') WHEN 'pricing.write' THEN m.role IN ('owner','admin','operator') WHEN 'products.write' THEN m.role IN ('owner','admin','operator') END) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 uid:=u.id; enterprise_id:=e.id; RETURN NEXT;
END $$;

CREATE FUNCTION public.lookup_pricing_attempt(p_actor uuid,p_issuer text,p_attempt_id uuid,p_request_hash text) RETURNS TABLE(status text,calculation_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record; c public.pricing_calculations%ROWTYPE;
BEGIN
 IF p_attempt_id IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM private.pricing_actor(p_actor,p_issuer,'pricing.read');
 SELECT * INTO c FROM public.pricing_calculations pc WHERE pc.enterprise_id=x.enterprise_id AND pc.attempt_id=p_attempt_id;
 IF NOT FOUND THEN RETURN QUERY SELECT 'missing'::text,NULL::uuid; ELSIF c.actor_id=x.uid AND c.request_hash=p_request_hash THEN RETURN QUERY SELECT 'found'::text,c.id; ELSE RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
END $$;

CREATE FUNCTION public.save_pricing_attempt(p_actor uuid,p_issuer text,p_attempt_id uuid,p_request_hash text,p_snapshot_hash text,p_snapshot jsonb,p_product_id uuid,p_product_version bigint,p_enterprise_version bigint,p_original_rate numeric,p_used_rate numeric,p_suggested_price numeric) RETURNS TABLE(status text,calculation_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record; c public.pricing_calculations%ROWTYPE; p public.products%ROWTYPE; e public.enterprises%ROWTYPE; m record; pr record; ma record;
BEGIN
 IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_request_hash IS NULL OR p_snapshot_hash IS NULL OR p_snapshot IS NULL OR p_product_version IS NULL OR p_product_version<0 OR p_enterprise_version IS NULL OR p_enterprise_version<0 OR p_used_rate IS NULL OR p_used_rate NOT BETWEEN 0 AND 100 OR p_suggested_price IS NULL OR p_suggested_price NOT BETWEEN 0 AND 1e30 OR (p_original_rate IS NOT NULL AND p_original_rate NOT BETWEEN 0 AND 100) OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_snapshot_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM private.pricing_actor(p_actor,p_issuer,'pricing.write');
 SELECT * INTO c FROM public.pricing_calculations pc WHERE pc.enterprise_id=x.enterprise_id AND pc.attempt_id=p_attempt_id FOR UPDATE;
 IF FOUND THEN IF c.actor_id=x.uid AND c.request_hash=p_request_hash THEN RETURN QUERY SELECT 'idempotent'::text,c.id; RETURN; ELSE RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; END IF;
 IF jsonb_typeof(p_snapshot)<>'object' OR NOT (p_snapshot ? 'schema_version') OR p_snapshot->>'schema_version' <> '1' OR NOT (p_snapshot ? 'input') OR jsonb_typeof(p_snapshot->'input')<>'object' OR NOT (p_snapshot ? 'result') OR jsonb_typeof(p_snapshot->'result')<>'object' OR NOT (p_snapshot ? 'product_snapshot') OR jsonb_typeof(p_snapshot->'product_snapshot')<>'object' OR NOT (p_snapshot ? 'printers') OR jsonb_typeof(p_snapshot->'printers')<>'array' OR NOT (p_snapshot ? 'materials') OR jsonb_typeof(p_snapshot->'materials')<>'array' OR NOT (p_snapshot ? 'config_snapshot') OR jsonb_typeof(p_snapshot->'config_snapshot')<>'object' OR (p_snapshot->'product_snapshot'->>'id') IS NULL OR (p_snapshot->'product_snapshot'->>'id') IS DISTINCT FROM p_product_id::text OR (p_snapshot->'product_snapshot'->>'version') IS NULL OR (p_snapshot->'product_snapshot'->>'version') IS DISTINCT FROM p_product_version::text OR (p_snapshot->'config_snapshot'->>'version') IS NULL OR (p_snapshot->'config_snapshot'->>'version') IS DISTINCT FROM p_enterprise_version::text OR NOT (p_snapshot->'config_snapshot' ? 'original') OR (p_snapshot->'config_snapshot'->'original') IS NULL OR (p_snapshot->'config_snapshot'->'original') IS DISTINCT FROM coalesce(to_jsonb(p_original_rate),'null'::jsonb) OR NOT (p_snapshot->'config_snapshot' ? 'effective') OR (p_snapshot->'config_snapshot'->'effective') IS NULL OR (p_snapshot->'config_snapshot'->'effective') IS DISTINCT FROM to_jsonb(p_used_rate) OR (p_snapshot->'result'->>'suggestedUnitPrice') IS NULL OR (p_snapshot->'result'->>'suggestedUnitPrice') IS DISTINCT FROM p_suggested_price::text THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_snapshot->'printers')<>1 OR jsonb_array_length(p_snapshot->'materials') NOT BETWEEN 1 AND 10 OR (SELECT count(*) FROM jsonb_to_recordset(p_snapshot->'materials') AS q(id uuid,version bigint)) <> jsonb_array_length(p_snapshot->'materials') OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot->'materials') AS q(id uuid,version bigint)) <> jsonb_array_length(p_snapshot->'materials') OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_snapshot->'materials') AS q(id uuid,version bigint) WHERE q.id IS NULL OR q.version IS NULL OR q.version<0) OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_snapshot->'printers') AS q(id uuid,version bigint) WHERE q.id IS NULL OR q.version IS NULL OR q.version<0) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.products pp WHERE pp.enterprise_id=x.enterprise_id AND pp.id=p_product_id FOR UPDATE;
 IF NOT FOUND OR NOT p.active OR p.version<>p_product_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM public.enterprises ee WHERE ee.id=x.enterprise_id FOR UPDATE;
 IF NOT FOUND OR e.electricity_rate_per_kwh IS DISTINCT FROM p_original_rate THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
 FOR m IN SELECT * FROM jsonb_to_recordset(p_snapshot->'materials') AS q(id uuid,version bigint) ORDER BY id LOOP SELECT * INTO ma FROM public.materials mm WHERE mm.id=m.id AND mm.enterprise_id=x.enterprise_id FOR UPDATE; IF NOT FOUND OR NOT ma.active OR ma.version<>m.version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; END LOOP;
 FOR pr IN SELECT * FROM jsonb_to_recordset(p_snapshot->'printers') AS q(id uuid,version bigint) ORDER BY id LOOP SELECT * INTO ma FROM public.printers pp WHERE pp.id=pr.id AND pp.enterprise_id=x.enterprise_id FOR UPDATE; IF NOT FOUND OR NOT ma.active OR ma.version<>pr.version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF; END LOOP;
 INSERT INTO public.pricing_calculations(id,enterprise_id,product_id,actor_id,attempt_id,request_hash,snapshot_hash,product_version,enterprise_version,electricity_rate_original,electricity_rate_used,price_suggested_unit,snapshot) VALUES(p_attempt_id,x.enterprise_id,p_product_id,x.uid,p_attempt_id,p_request_hash,p_snapshot_hash,p_product_version,p_enterprise_version,p_original_rate,p_used_rate,p_suggested_price,p_snapshot);
 RETURN QUERY SELECT 'created'::text,p_attempt_id;
END $$;

CREATE FUNCTION public.apply_pricing_price(p_actor uuid,p_issuer text,p_calculation_id uuid,p_expected_product_version bigint) RETURNS TABLE(status text,product_id uuid,version bigint,applied_price numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record;c public.pricing_calculations%ROWTYPE;p public.products%ROWTYPE;a public.pricing_price_applications%ROWTYPE;n numeric;v bigint;
BEGIN
 IF p_calculation_id IS NULL OR p_expected_product_version IS NULL OR p_expected_product_version<0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM private.pricing_actor(p_actor,p_issuer,'pricing.read'); PERFORM private.pricing_actor(p_actor,p_issuer,'products.write');
 SELECT * INTO c FROM public.pricing_calculations pc WHERE pc.id=p_calculation_id AND pc.enterprise_id=x.enterprise_id;
 IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text,NULL::uuid,NULL::bigint,NULL::numeric; RETURN; END IF;
 SELECT * INTO a FROM public.pricing_price_applications pa WHERE pa.calculation_id=c.id;
 IF FOUND THEN RETURN QUERY SELECT 'idempotent'::text,c.product_id,a.product_version,a.applied_price; RETURN; END IF;
 SELECT * INTO p FROM public.products pp WHERE pp.id=c.product_id AND pp.enterprise_id=x.enterprise_id FOR UPDATE;
 IF NOT FOUND OR NOT p.active THEN RETURN QUERY SELECT 'product_unavailable'::text,c.product_id,NULL::bigint,NULL::numeric; RETURN; END IF;
 IF p.version<>p_expected_product_version THEN RETURN QUERY SELECT 'product_version_conflict'::text,p.id,p.version,NULL::numeric; RETURN; END IF;
 n:=round(c.price_suggested_unit,2); IF n<0 OR n>1000000 THEN RETURN QUERY SELECT 'price_out_of_bounds'::text,p.id,p.version,NULL::numeric; RETURN; END IF;
 UPDATE public.products pp SET price=n WHERE pp.id=p.id RETURNING pp.version INTO v;
 INSERT INTO public.pricing_price_applications(calculation_id,enterprise_id,product_id,actor_id,previous_price,applied_price,product_version) VALUES(c.id,x.enterprise_id,p.id,x.uid,p.price,n,v);
 RETURN QUERY SELECT 'applied'::text,p.id,v,n;
END $$;

ALTER FUNCTION private.reject_pricing_mutation() OWNER TO postgres;
ALTER FUNCTION private.can_access_enterprise(UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION private.pricing_actor(uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric) OWNER TO postgres;
ALTER FUNCTION public.apply_pricing_price(uuid,text,uuid,bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.reject_pricing_mutation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.pricing_actor(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text),public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric),public.apply_pricing_price(uuid,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_pricing_attempt(uuid,text,uuid,text),public.save_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,bigint,numeric,numeric,numeric),public.apply_pricing_price(uuid,text,uuid,bigint) TO service_role;
COMMIT;

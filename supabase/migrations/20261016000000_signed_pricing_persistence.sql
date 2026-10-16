-- NEW / UNAPPLIED. Requires the internal products/printers/materials migrations.
-- Provision pgcrypto in schema extensions before applying; fail closed otherwise.
-- PROVISIONING: an administrator must insert >=32 random bytes into
-- private.pricing_attestation_keys(secret), with the same bytes in a server-only
-- environment variable. Never put the secret in this migration/client/logs.
-- Rotation: insert a new key_id, switch signer, retain old keys for the 5 minute
-- TTL then disable. Database does not read application environment variables.
-- CONTRACT: canonical payload is JSON.stringify(array-of-strings), no whitespace.
-- Every element is ASCII and excludes quotes/backslashes/control characters.
-- Positions: ["fdm-pricing-v1", request UUID, internal user UUID, enterprise UUID,
-- product UUID, product version, enterprise version, tariff decimal,
-- printer UUID, printer version, expires epoch seconds, price decimal,
-- materials JSON string, calculation snapshot SHA256 hex].
-- materials JSON string would require escaping, so position 12 instead uses
-- sorted unique "uuid:version,uuid:version" (1..10 materials).
-- Snapshot is separate JSONB; hash is SHA256 of exact p_snapshot_text UTF8 bytes.
-- Server signs UTF8 p_canonical using HMAC-SHA256 (lowercase hex), after loading
-- trusted database records and calculating the result itself. Never sign browser
-- supplied results. All decimals/versions are strings; expiry <= now+300 seconds.
-- save_my_pricing records a snapshot only; apply_my_pricing_price is explicit.
BEGIN;
DO $$ BEGIN
 IF pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR
    pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
   RAISE EXCEPTION 'Provision pgcrypto in extensions schema before this migration';
 END IF;
END $$;
CREATE TABLE private.pricing_attestation_keys (
 key_id TEXT PRIMARY KEY CHECK(key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
 secret BYTEA NOT NULL CHECK(octet_length(secret)>=32),
 active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE private.pricing_attestation_keys OWNER TO postgres;
ALTER TABLE private.pricing_attestation_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pricing_attestation_keys FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the complete existing permission implementation rather than copying
-- an obsolete whitelist. New permissions inherit the exact products role rules.
-- Keep the existing permission function and extend its allow-list in-place; renaming it
-- would invalidate existing policies/grants and the function's callers.
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
    WHEN 'pricing.read' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN ('owner','admin','operator')
     WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN ('owner','admin') ELSE false END
 ) END;
$$;
ALTER FUNCTION private.can_access_enterprise(UUID,TEXT) OWNER TO postgres;

CREATE TABLE public.pricing_calculations (
 id UUID PRIMARY KEY,
 enterprise_id UUID NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
 product_id UUID NOT NULL,
 actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 product_version BIGINT NOT NULL CHECK(product_version>=0),
 enterprise_version BIGINT NOT NULL CHECK(enterprise_version>=0),
 electricity_rate_per_kwh NUMERIC NOT NULL CHECK(electricity_rate_per_kwh BETWEEN 0 AND 100),
 price NUMERIC NOT NULL CHECK(price BETWEEN 0 AND 1000000 AND scale(price)<=2),
 canonical_payload TEXT NOT NULL,
 payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(enterprise_id,product_id) REFERENCES public.products(enterprise_id,id) ON DELETE RESTRICT
);
CREATE INDEX pricing_calculations_history_idx ON public.pricing_calculations(enterprise_id,product_id,created_at DESC,id DESC);
CREATE TABLE public.pricing_price_applications (
 calculation_id UUID PRIMARY KEY REFERENCES public.pricing_calculations(id) ON DELETE RESTRICT,
 enterprise_id UUID NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 previous_price NUMERIC,
 applied_price NUMERIC NOT NULL,
 product_version BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION private.reject_pricing_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'pricing_history_is_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER pricing_calculations_immutable BEFORE UPDATE OR DELETE ON public.pricing_calculations FOR EACH ROW EXECUTE FUNCTION private.reject_pricing_mutation();
CREATE TRIGGER pricing_applications_immutable BEFORE UPDATE OR DELETE ON public.pricing_price_applications FOR EACH ROW EXECUTE FUNCTION private.reject_pricing_mutation();
CREATE TRIGGER pricing_calculations_no_truncate BEFORE TRUNCATE ON public.pricing_calculations FOR EACH STATEMENT EXECUTE FUNCTION private.reject_pricing_mutation();
CREATE TRIGGER pricing_applications_no_truncate BEFORE TRUNCATE ON public.pricing_price_applications FOR EACH STATEMENT EXECUTE FUNCTION private.reject_pricing_mutation();
ALTER TABLE public.pricing_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_price_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_calculations_read ON public.pricing_calculations FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'pricing.read'));
CREATE POLICY pricing_applications_read ON public.pricing_price_applications FOR SELECT TO authenticated USING(private.can_access_enterprise(enterprise_id,'pricing.read'));
REVOKE ALL ON public.pricing_calculations,public.pricing_price_applications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.pricing_calculations,public.pricing_price_applications TO authenticated;

CREATE FUNCTION public.save_my_pricing(p_key_id TEXT,p_canonical TEXT,p_signature TEXT,p_snapshot_text TEXT)
RETURNS TABLE(status TEXT,calculation_id UUID) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a JSONB; fields TEXT[]; rebuilt TEXT; k BYTEA; expected BYTEA; supplied BYTEA; diff INTEGER:=0; i INTEGER;
 tenant UUID; actor UUID; request_id UUID; product public.products%ROWTYPE; enterprise public.enterprises%ROWTYPE;
 printer public.printers%ROWTYPE; material public.materials%ROWTYPE; old public.pricing_calculations%ROWTYPE;
 pair TEXT; pairs TEXT[]; mid UUID; last_mid TEXT:=''; expires BIGINT; amount NUMERIC; snap JSONB; hash TEXT;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 IF p_canonical IS NULL OR octet_length(p_canonical)>16384 OR p_snapshot_text IS NULL OR octet_length(p_snapshot_text)>131072 OR p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 a:=p_canonical::JSONB;
 IF jsonb_typeof(a) IS DISTINCT FROM 'array' OR jsonb_array_length(a)<>14 THEN RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(a) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023'; END IF;
 SELECT array_agg(value ORDER BY ord) INTO fields FROM jsonb_array_elements_text(a) WITH ORDINALITY t(value,ord);
 FOREACH pair IN ARRAY fields LOOP
   IF pair !~ '^[A-Za-z0-9.,:_-]+$' THEN RAISE EXCEPTION 'invalid_canonical_payload' USING ERRCODE='22023'; END IF;
 END LOOP;
 rebuilt:='["'||array_to_string(fields,'","')||'"]';
 IF rebuilt IS DISTINCT FROM p_canonical OR fields[1]<>'fdm-pricing-v1' THEN RAISE EXCEPTION 'invalid_canonical_payload' USING ERRCODE='22023'; END IF;
 SELECT secret INTO k FROM private.pricing_attestation_keys WHERE key_id=p_key_id AND active FOR SHARE;
 IF k IS NULL THEN RAISE EXCEPTION 'invalid_attestation' USING ERRCODE='42501'; END IF;
 expected:=extensions.hmac(convert_to(p_canonical,'UTF8'),k,'sha256'); supplied:=decode(p_signature,'hex');
 -- Fixed 32-byte comparison; no early exit on matching prefix.
 FOR i IN 0..31 LOOP diff:=diff | (get_byte(expected,i) # get_byte(supplied,i)); END LOOP;
 IF diff<>0 THEN RAISE EXCEPTION 'invalid_attestation' USING ERRCODE='42501'; END IF;
 expires:=fields[11]::BIGINT;
 IF expires<=extract(epoch FROM clock_timestamp()) OR expires>extract(epoch FROM clock_timestamp())+300 THEN RAISE EXCEPTION 'attestation_expired' USING ERRCODE='22023'; END IF;
 hash:=encode(extensions.digest(convert_to(p_canonical,'UTF8'),'sha256'),'hex');
 IF encode(extensions.digest(convert_to(p_snapshot_text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM fields[14] THEN RAISE EXCEPTION 'snapshot_hash_mismatch' USING ERRCODE='22023'; END IF;
 snap:=p_snapshot_text::JSONB;
 IF jsonb_typeof(snap) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_snapshot' USING ERRCODE='22023'; END IF;
 -- Existing helper implements global advisory -> actor advisory -> identity ->
 -- user -> membership -> enterprise locks and fully revalidates business context.
 tenant:=private.lock_internal_product_context('products.write'); actor:=private.current_internal_user_id();
 IF tenant IS NULL OR tenant IS DISTINCT FROM fields[4]::UUID OR actor IS DISTINCT FROM fields[3]::UUID OR NOT private.can_access_enterprise(tenant,'pricing.write') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 request_id:=fields[2]::UUID;
 SELECT c.* INTO old FROM public.pricing_calculations c WHERE c.id=request_id;
 IF FOUND THEN
   IF old.enterprise_id IS DISTINCT FROM tenant OR old.actor_id IS DISTINCT FROM actor OR old.canonical_payload IS DISTINCT FROM p_canonical OR old.payload_hash IS DISTINCT FROM hash THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
   RETURN QUERY SELECT 'idempotent'::TEXT,old.id; RETURN;
 END IF;
 SELECT e.* INTO enterprise FROM public.enterprises e WHERE e.id=tenant;
 IF enterprise.version IS DISTINCT FROM fields[7]::BIGINT OR enterprise.electricity_rate_per_kwh IS DISTINCT FROM fields[8]::NUMERIC THEN RAISE EXCEPTION 'enterprise_version_conflict' USING ERRCODE='40001'; END IF;
 SELECT p.* INTO product FROM public.products p WHERE p.enterprise_id=tenant AND p.id=fields[5]::UUID FOR UPDATE;
 IF NOT FOUND OR NOT product.active OR product.version IS DISTINCT FROM fields[6]::BIGINT THEN RAISE EXCEPTION 'product_version_conflict' USING ERRCODE='40001'; END IF;
 SELECT p.* INTO printer FROM public.printers p WHERE p.enterprise_id=tenant AND p.id=fields[9]::UUID FOR UPDATE;
 IF NOT FOUND OR NOT printer.active OR printer.version IS DISTINCT FROM fields[10]::BIGINT THEN RAISE EXCEPTION 'printer_version_conflict' USING ERRCODE='40001'; END IF;
 pairs:=string_to_array(fields[13],',');
 IF cardinality(pairs) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_materials' USING ERRCODE='22023'; END IF;
 FOREACH pair IN ARRAY pairs LOOP
   IF pair !~ '^[0-9a-f-]{36}:[0-9]+$' OR split_part(pair,':',1) COLLATE "C" <= last_mid COLLATE "C" THEN RAISE EXCEPTION 'materials_must_be_unique_sorted' USING ERRCODE='22023'; END IF;
   last_mid:=split_part(pair,':',1); mid:=last_mid::UUID;
   SELECT m.* INTO material FROM public.materials m WHERE m.enterprise_id=tenant AND m.id=mid FOR UPDATE;
   IF NOT FOUND OR NOT material.active OR material.version IS DISTINCT FROM split_part(pair,':',2)::BIGINT THEN RAISE EXCEPTION 'material_version_conflict' USING ERRCODE='40001'; END IF;
 END LOOP;
 amount:=fields[12]::NUMERIC;
 IF amount::TEXT IN ('NaN','Infinity','-Infinity') OR amount<0 OR amount>1000000 OR scale(amount)>2 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE='22023'; END IF;
 -- Recheck expiry after potentially waiting for row/advisory locks.
 IF expires<=extract(epoch FROM clock_timestamp()) THEN RAISE EXCEPTION 'attestation_expired' USING ERRCODE='22023'; END IF;
 INSERT INTO public.pricing_calculations(id,enterprise_id,product_id,actor_id,product_version,enterprise_version,electricity_rate_per_kwh,price,canonical_payload,payload_hash,snapshot)
 VALUES(request_id,tenant,product.id,actor,product.version,enterprise.version,enterprise.electricity_rate_per_kwh,amount,p_canonical,hash,snap);
 RETURN QUERY SELECT 'created'::TEXT,request_id;
END $$;

CREATE FUNCTION public.apply_my_pricing_price(p_calculation_id UUID,p_expected_product_version BIGINT)
RETURNS TABLE(status TEXT,product_id UUID,version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant UUID; c public.pricing_calculations%ROWTYPE; p public.products%ROWTYPE; applied public.pricing_price_applications%ROWTYPE; v BIGINT; e public.enterprises%ROWTYPE;
BEGIN
 tenant:=private.lock_internal_product_context('products.write');
 IF tenant IS NULL OR NOT private.can_access_enterprise(tenant,'pricing.apply') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO c FROM public.pricing_calculations x WHERE x.id=p_calculation_id AND x.enterprise_id=tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT x.* INTO applied FROM public.pricing_price_applications x WHERE x.calculation_id=c.id;
 IF FOUND THEN RETURN QUERY SELECT 'idempotent'::TEXT,c.product_id,applied.product_version; RETURN; END IF;
 SELECT x.* INTO e FROM public.enterprises x WHERE x.id=tenant;
 IF e.version IS DISTINCT FROM c.enterprise_version OR e.electricity_rate_per_kwh IS DISTINCT FROM c.electricity_rate_per_kwh THEN RAISE EXCEPTION 'enterprise_version_conflict' USING ERRCODE='40001'; END IF;
 SELECT x.* INTO p FROM public.products x WHERE x.id=c.product_id AND x.enterprise_id=tenant FOR UPDATE;
 IF NOT FOUND OR NOT p.active OR p.version IS DISTINCT FROM p_expected_product_version OR p.version IS DISTINCT FROM c.product_version THEN RAISE EXCEPTION 'product_version_conflict' USING ERRCODE='40001'; END IF;
 -- An immutable saved calculation is an intentional historical price decision;
 -- printer/material edits after saving do not rewrite that decision.
 UPDATE public.products x SET price=c.price WHERE x.id=p.id RETURNING x.version INTO v;
 INSERT INTO public.pricing_price_applications(calculation_id,enterprise_id,actor_id,previous_price,applied_price,product_version)
 VALUES(c.id,tenant,private.current_internal_user_id(),p.price,c.price,v);
 RETURN QUERY SELECT 'applied'::TEXT,p.id,v;
END $$;

CREATE FUNCTION public.get_my_pricing_history(p_product_id UUID,p_limit INTEGER DEFAULT 50)
RETURNS SETOF public.pricing_calculations LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT c.* FROM public.pricing_calculations c WHERE c.product_id=p_product_id
 ORDER BY c.created_at DESC,c.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),100));
$$;
ALTER TABLE public.pricing_calculations OWNER TO postgres;
ALTER TABLE public.pricing_price_applications OWNER TO postgres;
ALTER FUNCTION private.reject_pricing_mutation() OWNER TO postgres;
ALTER FUNCTION public.save_my_pricing(TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.apply_my_pricing_price(UUID,BIGINT) OWNER TO postgres;
ALTER FUNCTION public.get_my_pricing_history(UUID,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_pricing_mutation(),public.save_my_pricing(TEXT,TEXT,TEXT,TEXT),public.apply_my_pricing_price(UUID,BIGINT),public.get_my_pricing_history(UUID,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_my_pricing(TEXT,TEXT,TEXT,TEXT),public.apply_my_pricing_price(UUID,BIGINT),public.get_my_pricing_history(UUID,INTEGER) TO authenticated;
COMMIT;

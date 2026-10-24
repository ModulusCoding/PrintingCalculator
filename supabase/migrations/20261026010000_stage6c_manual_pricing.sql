BEGIN;

CREATE OR REPLACE FUNCTION private.stage6c_manual_snapshot_ok(p_snapshot jsonb,p_product_id uuid,p_product_version bigint,p_suggested numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; u jsonb; c jsonb;
BEGIN
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR p_snapshot->>'schema_version'<>'3' OR p_snapshot->>'source'<>'manual' THEN RETURN false; END IF;
 IF jsonb_typeof(p_snapshot->'config_snapshot')<>'object' OR p_snapshot->'config_snapshot'->>'source'<>'manual' OR jsonb_typeof(p_snapshot->'config_snapshot'->'energyRate')<>'number' THEN RETURN false; END IF;
 IF jsonb_typeof(p_snapshot->'units')<>'object' OR jsonb_typeof(p_snapshot->'product_snapshot')<>'object' OR p_snapshot->'product_snapshot'->>'id' IS DISTINCT FROM p_product_id::text OR p_snapshot->'product_snapshot'->>'version' IS DISTINCT FROM p_product_version::text THEN RETURN false; END IF;
 r:=p_snapshot->'result'; IF jsonb_typeof(r)<>'object' OR r->>'suggestedUnitPrice' IS DISTINCT FROM p_suggested::text THEN RETURN false; END IF;
 u:=p_snapshot->'units'; IF u IS NULL OR u='{}'::jsonb THEN RETURN false; END IF;
 c:=p_snapshot->'config_snapshot';
 IF (c->>'energyRate')::numeric IS NULL OR NOT isfinite((c->>'energyRate')::numeric) OR (c->>'energyRate')::numeric NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
 RETURN isfinite(p_suggested) AND p_suggested BETWEEN 0 AND 1000000000000000000000000000000;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.save_manual_pricing_attempt(
 p_actor uuid,p_issuer text,p_attempt_id uuid,p_request_hash text,p_snapshot_hash text,p_snapshot jsonb,
 p_product_id uuid,p_product_version bigint,p_suggested_price numeric)
RETURNS TABLE(status text,calculation_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x record; c public.pricing_calculations%ROWTYPE; p public.products%ROWTYPE; plan record; role text;
BEGIN
 IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_product_version IS NULL OR p_product_version<0 OR p_request_hash !~ '^[0-9a-f]{64}$' OR p_snapshot_hash !~ '^[0-9a-f]{64}$' OR NOT private.stage6c_manual_snapshot_ok(p_snapshot,p_product_id,p_product_version,p_suggested_price) THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM private.pricing_actor(p_actor,p_issuer,'pricing.write');
 SELECT em.role INTO role FROM public.enterprise_members em WHERE em.enterprise_id=x.enterprise_id AND em.user_id=x.uid AND em.status='active';
 SELECT * INTO plan FROM private.resolve_enterprise_plan(x.enterprise_id);
 IF role IS DISTINCT FROM 'owner' OR plan.effective_plan IS DISTINCT FROM 'free' OR plan.access_state NOT IN ('free','expired','cancelled') THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pricing:manual:'||x.enterprise_id::text,0));
 SELECT * INTO c FROM public.pricing_calculations WHERE enterprise_id=x.enterprise_id AND attempt_id=p_attempt_id FOR UPDATE;
 IF FOUND THEN IF c.actor_id=x.uid AND c.request_hash=p_request_hash AND c.snapshot_hash=p_snapshot_hash THEN RETURN QUERY SELECT 'idempotent',c.id; RETURN; ELSE RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF; END IF;
 SELECT * INTO p FROM public.products WHERE enterprise_id=x.enterprise_id AND id=p_product_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT p.active OR p.version<>p_product_version OR NOT private.stage6b_product_visible(x.enterprise_id,p_product_id) THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO public.pricing_calculations(id,enterprise_id,product_id,actor_id,attempt_id,request_hash,snapshot_hash,product_version,enterprise_version,electricity_rate_original,electricity_rate_used,price_suggested_unit,snapshot)
 VALUES(p_attempt_id,x.enterprise_id,p_product_id,x.uid,p_attempt_id,p_request_hash,p_snapshot_hash,p_product_version,0,(p_snapshot->'config_snapshot'->>'energyRate')::numeric,(p_snapshot->'config_snapshot'->>'energyRate')::numeric,p_suggested_price,p_snapshot);
 RETURN QUERY SELECT 'created',p_attempt_id;
END $$;

ALTER FUNCTION private.stage6c_manual_snapshot_ok(jsonb,uuid,bigint,numeric) OWNER TO postgres;
ALTER FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.stage6c_manual_snapshot_ok(jsonb,uuid,bigint,numeric),public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric) TO service_role;
COMMIT;

-- M7.2-C.3a: approved operational matrix. REVIEW ONLY; not applied by this agent.
BEGIN;
-- Depends on 20261026175500: event_uuid is separate from the bigint identity PK.
DO $preflight$
BEGIN
  IF to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid='public.order_events'::regclass AND a.attname='event_uuid'
         AND a.atttypid='pg_catalog.uuid'::regtype AND a.attnotnull AND NOT a.attisdropped)
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regprocedure('public.allocate_order_stock(uuid,uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'orders_c3_dependency_missing';
  END IF;
END $preflight$;

CREATE FUNCTION public.transition_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
  p_target_status text,p_reason text DEFAULT NULL
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; ev public.order_events%ROWTYPE;
  result_value jsonb; result_order uuid; result_event uuid; result_version bigint;
  old_status text; new_event uuid; allowed boolean; needs_reason boolean;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 OR p_target_status IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  reason_value:=pg_catalog.btrim(p_reason);
  IF p_reason IS NOT NULL AND (reason_value='' OR pg_catalog.length(reason_value)>1000) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid,'sales.write') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  -- Central authorization resolves the effective plan; transition has no physical entitlement gate.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version,
    'target_status',p_target_status,'reason',p_reason));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:transition:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=actor AND r.command_name='transition' AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'transition' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'operational_status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(receipt.result->'event_id') IS DISTINCT FROM 'string'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_order:=(receipt.result->>'order_id')::uuid;
      result_event:=(receipt.result->>'event_id')::uuid;
      result_version:=(receipt.result->>'version')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF receipt.result->>'status' IS DISTINCT FROM 'transitioned'
       OR receipt.result->>'operational_status' IS DISTINCT FROM p_target_status
       OR result_order IS DISTINCT FROM p_order_id OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version>9007199254740991
       OR NOT EXISTS(SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid AND x.id=result_order AND x.version>=result_version) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    SELECT e.* INTO ev FROM public.order_events e WHERE e.enterprise_id=eid AND e.event_uuid=result_event;
    IF NOT FOUND OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
       OR ev.event_type IS DISTINCT FROM 'status_changed' OR ev.order_version IS DISTINCT FROM result_version
       OR ev.to_status IS DISTINCT FROM p_target_status OR ev.reason IS DISTINCT FROM reason_value
       OR ev.metadata->>'attempt_id' IS DISTINCT FROM p_attempt_id::text
       OR ev.metadata->>'payload_hash' IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    old_status:=ev.from_status;
  ELSE
    SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
    IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
    IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
    old_status:=o.operational_status;
  END IF;
  allowed:=CASE old_status
    WHEN 'em_conversao' THEN p_target_status='orcado'
    WHEN 'orcado' THEN p_target_status IN ('em_conversao','pago','modelando')
    WHEN 'pago' THEN p_target_status IN ('orcado','modelando')
    WHEN 'modelando' THEN p_target_status IN ('pago','orcado','imprimindo')
    WHEN 'imprimindo' THEN p_target_status='modelando'
    ELSE false END;
  needs_reason:=(old_status,p_target_status) IN (
    ('orcado','em_conversao'),('pago','orcado'),('modelando','pago'),
    ('modelando','orcado'),('imprimindo','modelando'),('orcado','modelando'));
  IF NOT COALESCE(allowed,false) OR (needs_reason AND reason_value IS NULL) THEN
    IF result_event IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF NOT COALESCE(allowed,false) THEN RAISE EXCEPTION 'invalid_order_transition' USING ERRCODE='P0001'; END IF;
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  IF result_event IS NOT NULL THEN
    RETURN QUERY SELECT 'transitioned'::text,result_order,p_target_status,result_version,result_event;
    RETURN;
  END IF;
  UPDATE public.orders x SET operational_status=p_target_status,version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  INSERT INTO public.order_events(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,reason,metadata)
    VALUES(eid,p_order_id,actor,'status_changed',old_status,p_target_status,o.version,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value))
    RETURNING public.order_events.event_uuid INTO new_event;
  result_value:=pg_catalog.jsonb_build_object('status','transitioned','order_id',p_order_id,
    'operational_status',p_target_status,'version',o.version,'event_id',new_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'transition',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'transitioned'::text,p_order_id,p_target_status,o.version,new_event;
END $$;
ALTER FUNCTION public.transition_order(uuid,uuid,bigint,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transition_order(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid,uuid,bigint,text,text) TO authenticated;
COMMIT;

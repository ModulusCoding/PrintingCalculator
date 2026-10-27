-- M7.2-C4, approved F1/F2/F3/F4. Local source implementation; NOT APPLIED.
-- Existing append-only ledger is the only financial source. No external refund,
-- operational transition, inventory effect, paid-plan gate or fake zero receipt.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.order_payments') IS NULL
     OR to_regclass('private.order_operation_receipts') IS NULL
     OR to_regprocedure('private.orders_c1_decimal(text,numeric,integer)') IS NULL
     OR to_regprocedure('private.orders_c1_payload_hash(jsonb)') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('public.deliver_order(uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'orders_c4_dependency_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.order_events'::regclass AND attname='event_uuid'
        AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attname='event_uuid'
       WHERE k.conrelid='public.order_events'::regclass AND k.contype='u'
         AND k.conkey=ARRAY[a.attnum] AND k.convalidated AND NOT k.condeferrable)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.order_payments'::regclass
       AND tgname='order_payments_immutable' AND tgenabled='O' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.order_events'::regclass
       AND tgname='order_events_immutable' AND tgenabled='O' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'orders_c4_schema_mismatch';
  END IF;
END $preflight$;

-- Block concurrent old writers throughout data preflight/index/guard installation.
LOCK TABLE public.orders, public.order_payments, private.order_operation_receipts
  IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION private.orders_c4_financial(p_enterprise_id uuid,p_order_id uuid)
RETURNS TABLE(order_id uuid,version bigint,operational_status text,total_amount numeric,
  total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
  financial_status text,cancelled_unreversed_amount numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
  -- One statement / one snapshot, including commercial total and ledger semantics.
  SELECT o.id,o.version,o.operational_status,o.total_amount,
    coalesce(sum(p.amount) FILTER (WHERE p.entry_type='receipt'),0) AS received,
    coalesce(sum(p.amount) FILTER (WHERE p.entry_type='refund'),0) AS refunded,
    coalesce(bool_or(p.entry_type='refund' AND (r.id IS NULL OR r.entry_type<>'receipt'
      OR r.amount IS DISTINCT FROM p.amount OR r.method IS DISTINCT FROM p.method
      OR p.note IS NULL OR pg_catalog.length(pg_catalog.btrim(p.note)) NOT BETWEEN 1 AND 1000)),false) AS invalid_refund,
    count(p.id) FILTER (WHERE p.entry_type='refund') AS refund_count,
    count(DISTINCT p.reverses_payment_id) FILTER (WHERE p.entry_type='refund') AS reversed_count
  INTO s FROM public.orders o
  LEFT JOIN public.order_payments p ON p.enterprise_id=o.enterprise_id AND p.order_id=o.id
  LEFT JOIN public.order_payments r ON r.enterprise_id=p.enterprise_id AND r.order_id=p.order_id
    AND r.id=p.reverses_payment_id
  WHERE o.enterprise_id=p_enterprise_id AND o.id=p_order_id
  GROUP BY o.id,o.version,o.operational_status,o.total_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF s.invalid_refund OR s.refund_count<>s.reversed_count
     OR s.received-s.refunded<0 OR s.received-s.refunded>s.total_amount THEN
    RAISE EXCEPTION 'payment_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN QUERY SELECT s.id,s.version,s.operational_status,s.total_amount,s.received,s.refunded,
    s.received-s.refunded,s.total_amount-s.received+s.refunded,
    CASE WHEN s.received-s.refunded=s.total_amount THEN 'pago'
      WHEN s.received=s.refunded THEN 'pendente' ELSE 'parcial' END,
    CASE WHEN s.operational_status='cancelado' THEN s.received-s.refunded ELSE 0::numeric END;
END $$;

DO $data_preflight$
DECLARE o record;
BEGIN
  -- An unknown prior financial receipt protocol cannot be authenticated as C4.
  IF EXISTS (SELECT 1 FROM private.order_operation_receipts r
      WHERE r.command_name IN ('record_payment','reverse_payment')) THEN
    RAISE EXCEPTION 'orders_c4_prior_receipts_require_review';
  END IF;
  FOR o IN SELECT x.enterprise_id,x.id FROM public.orders x LOOP
    PERFORM 1 FROM private.orders_c4_financial(o.enterprise_id,o.id);
  END LOOP;
END $data_preflight$;

CREATE UNIQUE INDEX order_payments_one_refund_idx
  ON public.order_payments(enterprise_id,reverses_payment_id) WHERE entry_type='refund';

CREATE FUNCTION private.orders_c4_total_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
  -- UPDATE already owns the order row lock, shared by both payment commands.
  -- This guard has no operational/physical side effects and does not replace C2c.
  SELECT * INTO s FROM private.orders_c4_financial(OLD.enterprise_id,OLD.id);
  IF NEW.total_amount<s.net_received THEN
    RAISE EXCEPTION 'total_below_net_received' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_c4_total_guard BEFORE UPDATE OF total_amount ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.orders_c4_total_guard();

-- Private shared command engine; callers cannot select an actor/enterprise.
-- Returns a typed, verified JSON snapshot for the two thin public TABLE wrappers.
CREATE FUNCTION private.orders_c4_mutate(p_command text,p_attempt_id uuid,p_order_id uuid,
  p_expected_version bigint,p_amount text,p_method text,p_payment_id uuid,
  p_effective_at timestamptz,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; amount_value numeric; hash_value text; request_value jsonb;
  receipt private.order_operation_receipts%ROWTYPE; o public.orders%ROWTYPE;
  original public.order_payments%ROWTYPE; pay public.order_payments%ROWTYPE;
  ev public.order_events%ROWTYPE; s record; result_value jsonb; metadata_value jsonb;
  result_event uuid; result_payment uuid; result_version bigint; field_name text;
  expected_status text; expected_event text; expected_financial_status text; permission_value text; note_value text;
  received_value numeric; refunded_value numeric; net_value numeric; total_value numeric;
  pending_value numeric; cancelled_value numeric;
BEGIN
  IF p_command IS NULL OR p_command NOT IN ('record_payment','reverse_payment')
     OR p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
     OR p_effective_at IS NULL OR NOT pg_catalog.isfinite(p_effective_at) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  note_value:=p_note;
  IF p_command='record_payment' THEN
    amount_value:=private.orders_c1_decimal(p_amount,999999999999.99,2);
    IF amount_value<0.01 OR p_method IS NULL OR p_method NOT IN ('pix','card','cash','bank_transfer','other')
       OR (p_note IS NOT NULL AND pg_catalog.length(p_note)>1000) OR p_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    expected_status:='payment_received'; expected_event:='payment_received'; permission_value:='sales.write';
  ELSE
    note_value:=pg_catalog.btrim(p_note);
    IF p_payment_id IS NULL OR note_value IS NULL OR pg_catalog.length(note_value) NOT BETWEEN 1 AND 1000
       OR p_amount IS NOT NULL OR p_method IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
    END IF;
    expected_status:='payment_refunded'; expected_event:='payment_refunded'; permission_value:='sales.delete';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid,permission_value) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  -- Retain raw decimal text (1 and 1.00 are different attempts); canonical UTC
  -- date representation avoids session TimeZone affecting identical retries.
  request_value:=pg_catalog.jsonb_build_object('command',p_command,'attempt_id',p_attempt_id,
    'order_id',p_order_id,'expected_version',p_expected_version,'amount',p_amount,'method',p_method,
    'original_payment_id',p_payment_id,'effective_at',pg_catalog.timezone('UTC',p_effective_at),'note',p_note);
  hash_value:=private.orders_c1_payload_hash(request_value);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:'||p_command||':'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=actor AND r.command_name=p_command AND r.attempt_id=p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    result_value:=receipt.result;
    IF receipt.order_id IS DISTINCT FROM p_order_id OR pg_catalog.jsonb_typeof(result_value) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    FOREACH field_name IN ARRAY ARRAY['status','payment_id','order_id','event_id','financial_status'] LOOP
      IF pg_catalog.jsonb_typeof(result_value->field_name) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
    END LOOP;
    FOREACH field_name IN ARRAY ARRAY['version','total_amount','total_received','total_refunded','net_received','pending_amount','cancelled_unreversed_amount'] LOOP
      IF pg_catalog.jsonb_typeof(result_value->field_name) IS DISTINCT FROM 'number'
         OR (result_value->>field_name) !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
    END LOOP;
    BEGIN
      result_event:=(result_value->>'event_id')::uuid;
      result_payment:=(result_value->>'payment_id')::uuid;
      result_version:=(result_value->>'version')::bigint;
      IF (result_value->>'order_id')::uuid IS DISTINCT FROM p_order_id THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
      total_value:=(result_value->>'total_amount')::numeric;
      received_value:=(result_value->>'total_received')::numeric;
      refunded_value:=(result_value->>'total_refunded')::numeric;
      net_value:=(result_value->>'net_received')::numeric;
      pending_value:=(result_value->>'pending_amount')::numeric;
      cancelled_value:=(result_value->>'cancelled_unreversed_amount')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    expected_financial_status:=CASE
      WHEN net_value=total_value THEN 'pago'
      WHEN net_value=0 THEN 'pendente'
      ELSE 'parcial'
    END;
    IF result_value->>'status' IS DISTINCT FROM expected_status
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991
       OR (result_value->>'version') !~ '^[0-9]+$'
       OR total_value>999999999999.99 OR net_value<>received_value-refunded_value
       OR net_value>total_value OR pending_value<>total_value-net_value
       OR cancelled_value NOT IN (0,net_value)
       OR result_value->>'financial_status' IS DISTINCT FROM expected_financial_status
       OR NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid
         AND x.id=p_order_id AND x.version>=result_version) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    SELECT x.* INTO ev FROM public.order_events x WHERE x.enterprise_id=eid AND x.event_uuid=result_event;
    IF NOT FOUND OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
       OR ev.event_type IS DISTINCT FROM expected_event OR ev.order_version IS DISTINCT FROM result_version
       OR ev.from_status IS NOT NULL OR ev.to_status IS NOT NULL
       OR ev.recorded_at IS DISTINCT FROM receipt.created_at
       OR ev.reason IS DISTINCT FROM (CASE WHEN p_command='reverse_payment' THEN note_value ELSE NULL::text END)
       OR ev.metadata IS DISTINCT FROM pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,
         'payload_hash',hash_value,'request',request_value,'snapshot',result_value) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Immutable event authenticates the HISTORICAL totals, not today's balance.
    -- Independently authenticate the ledger identity, input date/reason and refund chain.
    SELECT x.* INTO pay FROM public.order_payments x WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=result_payment;
    IF NOT FOUND OR pay.actor_id IS DISTINCT FROM actor OR pay.effective_at IS DISTINCT FROM p_effective_at
       OR pay.note IS DISTINCT FROM note_value OR pay.recorded_at IS DISTINCT FROM receipt.created_at
       OR pay.entry_type IS DISTINCT FROM (CASE WHEN p_command='record_payment' THEN 'receipt' ELSE 'refund' END)
       OR pay.reverses_payment_id IS DISTINCT FROM p_payment_id
       OR received_value<(CASE WHEN p_command='record_payment' THEN pay.amount ELSE 0 END)
       OR refunded_value<(CASE WHEN p_command='reverse_payment' THEN pay.amount ELSE 0 END) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF p_command='record_payment' THEN
      IF pay.amount IS DISTINCT FROM amount_value OR pay.method IS DISTINCT FROM p_method THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
    ELSE
      SELECT x.* INTO original FROM public.order_payments x
        WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=p_payment_id;
      IF NOT FOUND OR original.entry_type<>'receipt' OR original.reverses_payment_id IS NOT NULL
         OR original.amount IS DISTINCT FROM pay.amount OR original.method IS DISTINCT FROM pay.method
         OR (SELECT count(*) FROM public.order_payments x WHERE x.enterprise_id=eid
           AND x.reverses_payment_id=p_payment_id AND x.entry_type='refund')<>1 THEN
        RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
      END IF;
    END IF;
    RETURN result_value;
  END IF;

  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  SELECT * INTO s FROM private.orders_c4_financial(eid,p_order_id);
  IF p_command='record_payment' THEN
    IF o.operational_status='cancelado' THEN RAISE EXCEPTION 'order_cancelled' USING ERRCODE='P0001'; END IF;
    IF amount_value>s.pending_amount THEN RAISE EXCEPTION 'payment_exceeds_pending' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT x.* INTO original FROM public.order_payments x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=p_payment_id FOR UPDATE;
    IF NOT FOUND OR original.entry_type<>'receipt' OR original.reverses_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'payment_unavailable' USING ERRCODE='P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_payments x WHERE x.enterprise_id=eid
        AND x.entry_type='refund' AND x.reverses_payment_id=p_payment_id) THEN
      RAISE EXCEPTION 'payment_already_reversed' USING ERRCODE='23505';
    END IF;
    amount_value:=original.amount;
  END IF;
  INSERT INTO public.order_payments(enterprise_id,order_id,actor_id,entry_type,amount,method,effective_at,reverses_payment_id,note)
    VALUES(eid,p_order_id,actor,CASE WHEN p_command='record_payment' THEN 'receipt' ELSE 'refund' END,
      amount_value,CASE WHEN p_command='record_payment' THEN p_method ELSE original.method END,
      p_effective_at,p_payment_id,note_value) RETURNING * INTO pay;
  IF pay.id IS NULL OR pay.enterprise_id IS DISTINCT FROM eid OR pay.order_id IS DISTINCT FROM p_order_id
     OR pay.actor_id IS DISTINCT FROM actor OR pay.amount IS DISTINCT FROM amount_value
     OR pay.method IS DISTINCT FROM (CASE WHEN p_command='record_payment' THEN p_method ELSE original.method END)
     OR pay.entry_type IS DISTINCT FROM (CASE WHEN p_command='record_payment' THEN 'receipt' ELSE 'refund' END)
     OR pay.effective_at IS DISTINCT FROM p_effective_at OR pay.recorded_at IS DISTINCT FROM pg_catalog.now()
     OR pay.reverses_payment_id IS DISTINCT FROM p_payment_id OR pay.note IS DISTINCT FROM note_value THEN
    RAISE EXCEPTION 'payment_ledger_unavailable' USING ERRCODE='23514';
  END IF;
  UPDATE public.orders x SET version=x.version+1 WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  SELECT * INTO s FROM private.orders_c4_financial(eid,p_order_id);
  result_event:=pg_catalog.gen_random_uuid();
  result_value:=pg_catalog.jsonb_build_object('status',expected_status,'payment_id',pay.id,'order_id',p_order_id,
    'version',o.version,'event_id',result_event,'total_amount',s.total_amount,'total_received',s.total_received,
    'total_refunded',s.total_refunded,'net_received',s.net_received,'pending_amount',s.pending_amount,
    'financial_status',s.financial_status,'cancelled_unreversed_amount',s.cancelled_unreversed_amount);
  metadata_value:=pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value,
    'request',request_value,'snapshot',result_value);
  INSERT INTO public.order_events(event_uuid,enterprise_id,order_id,actor_id,event_type,order_version,reason,metadata)
    VALUES(result_event,eid,p_order_id,actor,expected_event,o.version,
      CASE WHEN p_command='reverse_payment' THEN note_value ELSE NULL END,metadata_value)
    RETURNING * INTO ev;
  IF ev.event_uuid IS DISTINCT FROM result_event OR ev.enterprise_id IS DISTINCT FROM eid
     OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
     OR ev.event_type IS DISTINCT FROM expected_event OR ev.order_version IS DISTINCT FROM o.version
     OR ev.from_status IS NOT NULL OR ev.to_status IS NOT NULL OR ev.metadata IS DISTINCT FROM metadata_value
     OR ev.reason IS DISTINCT FROM (CASE WHEN p_command='reverse_payment' THEN note_value ELSE NULL::text END) THEN
    RAISE EXCEPTION 'payment_event_unavailable' USING ERRCODE='23514';
  END IF;
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,p_command,p_attempt_id,hash_value,p_order_id,result_value);
  RETURN result_value;
END $$;

CREATE FUNCTION public.record_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
  p_amount text,p_method text,p_effective_at timestamptz,p_note text DEFAULT NULL)
RETURNS TABLE(status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,total_amount numeric,
  total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
  financial_status text,cancelled_unreversed_amount numeric)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT r.* FROM pg_catalog.jsonb_to_record(private.orders_c4_mutate('record_payment',p_attempt_id,
    p_order_id,p_expected_version,p_amount,p_method,NULL,p_effective_at,p_note)) AS r(
    status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,total_amount numeric,
    total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
    financial_status text,cancelled_unreversed_amount numeric);
$$;
CREATE FUNCTION public.reverse_order_payment(p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,
  p_payment_id uuid,p_effective_at timestamptz,p_reason text)
RETURNS TABLE(status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,total_amount numeric,
  total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
  financial_status text,cancelled_unreversed_amount numeric)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT r.* FROM pg_catalog.jsonb_to_record(private.orders_c4_mutate('reverse_payment',p_attempt_id,
    p_order_id,p_expected_version,NULL,NULL,p_payment_id,p_effective_at,p_reason)) AS r(
    status text,payment_id uuid,order_id uuid,version bigint,event_id uuid,total_amount numeric,
    total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
    financial_status text,cancelled_unreversed_amount numeric);
$$;

CREATE FUNCTION private.orders_c4_reader()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; actor uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(c.enterprise_id,'sales.read') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  RETURN c.enterprise_id;
END $$;
CREATE FUNCTION public.get_order_financial_summary(p_order_id uuid)
RETURNS TABLE(order_id uuid,version bigint,operational_status text,total_amount numeric,
  total_received numeric,total_refunded numeric,net_received numeric,pending_amount numeric,
  financial_status text,cancelled_unreversed_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  eid:=private.orders_c4_reader();
  RETURN QUERY SELECT s.* FROM private.orders_c4_financial(eid,p_order_id) s;
END $$;
CREATE FUNCTION public.get_order_payment_history(p_order_id uuid,p_limit integer DEFAULT 50,
  p_before_recorded_at timestamptz DEFAULT NULL,p_before_payment_id uuid DEFAULT NULL)
RETURNS TABLE(payment_id uuid,order_id uuid,actor_id uuid,entry_type text,amount numeric,method text,
  effective_at timestamptz,recorded_at timestamptz,reverses_payment_id uuid,note text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid;
BEGIN
  IF p_order_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_recorded_at IS NULL)<>(p_before_payment_id IS NULL)
     OR (p_before_recorded_at IS NOT NULL AND NOT pg_catalog.isfinite(p_before_recorded_at)) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  eid:=private.orders_c4_reader();
  PERFORM 1 FROM private.orders_c4_financial(eid,p_order_id);
  RETURN QUERY SELECT x.id,x.order_id,x.actor_id,x.entry_type,x.amount,x.method,x.effective_at,
    x.recorded_at,x.reverses_payment_id,x.note FROM public.order_payments x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND (p_before_recorded_at IS NULL OR (x.recorded_at,x.id)<(p_before_recorded_at,p_before_payment_id))
    ORDER BY x.recorded_at DESC,x.id DESC LIMIT p_limit;
END $$;

-- No defensive ledger INSERT trigger: application/service roles retain no direct
-- DML; the sole two new writers serialize on order BEFORE original payment locks.
-- An administrator bypassing these RPCs remains outside the supported protocol.
-- Cancelled pending is historical commercial arithmetic, NOT an active collection
-- instruction. cancelled_unreversed_amount is the net to manually settle/return.
-- A revoked client table access but did not explicitly revoke service_role on
-- public tables. Hosted default ACLs are not represented in this repository.
-- Close direct writes on the four protocol tables before asserting effective
-- privileges; do not depend on RLS to constrain a BYPASSRLS service role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders, public.order_payments,
  public.order_events, private.order_operation_receipts FROM PUBLIC,anon,authenticated,service_role;

DO $security$
DECLARE signature text; f oid; is_public boolean;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'private.orders_c4_financial(uuid,uuid)',
    'private.orders_c4_total_guard()',
    'private.orders_c4_mutate(text,uuid,uuid,bigint,text,text,uuid,timestamp with time zone,text)',
    'private.orders_c4_reader()',
    'public.record_order_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text)',
    'public.reverse_order_payment(uuid,uuid,bigint,uuid,timestamp with time zone,text)',
    'public.get_order_financial_summary(uuid)',
    'public.get_order_payment_history(uuid,integer,timestamp with time zone,uuid)'
  ] LOOP
    f:=pg_catalog.to_regprocedure(signature);
    IF f IS NULL THEN RAISE EXCEPTION 'orders_c4_signature_missing: %',signature; END IF;
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO postgres',f::regprocedure);
    EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path = %L',f::regprocedure,'');
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f::regprocedure);
    is_public:=signature LIKE 'public.%';
    IF is_public THEN
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f::regprocedure);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
        WHERE p.oid=f AND p.prosecdef AND r.rolname='postgres' AND p.proconfig @> ARRAY['search_path=""'])
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
         WHERE p.oid=f AND a.privilege_type='EXECUTE' AND a.grantee=0)
       OR pg_catalog.has_function_privilege('anon',f,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',f,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',f,'EXECUTE') IS DISTINCT FROM is_public THEN
      RAISE EXCEPTION 'orders_c4_function_security_mismatch: %',signature;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
      WHERE i.indexrelid='public.order_payments_one_refund_idx'::regclass AND i.indisunique AND i.indisvalid)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='public.orders'::regclass
       AND t.tgname='orders_c4_total_guard' AND t.tgenabled='O' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'orders_c4_guard_missing';
  END IF;
  FOREACH signature IN ARRAY ARRAY['public.orders','public.order_payments','public.order_events','private.order_operation_receipts'] LOOP
    IF pg_catalog.has_table_privilege('authenticated',signature,'INSERT,UPDATE,DELETE,TRUNCATE')
       OR pg_catalog.has_table_privilege('anon',signature,'INSERT,UPDATE,DELETE,TRUNCATE')
       OR pg_catalog.has_table_privilege('service_role',signature,'INSERT,UPDATE,DELETE,TRUNCATE')
       OR pg_catalog.has_any_column_privilege('authenticated',signature,'INSERT,UPDATE')
       OR pg_catalog.has_any_column_privilege('anon',signature,'INSERT,UPDATE')
       OR pg_catalog.has_any_column_privilege('service_role',signature,'INSERT,UPDATE') THEN
      RAISE EXCEPTION 'orders_c4_unexpected_direct_dml: %',signature;
    END IF;
  END LOOP;
END $security$;
COMMIT;
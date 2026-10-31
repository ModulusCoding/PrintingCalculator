-- PREPARADO, NÃO EXECUTADO. SQL Editor do projeto descartável autorizado somente.
BEGIN;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
-- Inspector snapshots; business commands below run with authenticated privileges.
INSERT INTO flex_manual_test.checkpoints(label,data)
SELECT '02_before',jsonb_build_object(
  'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.product_inventory i
    WHERE i.enterprise_id=(SELECT enterprise_id FROM flex_manual_test.actors WHERE label='owner_visionary')),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.order_payments p
    WHERE p.order_id=(SELECT id FROM flex_manual_test.objects WHERE label='transition')));
SELECT flex_manual_test.set_actor('owner_visionary');
SET LOCAL ROLE authenticated;
DO $tests$
DECLARE oid uuid; v bigint; r record; spec record; attempt uuid; payload jsonb;
BEGIN
  SELECT id INTO STRICT oid FROM flex_manual_test.objects WHERE label='transition';
  -- Return to em_conversao between forward cases: this also tests long regressions.
  FOR spec IN SELECT * FROM (VALUES
    (1,'orcado',NULL::text),(2,'em_conversao','retorno 1'),
    (3,'modelando',NULL),(4,'em_conversao','retorno 2'),
    (5,'imprimindo',NULL),(6,'orcado','retrocesso longo'),
    (7,'imprimindo','motivo opcional no avanço'),(8,'modelando','retorno 3'),
    (9,'em_conversao','retorno 4'),(10,'modelando',NULL),
    (11,'em_conversao','retorno 5'),(12,'orcado',NULL),(13,'imprimindo',NULL)
  ) t(seq,target,reason) ORDER BY seq LOOP
    SELECT s.version INTO STRICT v FROM public.get_order_financial_summary(oid) s;
    attempt:=gen_random_uuid();
    payload:=jsonb_build_object('p_attempt_id',attempt,'p_order_id',oid,'p_expected_version',v,
      'p_target_status',spec.target,'p_reason',spec.reason);
    SELECT * INTO STRICT r FROM public.transition_order(attempt,oid,v,spec.target,spec.reason);
    PERFORM flex_manual_test.assert_true(r.status='transitioned' AND r.order_id=oid
      AND r.operational_status=spec.target AND r.version=v+1 AND r.event_id IS NOT NULL,
      'transition result '||spec.seq);
    INSERT INTO flex_manual_test.calls(label,rpc,payload,result)
      VALUES('transition_'||spec.seq,'transition_order',payload,to_jsonb(r));
  END LOOP;
  SELECT s.version INTO STRICT v FROM public.get_order_financial_summary(oid) s;
  -- All expected errors run in subtransactions; check SQLSTATE AND exact domain message.
  FOR spec IN SELECT * FROM (VALUES
    ('missing backward','orcado',NULL::text,v,'22023','invalid_input'),
    ('blank backward','orcado','   ',v,'22023','invalid_input'),
    ('too long','orcado',repeat('x',1001),v,'22023','invalid_input'),
    ('same status','imprimindo',NULL,v,'P0001','invalid_order_transition'),
    ('special delivery','entregue',NULL,v,'P0001','invalid_order_transition'),
    ('special cancellation','cancelado',NULL,v,'P0001','invalid_order_transition'),
    ('stale version','orcado','reason',v-1,'40001','version_conflict')
  ) t(label,target,reason,expected_version,expected_state,expected_message) LOOP
    BEGIN
      PERFORM public.transition_order(gen_random_uuid(),oid,spec.expected_version,spec.target,spec.reason);
      RAISE EXCEPTION 'manual_flex_expected_error_missing: %',spec.label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE IS DISTINCT FROM spec.expected_state OR SQLERRM IS DISTINCT FROM spec.expected_message THEN
        RAISE EXCEPTION 'manual_flex_wrong_error [%]: got % %, expected % %',
          spec.label,SQLSTATE,SQLERRM,spec.expected_state,spec.expected_message;
      END IF;
    END;
  END LOOP;
  PERFORM flex_manual_test.assert_true((SELECT s.version=v FROM public.get_order_financial_summary(oid) s),
    'failed transitions changed version');
END $tests$;
RESET ROLE;
DO $audit$
DECLARE before_value jsonb; after_value jsonb;
BEGIN
  SELECT data INTO STRICT before_value FROM flex_manual_test.checkpoints WHERE label='02_before';
  SELECT jsonb_build_object(
    'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.product_inventory i
      WHERE i.enterprise_id=(SELECT enterprise_id FROM flex_manual_test.actors WHERE label='owner_visionary')),
    'payments',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.order_payments p
      WHERE p.order_id=(SELECT id FROM flex_manual_test.objects WHERE label='transition')))
    INTO after_value;
  PERFORM flex_manual_test.assert_true(before_value=after_value,'transition touched inventory/payment ledger');
  PERFORM flex_manual_test.assert_true(NOT EXISTS (
    SELECT 1 FROM flex_manual_test.calls c LEFT JOIN public.order_events e
      ON e.event_uuid=(c.result->>'event_id')::uuid
    WHERE c.rpc='transition_order' AND (e.event_uuid IS NULL OR e.event_type<>'status_changed'
      OR e.order_version<>(c.result->>'version')::bigint OR e.to_status<>c.payload->>'p_target_status'
      OR e.reason IS DISTINCT FROM btrim(c.payload->>'p_reason'))),'transition immutable event mismatch');
END $audit$;
COMMIT;
SELECT '02 PASS only if transaction committed without error' AS result;

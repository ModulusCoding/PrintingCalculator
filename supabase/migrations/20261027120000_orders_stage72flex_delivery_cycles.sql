-- WARNING: multi-part installation is NOT atomic across files.
-- Only run in order 01 -> 02 -> 03, after a verified backup.
BEGIN;
-- M7.2-D.3 FLEX: local candidate, NOT APPLIED. No financial contract changes.
-- Requires catalog compatibility and PostgreSQL/concurrency homologation before use.
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));

-- FLEX schema fragment. Included inside the assembler's transaction; no BEGIN/COMMIT.
-- No database execution performed. Classification contract: actual_delivery / incorrect_record.
DO $flex_preflight$
DECLARE x record; rel regclass; signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.deliver_order(uuid,uuid,bigint)',
    'public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)',
    'private.finalize_order_item_reservation(uuid,uuid,uuid,text,text)',
    'private.orders_c1_payload_hash(jsonb)',
    'private.orders_c4_financial(uuid,uuid)',
    'private.orders_c4_total_guard()'
  ] LOOP
    IF pg_catalog.to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'orders_flex_dependency_missing: %',signature;
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['public.orders','public.order_items','public.order_events',
    'public.order_stock_reservations','public.order_stock_settlements','public.products',
    'public.product_inventory','public.product_inventory_movements','public.order_payments',
    'private.order_operation_receipts'] LOOP
    rel:=pg_catalog.to_regclass(signature);
    IF rel IS NULL THEN RAISE EXCEPTION 'orders_flex_relation_missing: %',signature; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=rel AND relkind='r' AND relrowsecurity) THEN
      RAISE EXCEPTION 'orders_flex_relation_security_mismatch: %',signature;
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM (VALUES
    ('public.order_events','event_uuid','uuid',true),('public.order_events','id','bigint',true),
    ('public.order_events','order_version','bigint',true),
    ('public.order_stock_settlements','id','uuid',true),
    ('public.order_stock_settlements','enterprise_id','uuid',true),
    ('public.order_stock_settlements','order_id','uuid',true),
    ('public.order_stock_settlements','order_item_id','uuid',true),
    ('public.order_stock_settlements','reservation_id','uuid',true),
    ('public.order_stock_settlements','movement_id','uuid',true),
    ('public.order_stock_settlements','product_id','uuid',true),
    ('public.order_stock_settlements','delivery_operation_id','uuid',true),
    ('public.order_stock_settlements','quantity','bigint',true),
    ('public.order_items','quantity','bigint',true),
    ('public.product_inventory','balance','bigint',true),
    ('public.product_inventory','reserved_balance','bigint',true),
    ('public.product_inventory','version','bigint',true),
    ('public.product_inventory_movements','id','uuid',true),
    ('public.product_inventory_movements','quantity','bigint',true),
    ('public.product_inventory_movements','balance_before','bigint',true),
    ('public.product_inventory_movements','balance_after','bigint',true),
    ('public.product_inventory_movements','request_expected_version','bigint',true),
    ('public.product_inventory_movements','result_version','bigint',true),
    ('public.product_inventory_movements','request_quantity','bigint',false),
    ('public.product_inventory_movements','request_counted_balance','bigint',false)
  ) v(tbl,col,typ,nn) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=x.tbl::regclass
      AND a.attname=x.col AND a.atttypid=x.typ::regtype AND a.attnotnull=x.nn AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'orders_flex_effective_type_mismatch: %.%',x.tbl,x.col;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.order_events'::regclass
    AND attname='id' AND attidentity='a') THEN RAISE EXCEPTION 'orders_flex_event_identity_mismatch'; END IF;
  FOR x IN SELECT * FROM (VALUES
    ('public.order_events','order_events_immutable','public.order_events_forbid_mutation()'),
    ('public.order_stock_settlements','order_stock_settlements_immutable','public.order_events_forbid_mutation()'),
    ('public.order_stock_reservations','order_stock_reservations_transition_guard','public.order_reservations_validate_transition()'),
    ('public.orders','orders_c4_total_guard','private.orders_c4_total_guard()'),
    ('public.product_inventory_movements','product_inventory_movements_immutable','public.reject_product_inventory_movement_mutation()')
  ) v(tbl,trg,fn) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=x.tbl::regclass
      AND t.tgname=x.trg AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
      AND t.tgfoid=pg_catalog.to_regprocedure(x.fn)
      AND (CASE WHEN x.trg='orders_c4_total_guard' THEN (t.tgtype::integer & 19)=19
        ELSE (t.tgtype::integer & 27)=27 END)
      AND pg_catalog.pg_get_functiondef(t.tgfoid) LIKE '%RAISE EXCEPTION%') THEN
      RAISE EXCEPTION 'orders_flex_required_trigger_missing: %',x.trg;
    END IF;
  END LOOP;
  IF pg_catalog.pg_get_functiondef('public.order_events_forbid_mutation()'::regprocedure) NOT LIKE '%order_events_immutable%'
    OR pg_catalog.pg_get_functiondef('public.order_reservations_validate_transition()'::regprocedure) NOT LIKE '%order_reservation_identity_immutable%'
    OR pg_catalog.pg_get_functiondef('public.order_reservations_validate_transition()'::regprocedure) NOT LIKE '%order_reservation_transition_invalid%' THEN
    RAISE EXCEPTION 'orders_flex_guard_semantics_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid IN
    ('public.order_stock_settlements'::regclass,'public.order_stock_reservations'::regclass,
     'public.order_events'::regclass,'private.order_operation_receipts'::regclass)
    AND (NOT convalidated OR condeferrable)) THEN RAISE EXCEPTION 'orders_flex_untrusted_constraints'; END IF;
END $flex_preflight$;

-- Prevent old RPCs from changing the evidence between preflight and snapshot installation.
LOCK TABLE public.orders,public.order_items,public.order_events,public.order_stock_reservations,
  public.order_stock_settlements,public.product_inventory,public.product_inventory_movements,
  private.order_operation_receipts IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.order_events ADD CONSTRAINT order_events_flex_tenant_order_uuid_key
  UNIQUE(enterprise_id,order_id,event_uuid);
ALTER TABLE public.order_events ADD CONSTRAINT order_events_flex_tenant_uuid_key
  UNIQUE(enterprise_id,event_uuid);
ALTER TABLE public.order_stock_settlements ADD CONSTRAINT order_stock_settlements_flex_delivery_event_fk
  FOREIGN KEY(enterprise_id,order_id,delivery_operation_id)
  REFERENCES public.order_events(enterprise_id,order_id,event_uuid) ON DELETE RESTRICT;

CREATE TABLE public.order_delivery_manifest (
  enterprise_id uuid NOT NULL,
  order_id uuid NOT NULL,
  delivery_event_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  product_id uuid,
  quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
  fulfillment_mode text NOT NULL CHECK(fulfillment_mode IN ('stock','untracked')),
  settlement_id uuid,
  inherited_from_event_id uuid,
  PRIMARY KEY(enterprise_id,delivery_event_id,order_item_id),
  FOREIGN KEY(enterprise_id,order_id) REFERENCES public.orders(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,order_id,delivery_event_id)
    REFERENCES public.order_events(enterprise_id,order_id,event_uuid) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,settlement_id) REFERENCES public.order_stock_settlements(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,inherited_from_event_id,order_item_id)
    REFERENCES public.order_delivery_manifest(enterprise_id,delivery_event_id,order_item_id) ON DELETE RESTRICT,
  CHECK((fulfillment_mode='stock' AND product_id IS NOT NULL AND settlement_id IS NOT NULL)
    OR (fulfillment_mode='untracked' AND settlement_id IS NULL AND inherited_from_event_id IS NULL)),
  CHECK(inherited_from_event_id IS NULL OR inherited_from_event_id<>delivery_event_id)
);
-- Intentionally NO FK to live order_items: this is immutable historical evidence.
CREATE TABLE public.order_delivery_undos (
  enterprise_id uuid NOT NULL,order_id uuid NOT NULL,delivery_event_id uuid NOT NULL,
  undo_event_id uuid NOT NULL,target_status text NOT NULL,classification text NOT NULL,attempt_id uuid NOT NULL,
  PRIMARY KEY(enterprise_id,delivery_event_id),
  UNIQUE(enterprise_id,undo_event_id),
  FOREIGN KEY(enterprise_id,order_id) REFERENCES public.orders(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,order_id,delivery_event_id) REFERENCES public.order_events(enterprise_id,order_id,event_uuid) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,order_id,undo_event_id) REFERENCES public.order_events(enterprise_id,order_id,event_uuid) ON DELETE RESTRICT,
  CHECK(delivery_event_id<>undo_event_id),
  CHECK(target_status IN ('em_conversao','orcado','pago','modelando','imprimindo')),
  CHECK(classification IN ('actual_delivery','incorrect_record'))
);
-- Composite tenant-scoped key required by compensation movement foreign keys.
-- The existing movement id uniqueness alone is not a FK target for (enterprise_id,id).
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_flex_tenant_id_key UNIQUE(enterprise_id,id);

CREATE TABLE public.order_delivery_compensations (
  enterprise_id uuid NOT NULL,settlement_id uuid NOT NULL,original_movement_id uuid NOT NULL,
  compensation_movement_id uuid NOT NULL,undo_event_id uuid NOT NULL,
  PRIMARY KEY(enterprise_id,settlement_id),
  UNIQUE(enterprise_id,compensation_movement_id),
  UNIQUE(enterprise_id,original_movement_id),
  FOREIGN KEY(enterprise_id,settlement_id) REFERENCES public.order_stock_settlements(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,original_movement_id) REFERENCES public.product_inventory_movements(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,compensation_movement_id) REFERENCES public.product_inventory_movements(enterprise_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(enterprise_id,undo_event_id) REFERENCES public.order_delivery_undos(enterprise_id,undo_event_id) ON DELETE RESTRICT,
  CHECK(original_movement_id<>compensation_movement_id)
);

CREATE INDEX order_delivery_manifest_order_idx ON public.order_delivery_manifest(enterprise_id,order_id,delivery_event_id);
CREATE INDEX order_delivery_manifest_settlement_idx ON public.order_delivery_manifest(enterprise_id,settlement_id)
  WHERE settlement_id IS NOT NULL;
CREATE INDEX order_delivery_undos_order_idx ON public.order_delivery_undos(enterprise_id,order_id,undo_event_id);
CREATE INDEX order_delivery_compensations_undo_idx ON public.order_delivery_compensations(enterprise_id,undo_event_id);

ALTER TABLE public.order_events DROP CONSTRAINT order_events_type_check;
ALTER TABLE public.order_events ADD CONSTRAINT order_events_type_check CHECK(event_type IN
  ('created','updated','status_changed','cancelled','reopened','delivered','delivery_undone',
   'payment_received','payment_refunded','stock_allocated','archived'));
ALTER TABLE public.order_events DROP CONSTRAINT order_events_status_pair_check;
ALTER TABLE public.order_events ADD CONSTRAINT order_events_status_pair_check CHECK(
  (event_type='created' AND from_status IS NULL AND to_status='em_conversao')
  OR (event_type IN ('status_changed','cancelled','reopened','delivered') AND from_status IS NOT NULL AND to_status IS NOT NULL)
  OR (event_type='delivery_undone' AND from_status='entregue' AND to_status IN ('em_conversao','orcado','pago','modelando','imprimindo'))
  OR (event_type='updated' AND ((from_status IS NULL AND to_status IS NULL) OR (from_status IS NOT NULL AND to_status IS NOT NULL)))
  OR (event_type IN ('payment_received','payment_refunded','stock_allocated','archived') AND from_status IS NULL AND to_status IS NULL));
ALTER TABLE private.order_operation_receipts DROP CONSTRAINT order_operation_receipts_command_check;
ALTER TABLE private.order_operation_receipts ADD CONSTRAINT order_operation_receipts_command_check CHECK(command_name IN
  ('create','update','transition','cancel','reopen','allocate_stock','deliver','undo_delivery','record_payment','reverse_payment','archive'));

CREATE FUNCTION private.orders_flex_validate_delivery(eid uuid,event_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ev public.order_events%ROWTYPE; row_value record; chain record; exit_record record;
  expected_effect text; previous_undo uuid;
  previous_product uuid; previous_inventory_id uuid; previous_version bigint; previous_balance bigint;
BEGIN
  SELECT e.* INTO ev FROM public.order_events e WHERE e.enterprise_id=eid AND e.event_uuid=event_id;
  IF NOT FOUND OR ev.event_type<>'delivered' OR ev.to_status IS DISTINCT FROM 'entregue'
    OR ev.from_status IS NULL OR ev.from_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo')
    OR ev.order_version NOT BETWEEN 1 AND 9007199254740991 OR ev.reason IS NOT NULL
    OR ev.metadata->>'delivery_operation_id' IS DISTINCT FROM event_id::text
    OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.enterprise_id=eid AND o.id=ev.order_id AND o.version>=ev.order_version)
    OR NOT EXISTS (SELECT 1 FROM public.order_delivery_manifest d WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id)
  THEN RAISE EXCEPTION 'delivery_manifest_inconsistent' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=ev.actor_id AND r.order_id=ev.order_id AND r.command_name='deliver'
    AND r.attempt_id::text=ev.metadata->>'attempt_id' AND r.payload_hash=ev.metadata->>'payload_hash'
    AND r.payload_hash=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
      'attempt_id',r.attempt_id,'order_id',ev.order_id,'expected_version',ev.order_version-1))
    AND r.result=pg_catalog.jsonb_build_object('status','delivered','order_id',ev.order_id,
      'operational_status','entregue','version',ev.order_version,'event_id',event_id))<>1 THEN
    RAISE EXCEPTION 'delivery_receipt_inconsistent' USING ERRCODE='23514';
  END IF;
  FOR row_value IN SELECT d.* FROM public.order_delivery_manifest d
    WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id LOOP
    IF row_value.order_id IS DISTINCT FROM ev.order_id THEN
      RAISE EXCEPTION 'delivery_manifest_inconsistent' USING ERRCODE='23514';
    END IF;
    IF row_value.fulfillment_mode='untracked' THEN CONTINUE; END IF;
    IF row_value.inherited_from_event_id IS NOT NULL THEN
      -- Only inherit directly from the ORIGINAL manifest, never an unbounded recursive chain.
      IF NOT EXISTS (SELECT 1 FROM public.order_delivery_manifest src
        JOIN public.order_events se ON se.enterprise_id=src.enterprise_id AND se.event_uuid=src.delivery_event_id
        JOIN public.order_delivery_undos u ON u.enterprise_id=src.enterprise_id AND u.delivery_event_id=src.delivery_event_id
        JOIN public.order_events ue ON ue.enterprise_id=u.enterprise_id AND ue.event_uuid=u.undo_event_id
        WHERE src.enterprise_id=eid AND src.delivery_event_id=row_value.inherited_from_event_id
          AND src.order_id=ev.order_id AND src.order_item_id=row_value.order_item_id
          AND src.product_id=row_value.product_id AND src.quantity=row_value.quantity
          AND src.settlement_id=row_value.settlement_id AND src.fulfillment_mode='stock'
          AND src.inherited_from_event_id IS NULL AND u.classification='actual_delivery'
          AND ue.event_type='delivery_undone' AND ue.from_status='entregue' AND ue.to_status=u.target_status
          AND ue.order_id=ev.order_id AND ue.order_version>se.order_version AND ue.order_version<ev.order_version)
      THEN RAISE EXCEPTION 'delivery_inheritance_inconsistent' USING ERRCODE='23514'; END IF;
      PERFORM private.orders_flex_validate_delivery(eid,row_value.inherited_from_event_id);
    ELSE
      IF (SELECT count(*) FROM public.order_stock_settlements s
        JOIN public.order_stock_reservations r ON r.enterprise_id=s.enterprise_id AND r.id=s.reservation_id
        JOIN public.product_inventory_movements m ON m.enterprise_id=s.enterprise_id AND m.id=s.movement_id
        JOIN public.product_inventory i ON i.enterprise_id=m.enterprise_id AND i.id=m.inventory_id
        WHERE s.enterprise_id=eid AND s.id=row_value.settlement_id
          AND s.order_id=ev.order_id AND s.order_item_id=row_value.order_item_id
          AND s.product_id=row_value.product_id AND s.quantity=row_value.quantity AND s.delivery_operation_id=event_id
          AND r.order_id=s.order_id AND r.order_item_id=s.order_item_id AND r.product_id=s.product_id
          AND r.quantity=s.quantity AND r.state='consumed' AND r.finalized_at IS NOT NULL AND r.finalization_reason IS NULL
          AND m.product_id=s.product_id AND m.actor_id=ev.actor_id AND m.movement_type='exit'
          AND m.quantity=-s.quantity AND m.request_quantity=s.quantity AND m.request_counted_balance IS NULL
          AND m.reason='Order delivery '||event_id::text AND m.attempt_id::text<>ev.metadata->>'attempt_id'
          AND m.balance_before BETWEEN 0 AND 1000000000 AND m.balance_after BETWEEN 0 AND 1000000000
          AND m.balance_after=m.balance_before-s.quantity AND m.request_expected_version BETWEEN 0 AND 9007199254740990
          AND m.result_version=m.request_expected_version+1 AND i.product_id=s.product_id AND i.version>=m.result_version)<>1
      THEN RAISE EXCEPTION 'delivery_settlement_inconsistent' USING ERRCODE='23514'; END IF;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid AND s.delivery_operation_id=event_id
    AND NOT EXISTS (SELECT 1 FROM public.order_delivery_manifest d WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id
      AND d.settlement_id=s.id AND d.inherited_from_event_id IS NULL)) THEN
    RAISE EXCEPTION 'delivery_settlement_inconsistent' USING ERRCODE='23514';
  END IF;
  FOR chain IN SELECT m.* FROM public.order_delivery_manifest d
    JOIN public.order_stock_settlements s ON s.enterprise_id=d.enterprise_id AND s.id=d.settlement_id
    JOIN public.product_inventory_movements m ON m.enterprise_id=s.enterprise_id AND m.id=s.movement_id
    WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id AND d.inherited_from_event_id IS NULL
    ORDER BY m.inventory_id,m.product_id,m.result_version,m.id LOOP
    IF previous_product IS NOT DISTINCT FROM chain.product_id AND
      previous_inventory_id IS NOT DISTINCT FROM chain.inventory_id AND
      (chain.request_expected_version IS DISTINCT FROM previous_version OR chain.balance_before IS DISTINCT FROM previous_balance)
    THEN RAISE EXCEPTION 'delivery_movement_chain_inconsistent' USING ERRCODE='23514'; END IF;
    previous_product:=chain.product_id; previous_inventory_id:=chain.inventory_id; previous_version:=chain.result_version; previous_balance:=chain.balance_after;
  END LOOP;
  -- An exit is immutable evidence too: authenticate it independently of current state.
  FOR exit_record IN SELECT x.* FROM public.order_delivery_undos x WHERE x.enterprise_id=eid
    AND x.delivery_event_id=event_id LOOP
    expected_effect:=CASE WHEN EXISTS (SELECT 1 FROM public.order_delivery_manifest d
      WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id AND d.settlement_id IS NOT NULL)
      THEN CASE WHEN exit_record.classification='incorrect_record' THEN 'compensated' ELSE 'preserved' END
      ELSE 'no_physical_movement' END;
    IF NOT EXISTS (SELECT 1 FROM public.order_events ue
      JOIN private.order_operation_receipts r ON r.enterprise_id=ue.enterprise_id
        AND r.actor_id=ue.actor_id AND r.order_id=ue.order_id AND r.command_name='undo_delivery'
        AND r.attempt_id=exit_record.attempt_id
      WHERE ue.enterprise_id=eid AND ue.event_uuid=exit_record.undo_event_id AND ue.order_id=ev.order_id
        AND exit_record.order_id=ev.order_id AND ue.event_type='delivery_undone'
        AND ue.from_status='entregue' AND ue.to_status=exit_record.target_status
        AND ue.order_version>ev.order_version AND ue.reason IS NOT NULL
        AND pg_catalog.length(pg_catalog.btrim(ue.reason)) BETWEEN 1 AND 1000
        AND ue.metadata=pg_catalog.jsonb_build_object('attempt_id',exit_record.attempt_id,
          'payload_hash',r.payload_hash,'source_delivery_event_id',event_id,
          'classification',exit_record.classification,'physical_effect',expected_effect)
        AND r.result=pg_catalog.jsonb_build_object('status','delivery_undone','order_id',ev.order_id,
          'operational_status',exit_record.target_status,'version',ue.order_version,'event_id',exit_record.undo_event_id,
          'source_delivery_event_id',event_id,'physical_effect',expected_effect))
      OR (exit_record.classification='incorrect_record' AND (
        EXISTS (SELECT 1 FROM public.order_delivery_manifest d WHERE d.enterprise_id=eid
          AND d.delivery_event_id=event_id AND d.inherited_from_event_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
          AND s.delivery_operation_id=event_id AND NOT EXISTS (
            SELECT 1 FROM public.order_delivery_compensations k WHERE k.enterprise_id=eid
              AND k.settlement_id=s.id AND k.undo_event_id=exit_record.undo_event_id))))
      OR (exit_record.classification='actual_delivery' AND EXISTS (
        SELECT 1 FROM public.order_delivery_compensations k WHERE k.enterprise_id=eid AND k.undo_event_id=exit_record.undo_event_id)) THEN
      RAISE EXCEPTION 'delivery_exit_inconsistent' USING ERRCODE='23514';
    END IF;
  END LOOP;
  -- A compensation does not invalidate replay, but it must itself be authentic.
  IF EXISTS (SELECT 1 FROM public.order_delivery_manifest d
    JOIN public.order_delivery_compensations c ON c.enterprise_id=d.enterprise_id AND c.settlement_id=d.settlement_id
    LEFT JOIN public.order_stock_settlements s ON s.enterprise_id=c.enterprise_id AND s.id=c.settlement_id
    LEFT JOIN public.product_inventory_movements m ON m.enterprise_id=c.enterprise_id AND m.id=c.compensation_movement_id
    LEFT JOIN public.product_inventory_movements original ON original.enterprise_id=c.enterprise_id AND original.id=c.original_movement_id
    LEFT JOIN public.order_delivery_undos u ON u.enterprise_id=c.enterprise_id AND u.undo_event_id=c.undo_event_id
    LEFT JOIN public.order_events ue ON ue.enterprise_id=u.enterprise_id AND ue.event_uuid=u.undo_event_id
    LEFT JOIN public.order_events de ON de.enterprise_id=u.enterprise_id AND de.event_uuid=u.delivery_event_id
    LEFT JOIN public.product_inventory i ON i.enterprise_id=m.enterprise_id AND i.id=m.inventory_id
    WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id AND (
      s.id IS NULL OR m.id IS NULL OR original.id IS NULL OR u.undo_event_id IS NULL OR ue.event_uuid IS NULL
      OR c.original_movement_id IS DISTINCT FROM s.movement_id
      OR s.delivery_operation_id IS DISTINCT FROM u.delivery_event_id
      OR u.classification IS DISTINCT FROM 'incorrect_record' OR u.order_id IS DISTINCT FROM s.order_id
      OR ue.order_id IS DISTINCT FROM s.order_id OR ue.event_type IS DISTINCT FROM 'delivery_undone'
      OR ue.from_status IS DISTINCT FROM 'entregue' OR ue.to_status IS DISTINCT FROM u.target_status
      OR de.event_type IS DISTINCT FROM 'delivered' OR de.order_id IS DISTINCT FROM s.order_id
      OR ue.order_version<=de.order_version OR de.event_uuid IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.order_delivery_manifest ud WHERE ud.enterprise_id=eid
        AND ud.delivery_event_id=u.delivery_event_id AND ud.settlement_id=s.id
        AND ud.inherited_from_event_id IS NULL AND ud.order_id=s.order_id
        AND ud.order_item_id=s.order_item_id AND ud.product_id=s.product_id
        AND ud.quantity=s.quantity AND ud.fulfillment_mode='stock')
      OR m.product_id IS DISTINCT FROM s.product_id OR m.actor_id IS DISTINCT FROM ue.actor_id
      OR m.inventory_id IS DISTINCT FROM original.inventory_id OR m.movement_type IS DISTINCT FROM 'entry'
      OR m.quantity IS DISTINCT FROM s.quantity OR m.request_quantity IS DISTINCT FROM s.quantity
      OR m.request_counted_balance IS NOT NULL OR m.reason IS DISTINCT FROM 'Order delivery correction '||u.undo_event_id::text
      OR m.balance_before NOT BETWEEN 0 AND 1000000000 OR m.balance_after NOT BETWEEN 0 AND 1000000000
      OR m.balance_after IS DISTINCT FROM m.balance_before+s.quantity
      OR m.request_expected_version NOT BETWEEN 0 AND 9007199254740990
      OR m.result_version IS DISTINCT FROM m.request_expected_version+1 OR m.result_version<=original.result_version
      OR i.id IS NULL OR i.product_id IS DISTINCT FROM s.product_id OR i.version<m.result_version
      OR m.attempt_id=u.attempt_id)) THEN
    RAISE EXCEPTION 'delivery_compensation_inconsistent' USING ERRCODE='23514';
  END IF;
  previous_undo:=NULL; previous_product:=NULL; previous_inventory_id:=NULL; previous_version:=NULL; previous_balance:=NULL;
  -- Check the entire undo's per-inventory entry chain, not only one manifest row.
  FOR chain IN SELECT c.undo_event_id,m.* FROM public.order_delivery_compensations c
    JOIN public.product_inventory_movements m ON m.enterprise_id=c.enterprise_id AND m.id=c.compensation_movement_id
    WHERE c.enterprise_id=eid AND c.undo_event_id IN (
      SELECT dc.undo_event_id FROM public.order_delivery_manifest d
      JOIN public.order_delivery_compensations dc ON dc.enterprise_id=d.enterprise_id AND dc.settlement_id=d.settlement_id
      WHERE d.enterprise_id=eid AND d.delivery_event_id=event_id)
    ORDER BY c.undo_event_id,m.inventory_id,m.product_id,m.result_version,m.id LOOP
    IF previous_undo IS NOT DISTINCT FROM chain.undo_event_id
      AND previous_product IS NOT DISTINCT FROM chain.product_id
      AND previous_inventory_id IS NOT DISTINCT FROM chain.inventory_id
      AND (chain.request_expected_version IS DISTINCT FROM previous_version
        OR chain.balance_before IS DISTINCT FROM previous_balance) THEN
      RAISE EXCEPTION 'delivery_compensation_chain_inconsistent' USING ERRCODE='23514';
    END IF;
    previous_undo:=chain.undo_event_id; previous_product:=chain.product_id; previous_inventory_id:=chain.inventory_id;
    previous_version:=chain.result_version; previous_balance:=chain.balance_after;
  END LOOP;
END $$;

CREATE FUNCTION private.orders_flex_valid_coverage(eid uuid,order_id uuid,item_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record; item public.order_items%ROWTYPE; candidate uuid; n integer:=0; current_status text;
BEGIN
  SELECT i.* INTO item FROM public.order_items i WHERE i.enterprise_id=eid AND i.order_id=$2 AND i.id=item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_coverage_item_missing' USING ERRCODE='23514'; END IF;
  SELECT o.operational_status INTO current_status FROM public.orders o WHERE o.enterprise_id=eid AND o.id=$2;
  FOR s IN SELECT z.* FROM public.order_stock_settlements z WHERE z.enterprise_id=eid AND z.order_id=$2
    AND z.order_item_id=item_id AND NOT EXISTS (SELECT 1 FROM public.order_delivery_compensations c
      WHERE c.enterprise_id=eid AND c.settlement_id=z.id) LOOP
    IF item.fulfillment_mode<>'stock' OR s.product_id IS DISTINCT FROM item.product_id OR s.quantity IS DISTINCT FROM item.quantity THEN
      RAISE EXCEPTION 'delivery_coverage_mismatch' USING ERRCODE='23514';
    END IF;
    PERFORM private.orders_flex_validate_delivery(eid,s.delivery_operation_id);
    IF NOT EXISTS (SELECT 1 FROM public.order_delivery_undos u JOIN public.order_events e
      ON e.enterprise_id=u.enterprise_id AND e.event_uuid=u.undo_event_id
      WHERE u.enterprise_id=eid AND u.order_id=$2 AND u.delivery_event_id=s.delivery_operation_id
        AND u.classification='actual_delivery' AND e.event_type='delivery_undone'
        AND e.from_status='entregue' AND e.to_status=u.target_status AND e.order_id=$2) THEN
      IF current_status IS DISTINCT FROM 'entregue' THEN
        RAISE EXCEPTION 'delivery_coverage_exit_missing' USING ERRCODE='23514';
      END IF;
      CONTINUE;
    END IF;
    n:=n+1; candidate:=s.id;
  END LOOP;
  IF n>1 THEN RAISE EXCEPTION 'delivery_coverage_ambiguous' USING ERRCODE='23514'; END IF;
  RETURN candidate;
END $$;

-- Legacy snapshots are only safe while the original delivered aggregate remains
-- terminal and unchanged. Refuse any exited/ambiguous history rather than guessing.
DO $flex_backfill$
DECLARE legacy_delivery record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_inventory i WHERE i.reserved_balance IS DISTINCT FROM
    (SELECT coalesce(sum(r.quantity),0) FROM public.order_stock_reservations r
     WHERE r.enterprise_id=i.enterprise_id AND r.product_id=i.product_id AND r.state='active'))
    OR EXISTS (SELECT 1 FROM public.order_stock_reservations r WHERE r.state='active' AND NOT EXISTS
      (SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=r.enterprise_id AND i.product_id=r.product_id)) THEN
    RAISE EXCEPTION 'orders_flex_reservation_reconciliation_failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.operational_status='entregue' AND NOT EXISTS
    (SELECT 1 FROM public.order_events evt WHERE evt.enterprise_id=o.enterprise_id AND evt.order_id=o.id AND evt.event_type='delivered')) THEN
    RAISE EXCEPTION 'orders_flex_delivered_order_evidence_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_stock_settlements s WHERE NOT EXISTS
    (SELECT 1 FROM public.order_events evt WHERE evt.enterprise_id=s.enterprise_id AND evt.order_id=s.order_id
      AND evt.event_uuid=s.delivery_operation_id AND evt.event_type='delivered'))
    OR EXISTS (SELECT 1 FROM public.order_stock_reservations r WHERE r.state='consumed' AND NOT EXISTS
      (SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=r.enterprise_id AND s.reservation_id=r.id)) THEN
    RAISE EXCEPTION 'orders_flex_orphan_delivery_evidence';
  END IF;
  FOR legacy_delivery IN SELECT ev.* FROM public.order_events ev WHERE ev.event_type='delivered' LOOP
    IF (SELECT count(*) FROM public.order_events ev WHERE ev.enterprise_id=legacy_delivery.enterprise_id AND ev.order_id=legacy_delivery.order_id
      AND ev.event_type='delivered')<>1 OR NOT EXISTS (SELECT 1 FROM public.orders o
      WHERE o.enterprise_id=legacy_delivery.enterprise_id AND o.id=legacy_delivery.order_id AND o.operational_status='entregue'
        AND o.version>=legacy_delivery.order_version AND o.delivered_at>=legacy_delivery.recorded_at)
      OR EXISTS (SELECT 1 FROM public.order_events ev WHERE ev.enterprise_id=legacy_delivery.enterprise_id AND ev.order_id=legacy_delivery.order_id
        AND ev.order_version>legacy_delivery.order_version AND (ev.from_status IS NOT NULL OR ev.event_type='updated'))
      OR EXISTS (SELECT 1 FROM public.order_items i WHERE i.enterprise_id=legacy_delivery.enterprise_id AND i.order_id=legacy_delivery.order_id
        AND (i.fulfillment_mode NOT IN ('stock','untracked') OR i.created_at>legacy_delivery.recorded_at OR i.updated_at>legacy_delivery.recorded_at))
      OR EXISTS (SELECT 1 FROM public.order_stock_reservations r WHERE r.enterprise_id=legacy_delivery.enterprise_id AND r.order_id=legacy_delivery.order_id
        AND (r.state='active' OR NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.enterprise_id=r.enterprise_id
          AND i.order_id=r.order_id AND i.id=r.order_item_id AND i.fulfillment_mode='stock')))
    THEN RAISE EXCEPTION 'orders_flex_legacy_snapshot_unproven: %',legacy_delivery.event_uuid; END IF;
    IF (SELECT count(*) FROM private.order_operation_receipts r WHERE r.enterprise_id=legacy_delivery.enterprise_id
      AND r.order_id=legacy_delivery.order_id AND r.actor_id=legacy_delivery.actor_id AND r.command_name='deliver'
      AND r.attempt_id::text=legacy_delivery.metadata->>'attempt_id' AND r.payload_hash=legacy_delivery.metadata->>'payload_hash'
      AND r.result=pg_catalog.jsonb_build_object('status','delivered','order_id',legacy_delivery.order_id,
        'operational_status','entregue','version',legacy_delivery.order_version,'event_id',legacy_delivery.event_uuid))<>1 THEN
      RAISE EXCEPTION 'orders_flex_legacy_receipt_unproven: %',legacy_delivery.event_uuid;
    END IF;
    INSERT INTO public.order_delivery_manifest(enterprise_id,order_id,delivery_event_id,order_item_id,
      product_id,quantity,fulfillment_mode,settlement_id)
      SELECT i.enterprise_id,i.order_id,legacy_delivery.event_uuid,i.id,i.product_id,i.quantity,i.fulfillment_mode,s.id
      FROM public.order_items i LEFT JOIN public.order_stock_settlements s
        ON s.enterprise_id=i.enterprise_id AND s.order_id=i.order_id AND s.order_item_id=i.id
          AND s.delivery_operation_id=legacy_delivery.event_uuid
      WHERE i.enterprise_id=legacy_delivery.enterprise_id AND i.order_id=legacy_delivery.order_id;
    PERFORM private.orders_flex_validate_delivery(legacy_delivery.enterprise_id,legacy_delivery.event_uuid);
  END LOOP;
  IF EXISTS (SELECT 1 FROM private.order_operation_receipts r WHERE r.command_name='deliver' AND NOT EXISTS
    (SELECT 1 FROM public.order_events evt WHERE evt.enterprise_id=r.enterprise_id AND evt.order_id=r.order_id
      AND evt.event_type='delivered' AND evt.event_uuid::text=r.result->>'event_id'
      AND evt.actor_id=r.actor_id AND evt.metadata->>'attempt_id'=r.attempt_id::text)) THEN
    RAISE EXCEPTION 'orders_flex_orphan_delivery_receipt';
  END IF;
END $flex_backfill$;

-- Earlier receipt contracts relied on ACLs alone; enforce append-only at storage too.
CREATE TRIGGER order_operation_receipts_flex_immutable BEFORE UPDATE OR DELETE ON private.order_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();
CREATE TRIGGER order_delivery_manifest_immutable BEFORE UPDATE OR DELETE ON public.order_delivery_manifest
  FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();
CREATE TRIGGER order_delivery_undos_immutable BEFORE UPDATE OR DELETE ON public.order_delivery_undos
  FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();
CREATE TRIGGER order_delivery_compensations_immutable BEFORE UPDATE OR DELETE ON public.order_delivery_compensations
  FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();
ALTER TABLE public.order_delivery_manifest OWNER TO postgres;
ALTER TABLE public.order_delivery_undos OWNER TO postgres;
ALTER TABLE public.order_delivery_compensations OWNER TO postgres;
ALTER TABLE public.order_delivery_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_undos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_compensations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_delivery_manifest,public.order_delivery_undos,public.order_delivery_compensations
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.orders_flex_validate_delivery(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION private.orders_flex_valid_coverage(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.orders_flex_validate_delivery(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.orders_flex_valid_coverage(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
-- WARNING: multi-part installation is NOT atomic across files.
-- Only run in order 01 -> 02 -> 03, after a verified backup.
BEGIN;
-- LOCAL ONLY: complete lifecycle replacements for composition inside the FLEX transaction.
-- Requires private.orders_flex_valid_coverage(uuid,uuid,uuid) and compensation schema.
-- No transaction wrapper: the parent migration owns atomic installation.

CREATE OR REPLACE FUNCTION public.transition_order(
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
    -- Immutable historical evidence is authoritative; never re-run today's matrix.
    RETURN QUERY SELECT 'transitioned'::text,result_order,p_target_status,result_version,result_event;
    RETURN;
  ELSE
    SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
    IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
    IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
    old_status:=o.operational_status;
  END IF;
  -- FLEX: operational stages are freely navigable; terminal effects stay in their RPCs.
  allowed:=old_status IN ('em_conversao','orcado','pago','modelando','imprimindo')
    AND p_target_status IN ('em_conversao','orcado','pago','modelando','imprimindo')
    AND old_status<>p_target_status;
  needs_reason:=pg_catalog.array_position(
    ARRAY['em_conversao','orcado','pago','modelando','imprimindo']::text[],old_status)
    > pg_catalog.array_position(
    ARRAY['em_conversao','orcado','pago','modelando','imprimindo']::text[],p_target_status);
  IF NOT COALESCE(allowed,false) OR (needs_reason AND reason_value IS NULL) THEN
    IF NOT COALESCE(allowed,false) THEN RAISE EXCEPTION 'invalid_order_transition' USING ERRCODE='P0001'; END IF;
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
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

CREATE OR REPLACE FUNCTION public.allocate_order_stock(
  p_attempt_id uuid,p_order_id uuid,p_order_item_id uuid,p_expected_version bigint
) RETURNS TABLE(status text,order_id uuid,order_item_id uuid,reservation_id uuid,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; it public.order_items%ROWTYPE;
  product public.products%ROWTYPE; inv public.product_inventory%ROWTYPE;
  reservation public.order_stock_reservations%ROWTYPE;
  rid uuid; result_value jsonb; result_status text;
  result_order uuid; result_item uuid; result_reservation uuid; result_version bigint;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_order_item_id IS NULL
     OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Same global mutex as identity/plan writers; never acquire context after stock.
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
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required THEN RAISE EXCEPTION 'selection_required' USING ERRCODE='42501'; END IF;
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'order_id',p_order_id,'order_item_id',p_order_item_id,'expected_version',p_expected_version));
  -- This is an attempt mutex, not a reservation lock. Receipt lookup is read-only;
  -- every writer of this command serializes on the same key before insertion.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:allocate_stock:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r
    WHERE r.enterprise_id=eid AND r.actor_id=actor AND r.command_name='allocate_stock'
      AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'allocate_stock' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id OR receipt.result IS NULL
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR NOT (receipt.result ?& ARRAY['status','order_id','order_item_id','reservation_id','version']) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_item_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'reservation_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_status:=receipt.result->>'status';
      result_order:=(receipt.result->>'order_id')::uuid;
      result_item:=(receipt.result->>'order_item_id')::uuid;
      result_reservation:=(receipt.result->>'reservation_id')::uuid;
      result_version:=(receipt.result->>'version')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF result_status IS DISTINCT FROM 'allocated' OR result_order IS DISTINCT FROM p_order_id
       OR result_item IS DISTINCT FROM p_order_item_id OR result_reservation IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- A historical replay need not match today's mode, stock or order version.
    -- Immutable reservation identity and event bind this result to its original effect.
    IF NOT EXISTS(SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid AND x.id=result_order AND x.version>=result_version)
       OR NOT EXISTS(SELECT 1 FROM public.order_stock_reservations r JOIN public.order_items x
           ON x.enterprise_id=r.enterprise_id AND x.order_id=r.order_id AND x.id=r.order_item_id
         WHERE r.enterprise_id=eid AND r.id=result_reservation AND r.order_id=result_order
           AND r.order_item_id=result_item AND r.actor_id=actor
           AND r.product_id=x.product_id AND r.quantity=x.quantity)
       OR NOT EXISTS(SELECT 1 FROM public.order_events e WHERE e.enterprise_id=eid AND e.order_id=result_order
           AND e.actor_id=actor AND e.event_type='stock_allocated' AND e.order_version=result_version
           AND e.metadata->>'order_item_id'=result_item::text
           AND e.metadata->>'reservation_id'=result_reservation::text) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT result_status,result_order,result_item,result_reservation,result_version;
    RETURN;
  END IF;

  -- Historical receipt recovery does not grant a new physical capability after downgrade.
  IF plan.effective_plan IS DISTINCT FROM 'intermediate' OR plan.access_state IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.operational_status IN ('entregue','cancelado') THEN RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  -- All item writers serialize on the order. Do not take item/reservation locks
  -- before the common product -> inventory barrier.
  SELECT x.* INTO it FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=p_order_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_item_unavailable' USING ERRCODE='P0002'; END IF;
  IF it.fulfillment_mode NOT IN ('make_to_order','stock') OR it.product_id IS NULL THEN
    RAISE EXCEPTION 'order_item_not_allocatable' USING ERRCODE='P0001';
  END IF;
  -- Coverage excludes compensated rows, so validate their delivery chains too.
  PERFORM private.orders_flex_validate_delivery(eid,h.delivery_operation_id)
    FROM (SELECT DISTINCT s.delivery_operation_id FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.order_item_id=it.id) h;
  -- A currently covered item must never receive another reservation.
  IF private.orders_flex_valid_coverage(eid,p_order_id,it.id) IS NOT NULL THEN
    RAISE EXCEPTION 'order_item_already_allocated' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.order_item_id=it.id
        AND NOT EXISTS (SELECT 1 FROM public.order_delivery_compensations dc
          WHERE dc.enterprise_id=eid AND dc.settlement_id=s.id)) THEN
    RAISE EXCEPTION 'order_item_already_allocated' USING ERRCODE='P0001';
  END IF;
  SELECT x.* INTO product FROM public.products x WHERE x.enterprise_id=eid AND x.id=it.product_id FOR UPDATE;
  IF NOT FOUND OR NOT product.active OR product.deleted_at IS NOT NULL
     OR NOT private.stage6b_product_visible(eid,it.product_id) THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
  END IF;
  SELECT x.* INTO inv FROM public.product_inventory x
    WHERE x.enterprise_id=eid AND x.product_id=it.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003'; END IF;
  IF inv.reserved_balance IS DISTINCT FROM (SELECT COALESCE(sum(r.quantity),0)
      FROM public.order_stock_reservations r WHERE r.enterprise_id=eid AND r.product_id=it.product_id AND r.state='active') THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='P0001';
  END IF;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_item_id=it.id ORDER BY r.id FOR UPDATE LOOP
    IF reservation.order_id IS DISTINCT FROM p_order_id
       OR reservation.product_id IS DISTINCT FROM it.product_id
       OR reservation.quantity IS DISTINCT FROM it.quantity
       OR reservation.state NOT IN ('released','consumed') THEN
      RAISE EXCEPTION 'order_item_already_allocated' USING ERRCODE='P0001';
    END IF;
    -- Consumed cycles are legitimate only through the validated settlement chain.
    IF reservation.state='consumed' AND NOT EXISTS (
        SELECT 1 FROM public.order_stock_settlements s
        WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.order_item_id=it.id
          AND s.reservation_id=reservation.id) THEN
      RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  IF it.quantity>inv.balance-inv.reserved_balance THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003'; END IF;
  -- Resolve the mode before creating the active reference. B accepts stock and
  -- make_to_order; a later failure rolls this change back with the reservation.
  UPDATE public.order_items x SET fulfillment_mode='stock',updated_at=pg_catalog.now()
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.id=it.id;
  rid:=private.reserve_order_item_stock(eid,p_order_id,it.id,it.product_id,it.quantity);
  UPDATE public.orders x SET version=x.version+1 WHERE x.enterprise_id=eid AND x.id=p_order_id
    RETURNING x.* INTO o;
  INSERT INTO public.order_events(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,metadata)
    VALUES(eid,p_order_id,actor,'stock_allocated',NULL,NULL,o.version,
      pg_catalog.jsonb_build_object('order_item_id',it.id,'reservation_id',rid));
  result_value:=pg_catalog.jsonb_build_object('status','allocated','order_id',p_order_id,
    'order_item_id',it.id,'reservation_id',rid,'version',o.version);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'allocate_stock',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'allocated'::text,p_order_id,it.id,rid,o.version;
END $$;

ALTER FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) SET search_path='';
REVOKE ALL ON FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.allocate_order_stock(uuid,uuid,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE;
  product public.products%ROWTYPE;
  inv public.product_inventory%ROWTYPE;
  reservation public.order_stock_reservations%ROWTYPE;
  pid uuid; product_ids uuid[]; release_count bigint;
  result_value jsonb; result_status text; result_order uuid;
  result_operational_status text; result_version bigint; result_event uuid;
  previous_status text;
BEGIN
  reason_value:=pg_catalog.btrim(p_reason);
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
     OR reason_value IS NULL OR pg_catalog.length(reason_value) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid,'sales.delete') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'selection_required' USING ERRCODE='42501';
  END IF;
  -- Raw reason binds the request; only the normalized reason is persisted in events.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,
    'expected_version',p_expected_version,'reason',p_reason));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:cancel:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r
    WHERE r.enterprise_id=eid AND r.actor_id=actor AND r.command_name='cancel'
      AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'cancel' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id OR receipt.result IS NULL
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR NOT (receipt.result ?& ARRAY['status','order_id','operational_status','version','event_id']) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'operational_status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'event_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_status:=receipt.result->>'status';
      result_order:=(receipt.result->>'order_id')::uuid;
      result_operational_status:=receipt.result->>'operational_status';
      result_version:=(receipt.result->>'version')::bigint;
      result_event:=(receipt.result->>'event_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    IF result_status IS DISTINCT FROM 'cancelled' OR result_order IS DISTINCT FROM p_order_id
       OR result_operational_status IS DISTINCT FROM 'cancelado' OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Historical success survives reopening, delivery and further order versions.
    -- Bind the real UUID event column; typed JSON equality binds attempt/hash metadata.
    IF NOT EXISTS (SELECT 1 FROM public.orders x
        WHERE x.enterprise_id=eid AND x.id=result_order AND x.version>=result_version)
       OR (SELECT count(*) FROM public.order_events e
        WHERE e.enterprise_id=eid AND e.order_id=result_order AND e.actor_id=actor
          AND e.event_type='cancelled' AND e.order_version=result_version
          AND e.from_status IN ('em_conversao','orcado','pago','modelando','imprimindo')
          AND e.to_status='cancelado' AND e.reason=reason_value
          AND e.event_uuid=result_event
          AND e.metadata->'attempt_id'=pg_catalog.to_jsonb(p_attempt_id)
          AND e.metadata->'payload_hash'=pg_catalog.to_jsonb(hash_value))<>1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT result_status,result_order,result_operational_status,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x
    WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.operational_status='cancelado' THEN RAISE EXCEPTION 'order_already_cancelled' USING ERRCODE='P0001'; END IF;
  IF o.operational_status='entregue' THEN RAISE EXCEPTION 'order_already_delivered' USING ERRCODE='P0001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  previous_status:=o.operational_status;

  -- Identity reads only. All supported reservation/item writers serialize on order.
  -- Take the COMPLETE product set, then COMPLETE position set, then reservations;
  -- never alternate these layers for individual items. Include historical cycles.
  SELECT pg_catalog.array_agg(s.product_id ORDER BY s.product_id) INTO product_ids
    FROM (SELECT DISTINCT r.product_id FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id) s;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT p.* INTO product FROM public.products p
      WHERE p.enterprise_id=eid AND p.id=pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
    -- B1 forbids archive/delete with active reservations: reject impossible drift,
    -- not normal catalog/window eligibility (no visibility or paid-plan gate here).
    IF (NOT product.active OR product.deleted_at IS NOT NULL) AND EXISTS (
        SELECT 1 FROM public.order_stock_reservations r WHERE r.enterprise_id=eid
          AND r.order_id=p_order_id AND r.product_id=pid AND r.state='active') THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT i.* INTO inv FROM public.product_inventory i
      WHERE i.enterprise_id=eid AND i.product_id=pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  PERFORM r.id FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id FOR UPDATE;

  -- Validate all delivery chains, including fully compensated historical cycles.
  PERFORM private.orders_flex_validate_delivery(eid,h.delivery_operation_id)
    FROM (SELECT DISTINCT s.delivery_operation_id FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id) h;
  -- Cancellation releases only active obligations; it never reverses a settlement.
  PERFORM private.orders_flex_valid_coverage(eid,p_order_id,it.id)
    FROM public.order_items it WHERE it.enterprise_id=eid AND it.order_id=p_order_id;
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations r
      LEFT JOIN public.order_items it ON it.enterprise_id=r.enterprise_id
        AND it.order_id=r.order_id AND it.id=r.order_item_id
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id
        AND (it.id IS NULL OR it.fulfillment_mode IS DISTINCT FROM 'stock'
          OR it.product_id IS DISTINCT FROM r.product_id OR it.quantity IS DISTINCT FROM r.quantity
          OR (r.state='consumed' AND NOT EXISTS (
            SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
              AND s.order_id=p_order_id AND s.order_item_id=it.id AND s.reservation_id=r.id))
          OR (r.state='active' AND private.orders_flex_valid_coverage(eid,p_order_id,it.id) IS NOT NULL))) THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT i.* INTO inv FROM public.product_inventory i
      WHERE i.enterprise_id=eid AND i.product_id=pid;
    IF inv.reserved_balance IS DISTINCT FROM (SELECT COALESCE(sum(r.quantity),0)
        FROM public.order_stock_reservations r
        WHERE r.enterprise_id=eid AND r.product_id=pid AND r.state='active')
       OR inv.reserved_balance<0 OR inv.reserved_balance>inv.balance THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO release_count FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.product_id=pid AND r.state='active';
    IF inv.version>9007199254740991-release_count THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.state='active' ORDER BY r.id LOOP
    PERFORM * FROM private.finalize_order_item_reservation(eid,p_order_id,reservation.id,'release',reason_value);
  END LOOP;

  UPDATE public.orders x SET operational_status='cancelado',cancelled_at=pg_catalog.now(),
    version=x.version+1 WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  INSERT INTO public.order_events AS e(enterprise_id,order_id,actor_id,event_type,
    from_status,to_status,order_version,reason,metadata)
    VALUES(eid,p_order_id,actor,'cancelled',previous_status,'cancelado',o.version,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value))
    RETURNING e.event_uuid INTO result_event;
  result_value:=pg_catalog.jsonb_build_object('status','cancelled','order_id',p_order_id,
    'operational_status','cancelado','version',o.version,'event_id',result_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'cancel',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'cancelled'::text,p_order_id,'cancelado'::text,o.version,result_event;
END $$;

ALTER FUNCTION public.cancel_order(uuid,uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.cancel_order(uuid,uuid,bigint,text) SET search_path='';
REVOKE ALL ON FUNCTION public.cancel_order(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid,uuid,bigint,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_reason text
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; plan record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; product public.products%ROWTYPE;
  inv public.product_inventory%ROWTYPE; reservation public.order_stock_reservations%ROWTYPE;
  it public.order_items%ROWTYPE; pid uuid; product_ids uuid[];
  demand numeric; reserve_count bigint; active_quantity numeric;
  result_value jsonb; result_order uuid; result_event uuid; result_version bigint;
  new_event uuid;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  reason_value:=pg_catalog.btrim(p_reason);
  IF pg_catalog.length(reason_value) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Context itself takes no management mutex: acquire it explicitly first.
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
  SELECT * INTO plan FROM private.resolve_enterprise_plan(eid);
  IF NOT FOUND OR plan.selection_required IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'selection_required' USING ERRCODE='42501';
  END IF;
  -- Hash raw arguments, not the trimmed reason; whitespace changes conflict too.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version,'reason',p_reason));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:reopen:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT r.* INTO receipt FROM private.order_operation_receipts r WHERE r.enterprise_id=eid
    AND r.actor_id=actor AND r.command_name='reopen' AND r.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'reopen' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
       OR receipt.order_id IS DISTINCT FROM p_order_id OR receipt.result IS NULL
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR NOT (receipt.result ?& ARRAY['status','order_id','operational_status','version','event_id']) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    IF pg_catalog.jsonb_typeof(receipt.result->'status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'order_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'operational_status') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'event_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
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
    IF receipt.result->>'status' IS DISTINCT FROM 'reopened'
       OR receipt.result->>'operational_status' IS DISTINCT FROM 'em_conversao'
       OR result_order IS DISTINCT FROM p_order_id OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Historical replay deliberately ignores today's state, modes, stock and plan
    -- physical entitlement. Reservation cycles may already be released/consumed.
    IF NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid
        AND x.id=result_order AND x.version>=result_version)
       OR (SELECT count(*) FROM public.order_events e
        WHERE e.enterprise_id=eid AND e.order_id=result_order AND e.actor_id=actor
          AND e.event_type='reopened' AND e.from_status='cancelado' AND e.to_status='em_conversao'
          AND e.order_version=result_version AND e.reason=reason_value
          AND e.event_uuid=result_event
          AND e.metadata->'attempt_id'=pg_catalog.to_jsonb(p_attempt_id)
          AND e.metadata->'payload_hash'=pg_catalog.to_jsonb(hash_value))<>1 THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT 'reopened'::text,result_order,'em_conversao'::text,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.operational_status<>'cancelado' THEN RAISE EXCEPTION 'order_not_cancelled' USING ERRCODE='P0001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  -- Validate all delivery chains, including compensated historical cycles.
  PERFORM private.orders_flex_validate_delivery(eid,h.delivery_operation_id)
    FROM (SELECT DISTINCT s.delivery_operation_id FROM public.order_stock_settlements s
      WHERE s.enterprise_id=eid AND s.order_id=p_order_id) h;
  PERFORM private.orders_flex_valid_coverage(eid,p_order_id,x.id)
    FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id;
  -- D3: covered physical items create no new obligation after downgrade.
  IF EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode IN ('stock','make_to_order')
      AND private.orders_flex_valid_coverage(eid,p_order_id,x.id) IS NULL)
     AND (plan.effective_plan IS DISTINCT FROM 'intermediate' OR plan.access_state IS DISTINCT FROM 'paid') THEN
    RAISE EXCEPTION 'plan_feature_unavailable' USING ERRCODE='42501';
  END IF;

  -- Order lock stabilizes item/history identities. Include historical products so
  -- even inconsistent references cannot escape the complete product barrier.
  SELECT pg_catalog.array_agg(s.product_id ORDER BY s.product_id) INTO product_ids FROM (
    SELECT x.product_id FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode IN ('stock','make_to_order')
    UNION
    SELECT r.product_id FROM public.order_stock_reservations r WHERE r.enterprise_id=eid AND r.order_id=p_order_id
  ) s;
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT p.* INTO product FROM public.products p WHERE p.enterprise_id=eid AND p.id=pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
    -- Historical products retain the lock barrier, not today's catalog eligibility.
    IF EXISTS (SELECT 1 FROM public.order_items x
        WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.product_id=pid
          AND x.fulfillment_mode IN ('stock','make_to_order')
          AND private.orders_flex_valid_coverage(eid,p_order_id,x.id) IS NULL)
       AND (NOT product.active OR product.deleted_at IS NOT NULL
         OR NOT private.stage6b_product_visible(eid,pid)) THEN
      RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- Acquire ALL positions before ANY reservation row lock. Missing MTO positions
  -- are legitimate demand; missing stock positions mean no available stock.
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    PERFORM 1 FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=pid FOR UPDATE;
  END LOOP;
  FOR reservation IN SELECT r.* FROM public.order_stock_reservations r
    WHERE r.enterprise_id=eid AND r.order_id=p_order_id ORDER BY r.id FOR UPDATE LOOP
    SELECT x.* INTO it FROM public.order_items x WHERE x.enterprise_id=eid
      AND x.order_id=p_order_id AND x.id=reservation.order_item_id;
    IF NOT FOUND OR reservation.state NOT IN ('released','consumed') OR it.fulfillment_mode<>'stock'
       OR it.product_id IS DISTINCT FROM reservation.product_id OR it.quantity IS DISTINCT FROM reservation.quantity
       OR (reservation.state='consumed' AND NOT EXISTS (
         SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
           AND s.order_id=p_order_id AND s.order_item_id=it.id AND s.reservation_id=reservation.id)) THEN
      RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Validate every history (including compensated consumption); only uncovered
  -- stock demand is re-reserved. Existing coverage is never consumed twice.
  PERFORM private.orders_flex_valid_coverage(eid,p_order_id,x.id)
    FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id;
  IF EXISTS (SELECT 1 FROM public.order_items x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock'
        AND NOT EXISTS (SELECT 1 FROM public.order_stock_reservations r
          WHERE r.enterprise_id=eid AND r.order_id=p_order_id AND r.order_item_id=x.id
            AND r.state IN ('released','consumed') AND r.product_id=x.product_id AND r.quantity=x.quantity)) THEN
    RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001';
  END IF;

  -- Whole-order validation, including reconciliation of ALL active tenant/product
  -- reservations and capacity for every per-item inventory version increment.
  -- No reserve helper is called until every product has passed.
  FOREACH pid IN ARRAY COALESCE(product_ids,ARRAY[]::uuid[]) LOOP
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=pid;
    SELECT COALESCE(sum(r.quantity),0) INTO active_quantity FROM public.order_stock_reservations r
      WHERE r.enterprise_id=eid AND r.product_id=pid AND r.state='active';
    IF (inv.id IS NULL AND active_quantity<>0)
       OR (inv.id IS NOT NULL AND (inv.reserved_balance<0 OR inv.reserved_balance>inv.balance
         OR inv.reserved_balance IS DISTINCT FROM active_quantity)) THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(sum(x.quantity),0),count(*) INTO demand,reserve_count FROM public.order_items x
      WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.product_id=pid AND x.fulfillment_mode='stock'
        AND private.orders_flex_valid_coverage(eid,p_order_id,x.id) IS NULL;
    IF demand>COALESCE(inv.balance-inv.reserved_balance,0) THEN
      RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003';
    END IF;
    IF reserve_count>0 AND inv.version>9007199254740991-reserve_count THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  -- Preserve item IDs/modes/quantities/prices/snapshots; MTO remains unallocated.
  FOR it IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode='stock'
      AND private.orders_flex_valid_coverage(eid,p_order_id,x.id) IS NULL ORDER BY x.product_id,x.id LOOP
    PERFORM private.reserve_order_item_stock(eid,p_order_id,it.id,it.product_id,it.quantity);
  END LOOP;
  UPDATE public.orders x SET operational_status='em_conversao',cancelled_at=NULL,version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  INSERT INTO public.order_events AS e(enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,reason,metadata)
    VALUES(eid,p_order_id,actor,'reopened','cancelado','em_conversao',o.version,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value))
    RETURNING e.event_uuid INTO new_event;
  result_value:=pg_catalog.jsonb_build_object('status','reopened','order_id',p_order_id,
    'operational_status','em_conversao','version',o.version,'event_id',new_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'reopen',p_attempt_id,hash_value,p_order_id,result_value);
  RETURN QUERY SELECT 'reopened'::text,p_order_id,'em_conversao'::text,o.version,new_event;
END $$;

ALTER FUNCTION public.reopen_order(uuid,uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.reopen_order(uuid,uuid,bigint,text) SET search_path='';
REVOKE ALL ON FUNCTION public.reopen_order(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reopen_order(uuid,uuid,bigint,text) TO authenticated;
COMMIT;
-- WARNING: multi-part installation is NOT atomic across files.
-- Only run in order 01 -> 02 -> 03, after a verified backup.
BEGIN;
-- Delivery cycles: installed after FLEX schema/helpers in this transaction.
-- No database execution and no transaction wrapper. Historical replay is manifest-only.
CREATE OR REPLACE FUNCTION public.deliver_order(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; hash_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; ev public.order_events%ROWTYPE;
  inv public.product_inventory%ROWTYPE;
  r public.order_stock_reservations%ROWTYPE;
  consumed record; item record; group_value record;
  coverage_uuid uuid; settlement_uuid uuid; origin_event uuid;
  uncovered_items uuid[]:=ARRAY[]::uuid[];
  result_order uuid; result_event uuid; result_version bigint;
  new_event uuid; movement_uuid uuid; internal_attempt uuid; product_uuid uuid;
  old_status text; result_value jsonb;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_expected_version IS NULL
     OR p_expected_version NOT BETWEEN 0 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  -- Global identity/plan barrier MUST precede context and every physical lock.
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
  -- Central authorization retains plan selection/team restrictions. Consuming an
  -- existing reservation has NO paid, inventory.write, product-window or active gate.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:deliver:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT x.* INTO receipt FROM private.order_operation_receipts x
    WHERE x.enterprise_id=eid AND x.actor_id=actor AND x.command_name='deliver'
      AND x.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.enterprise_id IS DISTINCT FROM eid OR receipt.actor_id IS DISTINCT FROM actor
       OR receipt.command_name IS DISTINCT FROM 'deliver' OR receipt.attempt_id IS DISTINCT FROM p_attempt_id
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
    IF receipt.result->>'status' IS DISTINCT FROM 'delivered'
       OR receipt.result->>'operational_status' IS DISTINCT FROM 'entregue'
       OR result_order IS DISTINCT FROM p_order_id OR result_event IS NULL
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991
       OR NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid
         AND x.id=result_order AND x.version>=result_version) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    SELECT x.* INTO ev FROM public.order_events x WHERE x.enterprise_id=eid AND x.event_uuid=result_event;
    IF NOT FOUND OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
       OR ev.event_type IS DISTINCT FROM 'delivered' OR ev.order_version IS DISTINCT FROM result_version
       OR ev.from_status IS NULL OR ev.from_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo')
       OR ev.to_status IS DISTINCT FROM 'entregue' OR ev.reason IS NOT NULL
       OR pg_catalog.jsonb_typeof(ev.metadata->'attempt_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(ev.metadata->'payload_hash') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(ev.metadata->'delivery_operation_id') IS DISTINCT FROM 'string'
       OR ev.metadata->>'attempt_id' IS DISTINCT FROM p_attempt_id::text
       OR ev.metadata->>'payload_hash' IS DISTINCT FROM hash_value
       OR ev.metadata->>'delivery_operation_id' IS DISTINCT FROM result_event::text THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Replay validates the immutable snapshot, not today's items or coverage.
    PERFORM private.orders_flex_validate_delivery(eid,result_event);
    RETURN QUERY SELECT 'delivered'::text,result_order,'entregue'::text,result_version,result_event;
    RETURN;
  END IF;

  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF o.operational_status='entregue' THEN RAISE EXCEPTION 'order_already_delivered' USING ERRCODE='P0001'; END IF;
  IF o.operational_status='cancelado' THEN RAISE EXCEPTION 'order_already_cancelled' USING ERRCODE='P0001'; END IF;
  old_status:=o.operational_status;
  IF old_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo') THEN
    RAISE EXCEPTION 'invalid_order_transition' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id)
     OR EXISTS (SELECT 1 FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
       AND x.fulfillment_mode='make_to_order') THEN
    RAISE EXCEPTION 'order_fulfillment_incomplete' USING ERRCODE='P0001';
  END IF;
  -- Collect identities without reservation row locks. Complete product set first,
  -- then complete position set, then reservations. Never interleave these barriers.
  FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.product_id IS NOT NULL
    ORDER BY x.product_id LOOP
    PERFORM 1 FROM public.products x WHERE x.enterprise_id=eid AND x.id=product_uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_items x
    WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.fulfillment_mode='stock'
    ORDER BY x.product_id LOOP
    PERFORM 1 FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=product_uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  END LOOP;
  PERFORM 1 FROM public.order_stock_reservations x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
    ORDER BY x.id FOR UPDATE;
  -- Historical reservations need not match mutable items. Active ones must.
  -- Validate every original delivery chain, including compensated/deleted-item history.
  FOR origin_event IN SELECT DISTINCT s.delivery_operation_id
    FROM public.order_stock_settlements s WHERE s.enterprise_id=eid AND s.order_id=p_order_id
    ORDER BY s.delivery_operation_id LOOP
    PERFORM private.orders_flex_validate_delivery(eid,origin_event);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations z
      WHERE z.enterprise_id=eid AND z.order_id=p_order_id
        AND (z.state NOT IN ('active','released','consumed') OR z.quantity<=0
          OR (z.state IN ('released','consumed') AND z.finalized_at IS NULL)
          OR (z.state='consumed' AND z.finalization_reason IS NOT NULL)
          OR (z.state<>'consumed' AND EXISTS (SELECT 1 FROM public.order_stock_settlements s
            WHERE s.enterprise_id=eid AND s.reservation_id=z.id))))
     OR EXISTS (SELECT 1 FROM public.order_stock_reservations z
      LEFT JOIN public.order_items x ON x.enterprise_id=z.enterprise_id AND x.order_id=z.order_id AND x.id=z.order_item_id
      WHERE z.enterprise_id=eid AND z.order_id=p_order_id AND z.state='active'
        AND (x.id IS NULL OR x.fulfillment_mode<>'stock' OR z.product_id IS DISTINCT FROM x.product_id
          OR z.quantity IS DISTINCT FROM x.quantity OR z.finalized_at IS NOT NULL
          OR z.finalization_reason IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.order_stock_reservations z
       WHERE z.enterprise_id=eid AND z.order_id=p_order_id AND z.state='consumed'
         AND (SELECT count(*) FROM public.order_stock_settlements s
           WHERE s.enterprise_id=eid AND s.reservation_id=z.id AND s.order_id=z.order_id
             AND s.order_item_id=z.order_item_id AND s.product_id=z.product_id AND s.quantity=z.quantity)<>1) THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid
    AND x.order_id=p_order_id AND x.fulfillment_mode='stock' ORDER BY x.id LOOP
    coverage_uuid:=private.orders_flex_valid_coverage(eid,p_order_id,item.id);
    IF coverage_uuid IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.order_stock_reservations z WHERE z.enterprise_id=eid
        AND z.order_id=p_order_id AND z.order_item_id=item.id AND z.state='active') THEN
        RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
      END IF;
    ELSE
      -- No silently ignored uncompensated settlement, even if its snapshot mismatches.
      IF EXISTS (SELECT 1 FROM public.order_stock_settlements s WHERE s.enterprise_id=eid
          AND s.order_id=p_order_id AND s.order_item_id=item.id
          AND NOT EXISTS (SELECT 1 FROM public.order_delivery_compensations d
            WHERE d.enterprise_id=s.enterprise_id AND d.settlement_id=s.id)) THEN
        RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
      END IF;
      IF (SELECT count(*) FROM public.order_stock_reservations z WHERE z.enterprise_id=eid
          AND z.order_id=p_order_id AND z.order_item_id=item.id AND z.state='active')<>1 THEN
        RAISE EXCEPTION 'order_fulfillment_incomplete' USING ERRCODE='P0001';
      END IF;
      uncovered_items:=pg_catalog.array_append(uncovered_items,item.id);
    END IF;
  END LOOP;
  -- Reconcile ALL company/product active obligations, not just this order. Reserve
  -- enough version capacity for every helper call before the first mutation.
  FOR group_value IN SELECT x.product_id,
      count(*) FILTER (WHERE x.id=ANY(uncovered_items)) AS calls,
      coalesce(sum(x.quantity) FILTER (WHERE x.id=ANY(uncovered_items)),0) AS total_quantity
    FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
      AND x.fulfillment_mode='stock' GROUP BY x.product_id ORDER BY x.product_id LOOP
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=group_value.product_id;
    IF inv.balance NOT BETWEEN 0 AND 1000000000 OR inv.reserved_balance<0 OR inv.reserved_balance>inv.balance
       OR inv.reserved_balance IS DISTINCT FROM (SELECT coalesce(sum(z.quantity),0)
         FROM public.order_stock_reservations z WHERE z.enterprise_id=eid
           AND z.product_id=group_value.product_id AND z.state='active')
       OR group_value.total_quantity>inv.reserved_balance OR group_value.total_quantity>inv.balance THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    IF inv.version>9007199254740991-group_value.calls THEN
      RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003';
    END IF;
  END LOOP;
  -- Persist identity BEFORE consumes/ledger writes. Never insert into bigint id.
  -- The proposal is only needed for immutable event metadata; all downstream
  -- references use the actual RETURNING identity, never an unpersisted UUID.
  -- Any failure below rolls back event, order, consumes, ledger and receipt alike.
  new_event:=pg_catalog.gen_random_uuid();
  INSERT INTO public.order_events(event_uuid,enterprise_id,order_id,actor_id,event_type,
    from_status,to_status,order_version,metadata)
    VALUES(new_event,eid,p_order_id,actor,'delivered',old_status,'entregue',o.version+1,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value,
        'delivery_operation_id',new_event))
    RETURNING event_uuid INTO new_event;
  -- A BEFORE INSERT trigger must not silently substitute a different identity
  -- without maintaining the immutable metadata binding. Fail closed if it does.
  IF new_event IS NULL OR NOT EXISTS (SELECT 1 FROM public.order_events e
    WHERE e.event_uuid=new_event AND e.enterprise_id=eid AND e.order_id=p_order_id
      AND e.actor_id=actor AND e.event_type='delivered' AND e.order_version=o.version+1
      AND e.from_status=old_status AND e.to_status='entregue' AND e.reason IS NULL
      AND e.metadata=pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,
        'payload_hash',hash_value,'delivery_operation_id',new_event)) THEN
    RAISE EXCEPTION 'delivery_event_unavailable' USING ERRCODE='23514';
  END IF;
  FOR r IN SELECT x.* FROM public.order_stock_reservations x WHERE x.enterprise_id=eid
    AND x.order_id=p_order_id AND x.state='active'
    AND x.order_item_id=ANY(uncovered_items) ORDER BY x.id LOOP
    SELECT x.* INTO STRICT consumed FROM private.finalize_order_item_reservation(eid,p_order_id,r.id,'consume',NULL) x;
    IF consumed.product_id IS DISTINCT FROM r.product_id OR consumed.quantity IS DISTINCT FROM r.quantity THEN
      RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
    END IF;
    SELECT x.* INTO inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=consumed.product_id;
    -- A random internal attempt per exit, never reuse the public delivery attempt.
    LOOP
      internal_attempt:=pg_catalog.gen_random_uuid();
      EXIT WHEN internal_attempt<>p_attempt_id AND NOT EXISTS (SELECT 1 FROM public.product_inventory_movements m
        WHERE m.enterprise_id=eid AND m.actor_id=actor AND m.attempt_id=internal_attempt);
    END LOOP;
    INSERT INTO public.product_inventory_movements(
      enterprise_id,inventory_id,product_id,actor_id,movement_type,quantity,balance_before,balance_after,
      reason,attempt_id,request_expected_version,request_quantity,request_counted_balance,result_version)
    VALUES(eid,inv.id,consumed.product_id,actor,'exit',-consumed.quantity,
      consumed.resulting_balance+consumed.quantity,consumed.resulting_balance,
      'Order delivery '||new_event::text,internal_attempt,consumed.inventory_version-1,consumed.quantity,NULL,consumed.inventory_version)
    RETURNING id INTO movement_uuid;
    INSERT INTO public.order_stock_settlements(
      enterprise_id,order_id,order_item_id,reservation_id,movement_id,product_id,quantity,delivery_operation_id)
    VALUES(eid,p_order_id,r.order_item_id,r.id,movement_uuid,consumed.product_id,consumed.quantity,new_event)
      RETURNING id INTO settlement_uuid;
    INSERT INTO public.order_delivery_manifest(enterprise_id,order_id,delivery_event_id,
      order_item_id,product_id,quantity,fulfillment_mode,settlement_id,inherited_from_event_id)
      VALUES(eid,p_order_id,new_event,r.order_item_id,consumed.product_id,consumed.quantity,
        'stock',settlement_uuid,NULL);
  END LOOP;
  -- Preserved coverage always points directly to the original physical exit event,
  -- never to an intermediate delivery that merely inherited the same coverage.
  FOR item IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid
    AND x.order_id=p_order_id AND NOT (x.id=ANY(uncovered_items)) ORDER BY x.id LOOP
    coverage_uuid:=NULL; origin_event:=NULL;
    IF item.fulfillment_mode='stock' THEN
      coverage_uuid:=private.orders_flex_valid_coverage(eid,p_order_id,item.id);
      IF coverage_uuid IS NULL THEN
        RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
      END IF;
      SELECT s.delivery_operation_id INTO STRICT origin_event FROM public.order_stock_settlements s
        WHERE s.enterprise_id=eid AND s.order_id=p_order_id AND s.order_item_id=item.id
          AND s.id=coverage_uuid AND s.product_id=item.product_id AND s.quantity=item.quantity;
    ELSIF item.fulfillment_mode IS DISTINCT FROM 'untracked' THEN
      RAISE EXCEPTION 'order_fulfillment_incomplete' USING ERRCODE='P0001';
    END IF;
    INSERT INTO public.order_delivery_manifest(enterprise_id,order_id,delivery_event_id,
      order_item_id,product_id,quantity,fulfillment_mode,settlement_id,inherited_from_event_id)
      VALUES(eid,p_order_id,new_event,item.id,item.product_id,item.quantity,item.fulfillment_mode,
        coverage_uuid,origin_event);
  END LOOP;
  UPDATE public.orders x SET operational_status='entregue',delivered_at=pg_catalog.now(),version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  result_value:=pg_catalog.jsonb_build_object('status','delivered','order_id',p_order_id,
    'operational_status','entregue','version',o.version,'event_id',new_event);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'deliver',p_attempt_id,hash_value,p_order_id,result_value);
  PERFORM private.orders_flex_validate_delivery(eid,new_event);
  RETURN QUERY SELECT 'delivered'::text,p_order_id,'entregue'::text,o.version,new_event;
END $$;

ALTER FUNCTION public.deliver_order(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.deliver_order(uuid,uuid,bigint) SET search_path='';
REVOKE ALL ON FUNCTION public.deliver_order(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.deliver_order(uuid,uuid,bigint) TO authenticated;





-- Narrow correction of a proven historical debit. No inventory entitlement is granted.
CREATE FUNCTION public.undo_order_delivery(
  p_attempt_id uuid,p_order_id uuid,p_expected_version bigint,p_delivery_event_id uuid,
  p_target_status text,p_reason text,p_classification text
) RETURNS TABLE(status text,order_id uuid,operational_status text,version bigint,event_id uuid,
                source_delivery_event_id uuid,physical_effect text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; hash_value text; reason_value text;
  receipt private.order_operation_receipts%ROWTYPE;
  o public.orders%ROWTYPE; ev public.order_events%ROWTYPE;
  inv public.product_inventory%ROWTYPE; s record; g record; product_uuid uuid;
  new_event uuid; movement_uuid uuid; internal_attempt uuid;
  result_value jsonb; result_event uuid; result_version bigint; effect_value text;
BEGIN
  IF p_attempt_id IS NULL OR p_order_id IS NULL OR p_delivery_event_id IS NULL
     OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9007199254740991
     OR p_target_status IS NULL OR p_target_status NOT IN ('em_conversao','orcado','pago','modelando','imprimindo')
     OR p_classification IS NULL OR p_classification NOT IN ('incorrect_record','actual_delivery')
     OR p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  reason_value:=pg_catalog.btrim(p_reason);
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
  -- Raw inputs, including whitespace, are part of the immutable attempt payload.
  hash_value:=private.orders_c1_payload_hash(pg_catalog.jsonb_build_object(
    'attempt_id',p_attempt_id,'order_id',p_order_id,'expected_version',p_expected_version,
    'delivery_event_id',p_delivery_event_id,'target_status',p_target_status,
    'reason',p_reason,'classification',p_classification));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'orders:undo_delivery:'||eid::text||':'||actor::text||':'||p_attempt_id::text,0));
  SELECT x.* INTO receipt FROM private.order_operation_receipts x
    WHERE x.enterprise_id=eid AND x.actor_id=actor AND x.command_name='undo_delivery' AND x.attempt_id=p_attempt_id;
  IF FOUND THEN
    IF receipt.payload_hash IS DISTINCT FROM hash_value THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    IF receipt.order_id IS DISTINCT FROM p_order_id
       OR pg_catalog.jsonb_typeof(receipt.result) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(receipt.result->'version') IS DISTINCT FROM 'number'
       OR (receipt.result->>'version') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    BEGIN
      result_event:=(receipt.result->>'event_id')::uuid;
      result_version:=(receipt.result->>'version')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END;
    effect_value:=receipt.result->>'physical_effect';
    IF receipt.result->>'status' IS DISTINCT FROM 'delivery_undone'
       OR receipt.result->>'order_id' IS DISTINCT FROM p_order_id::text
       OR receipt.result->>'source_delivery_event_id' IS DISTINCT FROM p_delivery_event_id::text
       OR receipt.result->>'operational_status' IS DISTINCT FROM p_target_status
       OR result_version IS DISTINCT FROM p_expected_version+1
       OR result_version NOT BETWEEN 1 AND 9007199254740991 OR result_event IS NULL
       OR effect_value IS NULL OR effect_value NOT IN ('compensated','preserved','no_physical_movement') THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    SELECT x.* INTO ev FROM public.order_events x WHERE x.enterprise_id=eid AND x.event_uuid=result_event;
    IF NOT FOUND OR ev.order_id IS DISTINCT FROM p_order_id OR ev.actor_id IS DISTINCT FROM actor
       OR ev.event_type IS DISTINCT FROM 'delivery_undone' OR ev.from_status IS DISTINCT FROM 'entregue'
       OR ev.to_status IS DISTINCT FROM p_target_status OR ev.order_version IS DISTINCT FROM result_version
       OR ev.reason IS DISTINCT FROM reason_value
       OR ev.metadata IS DISTINCT FROM pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,
         'payload_hash',hash_value,'source_delivery_event_id',p_delivery_event_id,
         'classification',p_classification,'physical_effect',effect_value)
       OR NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id AND x.version>=result_version)
       OR NOT EXISTS (SELECT 1 FROM public.order_delivery_undos x WHERE x.enterprise_id=eid
         AND x.order_id=p_order_id AND x.delivery_event_id=p_delivery_event_id AND x.undo_event_id=result_event
         AND x.target_status=p_target_status AND x.classification=p_classification AND x.attempt_id=p_attempt_id) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    PERFORM private.orders_flex_validate_delivery(eid,p_delivery_event_id);
    IF (effect_value='compensated' AND (p_classification<>'incorrect_record'
          OR NOT EXISTS (SELECT 1 FROM public.order_stock_settlements x WHERE x.enterprise_id=eid AND x.delivery_operation_id=p_delivery_event_id)
          OR EXISTS (SELECT 1 FROM public.order_stock_settlements x WHERE x.enterprise_id=eid
            AND x.delivery_operation_id=p_delivery_event_id AND NOT EXISTS (
              SELECT 1 FROM public.order_delivery_compensations k WHERE k.enterprise_id=eid
                AND k.settlement_id=x.id AND k.undo_event_id=result_event))))
       OR (effect_value='preserved' AND (p_classification<>'actual_delivery'
          OR NOT EXISTS (SELECT 1 FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid
            AND x.delivery_event_id=p_delivery_event_id AND x.settlement_id IS NOT NULL)))
       OR (effect_value='no_physical_movement' AND EXISTS (SELECT 1 FROM public.order_delivery_manifest x
          WHERE x.enterprise_id=eid AND x.delivery_event_id=p_delivery_event_id AND x.settlement_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    -- Recheck the compensating immutable ledger, not today's balance.
    IF EXISTS (SELECT 1 FROM public.order_delivery_compensations k
      JOIN public.order_stock_settlements z ON z.enterprise_id=k.enterprise_id AND z.id=k.settlement_id
      LEFT JOIN public.product_inventory_movements m ON m.enterprise_id=k.enterprise_id AND m.id=k.compensation_movement_id
      WHERE k.enterprise_id=eid AND k.undo_event_id=result_event
        AND (k.original_movement_id IS DISTINCT FROM z.movement_id OR m.id IS NULL
          OR m.product_id IS DISTINCT FROM z.product_id OR m.actor_id IS DISTINCT FROM actor
          OR m.movement_type IS DISTINCT FROM 'entry' OR m.quantity IS DISTINCT FROM z.quantity
          OR m.request_quantity IS DISTINCT FROM z.quantity OR m.request_counted_balance IS NOT NULL
          OR m.balance_after IS DISTINCT FROM m.balance_before+z.quantity
          OR m.result_version IS DISTINCT FROM m.request_expected_version+1
          OR m.reason IS DISTINCT FROM 'Order delivery correction '||result_event::text)) THEN
      RAISE EXCEPTION 'receipt_result_unavailable' USING ERRCODE='P0002';
    END IF;
    RETURN QUERY SELECT 'delivery_undone'::text,p_order_id,p_target_status,result_version,result_event,p_delivery_event_id,effect_value;
    RETURN;
  END IF;
  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.version<>p_expected_version THEN RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001'; END IF;
  IF o.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF o.operational_status<>'entregue' THEN RAISE EXCEPTION 'order_not_delivered' USING ERRCODE='P0001'; END IF;
  SELECT x.* INTO ev FROM public.order_events x WHERE x.enterprise_id=eid AND x.order_id=p_order_id
    AND x.event_type='delivered' ORDER BY x.order_version DESC LIMIT 1;
  IF NOT FOUND OR ev.event_uuid IS DISTINCT FROM p_delivery_event_id
     OR EXISTS (SELECT 1 FROM public.order_delivery_undos x WHERE x.enterprise_id=eid AND x.delivery_event_id=p_delivery_event_id) THEN
    RAISE EXCEPTION 'delivery_confirmation_unavailable' USING ERRCODE='P0001';
  END IF;
  PERFORM private.orders_flex_validate_delivery(eid,p_delivery_event_id);
  -- No attempt may relabel an inherited actual delivery as an incorrect original debit (D4).
  IF p_classification='incorrect_record' AND EXISTS (SELECT 1 FROM public.order_delivery_manifest x
    WHERE x.enterprise_id=eid AND x.delivery_event_id=p_delivery_event_id AND x.inherited_from_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'delivery_reconciliation_required' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_stock_reservations x WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.state='active') THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  -- Immutable manifest must also match the current physical obligation for a NEW command.
  IF (SELECT count(*) FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id)
       <> (SELECT count(*) FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid AND x.delivery_event_id=p_delivery_event_id)
     OR EXISTS (SELECT 1 FROM public.order_delivery_manifest x LEFT JOIN public.order_items it
       ON it.enterprise_id=x.enterprise_id AND it.order_id=x.order_id AND it.id=x.order_item_id
       WHERE x.enterprise_id=eid AND x.delivery_event_id=p_delivery_event_id AND
         (it.id IS NULL OR it.product_id IS DISTINCT FROM x.product_id OR it.quantity IS DISTINCT FROM x.quantity
          OR it.fulfillment_mode IS DISTINCT FROM x.fulfillment_mode)) THEN
    RAISE EXCEPTION 'delivery_reconciliation_required' USING ERRCODE='23514';
  END IF;
  effect_value:=CASE WHEN EXISTS (SELECT 1 FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid
    AND x.delivery_event_id=p_delivery_event_id AND x.settlement_id IS NOT NULL)
    THEN CASE WHEN p_classification='incorrect_record' THEN 'compensated' ELSE 'preserved' END ELSE 'no_physical_movement' END;
  IF p_classification='incorrect_record' THEN
    FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_stock_settlements x
      WHERE x.enterprise_id=eid AND x.delivery_operation_id=p_delivery_event_id ORDER BY x.product_id LOOP
      PERFORM 1 FROM public.products x WHERE x.enterprise_id=eid AND x.id=product_uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'delivery_reconciliation_required' USING ERRCODE='23514'; END IF;
    END LOOP;
    FOR product_uuid IN SELECT DISTINCT x.product_id FROM public.order_stock_settlements x
      WHERE x.enterprise_id=eid AND x.delivery_operation_id=p_delivery_event_id ORDER BY x.product_id LOOP
      PERFORM 1 FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=product_uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'delivery_reconciliation_required' USING ERRCODE='23514'; END IF;
    END LOOP;
    FOR g IN SELECT x.product_id,sum(x.quantity) AS quantity,count(*) AS calls FROM public.order_stock_settlements x
      WHERE x.enterprise_id=eid AND x.delivery_operation_id=p_delivery_event_id GROUP BY x.product_id ORDER BY x.product_id LOOP
      SELECT x.* INTO STRICT inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=g.product_id;
      IF inv.reserved_balance IS DISTINCT FROM (SELECT coalesce(sum(x.quantity),0) FROM public.order_stock_reservations x
        WHERE x.enterprise_id=eid AND x.product_id=g.product_id AND x.state='active') THEN
        RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
      END IF;
      IF inv.balance+g.quantity>1000000000 THEN RAISE EXCEPTION 'inventory_balance_limit_exceeded' USING ERRCODE='22003'; END IF;
      IF inv.version>9007199254740991-g.calls THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.order_stock_settlements z JOIN public.order_delivery_compensations k
      ON k.enterprise_id=z.enterprise_id AND k.settlement_id=z.id WHERE z.enterprise_id=eid AND z.delivery_operation_id=p_delivery_event_id) THEN
      RAISE EXCEPTION 'settlement_already_compensated' USING ERRCODE='23505';
    END IF;
  END IF;
  new_event:=pg_catalog.gen_random_uuid();
  INSERT INTO public.order_events(event_uuid,enterprise_id,order_id,actor_id,event_type,from_status,to_status,order_version,reason,metadata)
    VALUES(new_event,eid,p_order_id,actor,'delivery_undone','entregue',p_target_status,o.version+1,reason_value,
      pg_catalog.jsonb_build_object('attempt_id',p_attempt_id,'payload_hash',hash_value,
        'source_delivery_event_id',p_delivery_event_id,'classification',p_classification,'physical_effect',effect_value));
  INSERT INTO public.order_delivery_undos(enterprise_id,order_id,delivery_event_id,undo_event_id,target_status,classification,attempt_id)
    VALUES(eid,p_order_id,p_delivery_event_id,new_event,p_target_status,p_classification,p_attempt_id);
  IF p_classification='incorrect_record' THEN
    FOR s IN SELECT x.* FROM public.order_stock_settlements x WHERE x.enterprise_id=eid
      AND x.delivery_operation_id=p_delivery_event_id ORDER BY x.product_id,x.id LOOP
      SELECT x.* INTO STRICT inv FROM public.product_inventory x WHERE x.enterprise_id=eid AND x.product_id=s.product_id;
      LOOP
        internal_attempt:=pg_catalog.gen_random_uuid();
        EXIT WHEN internal_attempt<>p_attempt_id AND NOT EXISTS (SELECT 1 FROM public.product_inventory_movements x
          WHERE x.enterprise_id=eid AND x.actor_id=actor AND x.attempt_id=internal_attempt);
      END LOOP;
      INSERT INTO public.product_inventory_movements(enterprise_id,inventory_id,product_id,actor_id,movement_type,
        quantity,balance_before,balance_after,reason,attempt_id,request_expected_version,request_quantity,request_counted_balance,result_version)
      VALUES(eid,inv.id,s.product_id,actor,'entry',s.quantity,inv.balance,inv.balance+s.quantity,
        'Order delivery correction '||new_event::text,internal_attempt,inv.version,s.quantity,NULL,inv.version+1)
      RETURNING id INTO movement_uuid;
      UPDATE public.product_inventory x SET balance=x.balance+s.quantity,version=x.version+1 WHERE x.enterprise_id=eid AND x.id=inv.id;
      INSERT INTO public.order_delivery_compensations(enterprise_id,settlement_id,original_movement_id,compensation_movement_id,undo_event_id)
        VALUES(eid,s.id,s.movement_id,movement_uuid,new_event);
    END LOOP;
  END IF;
  UPDATE public.orders x SET operational_status=p_target_status,delivered_at=NULL,version=x.version+1
    WHERE x.enterprise_id=eid AND x.id=p_order_id RETURNING x.* INTO o;
  result_value:=pg_catalog.jsonb_build_object('status','delivery_undone','order_id',p_order_id,
    'operational_status',p_target_status,'version',o.version,'event_id',new_event,
    'source_delivery_event_id',p_delivery_event_id,'physical_effect',effect_value);
  INSERT INTO private.order_operation_receipts(enterprise_id,actor_id,command_name,attempt_id,payload_hash,order_id,result)
    VALUES(eid,actor,'undo_delivery',p_attempt_id,hash_value,p_order_id,result_value);
  PERFORM private.orders_flex_validate_delivery(eid,p_delivery_event_id);
  RETURN QUERY SELECT 'delivery_undone'::text,p_order_id,p_target_status,o.version,new_event,p_delivery_event_id,effect_value;
END $$;
ALTER FUNCTION public.undo_order_delivery(uuid,uuid,bigint,uuid,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.undo_order_delivery(uuid,uuid,bigint,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.undo_order_delivery(uuid,uuid,bigint,uuid,text,text,text) TO authenticated;


-- One row per CURRENT item. Snapshot version binds this reader to subsequent commands.
CREATE FUNCTION public.get_order_physical_state(p_order_id uuid)
RETURNS TABLE(order_id uuid,order_version bigint,order_item_id uuid,product_id uuid,quantity bigint,
  fulfillment_mode text,physical_state text,requires_allocation boolean,active_reservation_id uuid,
  settlement_id uuid,source_delivery_event_id uuid,current_delivery_event_id uuid,
  can_undo_as_incorrect boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c record; eid uuid; actor uuid; o public.orders%ROWTYPE; it record;
  coverage uuid; current_event uuid; source_event uuid; active_id uuid;
  state_value text; invalid_chain boolean; inherited boolean; covered_count bigint;
  invalid_current boolean:=false;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  eid:=c.enterprise_id; actor:=private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id OR NOT private.can_access_enterprise(eid,'sales.read') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT x.* INTO o FROM public.orders x WHERE x.enterprise_id=eid AND x.id=p_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002'; END IF;
  IF o.operational_status='entregue' THEN
    SELECT x.event_uuid INTO current_event FROM public.order_events x WHERE x.enterprise_id=eid
      AND x.order_id=p_order_id AND x.event_type='delivered' ORDER BY x.order_version DESC LIMIT 1;
  END IF;
  BEGIN
    -- Compensated cycles are not candidates for coverage, but still require proof.
    PERFORM private.orders_flex_validate_delivery(eid,h.delivery_operation_id)
      FROM (SELECT DISTINCT z.delivery_operation_id FROM public.order_stock_settlements z
        WHERE z.enterprise_id=eid AND z.order_id=p_order_id) h;
    IF current_event IS NOT NULL THEN
      PERFORM private.orders_flex_validate_delivery(eid,current_event);
      IF (SELECT count(*) FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id)
        <> (SELECT count(*) FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid AND x.delivery_event_id=current_event)
        OR EXISTS (SELECT 1 FROM public.order_delivery_undos x WHERE x.enterprise_id=eid AND x.delivery_event_id=current_event) THEN
        invalid_current:=true;
      END IF;
    END IF;
  EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE 'P0001' THEN invalid_current:=true;
  END;
  FOR it IN SELECT x.* FROM public.order_items x WHERE x.enterprise_id=eid AND x.order_id=p_order_id ORDER BY x.line_number LOOP
    coverage:=NULL; source_event:=NULL; active_id:=NULL; invalid_chain:=invalid_current; inherited:=false;
    BEGIN
      IF current_event IS NOT NULL THEN
        SELECT x.settlement_id,x.inherited_from_event_id IS NOT NULL INTO coverage,inherited
          FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid AND x.delivery_event_id=current_event
            AND x.order_item_id=it.id AND x.product_id IS NOT DISTINCT FROM it.product_id
            AND x.quantity=it.quantity AND x.fulfillment_mode=it.fulfillment_mode;
        IF NOT FOUND THEN invalid_chain:=true; END IF;
      ELSIF o.operational_status='entregue' THEN
        invalid_chain:=true;
      ELSE
        coverage:=private.orders_flex_valid_coverage(eid,p_order_id,it.id);
      END IF;
      IF coverage IS NOT NULL THEN
        SELECT x.delivery_operation_id INTO source_event FROM public.order_stock_settlements x
          WHERE x.enterprise_id=eid AND x.id=coverage;
        IF EXISTS (SELECT 1 FROM public.order_delivery_compensations x WHERE x.enterprise_id=eid AND x.settlement_id=coverage) THEN
          invalid_chain:=true;
        END IF;
      END IF;
      SELECT count(*),min(x.id::text)::uuid INTO covered_count,active_id FROM public.order_stock_reservations x
        WHERE x.enterprise_id=eid AND x.order_id=p_order_id AND x.order_item_id=it.id AND x.state='active';
      IF covered_count>1 OR (coverage IS NOT NULL AND covered_count>0)
         OR (it.fulfillment_mode='untracked' AND covered_count>0)
         OR EXISTS (SELECT 1 FROM public.order_stock_reservations x WHERE x.enterprise_id=eid
           AND x.order_item_id=it.id AND x.state='active'
           AND (x.product_id IS DISTINCT FROM it.product_id OR x.quantity IS DISTINCT FROM it.quantity)) THEN
        invalid_chain:=true;
      END IF;
    EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE 'P0001' THEN invalid_chain:=true;
    END;
    state_value:=CASE WHEN invalid_chain THEN 'reconciliation_required'
      WHEN it.fulfillment_mode='untracked' THEN 'untracked'
      WHEN coverage IS NOT NULL THEN 'valid_debit'
      WHEN active_id IS NOT NULL THEN 'allocated'
      WHEN EXISTS (SELECT 1 FROM public.order_stock_settlements z JOIN public.order_delivery_compensations k
        ON k.enterprise_id=z.enterprise_id AND k.settlement_id=z.id
        WHERE z.enterprise_id=eid AND z.order_id=p_order_id AND z.order_item_id=it.id) THEN 'compensated'
      ELSE 'allocation_required' END;
    RETURN QUERY SELECT p_order_id,o.version,it.id,it.product_id,it.quantity,it.fulfillment_mode,
      state_value,(state_value IN ('compensated','allocation_required')),active_id,coverage,source_event,current_event,
      (current_event IS NOT NULL AND NOT invalid_chain AND NOT EXISTS (
        SELECT 1 FROM public.order_delivery_manifest x WHERE x.enterprise_id=eid
          AND x.delivery_event_id=current_event AND x.inherited_from_event_id IS NOT NULL));
  END LOOP;
END $$;
ALTER FUNCTION public.get_order_physical_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_physical_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_order_physical_state(uuid) TO authenticated;


-- Fail the entire installation if any RPC/helper/table accidentally exposes a bypass.
DO $security$
DECLARE f record; t record; e record;
BEGIN
  FOR f IN SELECT p.oid,p.prosecdef,p.proowner,p.proconfig,n.nspname,p.proname
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN ('transition_order','allocate_order_stock','cancel_order',
      'reopen_order','deliver_order','undo_order_delivery','get_order_physical_state'))
      OR (n.nspname='private' AND p.proname LIKE 'orders_flex_%') LOOP
    IF NOT f.prosecdef OR f.proowner<>'postgres'::regrole
       OR NOT ('search_path=""'=ANY(coalesce(f.proconfig,ARRAY[]::text[])))
       OR pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
       OR (f.nspname='private' AND pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE'))
       OR (f.nspname='public' AND NOT pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'orders_flex_function_security_mismatch: %.%',f.nspname,f.proname;
    END IF;
  END LOOP;
  FOR t IN SELECT c.oid,c.relrowsecurity,c.relowner,c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN ('order_delivery_manifest','order_delivery_undos','order_delivery_compensations') LOOP
    IF NOT t.relrowsecurity OR t.relowner<>'postgres'::regrole
       OR pg_catalog.has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('authenticated',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('service_role',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy x WHERE x.polrelid=t.oid)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger x WHERE x.tgrelid=t.oid AND NOT x.tgisinternal
         AND x.tgenabled='O' AND x.tgfoid='public.order_events_forbid_mutation()'::regprocedure) THEN
      RAISE EXCEPTION 'orders_flex_table_security_mismatch: %',t.relname;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM private.order_stock_reservation_reconciliation WHERE discrepancy<>0)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid IN (
       'public.order_delivery_manifest'::regclass,'public.order_delivery_undos'::regclass,
       'public.order_delivery_compensations'::regclass) AND NOT convalidated) THEN
    RAISE EXCEPTION 'orders_flex_final_invariant_failed';
  END IF;
  FOR e IN SELECT enterprise_id,event_uuid FROM public.order_events WHERE event_type='delivered' LOOP
    PERFORM private.orders_flex_validate_delivery(e.enterprise_id,e.event_uuid);
  END LOOP;
END $security$;
COMMIT;

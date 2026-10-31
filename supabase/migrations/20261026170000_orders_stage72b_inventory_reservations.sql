-- Stage 7.2-B: reserved finished-product stock and narrow order primitives.
-- PRECONDITION: M7.2-A and the effective finished-product inventory/product RPC
-- definitions must exist exactly as inspected. This migration aborts if the
-- inventory table or expected columns are absent. Do not apply before catalog review.
-- No order-facing public RPCs are introduced; helpers are private and ungranted.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.product_inventory') IS NULL
     OR to_regclass('public.product_inventory_movements') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL THEN
    RAISE EXCEPTION 'stage72b_prerequisite_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.product_inventory'::regclass AND attname='balance'
      AND atttypid='bigint'::regtype AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.product_inventory_movements'::regclass AND attname='request_expected_version' AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.product_inventory_movements'::regclass
      AND conname='product_inventory_movements_pair_fk' AND contype='f')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.product_inventory_movements'::regclass
      AND conname='product_inventory_movements_attempt_key' AND contype='u') THEN
    RAISE EXCEPTION 'stage72b_inventory_schema_mismatch';
  END IF;
  IF to_regclass('public.products') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid='public.products'::regclass AND attname='deleted_at' AND NOT attisdropped)
     OR to_regclass('public.enterprise_plan_access') IS NULL
     OR to_regclass('public.internal_product_image_uploads') IS NULL
     OR to_regclass('private.stage5_delete_receipts') IS NULL
     OR to_regprocedure('private.lock_product_inventory_context(text)') IS NULL
     OR to_regprocedure('private.lock_internal_product_context(text)') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.stage6b_product_visible(uuid,uuid)') IS NULL
     OR to_regprocedure('public.order_events_forbid_mutation()') IS NULL THEN
    RAISE EXCEPTION 'stage72b_dependency_missing';
  END IF;
  IF to_regprocedure('public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)') IS NULL
    OR to_regprocedure('public.set_internal_product_active(uuid,bigint,boolean)') IS NULL
    OR to_regprocedure('public.delete_internal_product(uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'stage72b_rpc_signature_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.product_inventory'::regclass AND attname='reserved_balance' AND NOT attisdropped)
    OR to_regclass('public.order_stock_settlements') IS NOT NULL THEN
    RAISE EXCEPTION 'stage72b_already_partially_installed';
  END IF;
END;
$preflight$;

ALTER TABLE public.product_inventory
  ADD COLUMN reserved_balance bigint NOT NULL DEFAULT 0;
ALTER TABLE public.product_inventory
  ADD CONSTRAINT product_inventory_reserved_balance_check
  CHECK (reserved_balance BETWEEN 0 AND balance);

CREATE VIEW public.product_inventory_availability WITH (security_barrier=true) AS
SELECT enterprise_id, product_id, id AS inventory_id, balance, reserved_balance,
       balance-reserved_balance AS available_balance, version, created_at, updated_at
FROM public.product_inventory;
ALTER VIEW public.product_inventory_availability OWNER TO postgres;
REVOKE ALL ON public.product_inventory_availability FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_enterprise_id_product_key UNIQUE(enterprise_id,id,product_id);
ALTER TABLE public.order_stock_reservations
  ADD CONSTRAINT order_stock_reservations_settlement_target_key
  UNIQUE(enterprise_id,id,order_id,order_item_id,product_id,quantity);

CREATE TABLE public.order_stock_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
  delivery_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT order_stock_settlements_id_enterprise_key UNIQUE(enterprise_id,id),
  CONSTRAINT order_stock_settlements_reservation_unique UNIQUE(enterprise_id,reservation_id),
  CONSTRAINT order_stock_settlements_movement_unique UNIQUE(enterprise_id,movement_id),
  CONSTRAINT order_stock_settlements_delivery_item_unique UNIQUE(enterprise_id,delivery_operation_id,order_item_id),
  CONSTRAINT order_stock_settlements_order_fk FOREIGN KEY(enterprise_id,order_id)
    REFERENCES public.orders(enterprise_id,id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_settlements_item_fk FOREIGN KEY(enterprise_id,order_id,order_item_id,product_id)
    REFERENCES public.order_items(enterprise_id,order_id,id,product_id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_settlements_reservation_fk
    FOREIGN KEY(enterprise_id,reservation_id,order_id,order_item_id,product_id,quantity)
    REFERENCES public.order_stock_reservations(enterprise_id,id,order_id,order_item_id,product_id,quantity) ON DELETE RESTRICT,
  CONSTRAINT order_stock_settlements_movement_fk FOREIGN KEY(enterprise_id,movement_id,product_id)
    REFERENCES public.product_inventory_movements(enterprise_id,id,product_id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_settlements_created_finite CHECK(isfinite(created_at))
);
CREATE TRIGGER order_stock_settlements_immutable BEFORE UPDATE OR DELETE
ON public.order_stock_settlements FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();
CREATE INDEX order_stock_settlements_order_idx
  ON public.order_stock_settlements(enterprise_id,order_id,created_at,id);
ALTER TABLE public.order_stock_settlements OWNER TO postgres;
ALTER TABLE public.order_stock_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_stock_settlements FROM PUBLIC,anon,authenticated,service_role;

CREATE VIEW private.order_stock_reservation_reconciliation AS
WITH active AS (
  SELECT enterprise_id,product_id,sum(quantity)::numeric AS active_quantity
  FROM public.order_stock_reservations WHERE state='active'
  GROUP BY enterprise_id,product_id
)
SELECT coalesce(i.enterprise_id,a.enterprise_id) AS enterprise_id,
       coalesce(i.product_id,a.product_id) AS product_id,
       i.id AS inventory_id,coalesce(i.reserved_balance,0)::numeric AS reserved_balance,
       coalesce(a.active_quantity,0::numeric) AS active_reservation_quantity,
       coalesce(i.reserved_balance,0)::numeric-coalesce(a.active_quantity,0::numeric) AS discrepancy
FROM public.product_inventory i FULL JOIN active a USING(enterprise_id,product_id);
ALTER VIEW private.order_stock_reservation_reconciliation OWNER TO postgres;
REVOKE ALL ON private.order_stock_reservation_reconciliation FROM PUBLIC,anon,authenticated,service_role;

-- Caller contract: trusted M7.2-C SECURITY DEFINER only. Resolve identity/context,
-- `sales.write`, plan entitlement/mutex, lock the order FOR UPDATE, then lock every
-- affected product UUID-sorted, inventory positions UUID-sorted, then reservation
-- rows. Caller must keep plan mutex and order lock until commit. This helper never
-- treats p_enterprise_id as authorization. It only checks actor presence because
-- authorization and entitlement policy belong to the outer command. The full lock
-- set (product and position) must be acquired before this helper; inside it locks
-- item then reservation. It is not executable by API roles. No callers are defined.
CREATE FUNCTION private.reserve_order_item_stock(
  p_enterprise_id uuid,p_order_id uuid,p_order_item_id uuid,p_product_id uuid,p_quantity bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE it public.order_items%ROWTYPE; inv public.product_inventory%ROWTYPE; rid uuid;
BEGIN
  IF p_enterprise_id IS NULL OR p_order_id IS NULL OR p_order_item_id IS NULL
     OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000000000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  IF private.current_internal_user_id() IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  -- Caller has locked order, all affected items in UUID order, then products and
  -- positions UUID-sorted. Revalidate after those locks. No row lock is taken here
  -- because item writers are serialized by the same order lock; they must obey that
  -- protocol and cannot update this item until this command commits.
  SELECT x.* INTO it FROM public.order_items x
  WHERE x.enterprise_id=p_enterprise_id AND x.order_id=p_order_id
    AND x.id=p_order_item_id AND x.product_id=p_product_id
    AND x.quantity=p_quantity AND x.fulfillment_mode IN ('stock','make_to_order');
  IF NOT FOUND THEN RAISE EXCEPTION 'order_item_stock_mismatch' USING ERRCODE='P0001'; END IF;
  PERFORM 1 FROM public.products p WHERE p.enterprise_id=p_enterprise_id AND p.id=p_product_id
    AND p.active AND p.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.order_stock_reservations r
    WHERE r.enterprise_id=p_enterprise_id AND r.order_item_id=p_order_item_id AND r.state='active') THEN
    RAISE EXCEPTION 'active_reservation_exists' USING ERRCODE='23505';
  END IF;
  SELECT x.* INTO inv FROM public.product_inventory x
  WHERE x.enterprise_id=p_enterprise_id AND x.product_id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003'; END IF;
  IF inv.version >= 9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF inv.reserved_balance > inv.balance OR p_quantity > inv.balance-inv.reserved_balance THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0003';
  END IF;
  INSERT INTO public.order_stock_reservations(enterprise_id,order_id,order_item_id,product_id,quantity,actor_id)
  VALUES(p_enterprise_id,p_order_id,p_order_item_id,p_product_id,p_quantity,private.current_internal_user_id())
  RETURNING id INTO rid;
  UPDATE public.product_inventory x SET reserved_balance=x.reserved_balance+p_quantity,
    version=x.version+1 WHERE x.id=inv.id;
  RETURN rid;
END $$;

-- Call only after outer command locked order, product, then position. The reservation
-- identity read is unlocked; row lock is last in the hierarchy and identity/state
-- are revalidated. release affects aggregate only; consume also requires M7.2-C to
-- insert the physical movement and settlement in the same surrounding transaction.
CREATE FUNCTION private.finalize_order_item_reservation(
  p_enterprise_id uuid,p_order_id uuid,p_reservation_id uuid,p_action text,p_reason text DEFAULT NULL
) RETURNS TABLE(product_id uuid,quantity bigint,resulting_balance bigint,
                resulting_reserved_balance bigint,inventory_version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.order_stock_reservations%ROWTYPE; i public.product_inventory%ROWTYPE;
BEGIN
  IF p_enterprise_id IS NULL OR p_order_id IS NULL OR p_reservation_id IS NULL
     OR p_action NOT IN('release','consume')
     OR (p_action='release' AND (p_reason IS NULL OR pg_catalog.length(p_reason)>1000))
     OR (p_action='consume' AND p_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  SELECT x.* INTO r FROM public.order_stock_reservations x
  WHERE x.enterprise_id=p_enterprise_id AND x.order_id=p_order_id AND x.id=p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_active' USING ERRCODE='P0001'; END IF;
  -- Precondition: caller already owns product and inventory locks; do not acquire
  -- them here after any reservation lock.
  SELECT x.* INTO i FROM public.product_inventory x
  WHERE x.enterprise_id=p_enterprise_id AND x.product_id=r.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  SELECT x.* INTO r FROM public.order_stock_reservations x
  WHERE x.enterprise_id=p_enterprise_id AND x.order_id=p_order_id AND x.id=p_reservation_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'active' THEN RAISE EXCEPTION 'reservation_not_active' USING ERRCODE='P0001'; END IF;
  IF i.reserved_balance<r.quantity OR i.balance<i.reserved_balance THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514';
  END IF;
  IF i.version>=9007199254740991 THEN RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE='22003'; END IF;
  IF p_action='consume' AND i.balance<r.quantity THEN RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE='23514'; END IF;
  UPDATE public.product_inventory x SET reserved_balance=x.reserved_balance-r.quantity,
    balance=CASE WHEN p_action='consume' THEN x.balance-r.quantity ELSE x.balance END,
    version=x.version+1 WHERE x.id=i.id RETURNING x.* INTO i;
  UPDATE public.order_stock_reservations x SET state=CASE WHEN p_action='release' THEN 'released' ELSE 'consumed' END,
    finalized_at=pg_catalog.now(),finalization_reason=CASE WHEN p_action='release' THEN p_reason ELSE NULL END
  WHERE x.id=r.id;
  product_id:=r.product_id; quantity:=r.quantity; resulting_balance:=i.balance;
  resulting_reserved_balance:=i.reserved_balance; inventory_version:=i.version; RETURN NEXT;
END $$;

-- The existing writer already has centralized context/entitlement/plan-mutex,
-- product lock, inventory lock, idempotency receipt semantics, ledger insertion,
-- and five-column response contract. Replacing it here without the deployed body
-- is unsafe; implement the reserved-balance delta in a reviewed successor migration
-- only after remote preflight confirms the full definition. We deliberately do not
-- redefine it in this candidate. REQUIRED follow-up: extend writer validation to
-- reject exit/adjustment below reserved_balance while preserving its exact behavior.

-- Product RPC wrappers must likewise be composed from the effective 20261026080000
-- definitions. This candidate does not replace them: a full-body rewrite without
-- catalog evidence risks erasing plan-window, idempotency, receipts and ACL semantics.
-- REQUIRED follow-up: add the active-reservation check after context -> product ->
-- position locks, and retain current result/error contract. Product and position
-- guards alone cannot safely implement this without the deployed body review.

ALTER TABLE public.order_stock_settlements OWNER TO postgres;
ALTER FUNCTION private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint) SET search_path='';
ALTER FUNCTION private.finalize_order_item_reservation(uuid,uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION private.finalize_order_item_reservation(uuid,uuid,uuid,text,text) SET search_path='';
REVOKE ALL ON FUNCTION private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.finalize_order_item_reservation(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

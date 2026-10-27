-- M7.2-B.1: compatibility guards for the effective public inventory/product RPCs.
-- NOT APPLIED. Based on the exact pg_get_functiondef output supplied in this task.
-- Before applying: verify M7.2-B schema exists and locally compare catalog output.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.product_inventory') IS NULL
     OR to_regclass('public.order_stock_reservations') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('private.stage5_delete_receipts') IS NULL THEN
    RAISE EXCEPTION 'stage72b1_prerequisite_missing';
  END IF;
  IF to_regclass('public.product_inventory_movements') IS NULL
     OR to_regclass('public.internal_product_image_uploads') IS NULL
     OR to_regprocedure('private.lock_product_inventory_context(text)') IS NULL
     OR to_regprocedure('private.lock_internal_product_context(text)') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL
     OR to_regprocedure('private.stage6b_product_visible(uuid,uuid)') IS NULL
     OR to_regclass('private.stage5_delete_receipts') IS NULL THEN
    RAISE EXCEPTION 'stage72b1_dependencies_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.product_inventory'::regclass AND attname='reserved_balance'
      AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'stage72b1_reserved_balance_missing';
  END IF;
  IF to_regprocedure('public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)') IS NULL
    OR to_regprocedure('public.set_internal_product_active(uuid,bigint,boolean)') IS NULL
    OR to_regprocedure('public.delete_internal_product(uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'stage72b1_rpc_signatures_missing';
  END IF;
END;
$preflight$;

-- Concurrency contract: all authorized reservation writers MUST lock the product
-- row before the inventory position, then mutate reservations/aggregate and hold the
-- locks through commit. The current B reservation helper does not establish this
-- outer product lock itself; no production callers exist yet. API roles must not
-- have direct reservation DML. Without that future M7.2-C protocol, the guards below
-- are not race-proof against a writer that bypasses the product-row barrier.

CREATE OR REPLACE FUNCTION public.move_product_inventory(
  p_attempt_id uuid,
  p_product_id uuid,
  p_expected_version bigint,
  p_movement_type text,
  p_quantity numeric DEFAULT NULL::numeric,
  p_counted_balance numeric DEFAULT NULL::numeric,
  p_reason text DEFAULT NULL::text
)
RETURNS TABLE(status text, movement_id uuid, product_id uuid, balance bigint, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_enterprise_id uuid;
  v_actor_id uuid;
  v_product public.products%ROWTYPE;
  v_inventory public.product_inventory%ROWTYPE;
  v_old_movement public.product_inventory_movements%ROWTYPE;
  v_q bigint;
  v_nb bigint;
  v_r text;
  v_qty_scaled numeric;
  v_cnt_scaled numeric;
BEGIN
  IF p_attempt_id IS NULL OR p_product_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_movement_type IS NULL OR p_movement_type NOT IN ('entry', 'exit', 'adjustment')
     OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  v_r := pg_catalog.btrim(p_reason);
  IF v_r = '' OR pg_catalog.length(v_r) > 500 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF p_movement_type IN ('entry', 'exit') THEN
    IF p_quantity IS NULL OR p_counted_balance IS NOT NULL
       OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR pg_catalog.scale(p_quantity) > 0
       OR p_quantity NOT BETWEEN 1 AND 1000000000 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_qty_scaled := p_quantity;
    v_q := CASE WHEN p_movement_type = 'entry' THEN v_qty_scaled::bigint ELSE (-v_qty_scaled)::bigint END;
  ELSE
    IF p_counted_balance IS NULL OR p_quantity IS NOT NULL
       OR p_counted_balance::text IN ('NaN', 'Infinity', '-Infinity')
       OR pg_catalog.scale(p_counted_balance) > 0
       OR p_counted_balance NOT BETWEEN 0 AND 1000000000 THEN
      RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
    END IF;
    v_cnt_scaled := p_counted_balance;
  END IF;

  v_enterprise_id := private.lock_product_inventory_context('inventory.write');
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_actor_id := private.current_internal_user_id();

  -- Preserve idempotent recovery before current version/product checks.
  SELECT x.* INTO v_old_movement
  FROM public.product_inventory_movements AS x
  WHERE x.enterprise_id = v_enterprise_id
    AND x.actor_id = v_actor_id
    AND x.attempt_id = p_attempt_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_old_movement.product_id = p_product_id
       AND v_old_movement.movement_type = p_movement_type
       AND v_old_movement.request_expected_version = p_expected_version
       AND v_old_movement.request_quantity IS NOT DISTINCT FROM (CASE WHEN p_movement_type IN ('entry','exit') THEN v_qty_scaled::bigint ELSE NULL END)
       AND v_old_movement.request_counted_balance IS NOT DISTINCT FROM (CASE WHEN p_movement_type = 'adjustment' THEN v_cnt_scaled::bigint ELSE NULL END)
       AND v_old_movement.reason = v_r THEN
      RETURN QUERY
      SELECT 'idempotent'::text, v_old_movement.id, v_old_movement.product_id, v_old_movement.balance_after, v_old_movement.result_version;
      RETURN;
    END IF;
    RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  SELECT x.* INTO v_product
  FROM public.products AS x
  WHERE x.enterprise_id = v_enterprise_id AND x.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.active THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT x.* INTO v_inventory
  FROM public.product_inventory AS x
  WHERE x.enterprise_id = v_enterprise_id AND x.product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;

    IF p_movement_type = 'adjustment' AND v_cnt_scaled = 0 THEN
      RETURN QUERY
      SELECT 'no_change'::text, NULL::uuid, p_product_id, 0::bigint, 0::bigint;
      RETURN;
    END IF;

    -- Virtual position: defer INSERT until all effective-movement checks pass.
    v_inventory.balance := 0;
    v_inventory.reserved_balance := 0;
    v_inventory.version := 0;
  END IF;

  IF v_inventory.version <> p_expected_version THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_movement_type = 'adjustment' THEN
    v_q := v_cnt_scaled::bigint - v_inventory.balance;
  END IF;

  IF v_q = 0 THEN
    RETURN QUERY
    SELECT 'no_change'::text, NULL::uuid, p_product_id, v_inventory.balance, v_inventory.version;
    RETURN;
  END IF;

  -- Both a manual exit and a counted adjustment may reduce only free units.
  IF v_inventory.reserved_balance < 0 OR v_inventory.reserved_balance > v_inventory.balance THEN
    RAISE EXCEPTION 'reservation_balance_inconsistent' USING ERRCODE = '23514';
  END IF;

  IF v_q < 0 AND (-v_q) > (v_inventory.balance - v_inventory.reserved_balance) THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0003';
  END IF;

  IF v_q > 0 AND v_q > (1000000000 - v_inventory.balance) THEN
    RAISE EXCEPTION 'balance_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  v_nb := v_inventory.balance + v_q;
  IF v_nb < v_inventory.reserved_balance THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0003';
  END IF;
  IF v_nb < 0 OR v_nb > 1000000000 THEN
    RAISE EXCEPTION 'balance_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  IF v_inventory.version >= 9007199254740991 THEN
    RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  IF v_inventory.id IS NULL THEN
    INSERT INTO public.product_inventory AS x(enterprise_id, product_id, balance, reserved_balance, version)
    VALUES (v_enterprise_id, p_product_id, v_nb, 0, 1)
    RETURNING x.* INTO v_inventory;
  ELSE
    UPDATE public.product_inventory AS x
    SET balance = v_nb, version = x.version + 1
    WHERE x.id = v_inventory.id
    RETURNING x.* INTO v_inventory;
  END IF;

  INSERT INTO public.product_inventory_movements(
    enterprise_id, inventory_id, product_id, actor_id, movement_type,
    quantity, balance_before, balance_after, reason, attempt_id,
    request_expected_version, request_quantity, request_counted_balance, result_version
  )
  VALUES (
    v_enterprise_id, v_inventory.id, p_product_id, v_actor_id, p_movement_type,
    v_q, v_inventory.balance - v_q, v_nb, v_r, p_attempt_id,
    p_expected_version,
    CASE WHEN p_movement_type IN ('entry', 'exit') THEN v_qty_scaled::bigint ELSE NULL END,
    CASE WHEN p_movement_type = 'adjustment' THEN v_cnt_scaled::bigint ELSE NULL END,
    v_inventory.version
  )
  RETURNING id INTO movement_id;

  RETURN QUERY
  SELECT 'created'::text, movement_id, p_product_id, v_nb, v_inventory.version;
END
$function$;

CREATE OR REPLACE FUNCTION public.set_internal_product_active(
  p_id uuid,p_expected_version bigint,p_active boolean
)
RETURNS TABLE(status text,product_id uuid,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_enterprise_id uuid; v_product public.products%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_active IS NULL THEN
    RETURN QUERY SELECT 'invalid_input', p_id, NULL::bigint; RETURN;
  END IF;
  v_enterprise_id := private.lock_internal_product_context('products.delete');
  IF v_enterprise_id IS NULL THEN
    RETURN QUERY SELECT 'permission_denied', p_id, NULL::bigint; RETURN;
  END IF;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.id = p_id AND product.enterprise_id = v_enterprise_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'product_unavailable', p_id, NULL::bigint; RETURN;
  END IF;
  IF NOT private.stage6b_product_visible(v_enterprise_id, v_product.id) THEN
    RETURN QUERY SELECT 'product_unavailable', p_id, NULL::bigint; RETURN;
  END IF;
  IF v_product.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict', v_product.id, v_product.version; RETURN;
  END IF;
  IF v_product.active IS NOT DISTINCT FROM p_active THEN
    RETURN QUERY SELECT 'success', v_product.id, v_product.version; RETURN;
  END IF;
  IF NOT p_active THEN
    -- Match reserve/movement lock order: product row is already locked, then
    -- position row serializes against reservation aggregate changes.
    PERFORM 1 FROM public.product_inventory i
    WHERE i.enterprise_id=v_enterprise_id AND i.product_id=v_product.id
    FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.order_stock_reservations r
      WHERE r.enterprise_id=v_enterprise_id AND r.product_id=v_product.id AND r.state='active') THEN
      RAISE EXCEPTION 'product_has_active_reservations' USING ERRCODE='P0001';
    END IF;
  END IF;
  UPDATE public.products AS product
  SET active = p_active
  WHERE product.id = v_product.id
  RETURNING * INTO v_product;
  RETURN QUERY SELECT 'success', v_product.id, v_product.version;
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_internal_product(
  p_attempt_id uuid,p_id uuid,p_expected_version bigint
)
RETURNS TABLE(status text,product_id uuid,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE e uuid;a uuid;r jsonb;p jsonb:=pg_catalog.jsonb_build_object('id',p_id,'expected_version',p_expected_version);x public.products%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;
  e:=private.lock_internal_product_context('products.write');
  IF e IS NULL OR NOT private.can_access_enterprise(e,'products.delete') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  a:=private.current_internal_user_id();
  SELECT result INTO r FROM private.stage5_delete_receipts
  WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product' FOR UPDATE;
  IF FOUND THEN
    IF (SELECT payload FROM private.stage5_delete_receipts
        WHERE enterprise_id=e AND actor_id=a AND attempt_id=p_attempt_id AND entity='product')<>p THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT r->>'status',(r->>'product_id')::uuid,(r->>'version')::bigint; RETURN;
  END IF;
  SELECT * INTO x FROM public.products WHERE enterprise_id=e AND id=p_id FOR UPDATE;
  IF NOT FOUND OR x.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002';
  END IF;
  -- Receipt recovery above MUST precede visibility; successful soft-delete removes
  -- the product from the window. New attempts cannot mutate hidden rows.
  IF NOT private.stage6b_product_visible(e,x.id) THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE='P0002';
  END IF;
  IF x.version<>p_expected_version THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE='40001';
  END IF;
  -- Serialize against order reserve and manual movement (product -> position).
  PERFORM 1 FROM public.product_inventory i
    WHERE i.enterprise_id=e AND i.product_id=p_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.product_inventory i WHERE i.enterprise_id=e AND i.product_id=p_id AND i.balance<>0) THEN
    RAISE EXCEPTION 'balance_not_zero' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_stock_reservations r
    WHERE r.enterprise_id=e AND r.product_id=p_id AND r.state='active') THEN
    RAISE EXCEPTION 'product_has_active_reservations' USING ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.internal_product_image_uploads u WHERE u.enterprise_id=e AND u.product_id=p_id AND u.expires_at>=pg_catalog.now()) THEN
    RAISE EXCEPTION 'pending_image_upload' USING ERRCODE='55000';
  END IF;
  UPDATE public.products SET deleted_at=pg_catalog.now(),deleted_by=a
  WHERE id=p_id AND enterprise_id=e RETURNING * INTO x;
  r:=pg_catalog.jsonb_build_object('status','deleted','product_id',x.id,'version',x.version);
  INSERT INTO private.stage5_delete_receipts VALUES(e,a,p_attempt_id,'product',p,r,pg_catalog.now());
  RETURN QUERY SELECT 'deleted',x.id,x.version;
END
$function$;

-- CREATE OR REPLACE preserves the installed function ACLs; assert owner/settings
-- remain those reported by the supplied catalog definitions. No grants are added.
ALTER FUNCTION public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text) OWNER TO postgres;
ALTER FUNCTION public.move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text) SET search_path TO '';
ALTER FUNCTION public.set_internal_product_active(uuid,bigint,boolean) OWNER TO postgres;
ALTER FUNCTION public.set_internal_product_active(uuid,bigint,boolean) SET search_path TO '';
ALTER FUNCTION public.delete_internal_product(uuid,uuid,bigint) OWNER TO postgres;
ALTER FUNCTION public.delete_internal_product(uuid,uuid,bigint) SET search_path TO '';

COMMIT;

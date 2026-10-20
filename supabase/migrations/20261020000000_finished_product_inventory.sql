-- NEW / UNAPPLIED. Finished-product unit inventory, immutable ledger and narrow RPC contracts.
-- This migration is intentionally not executed automatically.
BEGIN;

CREATE TABLE public.product_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  balance bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT product_inventory_product_fk FOREIGN KEY (enterprise_id, product_id)
    REFERENCES public.products(enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT product_inventory_balance_check CHECK (balance BETWEEN 0 AND 1000000000),
  CONSTRAINT product_inventory_version_check CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT product_inventory_enterprise_product_key UNIQUE (enterprise_id, product_id),
  CONSTRAINT product_inventory_id_enterprise_product_key UNIQUE (enterprise_id, id, product_id)
);
CREATE INDEX product_inventory_list_idx ON public.product_inventory(enterprise_id, product_id);

CREATE TABLE public.product_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  inventory_id uuid NOT NULL,
  product_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  movement_type text NOT NULL,
  quantity bigint NOT NULL,
  balance_before bigint NOT NULL,
  balance_after bigint NOT NULL,
  reason varchar(500) NOT NULL,
  attempt_id uuid NOT NULL,
  request_expected_version bigint NOT NULL,
  request_quantity bigint,
  request_counted_balance bigint,
  result_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT product_inventory_movements_pair_fk FOREIGN KEY (enterprise_id, inventory_id, product_id)
    REFERENCES public.product_inventory(enterprise_id, id, product_id) ON DELETE RESTRICT,
  CONSTRAINT product_inventory_movements_type_check CHECK (movement_type IN ('entry','exit','adjustment')),
  CONSTRAINT product_inventory_movements_sign_check CHECK (
    (movement_type='entry' AND quantity IS NOT NULL AND quantity BETWEEN 1 AND 1000000000
      AND request_quantity IS NOT NULL AND request_quantity=quantity AND request_counted_balance IS NULL) OR
    (movement_type='exit' AND quantity IS NOT NULL AND quantity BETWEEN -1000000000 AND -1
      AND request_quantity IS NOT NULL AND request_quantity=(-quantity) AND request_counted_balance IS NULL) OR
    (movement_type='adjustment' AND quantity IS NOT NULL AND quantity BETWEEN -1000000000 AND 1000000000 AND quantity <> 0
      AND request_quantity IS NULL AND request_counted_balance IS NOT NULL AND request_counted_balance=balance_after)
  ),
  CONSTRAINT product_inventory_movements_balance_check CHECK (
    balance_before BETWEEN 0 AND 1000000000 AND balance_after BETWEEN 0 AND 1000000000 AND balance_after=balance_before+quantity
  ),
  CONSTRAINT product_inventory_movements_version_check CHECK (
    request_expected_version IS NOT NULL AND result_version IS NOT NULL
    AND request_expected_version BETWEEN 0 AND 9007199254740990
    AND result_version=request_expected_version+1
  ),
  CONSTRAINT product_inventory_movements_reason_check CHECK (
    pg_catalog.btrim(reason)=reason AND pg_catalog.length(reason) BETWEEN 1 AND 500
  ),
  CONSTRAINT product_inventory_movements_attempt_key UNIQUE (enterprise_id, actor_id, attempt_id)
);
CREATE INDEX product_inventory_movements_history_idx
  ON public.product_inventory_movements(enterprise_id, product_id, created_at DESC, id DESC);

ALTER TABLE public.product_inventory OWNER TO postgres;
ALTER TABLE public.product_inventory_movements OWNER TO postgres;
ALTER TABLE public.product_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.product_inventory_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'product_inventory_immutable_fields' USING ERRCODE='42501';
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END $$;
CREATE TRIGGER product_inventory_touch BEFORE UPDATE ON public.product_inventory
FOR EACH ROW EXECUTE FUNCTION public.product_inventory_touch();

CREATE OR REPLACE FUNCTION public.reject_product_inventory_movement_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'product_inventory_movements_immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER product_inventory_movements_immutable BEFORE UPDATE OR DELETE
ON public.product_inventory_movements FOR EACH ROW
EXECUTE FUNCTION public.reject_product_inventory_movement_mutation();

-- Preserve all existing permissions and append inventory.read/write.
CREATE OR REPLACE FUNCTION private.can_access_enterprise(p_enterprise_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT CASE WHEN p_enterprise_id IS NULL OR p_permission IS NULL THEN false ELSE
 (SELECT count(*)=1 FROM public.enterprise_members em JOIN public.enterprises e ON e.id=em.enterprise_id
  WHERE em.user_id=private.current_internal_user_id() AND em.status='active' AND e.status='active')
 AND EXISTS (SELECT 1 FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id
  JOIN public.enterprises e ON e.id=em.enterprise_id
  WHERE em.enterprise_id=p_enterprise_id AND em.user_id=private.current_internal_user_id()
    AND em.status='active' AND u.status='active' AND NOT u.must_change_password AND e.status='active'
    AND CASE p_permission
      WHEN 'products.read' THEN em.role IN ('owner','admin','operator') WHEN 'products.write' THEN em.role IN ('owner','admin','operator') WHEN 'products.delete' THEN em.role IN ('owner','admin')
      WHEN 'catalogs.read' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.write' THEN em.role IN ('owner','admin','operator') WHEN 'catalogs.delete' THEN em.role IN ('owner','admin')
      WHEN 'filters.read' THEN em.role IN ('owner','admin','operator') WHEN 'filters.write' THEN em.role IN ('owner','admin','operator') WHEN 'filters.delete' THEN em.role IN ('owner','admin')
      WHEN 'sales.read' THEN em.role IN ('owner','admin','operator') WHEN 'sales.write' THEN em.role IN ('owner','admin','operator') WHEN 'sales.delete' THEN em.role IN ('owner','admin')
      WHEN 'printers.read' THEN em.role IN ('owner','admin','operator') WHEN 'printers.write' THEN em.role IN ('owner','admin') WHEN 'printers.archive' THEN em.role IN ('owner','admin')
      WHEN 'materials.read' THEN em.role IN ('owner','admin','operator') WHEN 'materials.write' THEN em.role IN ('owner','admin') WHEN 'materials.archive' THEN em.role IN ('owner','admin')
      WHEN 'pricing.read' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.write' THEN em.role IN ('owner','admin','operator') WHEN 'pricing.apply' THEN em.role IN ('owner','admin','operator')
      WHEN 'enterprise.manage' THEN em.role='owner' WHEN 'members.manage_admins' THEN em.role='owner' WHEN 'members.manage_operators' THEN em.role IN ('owner','admin')
      WHEN 'spools.read' THEN em.role IN ('owner','admin','operator') WHEN 'spools.write' THEN em.role IN ('owner','admin','operator') WHEN 'spools.archive' THEN em.role IN ('owner','admin')
      WHEN 'inventory.read' THEN em.role IN ('owner','admin','operator') WHEN 'inventory.write' THEN em.role IN ('owner','admin','operator')
      ELSE false END)
END $$;

CREATE FUNCTION private.lock_product_inventory_context(p_permission text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_context RECORD;
  v_identity public.auth_identities%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_member public.enterprise_members%ROWTYPE;
  v_enterprise public.enterprises%ROWTYPE;
  v_auth_uid uuid := auth.uid();
  v_issuer text := auth.jwt() ->> 'iss';
BEGIN
  IF p_permission IS NULL OR p_permission NOT IN ('inventory.read', 'inventory.write')
     OR v_auth_uid IS NULL OR v_issuer IS NULL OR pg_catalog.btrim(v_issuer) = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0)
  );

  SELECT * INTO v_context FROM public.get_my_access_context();
  IF NOT FOUND OR v_context.state IS DISTINCT FROM 'business_ready' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.auth_issuer_config AS ac
    WHERE ac.issuer = v_issuer AND ac.provider = 'supabase' AND ac.status = 'active'
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || v_auth_uid::text, 0)
  );

  SELECT ai.* INTO v_identity
  FROM public.auth_identities AS ai
  JOIN private.auth_issuer_config AS ac
    ON ac.issuer = ai.issuer AND ac.provider = 'supabase' AND ac.status = 'active'
  WHERE ai.provider = 'supabase'
    AND ai.issuer = v_issuer
    AND ai.subject = v_auth_uid::text
    AND ai.status = 'active'
  FOR UPDATE OF ai;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT u.* INTO v_user
  FROM public.users AS u
  WHERE u.id = v_identity.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_user.status <> 'active' OR v_user.must_change_password THEN
    RETURN NULL;
  END IF;

  SELECT em.* INTO v_member
  FROM public.enterprise_members AS em
  WHERE em.user_id = v_user.id
    AND em.enterprise_id = v_context.enterprise_id
    AND em.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM public.enterprise_members AS z
    JOIN public.enterprises AS ze ON ze.id = z.enterprise_id
    WHERE z.user_id = v_user.id
      AND z.status = 'active'
      AND ze.status = 'active'
  ) <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT e.* INTO v_enterprise
  FROM public.enterprises AS e
  WHERE e.id = v_member.enterprise_id
    AND e.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_context FROM public.get_my_access_context();

  IF NOT FOUND
     OR v_context.state IS DISTINCT FROM 'business_ready'
     OR v_context.user_id IS DISTINCT FROM v_user.id
     OR v_context.membership_id IS DISTINCT FROM v_member.id
     OR v_context.enterprise_id IS DISTINCT FROM v_enterprise.id
     OR NOT private.can_access_enterprise(v_enterprise.id, p_permission) THEN
    RETURN NULL;
  END IF;

  RETURN v_enterprise.id;
END $$;

CREATE FUNCTION private.read_product_inventory_context()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_context RECORD;
BEGIN
  SELECT * INTO v_context FROM public.get_my_access_context();
  IF NOT FOUND
     OR v_context.state IS DISTINCT FROM 'business_ready'
     OR NOT private.can_access_enterprise(v_context.enterprise_id, 'inventory.read') THEN
    RETURN NULL;
  END IF;
  RETURN v_context.enterprise_id;
END $$;

CREATE FUNCTION public.move_product_inventory(
  p_attempt_id uuid,
  p_product_id uuid,
  p_expected_version bigint,
  p_movement_type text,
  p_quantity numeric DEFAULT NULL,
  p_counted_balance numeric DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(status text, movement_id uuid, product_id uuid, balance bigint, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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

  IF v_q < 0 AND (-v_q) > v_inventory.balance THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0003';
  END IF;

  IF v_q > 0 AND v_q > (1000000000 - v_inventory.balance) THEN
    RAISE EXCEPTION 'balance_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  v_nb := v_inventory.balance + v_q;
  IF v_nb < 0 OR v_nb > 1000000000 THEN
    RAISE EXCEPTION 'balance_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  IF v_inventory.version >= 9007199254740991 THEN
    RAISE EXCEPTION 'version_limit_exceeded' USING ERRCODE = '22003';
  END IF;

  IF v_inventory.id IS NULL THEN
    INSERT INTO public.product_inventory AS x(enterprise_id, product_id, balance, version)
    VALUES (v_enterprise_id, p_product_id, v_nb, 1)
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
END $$;

CREATE FUNCTION public.get_product_inventory_detail(p_product_id uuid)
RETURNS TABLE(
  product_id uuid, product_name text, product_active boolean,
  balance bigint, inventory_version bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_enterprise_id uuid;
  v_product public.products%ROWTYPE;
  v_inventory public.product_inventory%ROWTYPE;
BEGIN
  v_enterprise_id := private.read_product_inventory_context();
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT x.* INTO v_product
  FROM public.products AS x
  WHERE x.enterprise_id = v_enterprise_id AND x.id = p_product_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT NULL::uuid, NULL::text, NULL::boolean, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT x.* INTO v_inventory
  FROM public.product_inventory AS x
  WHERE x.enterprise_id = v_enterprise_id AND x.product_id = p_product_id;

  RETURN QUERY
  SELECT
    v_product.id,
    v_product.name::text,
    v_product.active,
    coalesce(v_inventory.balance, 0::bigint),
    coalesce(v_inventory.version, 0::bigint);
END $$;

CREATE FUNCTION public.list_product_inventory_movements(
  p_product_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  movement_id uuid,
  movement_at timestamptz,
  movement_type text,
  quantity bigint,
  balance_before bigint,
  balance_after bigint,
  reason text,
  actor_id uuid,
  result_version bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_enterprise_id uuid;
BEGIN
  v_enterprise_id := private.read_product_inventory_context();
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL OR p_limit IS NULL OR p_offset IS NULL
     OR p_limit NOT BETWEEN 1 AND 50 OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.enterprise_id = v_enterprise_id AND p.id = p_product_id
  ) THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.created_at,
    m.movement_type::text,
    m.quantity,
    m.balance_before,
    m.balance_after,
    m.reason::text,
    m.actor_id,
    m.result_version
  FROM public.product_inventory_movements AS m
  WHERE m.enterprise_id = v_enterprise_id AND m.product_id = p_product_id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

CREATE FUNCTION public.count_product_inventory_movements(p_product_id uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_enterprise_id uuid;
  v_count bigint;
BEGIN
  v_enterprise_id := private.read_product_inventory_context();
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.enterprise_id = v_enterprise_id AND p.id = p_product_id
  ) THEN
    RAISE EXCEPTION 'product_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.product_inventory_movements AS m
  WHERE m.enterprise_id = v_enterprise_id AND m.product_id = p_product_id;

  RETURN v_count;
END $$;

CREATE FUNCTION public.list_product_inventory(
  p_search text DEFAULT '',
  p_balance_filter text DEFAULT 'all',
  p_product_status text DEFAULT 'active',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  balance bigint,
  inventory_version bigint,
  product_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text;
BEGIN
  v_enterprise_id := private.read_product_inventory_context();
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_term := pg_catalog.btrim(coalesce(p_search, ''));

  IF p_balance_filter IS NULL OR p_product_status IS NULL
     OR p_limit IS NULL OR p_offset IS NULL
     OR p_limit NOT BETWEEN 1 AND 50 OR p_offset NOT BETWEEN 0 AND 100000
     OR pg_catalog.length(v_term) > 120
     OR p_balance_filter NOT IN ('all', 'with_balance', 'without_balance')
     OR p_product_status NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name::text,
    coalesce(i.balance, 0::bigint),
    coalesce(i.version, 0::bigint),
    p.active
  FROM public.products AS p
  LEFT JOIN public.product_inventory AS i
    ON i.enterprise_id = p.enterprise_id AND i.product_id = p.id
  WHERE p.enterprise_id = v_enterprise_id
    AND (
      p_product_status = 'all'
      OR (p_product_status = 'active' AND p.active)
      OR (p_product_status = 'archived' AND NOT p.active)
    )
    AND (
      v_term = ''
      OR pg_catalog.strpos(pg_catalog.lower(p.name), pg_catalog.lower(v_term)) > 0
    )
    AND (
      p_balance_filter = 'all'
      OR (p_balance_filter = 'with_balance' AND coalesce(i.balance, 0::bigint) > 0)
      OR (p_balance_filter = 'without_balance' AND coalesce(i.balance, 0::bigint) = 0)
    )
  ORDER BY p.name ASC, p.id ASC
  LIMIT p_limit OFFSET p_offset;
END $$;

CREATE FUNCTION public.count_product_inventory(
  p_search text DEFAULT '',
  p_balance_filter text DEFAULT 'all',
  p_product_status text DEFAULT 'active'
)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text;
  v_count bigint;
BEGIN
  v_enterprise_id := private.read_product_inventory_context();
  IF v_enterprise_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_term := pg_catalog.btrim(coalesce(p_search, ''));

  IF p_balance_filter IS NULL OR p_product_status IS NULL
     OR pg_catalog.length(v_term) > 120
     OR p_balance_filter NOT IN ('all', 'with_balance', 'without_balance')
     OR p_product_status NOT IN ('active', 'archived', 'all') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*) INTO v_count
  FROM public.products AS p
  LEFT JOIN public.product_inventory AS i
    ON i.enterprise_id = p.enterprise_id AND i.product_id = p.id
  WHERE p.enterprise_id = v_enterprise_id
    AND (
      p_product_status = 'all'
      OR (p_product_status = 'active' AND p.active)
      OR (p_product_status = 'archived' AND NOT p.active)
    )
    AND (
      v_term = ''
      OR pg_catalog.strpos(pg_catalog.lower(p.name), pg_catalog.lower(v_term)) > 0
    )
    AND (
      p_balance_filter = 'all'
      OR (p_balance_filter = 'with_balance' AND coalesce(i.balance, 0::bigint) > 0)
      OR (p_balance_filter = 'without_balance' AND coalesce(i.balance, 0::bigint) = 0)
    );

  RETURN v_count;
END $$;

ALTER FUNCTION private.read_product_inventory_context() OWNER TO postgres;
ALTER FUNCTION public.product_inventory_touch() OWNER TO postgres;
ALTER FUNCTION public.reject_product_inventory_movement_mutation() OWNER TO postgres;
ALTER FUNCTION private.can_access_enterprise(uuid, text) OWNER TO postgres;
ALTER FUNCTION private.lock_product_inventory_context(text) OWNER TO postgres;
ALTER FUNCTION public.move_product_inventory(uuid, uuid, bigint, text, numeric, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.get_product_inventory_detail(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_product_inventory_movements(uuid, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.count_product_inventory_movements(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_product_inventory(text, text, text, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.count_product_inventory(text, text, text) OWNER TO postgres;

REVOKE ALL ON public.product_inventory, public.product_inventory_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_access_enterprise(uuid, text), private.lock_product_inventory_context(text), private.read_product_inventory_context(), public.product_inventory_touch(), public.reject_product_inventory_movement_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_product_inventory(uuid, uuid, bigint, text, numeric, numeric, text), public.get_product_inventory_detail(uuid), public.list_product_inventory_movements(uuid, integer, integer), public.count_product_inventory_movements(uuid), public.list_product_inventory(text, text, text, integer, integer), public.count_product_inventory(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.can_access_enterprise(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_product_inventory(uuid, uuid, bigint, text, numeric, numeric, text), public.get_product_inventory_detail(uuid), public.list_product_inventory_movements(uuid, integer, integer), public.count_product_inventory_movements(uuid), public.list_product_inventory(text, text, text, integer, integer), public.count_product_inventory(text, text, text) TO authenticated;

COMMIT;

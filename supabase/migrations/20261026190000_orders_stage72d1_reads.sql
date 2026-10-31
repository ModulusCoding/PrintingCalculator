-- M7.2-D.1 — reader RPCs for orders listing, Kanban and details.
-- Additive only. Respects RLS default-deny by exposing security-definer RPCs
-- with central authentication, tenant isolation and sales.read permission check.
-- Local source implementation; NOT APPLIED automatically.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.order_payments') IS NULL
     OR to_regprocedure('public.get_order_financial_summary(uuid)') IS NULL
     OR to_regprocedure('public.get_my_access_context()') IS NULL
     OR to_regprocedure('private.current_internal_user_id()') IS NULL
     OR to_regprocedure('private.can_access_enterprise(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'orders_d1_dependency_missing';
  END IF;
END $preflight$;

--------------------------------------------------------------------------------
-- 1. list_orders: server-side pagination, search and filtering for list & Kanban
-- Contract unchanged: total_count is repeated on actual order rows only. An empty
-- page returns zero rows, never a synthetic order. Consumers needing its count
-- must retry this reader with the same filters, p_limit=1 and p_offset=0.
-- C.4 returns exactly one financial row or raises; do not replace failures/nulls
-- with zero-payment defaults. VOLATILE also matches C.4 and transaction locks.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_orders(
  p_search text DEFAULT NULL,
  p_operational_status text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  display_number bigint,
  operational_status text,
  buyer_name text,
  buyer_phone text,
  buyer_email text,
  currency text,
  subtotal numeric,
  discount_amount numeric,
  shipping_amount numeric,
  total_amount numeric,
  items_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  version bigint,
  total_received numeric,
  total_refunded numeric,
  net_received numeric,
  pending_amount numeric,
  financial_status text,
  cancelled_unreversed_amount numeric,
  total_count bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c record;
  eid uuid;
  actor uuid;
  limit_val integer;
  offset_val integer;
  search_query text;
  status_filter text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid := c.enterprise_id; actor := private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid, 'sales.read') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  limit_val := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  offset_val := GREATEST(COALESCE(p_offset, 0), 0);
  search_query := NULLIF(pg_catalog.btrim(p_search), '');
  status_filter := NULLIF(pg_catalog.btrim(p_operational_status), '');

  IF status_filter IS NOT NULL AND status_filter NOT IN ('em_conversao', 'orcado', 'pago', 'modelando', 'imprimindo', 'entregue', 'cancelado') THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.enterprise_id = eid
      AND (status_filter IS NULL OR o.operational_status = status_filter)
      AND (
        search_query IS NULL
        OR o.buyer_name ILIKE '%' || search_query || '%'
        OR o.display_number::text = search_query
        OR (o.buyer_email IS NOT NULL AND o.buyer_email ILIKE '%' || search_query || '%')
        OR (o.buyer_phone IS NOT NULL AND o.buyer_phone ILIKE '%' || search_query || '%')
      )
  ),
  counted AS (
    SELECT count(*)::bigint AS cnt FROM filtered
  ),
  paged AS (
    SELECT o.*,
           (SELECT count(*) FROM public.order_items oi WHERE oi.enterprise_id = eid AND oi.order_id = o.id) AS items_count
    FROM filtered f
    JOIN public.orders o ON o.enterprise_id = eid AND o.id = f.id
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT limit_val OFFSET offset_val
  )
  SELECT
    p.id,
    p.display_number,
    p.operational_status,
    p.buyer_name,
    p.buyer_phone,
    p.buyer_email,
    p.currency,
    p.subtotal,
    p.discount_amount,
    p.shipping_amount,
    p.total_amount,
    p.items_count,
    p.created_at,
    p.updated_at,
    p.archived_at,
    p.version,
    fin.total_received,
    fin.total_refunded,
    fin.net_received,
    fin.pending_amount,
    fin.financial_status,
    fin.cancelled_unreversed_amount,
    cnt.cnt AS total_count
  FROM paged p
  CROSS JOIN counted cnt
  CROSS JOIN LATERAL public.get_order_financial_summary(p.id) fin
  ORDER BY p.created_at DESC, p.id DESC;
END;
$$;

--------------------------------------------------------------------------------
-- 2. get_order_details: complete header and financial summary for a single order
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_details(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  enterprise_id uuid,
  display_number bigint,
  operational_status text,
  buyer_name text,
  buyer_phone text,
  buyer_email text,
  buyer_address text,
  currency text,
  subtotal numeric,
  discount_type text,
  discount_input numeric,
  discount_base numeric,
  discount_amount numeric,
  shipping_amount numeric,
  total_amount numeric,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  version bigint,
  total_received numeric,
  total_refunded numeric,
  net_received numeric,
  pending_amount numeric,
  financial_status text,
  cancelled_unreversed_amount numeric
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c record;
  eid uuid;
  actor uuid;
  ord public.orders%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid := c.enterprise_id; actor := private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid, 'sales.read') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  SELECT * INTO ord FROM public.orders o WHERE o.enterprise_id = eid AND o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  SELECT
    ord.id,
    ord.enterprise_id,
    ord.display_number,
    ord.operational_status,
    ord.buyer_name,
    ord.buyer_phone,
    ord.buyer_email,
    ord.buyer_address,
    ord.currency,
    ord.subtotal,
    ord.discount_type,
    ord.discount_input,
    ord.discount_base,
    ord.discount_amount,
    ord.shipping_amount,
    ord.total_amount,
    ord.notes,
    ord.created_by,
    ord.created_at,
    ord.updated_at,
    ord.delivered_at,
    ord.cancelled_at,
    ord.archived_at,
    ord.version,
    fin.total_received,
    fin.total_refunded,
    fin.net_received,
    fin.pending_amount,
    fin.financial_status,
    fin.cancelled_unreversed_amount
  FROM public.get_order_financial_summary(ord.id) fin;
END;
$$;

--------------------------------------------------------------------------------
-- 3. get_order_items: line items for a single order
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_order_items(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  product_id uuid,
  origin text,
  name text,
  description text,
  quantity bigint,
  unit_price numeric,
  line_subtotal numeric,
  fulfillment_mode text,
  line_number smallint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c record;
  eid uuid;
  actor uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO c FROM public.get_my_access_context();
  IF NOT FOUND OR c.state IS DISTINCT FROM 'business_ready' OR c.enterprise_id IS NULL
     OR c.user_id IS NULL OR c.role IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;
  eid := c.enterprise_id; actor := private.current_internal_user_id();
  IF actor IS NULL OR actor IS DISTINCT FROM c.user_id
     OR NOT private.can_access_enterprise(eid, 'sales.read') THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.enterprise_id = eid AND o.id = p_order_id) THEN
    RAISE EXCEPTION 'order_unavailable' USING ERRCODE='P0002';
  END IF;

  RETURN QUERY
  SELECT
    oi.id,
    oi.order_id,
    oi.product_id,
    oi.origin,
    oi.product_name_snapshot AS name,
    oi.product_description_snapshot AS description,
    oi.quantity,
    oi.unit_price,
    oi.line_subtotal,
    oi.fulfillment_mode,
    oi.line_number
  FROM public.order_items oi
  WHERE oi.enterprise_id = eid AND oi.order_id = p_order_id
  ORDER BY oi.line_number ASC;
END;
$$;

--------------------------------------------------------------------------------
-- Security hardening & ACLs
--------------------------------------------------------------------------------
ALTER FUNCTION public.list_orders(text,text,integer,integer) OWNER TO postgres;
ALTER FUNCTION public.list_orders(text,text,integer,integer) SET search_path='';
ALTER FUNCTION public.get_order_details(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_order_details(uuid) SET search_path='';
ALTER FUNCTION public.get_order_items(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_order_items(uuid) SET search_path='';

REVOKE ALL ON FUNCTION public.list_orders(text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_details(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_order_items(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_orders(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_items(uuid) TO authenticated;

DO $security$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.list_orders(text,text,integer,integer)',
    'public.get_order_details(uuid)',
    'public.get_order_items(uuid)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'orders_d1_acl_mismatch: %', signature;
    END IF;
  END LOOP;
END $security$;

COMMIT;

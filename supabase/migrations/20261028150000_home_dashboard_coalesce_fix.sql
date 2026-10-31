-- Modulus Hub — Home dashboard COALESCE corrective migration
-- NOT APPLIED: revisar antes de aplicar manualmente no Supabase de desenvolvimento.
-- Replaces installed RPCs de 20261028140000_home_dashboard_reads.sql, preservada sem edicao.
-- Corrige somente 7 usos de pg_catalog.coalesce para a expressao SQL COALESCE.
-- Sem alterar regras de negocio, locks, autorizacao de planos ou planos de consulta.
-- O indice order_payments_enterprise_effective_idx nao e alterado por esta correcao.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_home_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  eid uuid;
  anchor timestamptz := pg_catalog.statement_timestamp();
  first_month timestamp;
  result jsonb;
  pending numeric;
BEGIN
  -- Acesso e tenant sao resolvidos pelo contrato central de Pedidos C4.
  eid := private.orders_c4_reader();
  IF eid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  first_month := pg_catalog.date_trunc(
    'month', anchor AT TIME ZONE 'America/Sao_Paulo'
  );

  -- O helper C4 deve produzir exatamente uma linha para cada pedido valido,
  -- ou lancar excecao para ledger inconsistente. Verificar esse contrato.
  -- Pedidos cancelados nao entram no saldo, mas passam pela avaliacao do helper.
  SELECT COALESCE(
    pg_catalog.sum(f.pending_amount)
      FILTER (WHERE o.operational_status <> 'cancelado'),
    0
  )
  INTO pending
  FROM public.orders AS o
  CROSS JOIN LATERAL private.orders_c4_financial(eid, o.id) AS f
  WHERE o.enterprise_id = eid;

  WITH periods AS (
    SELECT first_month + n * INTERVAL '1 month' AS month
    FROM pg_catalog.generate_series(-5, 0) AS n
  ),
  sales AS (
    SELECT
      pg_catalog.date_trunc(
        'month', o.created_at AT TIME ZONE 'America/Sao_Paulo'
      ) AS month,
      pg_catalog.sum(o.total_amount) AS amount,
      pg_catalog.count(*) AS quantity
    FROM public.orders AS o
    WHERE o.enterprise_id = eid
      AND o.operational_status <> 'cancelado'
      AND o.created_at >= (
        (first_month - INTERVAL '5 months') AT TIME ZONE 'America/Sao_Paulo'
      )
      AND o.created_at < (
        (first_month + INTERVAL '1 month') AT TIME ZONE 'America/Sao_Paulo'
      )
    GROUP BY 1
  ),
  receipts AS (
    SELECT
      pg_catalog.date_trunc(
        'month', p.effective_at AT TIME ZONE 'America/Sao_Paulo'
      ) AS month,
      pg_catalog.sum(
        CASE
          WHEN p.entry_type = 'receipt' THEN p.amount
          ELSE -p.amount
        END
      ) AS amount
    FROM public.order_payments AS p
    WHERE p.enterprise_id = eid
      AND p.effective_at >= (
        (first_month - INTERVAL '5 months') AT TIME ZONE 'America/Sao_Paulo'
      )
      AND p.effective_at < (
        (first_month + INTERVAL '1 month') AT TIME ZONE 'America/Sao_Paulo'
      )
      AND p.effective_at <= anchor
    GROUP BY 1
  ),
  buckets AS (
    SELECT
      t.month,
      COALESCE(s.amount, 0) AS sales,
      COALESCE(r.amount, 0) AS receipts,
      COALESCE(s.quantity, 0) AS quantity
    FROM periods AS t
    LEFT JOIN sales AS s USING (month)
    LEFT JOIN receipts AS r USING (month)
  )
  SELECT pg_catalog.jsonb_build_object(
    'enterprise_id', eid,
    'as_of', anchor,
    'current_month', pg_catalog.to_char(first_month, 'YYYY-MM'),
    'sales_cents', (
      SELECT (b.sales * 100)::numeric(100, 0)::text
      FROM buckets AS b WHERE b.month = first_month
    ),
    'receipts_cents', (
      SELECT (b.receipts * 100)::numeric(100, 0)::text
      FROM buckets AS b WHERE b.month = first_month
    ),
    'pending_cents', (pending * 100)::numeric(100, 0)::text,
    'month_orders_count', (
      SELECT b.quantity FROM buckets AS b WHERE b.month = first_month
    ),
    'active_orders_count', (
      SELECT pg_catalog.count(*)
      FROM public.orders AS o
      WHERE o.enterprise_id = eid
        AND o.operational_status NOT IN ('entregue', 'cancelado')
    ),
    'months', (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'month', pg_catalog.to_char(b.month, 'YYYY-MM'),
          'sales_cents', (b.sales * 100)::numeric(100, 0)::text,
          'receipts_cents', (b.receipts * 100)::numeric(100, 0)::text,
          'orders_count', b.quantity
        ) ORDER BY b.month
      )
      FROM buckets AS b
    ),
    'recent_orders', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', r.id,
          'display_number', r.display_number::text,
          'buyer_name', r.buyer_name,
          'operational_status', r.operational_status,
          'total_cents', (r.total_amount * 100)::numeric(100, 0)::text,
          'created_at', r.created_at
        ) ORDER BY r.created_at DESC, r.id DESC
      )
      FROM (
        SELECT o.*
        FROM public.orders AS o
        WHERE o.enterprise_id = eid
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 5
      ) AS r
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_home_inventory()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c record;
  eid uuid;
BEGIN
  -- Preservar o lock e a ordem de autorizacao existentes no projeto.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0)
  );

  SELECT * INTO c FROM public.get_my_access_context();

  IF NOT FOUND
    OR c.state IS DISTINCT FROM 'business_ready'
    OR c.enterprise_id IS NULL
    OR c.user_id IS NULL
    OR c.role IS NULL
    OR private.current_internal_user_id() IS DISTINCT FROM c.user_id
    OR private.can_access_enterprise(c.enterprise_id, 'inventory.read') IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  eid := c.enterprise_id;

  -- Produtos arquivados que ainda possuem saldo fisico continuam na contagem.
  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'enterprise_id', eid,
      'available_units', COALESCE(
        pg_catalog.sum(i.balance::numeric - i.reserved_balance::numeric), 0
      )::text,
      'reserved_units', COALESCE(
        pg_catalog.sum(i.reserved_balance::numeric), 0
      )::text,
      'stocked_products', pg_catalog.count(*) FILTER (WHERE i.balance > 0)
    )
    FROM public.product_inventory AS i
    WHERE i.enterprise_id = eid
  );
END;
$$;

ALTER FUNCTION public.get_home_dashboard() OWNER TO postgres;
ALTER FUNCTION public.get_home_inventory() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_home_dashboard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_home_inventory() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_home_inventory() TO authenticated;

COMMIT;

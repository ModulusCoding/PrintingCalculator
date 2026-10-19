-- UNAPPLIED: bounded, tenant-scoped read helpers for the FDM inventory UI.
-- Search length is measured AFTER btrim(coalesce(p_search, '')). Search is literal:
-- '%' and '_' are ordinary characters, not LIKE wildcards.
-- List and count are separate RPC calls: they do NOT automatically share one snapshot.
BEGIN;

CREATE FUNCTION public.search_materials_for_spools(
  p_search text DEFAULT '', p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, name text, material_type text, brand text, color text,
  reference_weight_grams numeric, reference_price numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text := pg_catalog.btrim(coalesce(p_search, ''));
BEGIN
  v_enterprise_id := private.read_filament_spool_context('spools.read');
  IF v_enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR p_offset NOT BETWEEN 0 AND 100000 OR pg_catalog.length(v_term) > 120 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT m.id, m.name::text, m.material_type::text, m.brand::text, m.color::text,
         m.reference_weight_grams, m.reference_price
  FROM public.materials AS m
  WHERE m.enterprise_id = v_enterprise_id AND m.active
    AND (v_term = ''
      OR pg_catalog.strpos(pg_catalog.lower(m.name), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(m.material_type), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.brand, '')), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.color, '')), pg_catalog.lower(v_term)) > 0)
  ORDER BY m.name ASC, m.id ASC
  LIMIT p_limit OFFSET p_offset;
END $$;

CREATE FUNCTION public.count_materials_for_spools(p_search text DEFAULT '')
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text := pg_catalog.btrim(coalesce(p_search, ''));
BEGIN
  v_enterprise_id := private.read_filament_spool_context('spools.read');
  IF v_enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF pg_catalog.length(v_term) > 120 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;

  RETURN (
    SELECT pg_catalog.count(*) FROM public.materials AS m
    WHERE m.enterprise_id = v_enterprise_id AND m.active
      AND (v_term = ''
        OR pg_catalog.strpos(pg_catalog.lower(m.name), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(m.material_type), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.brand, '')), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.color, '')), pg_catalog.lower(v_term)) > 0)
  );
END $$;

CREATE FUNCTION public.list_filament_spools(
  p_search text DEFAULT '', p_status text DEFAULT 'active',
  p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, material_id uuid, material_name text, material_type text,
  material_brand text, material_color text, internal_identifier text,
  original_filament_grams numeric, current_balance_grams numeric,
  purchase_price numeric, active boolean, version bigint,
  created_at timestamptz, updated_at timestamptz, percent_remaining numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text := pg_catalog.btrim(coalesce(p_search, ''));
  v_threshold numeric;
BEGIN
  v_enterprise_id := private.read_filament_spool_context('spools.read');
  IF v_enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'archived', 'all', 'low', 'empty')
     OR p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR p_offset NOT BETWEEN 0 AND 100000 OR pg_catalog.length(v_term) > 120 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Narrow access inside this SECURITY DEFINER function; no direct enterprise SELECT grant to clients.
  SELECT en.low_spool_threshold_percent INTO v_threshold
  FROM public.enterprises AS en WHERE en.id = v_enterprise_id;

  RETURN QUERY
  SELECT s.id, s.material_id, m.name::text, m.material_type::text,
         m.brand::text, m.color::text, s.internal_identifier::text,
         s.original_filament_grams, s.current_balance_grams, s.purchase_price,
         s.active, s.version, s.created_at, s.updated_at,
         s.current_balance_grams * 100 / s.original_filament_grams
  FROM public.filament_spools AS s
  JOIN public.materials AS m ON m.enterprise_id = s.enterprise_id AND m.id = s.material_id
  WHERE s.enterprise_id = v_enterprise_id
    AND (v_term = ''
      OR pg_catalog.strpos(pg_catalog.lower(s.internal_identifier), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(m.name), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(m.material_type), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.brand, '')), pg_catalog.lower(v_term)) > 0
      OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.color, '')), pg_catalog.lower(v_term)) > 0)
    AND (p_status = 'all'
      OR (p_status = 'active' AND s.active AND s.current_balance_grams > 0)
      OR (p_status = 'low' AND s.active AND s.current_balance_grams > 0
          AND s.current_balance_grams * 100 / s.original_filament_grams <= v_threshold)
      OR (p_status = 'empty' AND s.active AND s.current_balance_grams = 0)
      OR (p_status = 'archived' AND NOT s.active))
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT p_limit OFFSET p_offset;
END $$;

CREATE FUNCTION public.count_filament_spools(p_search text DEFAULT '', p_status text DEFAULT 'active')
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enterprise_id uuid;
  v_term text := pg_catalog.btrim(coalesce(p_search, ''));
  v_threshold numeric;
BEGIN
  v_enterprise_id := private.read_filament_spool_context('spools.read');
  IF v_enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'archived', 'all', 'low', 'empty')
     OR pg_catalog.length(v_term) > 120 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT en.low_spool_threshold_percent INTO v_threshold
  FROM public.enterprises AS en WHERE en.id = v_enterprise_id;

  RETURN (
    SELECT pg_catalog.count(*)
    FROM public.filament_spools AS s
    JOIN public.materials AS m ON m.enterprise_id = s.enterprise_id AND m.id = s.material_id
    WHERE s.enterprise_id = v_enterprise_id
      AND (v_term = ''
        OR pg_catalog.strpos(pg_catalog.lower(s.internal_identifier), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(m.name), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(m.material_type), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.brand, '')), pg_catalog.lower(v_term)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(coalesce(m.color, '')), pg_catalog.lower(v_term)) > 0)
      AND (p_status = 'all'
        OR (p_status = 'active' AND s.active AND s.current_balance_grams > 0)
        OR (p_status = 'low' AND s.active AND s.current_balance_grams > 0
            AND s.current_balance_grams * 100 / s.original_filament_grams <= v_threshold)
        OR (p_status = 'empty' AND s.active AND s.current_balance_grams = 0)
        OR (p_status = 'archived' AND NOT s.active))
  );
END $$;

-- One row for an existing spool, even without consumption; do not expose another tenant's existence.
-- Movement costs are already historical, rounded at insertion; never recompute them from material prices.
CREATE FUNCTION public.get_filament_spool_consumption_summary(p_spool_id uuid)
RETURNS TABLE (total_consumed_grams numeric, total_consumption_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enterprise_id uuid;
BEGIN
  v_enterprise_id := private.read_filament_spool_context('spools.read');
  IF v_enterprise_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_spool_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;

  PERFORM 1 FROM public.filament_spools AS s
  WHERE s.enterprise_id = v_enterprise_id AND s.id = p_spool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'spool_unavailable' USING ERRCODE = 'P0002'; END IF;

  RETURN QUERY
  SELECT coalesce(pg_catalog.sum(-mv.quantity_grams), 0::numeric),
         coalesce(pg_catalog.sum(mv.movement_cost), 0::numeric)
  FROM public.filament_spool_movements AS mv
  WHERE mv.enterprise_id = v_enterprise_id AND mv.spool_id = p_spool_id
    AND mv.movement_type = 'consumption';
END $$;

ALTER FUNCTION public.search_materials_for_spools(text, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.count_materials_for_spools(text) OWNER TO postgres;
ALTER FUNCTION public.list_filament_spools(text, text, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.count_filament_spools(text, text) OWNER TO postgres;
ALTER FUNCTION public.get_filament_spool_consumption_summary(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.search_materials_for_spools(text, integer, integer),
  public.count_materials_for_spools(text), public.list_filament_spools(text, text, integer, integer),
  public.count_filament_spools(text, text), public.get_filament_spool_consumption_summary(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_materials_for_spools(text, integer, integer),
  public.count_materials_for_spools(text), public.list_filament_spools(text, text, integer, integer),
  public.count_filament_spools(text, text), public.get_filament_spool_consumption_summary(uuid)
TO authenticated;
COMMIT;

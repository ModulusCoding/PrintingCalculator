-- Empresa/equipe: RPCs estreitas para a área autenticada.
-- NÃO aplicar automaticamente. Revisar e aplicar somente após aprovação.
BEGIN;

ALTER TABLE public.enterprises ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.enterprises ADD CONSTRAINT enterprises_version_check CHECK (version >= 0);

CREATE OR REPLACE FUNCTION public.increment_enterprise_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END; $$;

CREATE TRIGGER enterprises_increment_version
BEFORE UPDATE ON public.enterprises
FOR EACH ROW EXECUTE FUNCTION public.increment_enterprise_version();

CREATE OR REPLACE FUNCTION public.get_my_enterprise()
RETURNS TABLE (name TEXT, created_at TIMESTAMPTZ, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE 
    v_ctx RECORD;
BEGIN
    SELECT * INTO v_ctx FROM public.get_my_access_context();
    IF v_ctx.state <> 'business_ready' THEN 
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;
    
    RETURN QUERY 
    SELECT e.name, e.created_at, e.version 
      FROM public.enterprises AS e 
     WHERE e.id = v_ctx.enterprise_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_my_enterprise_name(p_name TEXT, p_expected_version BIGINT)
RETURNS TABLE (status TEXT, name TEXT, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE 
    v_ctx RECORD;
    v_name TEXT;
BEGIN
    v_name := pg_catalog.btrim(p_name);
    IF v_name IS NULL OR v_name = '' OR pg_catalog.length(v_name) > 200 THEN 
        RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::TEXT, NULL::BIGINT; 
        RETURN; 
    END IF;

    SELECT * INTO v_ctx FROM public.get_my_access_context();
    IF v_ctx.state <> 'business_ready' OR NOT private.can_access_enterprise(v_ctx.enterprise_id, 'enterprise.manage') THEN
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    UPDATE public.enterprises 
       SET name = v_name
     WHERE id = v_ctx.enterprise_id 
       AND version = p_expected_version;

    IF NOT FOUND THEN 
        RETURN QUERY 
        SELECT 'version_conflict'::TEXT, e.name, e.version 
          FROM public.enterprises AS e 
         WHERE e.id = v_ctx.enterprise_id; 
        RETURN; 
    END IF;

    RETURN QUERY 
    SELECT 'updated'::TEXT, e.name, e.version 
      FROM public.enterprises AS e 
     WHERE e.id = v_ctx.enterprise_id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_my_enterprise_members(
    p_search TEXT DEFAULT '', 
    p_status TEXT DEFAULT 'active', 
    p_page INTEGER DEFAULT 1, 
    p_page_size INTEGER DEFAULT 20
)
RETURNS TABLE (
    full_name TEXT, 
    email TEXT, 
    role TEXT, 
    membership_status TEXT, 
    membership_created_at TIMESTAMPTZ, 
    must_change_password BOOLEAN, 
    total_count BIGINT,
    unfiltered_visible_total BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE 
    v_ctx RECORD;
    v_search TEXT;
    v_offset INTEGER;
    v_can_manage_admins BOOLEAN;
    v_can_manage_operators BOOLEAN;
BEGIN
    IF p_page < 1 OR p_page_size < 1 OR p_page_size > 100 OR p_status NOT IN ('active','inactive','all') THEN 
        RAISE SQLSTATE '42000' USING MESSAGE = 'invalid_arguments';
    END IF;
    
    v_search := pg_catalog.btrim(COALESCE(p_search, ''));
    IF pg_catalog.length(v_search) > 200 THEN 
        RAISE SQLSTATE '42000' USING MESSAGE = 'search_too_long';
    END IF;

    SELECT * INTO v_ctx FROM public.get_my_access_context();
    IF v_ctx.state <> 'business_ready' THEN
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    v_can_manage_admins := private.can_access_enterprise(v_ctx.enterprise_id, 'members.manage_admins');
    v_can_manage_operators := private.can_access_enterprise(v_ctx.enterprise_id, 'members.manage_operators');

    IF NOT (v_can_manage_admins OR v_can_manage_operators) THEN
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    v_offset := (p_page - 1) * p_page_size;

    RETURN QUERY
    WITH base_visibility AS (
        SELECT u.full_name, u.email, em.role, em.status AS membership_status, em.created_at AS membership_created_at, u.must_change_password, em.id AS member_id
        FROM public.enterprise_members AS em 
        JOIN public.users AS u ON u.id = em.user_id
        WHERE em.enterprise_id = v_ctx.enterprise_id
          AND (
              (v_can_manage_admins) -- Owner can see everyone
              OR 
              (v_can_manage_operators AND em.role = 'operator') -- Admin can see operators
          )
    ),
    filtered AS (
        SELECT b.*
        FROM base_visibility AS b
        WHERE (p_status = 'all' OR b.membership_status = p_status)
          AND (v_search = '' OR pg_catalog.strpos(pg_catalog.lower(b.full_name), pg_catalog.lower(v_search)) > 0 OR pg_catalog.strpos(pg_catalog.lower(b.email), pg_catalog.lower(v_search)) > 0)
    )
    SELECT 
        f.full_name, 
        f.email, 
        f.role, 
        f.membership_status, 
        f.membership_created_at, 
        f.must_change_password,
        (SELECT COUNT(*) FROM filtered) AS total_count,
        (SELECT COUNT(*) FROM base_visibility) AS unfiltered_visible_total
    FROM filtered AS f
    ORDER BY f.membership_created_at DESC, f.member_id ASC
    LIMIT p_page_size OFFSET v_offset;
END; $$;

ALTER FUNCTION public.increment_enterprise_version() OWNER TO postgres;
ALTER FUNCTION public.get_my_enterprise() OWNER TO postgres;
ALTER FUNCTION public.update_my_enterprise_name(TEXT,BIGINT) OWNER TO postgres;
ALTER FUNCTION public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_enterprise() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_enterprise_name(TEXT,BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_enterprise() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_enterprise_name(TEXT,BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER) TO authenticated;

COMMIT;

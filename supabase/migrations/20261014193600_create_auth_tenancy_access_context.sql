-- Modulus SaaS/CRM: resolução de identidade interna e contexto mínimo.
-- Dependência prevista: 20261014193500_create_auth_tenancy_core.sql.
-- O checkout atual contém 20261002000000_create_auth_tenancy_core.sql; confirmar
-- o nome registrado no banco de dev antes da execução desta migration.
-- Esta migration não altera tabelas operacionais, Storage, policies de negócio,
-- provisionamento, troca de senha ou comandos de gestão de membros.
--
-- Configuração pós-revisão, por ambiente: inserir em private.auth_issuer_config
-- somente issuers Supabase verificados para aquele ambiente. A tabela começa vazia;
-- sem issuer configurado, a resolução nega acesso por padrão.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.auth_issuer_config (
    issuer TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'supabase',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT auth_issuer_config_issuer_not_blank CHECK (btrim(issuer) <> ''),
    CONSTRAINT auth_issuer_config_provider_not_blank CHECK (btrim(provider) <> ''),
    CONSTRAINT auth_issuer_config_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT auth_issuer_config_provider_check CHECK (provider = 'supabase')
);

CREATE TRIGGER auth_issuer_config_set_updated_at
BEFORE UPDATE ON private.auth_issuer_config
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();

ALTER TABLE private.auth_issuer_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE private.auth_issuer_config
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.current_internal_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ai.user_id
    FROM public.auth_identities AS ai
    JOIN private.auth_issuer_config AS ic
      ON ic.issuer = auth.jwt() ->> 'iss'
     AND ic.provider = 'supabase'
     AND ic.status = 'active'
    WHERE auth.uid() IS NOT NULL
      AND ai.provider = 'supabase'
      AND ai.issuer = ic.issuer
      AND ai.subject = auth.uid()::text
      AND ai.status = 'active'
    LIMIT 1;
$$;

CREATE FUNCTION private.can_access_enterprise(
    p_enterprise_id UUID,
    p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
      WHEN p_enterprise_id IS NULL
        OR p_permission IS NULL
        OR p_permission NOT IN (
          'products.read', 'products.write', 'products.delete',
          'catalogs.read', 'catalogs.write', 'catalogs.delete',
          'filters.read', 'filters.write', 'filters.delete',
          'sales.read', 'sales.write', 'sales.delete',
          'enterprise.manage',
          'members.manage_admins',
          'members.manage_operators'
        ) THEN false
      ELSE (
        SELECT COUNT(*) = 1
        FROM public.enterprise_members AS eligible_em
        JOIN public.enterprises AS eligible_e
          ON eligible_e.id = eligible_em.enterprise_id
        WHERE eligible_em.user_id = private.current_internal_user_id()
          AND eligible_em.status = 'active'
          AND eligible_e.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM public.enterprise_members AS em
        JOIN public.users AS u ON u.id = em.user_id
        JOIN public.enterprises AS e ON e.id = em.enterprise_id
        WHERE em.enterprise_id = p_enterprise_id
          AND em.user_id = private.current_internal_user_id()
          AND em.status = 'active'
          AND u.status = 'active'
          AND e.status = 'active'
          AND u.must_change_password = false
          AND CASE p_permission
            WHEN 'products.read' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'products.write' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'catalogs.read' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'catalogs.write' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'filters.read' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'filters.write' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'sales.read' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'sales.write' THEN em.role IN ('owner', 'admin', 'operator')
            WHEN 'products.delete' THEN em.role IN ('owner', 'admin')
            WHEN 'catalogs.delete' THEN em.role IN ('owner', 'admin')
            WHEN 'filters.delete' THEN em.role IN ('owner', 'admin')
            WHEN 'sales.delete' THEN em.role IN ('owner', 'admin')
            WHEN 'enterprise.manage' THEN em.role = 'owner'
            WHEN 'members.manage_admins' THEN em.role = 'owner'
            WHEN 'members.manage_operators' THEN em.role IN ('owner', 'admin')
            ELSE false
          END
      )
    END;
$$;

-- Contexto próprio e mínimo. Não recebe identidade, empresa ou papel do cliente.
CREATE FUNCTION public.get_my_access_context()
RETURNS TABLE (
    state TEXT,
    user_id UUID,
    user_status TEXT,
    must_change_password BOOLEAN,
    enterprise_id UUID,
    membership_id UUID,
    role TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_user_status TEXT;
    v_must_change_password BOOLEAN;
    v_active_enterprise_count INTEGER;
    v_any_membership_count INTEGER;
    v_active_member_in_inactive_enterprise_count INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN QUERY SELECT
            'unauthenticated'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            NULL::BOOLEAN,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    v_user_id := private.current_internal_user_id();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT
            'no_active_internal_identity'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            NULL::BOOLEAN,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    SELECT u.status, u.must_change_password
      INTO v_user_status, v_must_change_password
      FROM public.users AS u
     WHERE u.id = v_user_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT
            'no_active_internal_identity'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            NULL::BOOLEAN,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    IF v_user_status <> 'active' THEN
        RETURN QUERY SELECT
            'user_inactive'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    IF v_must_change_password THEN
        RETURN QUERY SELECT
            'password_change_required'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    SELECT COUNT(*)
      INTO v_any_membership_count
      FROM public.enterprise_members AS em
     WHERE em.user_id = v_user_id;

    SELECT COUNT(*)
      INTO v_active_member_in_inactive_enterprise_count
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e ON e.id = em.enterprise_id
     WHERE em.user_id = v_user_id
       AND em.status = 'active'
       AND e.status <> 'active';

    SELECT COUNT(*)
      INTO v_active_enterprise_count
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e ON e.id = em.enterprise_id
     WHERE em.user_id = v_user_id
       AND em.status = 'active'
       AND e.status = 'active';

    IF v_active_enterprise_count > 1 THEN
        RETURN QUERY SELECT
            'ambiguous_active_enterprise'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    IF v_active_enterprise_count = 1 THEN
        RETURN QUERY
        SELECT
            'business_ready'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            em.enterprise_id,
            em.id,
            em.role
        FROM public.enterprise_members AS em
        JOIN public.enterprises AS e ON e.id = em.enterprise_id
        WHERE em.user_id = v_user_id
          AND em.status = 'active'
          AND e.status = 'active';
        RETURN;
    END IF;

    IF v_active_member_in_inactive_enterprise_count > 0 THEN
        RETURN QUERY SELECT
            'enterprise_inactive'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    IF v_any_membership_count > 0 THEN
        RETURN QUERY SELECT
            'membership_inactive'::TEXT,
            v_user_id,
            v_user_status,
            v_must_change_password,
            NULL::UUID,
            NULL::UUID,
            NULL::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        'no_enterprise_membership'::TEXT,
        v_user_id,
        v_user_status,
        v_must_change_password,
        NULL::UUID,
        NULL::UUID,
        NULL::TEXT;
END;
$$;

-- Explicit owner: postgres owns the existing core tables in a typical Supabase
-- migration. It can read the closed RLS tables as their owner unless FORCE RLS
-- is later enabled. If ownership differs in the target project, review before
-- execution rather than silently replacing this design.
ALTER FUNCTION private.current_internal_user_id() OWNER TO postgres;
ALTER FUNCTION private.can_access_enterprise(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.get_my_access_context() OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION private.current_internal_user_id()
FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION private.can_access_enterprise(UUID, TEXT)
FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_my_access_context()
FROM PUBLIC, anon;

-- These private helpers are callable by authenticated only for future RLS
-- policies. They derive the actor exclusively from verified request claims.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_internal_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_enterprise(UUID, TEXT) TO authenticated;

-- This is the sole new client-visible operation and returns only the caller's
-- minimal state. It has no side effects and does not grant table privileges.
GRANT EXECUTE ON FUNCTION public.get_my_access_context() TO authenticated;

COMMIT;

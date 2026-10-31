-- Enterprise electricity rate migration - Corrected version
BEGIN;

-- 1. Column and basic constraints
-- electricity_rate_per_kwh: nullable, 0 to 100 R$/kWh, up to 6 decimal places.
-- We use NUMERIC(12,6) for the column but will validate scale in functions as requested.
ALTER TABLE public.enterprises ADD COLUMN electricity_rate_per_kwh NUMERIC(12,6);
ALTER TABLE public.enterprises ADD CONSTRAINT enterprises_rate_range_check 
    CHECK (electricity_rate_per_kwh >= 0 AND electricity_rate_per_kwh <= 100);

-- 2. get_my_enterprise_config
-- Returns only rate and version. Accessible to all business_ready roles.
CREATE OR REPLACE FUNCTION public.get_my_enterprise_config()
RETURNS TABLE (electricity_rate_per_kwh NUMERIC(12,6), version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE 
    v_ctx RECORD;
BEGIN
    SELECT context.state, context.enterprise_id INTO v_ctx FROM public.get_my_access_context() AS context;
    IF v_ctx.state <> 'business_ready' THEN 
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;
    
    RETURN QUERY 
    SELECT e.electricity_rate_per_kwh, e.version 
      FROM public.enterprises AS e 
     WHERE e.id = v_ctx.enterprise_id;
END; $$;

ALTER FUNCTION public.get_my_enterprise_config() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_my_enterprise_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_enterprise_config() TO authenticated;

-- 3. update_my_enterprise_config
-- Exclusive to enterprise.manage.
-- Implements strict validation and versioning protocol.
CREATE OR REPLACE FUNCTION public.update_my_enterprise_config(p_rate NUMERIC, p_expected_version BIGINT)
RETURNS TABLE (status TEXT, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE 
    v_ctx RECORD;
    v_issuer TEXT;
    v_identity public.auth_identities%ROWTYPE;
    v_actor public.users%ROWTYPE;
    v_member public.enterprise_members%ROWTYPE;
    v_enterprise public.enterprises%ROWTYPE;
BEGIN
    -- VALIDAÇÃO INICIAL
    IF p_expected_version IS NULL OR p_expected_version < 0 THEN
        RAISE SQLSTATE '22023' USING MESSAGE = 'invalid_input';
    END IF;

    IF p_rate IS NOT NULL THEN
        IF p_rate < 0 OR p_rate > 100 OR pg_catalog.scale(p_rate) > 6 
           OR p_rate = 'NaN'::NUMERIC OR p_rate = 'Infinity'::NUMERIC OR p_rate = '-Infinity'::NUMERIC THEN
            RAISE SQLSTATE '22023' USING MESSAGE = 'invalid_input';
        END IF;
    END IF;

    -- LOCKS E AUTORIZAÇÃO (Protocolo existente)
    -- Advisory lock global de gestão
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
    
    SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
    IF v_ctx.state <> 'business_ready' THEN 
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    v_issuer := auth.jwt()->>'iss';
    -- Advisory lock do ator
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::TEXT, 0));

    -- Revalidar identidade/issuer
    SELECT identity.* INTO v_identity FROM public.auth_identities AS identity
      JOIN private.auth_issuer_config AS issuer ON issuer.issuer=identity.issuer AND issuer.provider='supabase' AND issuer.status='active'
      WHERE identity.provider='supabase' AND identity.issuer=v_issuer AND identity.subject=auth.uid()::TEXT AND identity.status='active' FOR UPDATE OF identity;
    IF NOT FOUND THEN RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized'; END IF;

    -- Revalidar usuário e obrigação de senha
    SELECT person.* INTO v_actor FROM public.users AS person WHERE person.id=v_identity.user_id FOR UPDATE;
    IF NOT FOUND OR v_actor.status<>'active' OR v_actor.must_change_password THEN 
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized'; 
    END IF;

    -- Revalidar vínculo
    SELECT member.* INTO v_member FROM public.enterprise_members AS member 
     WHERE member.user_id=v_actor.id AND member.enterprise_id=v_ctx.enterprise_id AND member.status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized'; END IF;

    -- Revalidar empresa ativa única
    IF (SELECT pg_catalog.count(*) FROM public.enterprise_members AS other_member 
          JOIN public.enterprises AS other_enterprise ON other_enterprise.id=other_member.enterprise_id 
         WHERE other_member.user_id=v_actor.id AND other_member.status='active' AND other_enterprise.status='active') <> 1 THEN
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    -- Revalidar enterprise.manage e lock da empresa
    SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise 
     WHERE enterprise.id=v_member.enterprise_id AND enterprise.status='active' FOR UPDATE;
    IF NOT FOUND OR NOT private.can_access_enterprise(v_enterprise.id, 'enterprise.manage') THEN
        RAISE SQLSTATE '42501' USING MESSAGE = 'unauthorized';
    END IF;

    -- ATUALIZAÇÃO E CONCORRÊNCIA
    -- Se versão obsoleta
    IF v_enterprise.version <> p_expected_version THEN
        RETURN QUERY SELECT 'version_conflict'::TEXT, v_enterprise.version;
        RETURN;
    END IF;

    -- Se tarifa já igual (NULL IS NOT DISTINCT FROM NULL), sucesso sem incremento
    IF v_enterprise.electricity_rate_per_kwh IS NOT DISTINCT FROM p_rate THEN
        RETURN QUERY SELECT 'updated'::TEXT, v_enterprise.version;
        RETURN;
    END IF;

    -- Atualizar (O trigger increment_enterprise_version cuidará do incremento se existir, 
    -- mas a migration 14 sugere que ele deve ser manual ou via trigger. 
    -- No update_my_enterprise_name ele não incrementa manualmente, 
    -- o que implica na existência de um trigger public.increment_enterprise_version)
    UPDATE public.enterprises AS e 
       SET electricity_rate_per_kwh = p_rate
     WHERE e.id = v_enterprise.id;

    -- Retornar versão efetiva (após trigger)
    RETURN QUERY 
    SELECT 'updated'::TEXT, e.version 
      FROM public.enterprises AS e 
     WHERE e.id = v_enterprise.id;
END; $$;

ALTER FUNCTION public.update_my_enterprise_config(NUMERIC, BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_my_enterprise_config(NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_enterprise_config(NUMERIC, BIGINT) TO authenticated;

COMMIT;

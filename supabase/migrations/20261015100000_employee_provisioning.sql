-- Modulus: provisionamento administrativo de funcionários em duas fases.
--
-- 1. O backend valida a sessão do ator e chama start_employee_provisioning.
-- 2. O backend cria uma NOVA conta Supabase Auth com:
--    - email_confirm: true;
--    - senha temporária, nunca armazenada nesta tabela;
--    - app_metadata.modulus_employee_provisioning_operation_id = operation_id.
-- 3. O backend chama finish_employee_provisioning.
--
-- Nunca adicionar o marcador a uma conta Auth preexistente.
-- Em timeout, reconciliar e retomar a operação antes de criar outra conta.
-- Não excluir contas Auth automaticamente após resultado desconhecido.
--
-- Dependências:
-- - núcleo de tenancy;
-- - private.auth_issuer_config;
-- - public.modulus_auth_tenancy_set_updated_at();
-- - trigger de versionamento de must_change_password.

BEGIN;

CREATE TABLE private.employee_provisioning_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    actor_user_id UUID NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,

    actor_identity_id UUID NOT NULL
        REFERENCES public.auth_identities(id) ON DELETE RESTRICT,

    enterprise_id UUID NOT NULL
        REFERENCES public.enterprises(id) ON DELETE RESTRICT,

    auth_issuer TEXT NOT NULL,
    email_normalized TEXT NOT NULL,
    full_name TEXT NOT NULL,
    requested_role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',

    auth_user_id UUID,

    user_id UUID
        REFERENCES public.users(id) ON DELETE RESTRICT,

    auth_identity_id UUID
        REFERENCES public.auth_identities(id) ON DELETE RESTRICT,

    membership_id UUID
        REFERENCES public.enterprise_members(id) ON DELETE RESTRICT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT employee_provisioning_auth_user_unique
        UNIQUE (auth_user_id),

    CONSTRAINT employee_provisioning_email_role_enterprise_unique
        UNIQUE (enterprise_id, email_normalized, requested_role),

    CONSTRAINT employee_provisioning_issuer_check
        CHECK (
            auth_issuer = pg_catalog.btrim(auth_issuer)
            AND auth_issuer <> ''
            AND pg_catalog.length(auth_issuer) <= 500
        ),

    CONSTRAINT employee_provisioning_email_check
        CHECK (
            email_normalized =
                pg_catalog.lower(pg_catalog.btrim(email_normalized))
            AND email_normalized <> ''
            AND pg_catalog.length(email_normalized) <= 320
        ),

    CONSTRAINT employee_provisioning_full_name_check
        CHECK (
            full_name = pg_catalog.btrim(full_name)
            AND full_name <> ''
            AND pg_catalog.length(full_name) <= 200
        ),

    CONSTRAINT employee_provisioning_role_check
        CHECK (requested_role IN ('admin', 'operator')),

    CONSTRAINT employee_provisioning_status_check
        CHECK (status IN ('pending', 'completed', 'failed')),

    CONSTRAINT employee_provisioning_completion_check
        CHECK (
            (
                status = 'completed'
                AND auth_user_id IS NOT NULL
                AND user_id IS NOT NULL
                AND auth_identity_id IS NOT NULL
                AND membership_id IS NOT NULL
                AND completed_at IS NOT NULL
            )
            OR
            (
                status IN ('pending', 'failed')
                AND auth_user_id IS NULL
                AND user_id IS NULL
                AND auth_identity_id IS NULL
                AND membership_id IS NULL
                AND completed_at IS NULL
            )
        )
);

COMMENT ON COLUMN private.employee_provisioning_operations.status IS
    'pending pode ser finalizado; completed permite repetição idempotente; '
    'failed é terminal para estas RPCs e exige análise administrativa.';

CREATE INDEX employee_provisioning_actor_idx
    ON private.employee_provisioning_operations (actor_user_id, status);

ALTER TABLE private.employee_provisioning_operations
    OWNER TO postgres;

ALTER TABLE private.employee_provisioning_operations
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
    ON TABLE private.employee_provisioning_operations
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER employee_provisioning_set_updated_at
BEFORE UPDATE ON private.employee_provisioning_operations
FOR EACH ROW
EXECUTE FUNCTION public.modulus_auth_tenancy_set_updated_at();


CREATE FUNCTION public.start_employee_provisioning(
    p_actor_auth_user_id UUID,
    p_actor_issuer TEXT,
    p_email TEXT,
    p_full_name TEXT,
    p_role TEXT
)
RETURNS TABLE (
    operation_id UUID,
    enterprise_id UUID,
    email_normalized TEXT,
    requested_role TEXT,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_identity public.auth_identities%ROWTYPE;
    v_actor public.users%ROWTYPE;
    v_member public.enterprise_members%ROWTYPE;
    v_enterprise public.enterprises%ROWTYPE;
    v_operation private.employee_provisioning_operations%ROWTYPE;

    v_email TEXT;
    v_issuer TEXT;
    v_full_name TEXT;
    v_active_enterprise_count BIGINT;
BEGIN
    v_issuer := pg_catalog.btrim(p_actor_issuer);
    v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
    v_full_name := pg_catalog.btrim(p_full_name);

    IF p_actor_auth_user_id IS NULL
       OR v_issuer IS NULL
       OR v_issuer = ''
       OR pg_catalog.length(v_issuer) > 500
       OR v_email IS NULL
       OR v_email = ''
       OR pg_catalog.length(v_email) > 320
       OR v_full_name IS NULL
       OR v_full_name = ''
       OR pg_catalog.length(v_full_name) > 200
       OR p_role IS NULL
       OR p_role NOT IN ('admin', 'operator') THEN
        RAISE EXCEPTION 'invalid employee provisioning input'
            USING ERRCODE = '22023';
    END IF;

    -- Mesma chave e mesma ordem de locks nas duas RPCs:
    -- ator -> identidade -> usuário -> membro -> empresa -> operação.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'modulus:employee-provisioning:actor:'
            || v_issuer
            || ':'
            || p_actor_auth_user_id::TEXT,
            0
        )
    );

    SELECT ai.*
      INTO v_actor_identity
      FROM public.auth_identities AS ai
      JOIN private.auth_issuer_config AS ic
        ON ic.issuer = ai.issuer
       AND ic.provider = 'supabase'
       AND ic.status = 'active'
     WHERE ai.provider = 'supabase'
       AND ai.issuer = v_issuer
       AND ai.subject = p_actor_auth_user_id::TEXT
       AND ai.status = 'active'
     FOR UPDATE OF ai;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'actor identity is not active'
            USING ERRCODE = '28000';
    END IF;

    SELECT u.*
      INTO v_actor
      FROM public.users AS u
     WHERE u.id = v_actor_identity.user_id
     FOR UPDATE OF u;

    IF NOT FOUND
       OR v_actor.status <> 'active'
       OR v_actor.must_change_password THEN
        RAISE EXCEPTION 'actor is not eligible'
            USING ERRCODE = '42501';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_active_enterprise_count
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e
        ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id
       AND em.status = 'active'
       AND e.status = 'active';

    IF v_active_enterprise_count <> 1 THEN
        RAISE EXCEPTION 'actor must have exactly one active enterprise'
            USING ERRCODE = '42501';
    END IF;

    SELECT em.*
      INTO v_member
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e
        ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id
       AND em.status = 'active'
       AND e.status = 'active'
     FOR UPDATE OF em;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'actor has no active enterprise membership'
            USING ERRCODE = '42501';
    END IF;

    SELECT e.*
      INTO v_enterprise
      FROM public.enterprises AS e
     WHERE e.id = v_member.enterprise_id
     FOR UPDATE OF e;

    IF NOT FOUND OR v_enterprise.status <> 'active' THEN
        RAISE EXCEPTION 'enterprise is not active'
            USING ERRCODE = '42501';
    END IF;

    IF (p_role = 'admin' AND v_member.role <> 'owner')
       OR (
           p_role = 'operator'
           AND v_member.role NOT IN ('owner', 'admin')
       ) THEN
        RAISE EXCEPTION 'actor cannot provision requested role'
            USING ERRCODE = '42501';
    END IF;

    SELECT o.*
      INTO v_operation
      FROM private.employee_provisioning_operations AS o
     WHERE o.enterprise_id = v_member.enterprise_id
       AND o.email_normalized = v_email
       AND o.requested_role = p_role
     FOR UPDATE OF o;

    IF FOUND THEN
        IF v_operation.actor_user_id <> v_actor.id
           OR v_operation.actor_identity_id <> v_actor_identity.id THEN
            RAISE EXCEPTION 'provisioning operation belongs to another actor'
                USING ERRCODE = '42501';
        END IF;

        IF v_operation.full_name <> v_full_name
           OR v_operation.auth_issuer <> v_issuer THEN
            RAISE EXCEPTION 'provisioning operation parameters conflict'
                USING ERRCODE = 'P0003';
        END IF;

        IF v_operation.status = 'failed' THEN
            RAISE EXCEPTION 'provisioning operation has failed'
                USING ERRCODE = 'P0004';
        END IF;

        -- Retomada: não criar outra operação nem outra conta Auth.
        RETURN QUERY
        SELECT
            v_operation.id,
            v_operation.enterprise_id,
            v_operation.email_normalized,
            v_operation.requested_role,
            v_operation.status;

        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.users AS u
         WHERE u.email_normalized = v_email
    ) THEN
        RAISE EXCEPTION 'email belongs to an existing internal user'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM auth.users AS au
         WHERE pg_catalog.lower(pg_catalog.btrim(au.email)) = v_email
    ) THEN
        RAISE EXCEPTION 'email belongs to an existing Auth account'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO private.employee_provisioning_operations AS o (
        actor_user_id,
        actor_identity_id,
        enterprise_id,
        auth_issuer,
        email_normalized,
        full_name,
        requested_role
    )
    VALUES (
        v_actor.id,
        v_actor_identity.id,
        v_member.enterprise_id,
        v_issuer,
        v_email,
        v_full_name,
        p_role
    )
    RETURNING o.* INTO v_operation;

    RETURN QUERY
    SELECT
        v_operation.id,
        v_operation.enterprise_id,
        v_operation.email_normalized,
        v_operation.requested_role,
        v_operation.status;
END;
$$;


CREATE FUNCTION public.finish_employee_provisioning(
    p_operation_id UUID,
    p_actor_auth_user_id UUID,
    p_actor_issuer TEXT,
    p_auth_user_id UUID,
    p_auth_issuer TEXT
)
RETURNS TABLE (
    operation_id UUID,
    user_id UUID,
    auth_identity_id UUID,
    membership_id UUID,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_op private.employee_provisioning_operations%ROWTYPE;

    v_actor_identity public.auth_identities%ROWTYPE;
    v_actor public.users%ROWTYPE;
    v_actor_member public.enterprise_members%ROWTYPE;
    v_enterprise public.enterprises%ROWTYPE;

    v_auth RECORD;
    v_marker TEXT;

    v_user UUID;
    v_identity UUID;
    v_membership UUID;

    v_actor_issuer TEXT;
    v_auth_issuer TEXT;
    v_active_enterprise_count BIGINT;
BEGIN
    v_actor_issuer := pg_catalog.btrim(p_actor_issuer);
    v_auth_issuer := pg_catalog.btrim(p_auth_issuer);

    IF p_operation_id IS NULL
       OR p_actor_auth_user_id IS NULL
       OR p_auth_user_id IS NULL
       OR v_actor_issuer IS NULL
       OR v_actor_issuer = ''
       OR pg_catalog.length(v_actor_issuer) > 500
       OR v_auth_issuer IS NULL
       OR v_auth_issuer = ''
       OR pg_catalog.length(v_auth_issuer) > 500 THEN
        RAISE EXCEPTION 'invalid employee provisioning finalization'
            USING ERRCODE = '22023';
    END IF;

    -- Este fluxo cria funcionários no mesmo projeto Auth do ator.
    IF v_auth_issuer <> v_actor_issuer THEN
        RAISE EXCEPTION 'employee issuer does not match actor issuer'
            USING ERRCODE = '28000';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'modulus:employee-provisioning:actor:'
            || v_actor_issuer
            || ':'
            || p_actor_auth_user_id::TEXT,
            0
        )
    );

    SELECT ai.*
      INTO v_actor_identity
      FROM public.auth_identities AS ai
      JOIN private.auth_issuer_config AS ic
        ON ic.issuer = ai.issuer
       AND ic.provider = 'supabase'
       AND ic.status = 'active'
     WHERE ai.provider = 'supabase'
       AND ai.issuer = v_actor_issuer
       AND ai.subject = p_actor_auth_user_id::TEXT
       AND ai.status = 'active'
     FOR UPDATE OF ai;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'actor identity is not active'
            USING ERRCODE = '28000';
    END IF;

    SELECT u.*
      INTO v_actor
      FROM public.users AS u
     WHERE u.id = v_actor_identity.user_id
     FOR UPDATE OF u;

    IF NOT FOUND
       OR v_actor.status <> 'active'
       OR v_actor.must_change_password THEN
        RAISE EXCEPTION 'actor is not eligible'
            USING ERRCODE = '42501';
    END IF;

    SELECT pg_catalog.count(*)
      INTO v_active_enterprise_count
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e
        ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id
       AND em.status = 'active'
       AND e.status = 'active';

    IF v_active_enterprise_count <> 1 THEN
        RAISE EXCEPTION 'actor must have exactly one active enterprise'
            USING ERRCODE = '42501';
    END IF;

    SELECT em.*
      INTO v_actor_member
      FROM public.enterprise_members AS em
      JOIN public.enterprises AS e
        ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id
       AND em.status = 'active'
       AND e.status = 'active'
     FOR UPDATE OF em;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'actor has no active enterprise membership'
            USING ERRCODE = '42501';
    END IF;

    SELECT e.*
      INTO v_enterprise
      FROM public.enterprises AS e
     WHERE e.id = v_actor_member.enterprise_id
     FOR UPDATE OF e;

    IF NOT FOUND OR v_enterprise.status <> 'active' THEN
        RAISE EXCEPTION 'enterprise is not active'
            USING ERRCODE = '42501';
    END IF;

    -- Mesma ordem de locks utilizada no início da operação.
    SELECT o.*
      INTO v_op
      FROM private.employee_provisioning_operations AS o
     WHERE o.id = p_operation_id
     FOR UPDATE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'provisioning operation not found'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_op.actor_user_id <> v_actor.id
       OR v_op.actor_identity_id <> v_actor_identity.id
       OR v_op.enterprise_id <> v_actor_member.enterprise_id THEN
        RAISE EXCEPTION 'actor is not authorized for this operation'
            USING ERRCODE = '42501';
    END IF;

    IF (v_op.requested_role = 'admin' AND v_actor_member.role <> 'owner')
       OR (
           v_op.requested_role = 'operator'
           AND v_actor_member.role NOT IN ('owner', 'admin')
       ) THEN
        RAISE EXCEPTION 'actor no longer has permission'
            USING ERRCODE = '42501';
    END IF;

    IF v_op.auth_issuer <> v_auth_issuer THEN
        RAISE EXCEPTION 'employee issuer does not match operation issuer'
            USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM private.auth_issuer_config AS ic
         WHERE ic.issuer = v_auth_issuer
           AND ic.provider = 'supabase'
           AND ic.status = 'active'
    ) THEN
        RAISE EXCEPTION 'employee issuer is not allowed'
            USING ERRCODE = '28000';
    END IF;

    IF v_op.status = 'completed' THEN
        IF v_op.auth_user_id <> p_auth_user_id THEN
            RAISE EXCEPTION 'completed operation correlation mismatch'
                USING ERRCODE = 'P0003';
        END IF;

        -- A repetição confirma o resultado original.
        -- Não reativa registros nem redefine senha, papel ou obrigação.
        RETURN QUERY
        SELECT
            v_op.id,
            v_op.user_id,
            v_op.auth_identity_id,
            v_op.membership_id,
            v_op.status;

        RETURN;
    END IF;

    IF v_op.status <> 'pending' THEN
        RAISE EXCEPTION 'provisioning operation cannot be finalized'
            USING ERRCODE = 'P0004';
    END IF;

    SELECT
        au.id,
        au.email,
        au.raw_app_meta_data,
        au.email_confirmed_at,
        au.created_at
      INTO v_auth
      FROM auth.users AS au
     WHERE au.id = p_auth_user_id
     FOR UPDATE OF au;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'new Auth account was not found'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_auth.email IS NULL
       OR pg_catalog.btrim(v_auth.email) = ''
       OR v_auth.email_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'new Auth account is missing a confirmed email'
            USING ERRCODE = 'P0002';
    END IF;

    v_marker :=
        v_auth.raw_app_meta_data
        ->> 'modulus_employee_provisioning_operation_id';

    IF v_marker IS NULL
       OR v_marker <> v_op.id::TEXT
       OR pg_catalog.lower(pg_catalog.btrim(v_auth.email))
            <> v_op.email_normalized THEN
        RAISE EXCEPTION 'Auth account correlation is invalid'
            USING ERRCODE = 'P0003';
    END IF;

    -- Proteção adicional: a conta deve ter sido criada após o início.
    -- Isso não substitui a obrigação do backend de nunca marcar contas antigas.
    IF v_auth.created_at IS NULL
       OR v_auth.created_at < v_op.created_at THEN
        RAISE EXCEPTION 'Auth account predates provisioning operation'
            USING ERRCODE = 'P0003';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.users AS u
         WHERE u.email_normalized = v_op.email_normalized
    ) THEN
        RAISE EXCEPTION 'email belongs to an existing internal user'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.auth_identities AS ai
         WHERE ai.issuer = v_auth_issuer
           AND ai.subject = p_auth_user_id::TEXT
    ) THEN
        RAISE EXCEPTION 'Auth identity is already registered'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.users AS u (
        full_name,
        email,
        status,
        must_change_password,
        password_change_version
    )
    VALUES (
        v_op.full_name,
        v_auth.email,
        'active',
        true,
        1
    )
    RETURNING u.id INTO v_user;

    INSERT INTO public.auth_identities AS ai (
        user_id,
        provider,
        issuer,
        subject,
        status
    )
    VALUES (
        v_user,
        'supabase',
        v_auth_issuer,
        p_auth_user_id::TEXT,
        'active'
    )
    RETURNING ai.id INTO v_identity;

    INSERT INTO public.enterprise_members AS em (
        enterprise_id,
        user_id,
        role,
        status
    )
    VALUES (
        v_op.enterprise_id,
        v_user,
        v_op.requested_role,
        'active'
    )
    RETURNING em.id INTO v_membership;

    UPDATE private.employee_provisioning_operations AS o
       SET status = 'completed',
           auth_user_id = p_auth_user_id,
           user_id = v_user,
           auth_identity_id = v_identity,
           membership_id = v_membership,
           completed_at = pg_catalog.now()
     WHERE o.id = v_op.id;

    RETURN QUERY
    SELECT
        v_op.id,
        v_user,
        v_identity,
        v_membership,
        'completed'::TEXT;
END;
$$;


ALTER FUNCTION public.start_employee_provisioning(
    UUID, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;

ALTER FUNCTION public.finish_employee_provisioning(
    UUID, UUID, TEXT, UUID, TEXT
) OWNER TO postgres;


REVOKE ALL PRIVILEGES
    ON FUNCTION public.start_employee_provisioning(
        UUID, TEXT, TEXT, TEXT, TEXT
    )
    FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
    ON FUNCTION public.finish_employee_provisioning(
        UUID, UUID, TEXT, UUID, TEXT
    )
    FROM PUBLIC, anon, authenticated;


GRANT EXECUTE
    ON FUNCTION public.start_employee_provisioning(
        UUID, TEXT, TEXT, TEXT, TEXT
    )
    TO service_role;

GRANT EXECUTE
    ON FUNCTION public.finish_employee_provisioning(
        UUID, UUID, TEXT, UUID, TEXT
    )
    TO service_role;

COMMIT;
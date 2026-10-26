-- Keep partially provisioned employee Auth accounts out of public onboarding.
-- Requires public onboarding and employee provisioning migrations.
-- No Auth writes, triggers, changes to provisioning, or remote application.
BEGIN;

CREATE OR REPLACE FUNCTION public.complete_public_onboarding(
    p_auth_user_id UUID,
    p_issuer TEXT,
    p_user_name TEXT,
    p_enterprise_name TEXT
)
RETURNS TABLE (
    user_id UUID,
    enterprise_id UUID,
    membership_id UUID,
    created_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_user RECORD;
    v_issuer_config_exists BOOLEAN;
    v_auth_identity public.auth_identities%ROWTYPE;
    v_completion private.public_onboarding_completions%ROWTYPE;
    v_existing_user public.users%ROWTYPE;
    v_existing_enterprise public.enterprises%ROWTYPE;
    v_existing_member public.enterprise_members%ROWTYPE;
    v_user_id UUID;
    v_enterprise_id UUID;
    v_membership_id UUID;
    v_auth_identity_id UUID;
BEGIN
    IF p_auth_user_id IS NULL
       OR p_issuer IS NULL
       OR pg_catalog.btrim(p_issuer) = ''
       OR p_user_name IS NULL
       OR pg_catalog.btrim(p_user_name) = ''
       OR pg_catalog.length(pg_catalog.btrim(p_user_name)) > 200
       OR p_enterprise_name IS NULL
       OR pg_catalog.btrim(p_enterprise_name) = ''
       OR pg_catalog.length(pg_catalog.btrim(p_enterprise_name)) > 200 THEN
        RAISE EXCEPTION 'public onboarding input is invalid'
            USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.length(pg_catalog.btrim(p_issuer)) > 500 THEN
        RAISE EXCEPTION 'public onboarding issuer is invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM private.auth_issuer_config AS ic
        WHERE ic.issuer = pg_catalog.btrim(p_issuer)
          AND ic.provider = 'supabase'
          AND ic.status = 'active'
    )
    INTO v_issuer_config_exists;

    IF NOT v_issuer_config_exists THEN
        RAISE EXCEPTION 'issuer is not allowed'
            USING ERRCODE = '28000';
    END IF;

    -- O lock serializa finalizações concorrentes da mesma conta.
    SELECT au.id, au.email, au.email_confirmed_at, au.raw_app_meta_data
      INTO v_auth_user
      FROM auth.users AS au
     WHERE au.id = p_auth_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'authentication account was not found'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_auth_user.email IS NULL
       OR pg_catalog.btrim(v_auth_user.email) = '' THEN
        RAISE EXCEPTION 'authentication account has no valid email'
            USING ERRCODE = '22023';
    END IF;

    IF v_auth_user.email_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'authentication email is not confirmed'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT ai.*
      INTO v_auth_identity
      FROM public.auth_identities AS ai
     WHERE ai.issuer = pg_catalog.btrim(p_issuer)
       AND ai.subject = p_auth_user_id::TEXT
     FOR UPDATE;

    IF FOUND THEN
        SELECT poc.*
          INTO v_completion
          FROM private.public_onboarding_completions AS poc
         WHERE poc.auth_identity_id = v_auth_identity.id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'authentication identity belongs to another onboarding flow'
                USING ERRCODE = 'P0003';
        END IF;

        SELECT u.*
          INTO v_existing_user
          FROM public.users AS u
         WHERE u.id = v_completion.user_id;

        SELECT e.*
          INTO v_existing_enterprise
          FROM public.enterprises AS e
         WHERE e.id = v_completion.enterprise_id;

        SELECT em.*
          INTO v_existing_member
          FROM public.enterprise_members AS em
         WHERE em.id = v_completion.membership_id;

        IF NOT FOUND
           OR v_completion.auth_user_id <> p_auth_user_id
           OR v_completion.issuer <> pg_catalog.btrim(p_issuer)
           OR v_auth_identity.user_id <> v_completion.user_id
           OR v_auth_identity.provider <> 'supabase'
           OR v_auth_identity.status <> 'active'
           OR v_existing_user.id IS NULL
           OR v_existing_user.status <> 'active'
           OR v_existing_user.must_change_password <> false
           OR v_existing_enterprise.id IS NULL
           OR v_existing_enterprise.status <> 'active'
           OR v_existing_member.id IS NULL
           OR v_existing_member.user_id <> v_completion.user_id
           OR v_existing_member.enterprise_id <> v_completion.enterprise_id
           OR v_existing_member.role <> 'owner'
           OR v_existing_member.status <> 'active' THEN
            RAISE EXCEPTION 'public onboarding state is inconsistent'
                USING ERRCODE = 'P0004';
        END IF;

        RETURN QUERY SELECT
            v_completion.user_id,
            v_completion.enterprise_id,
            v_completion.membership_id,
            false;

        RETURN;
    END IF;

    -- Only trusted app_metadata is authoritative, never raw_user_meta_data.
    -- Presence is fail-closed: pending, failed, missing or malformed operation
    -- references must be reconciled through the employee flow, not made owners.
    -- Do not cast the marker to UUID or require a matching pending row: either
    -- would allow invalid/stale correlation to escape into public onboarding.
    -- No operation lock/read is needed. finish/resume lock enterprise -> operation
    -- -> Auth; taking an operation lock here after Auth would invert that order.
    -- Existing public completions above retain their original idempotent result;
    -- completed employees already reject as another onboarding flow above.
    IF v_auth_user.raw_app_meta_data
        ? 'modulus_employee_provisioning_operation_id' THEN
        RAISE EXCEPTION 'employee_provisioning_requires_resume'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.email_normalized =
            pg_catalog.lower(pg_catalog.btrim(v_auth_user.email))
    ) THEN
        RAISE EXCEPTION
            'authentication email conflicts with an existing internal user'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.users (
        full_name,
        email,
        status,
        must_change_password
    )
    VALUES (
        pg_catalog.btrim(p_user_name),
        v_auth_user.email,
        'active',
        false
    )
    RETURNING id INTO v_user_id;

    INSERT INTO public.auth_identities (
        user_id,
        provider,
        issuer,
        subject,
        status
    )
    VALUES (
        v_user_id,
        'supabase',
        pg_catalog.btrim(p_issuer),
        p_auth_user_id::TEXT,
        'active'
    )
    RETURNING id INTO v_auth_identity_id;

    INSERT INTO public.enterprises (
        name,
        status
    )
    VALUES (
        pg_catalog.btrim(p_enterprise_name),
        'active'
    )
    RETURNING id INTO v_enterprise_id;

    INSERT INTO public.enterprise_members (
        enterprise_id,
        user_id,
        role,
        status
    )
    VALUES (
        v_enterprise_id,
        v_user_id,
        'owner',
        'active'
    )
    RETURNING id INTO v_membership_id;

    INSERT INTO private.public_onboarding_completions (
        auth_identity_id,
        auth_user_id,
        issuer,
        user_id,
        enterprise_id,
        membership_id
    )
    VALUES (
        v_auth_identity_id,
        p_auth_user_id,
        pg_catalog.btrim(p_issuer),
        v_user_id,
        v_enterprise_id,
        v_membership_id
    );

    RETURN QUERY SELECT
        v_user_id,
        v_enterprise_id,
        v_membership_id,
        true;
END;
$$;

ALTER FUNCTION public.complete_public_onboarding(UUID, TEXT, TEXT, TEXT)
    OWNER TO postgres;

REVOKE ALL PRIVILEGES
    ON FUNCTION public.complete_public_onboarding(UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
    ON FUNCTION public.complete_public_onboarding(UUID, TEXT, TEXT, TEXT)
    TO service_role;

COMMIT;

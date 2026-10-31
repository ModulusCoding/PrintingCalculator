-- Incremental migration, NOT applied by this change.
-- Requires 20261015100000_employee_provisioning.sql.
-- No Auth creation, password change, deletion, or email-based Auth discovery.
BEGIN;
CREATE FUNCTION public.resume_employee_provisioning(
    p_operation_id UUID, p_actor_auth_user_id UUID, p_actor_issuer TEXT
)
RETURNS TABLE (operation_id UUID, status TEXT, auth_user_id UUID, user_id UUID, auth_identity_id UUID, membership_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_op private.employee_provisioning_operations%ROWTYPE;
    v_actor_identity public.auth_identities%ROWTYPE;
    v_actor public.users%ROWTYPE;
    v_actor_member public.enterprise_members%ROWTYPE;
    v_enterprise public.enterprises%ROWTYPE;
    v_issuer TEXT := pg_catalog.btrim(p_actor_issuer);
    v_count BIGINT;
    v_auth auth.users%ROWTYPE;
    v_candidate auth.users%ROWTYPE;
    v_result RECORD;
BEGIN
    IF p_operation_id IS NULL OR p_actor_auth_user_id IS NULL
       OR v_issuer IS NULL OR v_issuer = '' OR pg_catalog.length(v_issuer) > 500 THEN
        RAISE EXCEPTION 'invalid resume input' USING ERRCODE = '22023';
    END IF;

    -- Same authorization and lock order as finish: advisory, identity, user,
    -- membership, enterprise, operation, then Auth. No status disclosure before authorization.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'modulus:employee-provisioning:actor:' || v_issuer || ':' || p_actor_auth_user_id::TEXT, 0));
    SELECT ai.* INTO v_actor_identity
      FROM public.auth_identities ai
      JOIN private.auth_issuer_config ic ON ic.issuer = ai.issuer
       AND ic.provider = 'supabase' AND ic.status = 'active'
     WHERE ai.provider = 'supabase' AND ai.issuer = v_issuer
       AND ai.subject = p_actor_auth_user_id::TEXT AND ai.status = 'active'
     FOR UPDATE OF ai;
    IF NOT FOUND THEN RAISE EXCEPTION 'actor identity is not active' USING ERRCODE = '28000'; END IF;
    SELECT u.* INTO v_actor FROM public.users u WHERE u.id = v_actor_identity.user_id FOR UPDATE OF u;
    IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.must_change_password THEN
        RAISE EXCEPTION 'actor is not eligible' USING ERRCODE = '42501';
    END IF;
    SELECT pg_catalog.count(*) INTO v_count
      FROM public.enterprise_members em JOIN public.enterprises e ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id AND em.status = 'active' AND e.status = 'active';
    IF v_count <> 1 THEN RAISE EXCEPTION 'actor must have exactly one active enterprise' USING ERRCODE = '42501'; END IF;
    SELECT em.* INTO v_actor_member
      FROM public.enterprise_members em JOIN public.enterprises e ON e.id = em.enterprise_id
     WHERE em.user_id = v_actor.id AND em.status = 'active' AND e.status = 'active'
     FOR UPDATE OF em;
    IF NOT FOUND THEN RAISE EXCEPTION 'actor has no active membership' USING ERRCODE = '42501'; END IF;
    SELECT e.* INTO v_enterprise FROM public.enterprises e WHERE e.id = v_actor_member.enterprise_id FOR UPDATE OF e;
    IF NOT FOUND OR v_enterprise.status <> 'active' THEN RAISE EXCEPTION 'enterprise inactive' USING ERRCODE = '42501'; END IF;
    SELECT o.* INTO v_op FROM private.employee_provisioning_operations o WHERE o.id = p_operation_id FOR UPDATE OF o;
    IF NOT FOUND THEN RAISE EXCEPTION 'operation unavailable' USING ERRCODE = '42501'; END IF;
    IF v_op.actor_user_id <> v_actor.id OR v_op.actor_identity_id <> v_actor_identity.id
       OR v_op.enterprise_id <> v_actor_member.enterprise_id
       OR (v_op.requested_role = 'admin' AND v_actor_member.role <> 'owner')
       OR (v_op.requested_role = 'operator' AND v_actor_member.role NOT IN ('owner', 'admin')) THEN
        RAISE EXCEPTION 'actor is not authorized for this operation' USING ERRCODE = '42501';
    END IF;
    IF v_op.auth_issuer <> v_issuer THEN RAISE EXCEPTION 'issuer mismatch' USING ERRCODE = '28000'; END IF;

    IF v_op.status = 'failed' THEN
        RETURN QUERY SELECT v_op.id, 'failed'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID; RETURN;
    END IF;

    -- Marker ONLY, including duplicates whose email does not match. Lock every match.
    v_count := 0;
    FOR v_candidate IN SELECT au.* FROM auth.users au
        WHERE au.raw_app_meta_data ->> 'modulus_employee_provisioning_operation_id' = v_op.id::TEXT
        ORDER BY au.id FOR UPDATE OF au
    LOOP
        v_count := v_count + 1;
        v_auth := v_candidate;
    END LOOP;
    IF v_count = 0 THEN
        IF v_op.status = 'completed' THEN
            RETURN QUERY SELECT v_op.id, 'inconsistent'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
        ELSE
            RETURN QUERY SELECT v_op.id, 'auth_account_not_found'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
        END IF;
        RETURN;
    END IF;
    IF v_count <> 1 OR v_auth.email IS NULL OR pg_catalog.btrim(v_auth.email) = ''
       OR v_auth.email_confirmed_at IS NULL
       OR pg_catalog.lower(pg_catalog.btrim(v_auth.email)) <> v_op.email_normalized
       OR v_auth.created_at IS NULL OR v_auth.created_at < v_op.created_at
       OR (v_op.auth_user_id IS NOT NULL AND v_op.auth_user_id <> v_auth.id)
       OR EXISTS (SELECT 1 FROM public.auth_identities ai
           WHERE ai.issuer = v_issuer AND ai.subject = v_auth.id::TEXT
             AND (v_op.status <> 'completed' OR ai.id IS DISTINCT FROM v_op.auth_identity_id
                  OR ai.user_id IS DISTINCT FROM v_op.user_id OR ai.provider <> 'supabase'))
       OR EXISTS (SELECT 1 FROM public.users u WHERE u.email_normalized = v_op.email_normalized
             AND (v_op.status <> 'completed' OR u.id IS DISTINCT FROM v_op.user_id)) THEN
        RETURN QUERY SELECT v_op.id, 'inconsistent'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID; RETURN;
    END IF;
        IF v_op.status = 'completed' THEN
        IF v_auth.id <> v_op.auth_user_id
           OR NOT EXISTS (
               SELECT 1
               FROM public.users AS u
               WHERE u.id = v_op.user_id
                 AND u.email_normalized = v_op.email_normalized
           )
           OR NOT EXISTS (
               SELECT 1
               FROM public.auth_identities AS ai
               WHERE ai.id = v_op.auth_identity_id
                 AND ai.user_id = v_op.user_id
                 AND ai.provider = 'supabase'
                 AND ai.issuer = v_op.auth_issuer
                 AND ai.subject = v_op.auth_user_id::TEXT
           )
           OR NOT EXISTS (
               SELECT 1
               FROM public.enterprise_members AS em
               WHERE em.id = v_op.membership_id
                 AND em.user_id = v_op.user_id
                 AND em.enterprise_id = v_op.enterprise_id
           )
           OR NOT EXISTS (
               SELECT 1
               FROM public.enterprises AS e
               WHERE e.id = v_op.enterprise_id
           ) THEN
            RETURN QUERY SELECT
                v_op.id,
                'inconsistent'::TEXT,
                NULL::UUID,
                NULL::UUID,
                NULL::UUID,
                NULL::UUID;
            RETURN;
        END IF;

        RETURN QUERY SELECT
            v_op.id,
            'already_completed'::TEXT,
            v_op.auth_user_id,
            v_op.user_id,
            v_op.auth_identity_id,
            v_op.membership_id;
        RETURN;
    END IF;

    BEGIN
        SELECT * INTO STRICT v_result FROM public.finish_employee_provisioning(
            v_op.id, p_actor_auth_user_id, v_issuer, v_auth.id, v_issuer);
        RETURN QUERY SELECT v_result.operation_id, 'completed'::TEXT,
            v_auth.id, v_result.user_id, v_result.auth_identity_id, v_result.membership_id;
    EXCEPTION
        -- Subtransaction rolls back every internal write on a known conflict.
        WHEN unique_violation OR SQLSTATE 'P0002' OR SQLSTATE 'P0003' THEN
            RETURN QUERY SELECT v_op.id, 'inconsistent'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
        WHEN SQLSTATE 'P0004' THEN
            RETURN QUERY SELECT v_op.id, 'failed'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
        -- Authorization and unexpected failures propagate; never disguise them as success.
    END;
END;
$$;
ALTER FUNCTION public.resume_employee_provisioning(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.resume_employee_provisioning(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_employee_provisioning(UUID, UUID, TEXT) TO service_role;
COMMIT;

-- Self-contained rollback regression, as postgres, in an authorized disposable DB.
-- Requires migrations through 20261026130000. No remote application intended.
-- SQL Editor-compatible: run the entire script; all fixture changes roll back.
-- Also usable with psql -X -v ON_ERROR_STOP=1 -f <this file>.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE
    v_issuer TEXT := 'https://employee-onboarding-guard.invalid/' || gen_random_uuid()::TEXT;
    v_owner_auth UUID := gen_random_uuid();
    v_auth UUID;
    v_operation UUID;
    v_owner RECORD;
    v_repeat RECORD;
    v_result RECORD;
    v_marker JSONB;
    v_case INTEGER;
    v_before JSONB;
    v_after JSONB;
BEGIN
    INSERT INTO private.auth_issuer_config(issuer) VALUES (v_issuer);
    INSERT INTO auth.users(id, email, email_confirmed_at, created_at, raw_app_meta_data)
    VALUES (v_owner_auth, v_owner_auth::TEXT || '@guard.invalid', now(), now(), '{}');
    SELECT * INTO STRICT v_owner FROM public.complete_public_onboarding(
        v_owner_auth, v_issuer, 'Guard owner', 'Guard enterprise');
    IF NOT v_owner.created_new THEN RAISE EXCEPTION 'normal onboarding failed'; END IF;

    -- A marker must not change the result of an existing public completion.
    UPDATE auth.users SET raw_app_meta_data =
        '{"modulus_employee_provisioning_operation_id": "invalid"}' WHERE id = v_owner_auth;
    SELECT * INTO STRICT v_repeat FROM public.complete_public_onboarding(
        v_owner_auth, v_issuer, 'Ignored name', 'Ignored enterprise');
    IF v_repeat.created_new OR v_repeat.user_id <> v_owner.user_id
       OR v_repeat.enterprise_id <> v_owner.enterprise_id
       OR v_repeat.membership_id <> v_owner.membership_id THEN
        RAISE EXCEPTION 'public completion idempotency changed';
    END IF;

    -- Bootstrap via normal public onboarding first, then give only this fixture
    -- enterprise paid operator capacity. No admin bootstrap or guard bypass.
    INSERT INTO public.enterprise_plan_access(
        enterprise_id, selected_plan, effective_plan, access_state,
        paid_until, authorization_id)
    VALUES (v_owner.enterprise_id, 'intermediate', 'intermediate', 'paid',
        now() + interval '1 day', 'onboarding-guard-' || v_owner.enterprise_id::TEXT)
    ON CONFLICT (enterprise_id) DO UPDATE SET
        selected_plan = EXCLUDED.selected_plan,
        effective_plan = EXCLUDED.effective_plan,
        access_state = EXCLUDED.access_state,
        paid_until = EXCLUDED.paid_until,
        authorization_id = EXCLUDED.authorization_id;

    FOR v_case IN 1..6 LOOP
        v_auth := gen_random_uuid();
        v_operation := gen_random_uuid();
        IF v_case IN (1, 2) THEN
            INSERT INTO private.employee_provisioning_operations(
                id, actor_user_id, actor_identity_id, enterprise_id, auth_issuer,
                email_normalized, full_name, requested_role, status)
            SELECT v_operation, v_owner.user_id, ai.id, v_owner.enterprise_id, v_issuer,
                v_auth::TEXT || '@guard.invalid', 'Partial employee', 'operator',
                CASE WHEN v_case = 1 THEN 'pending' ELSE 'failed' END
            FROM public.auth_identities ai WHERE ai.user_id = v_owner.user_id;
        END IF;
        v_marker := CASE v_case
            WHEN 4 THEN 'null'::JSONB
            WHEN 5 THEN '"not-a-uuid"'::JSONB
            WHEN 6 THEN '""'::JSONB
            ELSE to_jsonb(v_operation::TEXT) END;
        INSERT INTO auth.users(id, email, email_confirmed_at, created_at, raw_app_meta_data)
        VALUES (v_auth, v_auth::TEXT || '@guard.invalid', now(), now(),
            jsonb_build_object('modulus_employee_provisioning_operation_id', v_marker));
        SELECT jsonb_build_array(
            (SELECT count(*) FROM public.users),
            (SELECT count(*) FROM public.auth_identities),
            (SELECT count(*) FROM public.enterprises),
            (SELECT count(*) FROM public.enterprise_members),
            (SELECT count(*) FROM private.public_onboarding_completions),
            (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM private.employee_provisioning_operations o)
        ) INTO v_before;
        BEGIN
            PERFORM * FROM public.complete_public_onboarding(
                v_auth, v_issuer, 'Must not become owner', 'Must not be created');
            RAISE EXCEPTION 'marked account accepted (case %)', v_case;
        EXCEPTION WHEN SQLSTATE '42501' THEN
            IF SQLERRM <> 'employee_provisioning_requires_resume' THEN RAISE; END IF;
        END;
        SELECT jsonb_build_array(
            (SELECT count(*) FROM public.users),
            (SELECT count(*) FROM public.auth_identities),
            (SELECT count(*) FROM public.enterprises),
            (SELECT count(*) FROM public.enterprise_members),
            (SELECT count(*) FROM private.public_onboarding_completions),
            (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM private.employee_provisioning_operations o)
        ) INTO v_after;
        IF v_before IS DISTINCT FROM v_after THEN
            RAISE EXCEPTION 'rejection changed internal state (case %)', v_case;
        END IF;
    END LOOP;

    -- Client-editable user metadata and unrelated app metadata are not markers.
    v_auth := gen_random_uuid();
    INSERT INTO auth.users(id, email, email_confirmed_at, created_at,
        raw_app_meta_data, raw_user_meta_data)
    VALUES (v_auth, v_auth::TEXT || '@guard.invalid', now(), now(),
        '{"provider":"email"}',
        '{"modulus_employee_provisioning_operation_id":"client-controlled"}');
    SELECT * INTO STRICT v_result FROM public.complete_public_onboarding(
        v_auth, v_issuer, 'Public user', 'Public enterprise');
    IF NOT v_result.created_new THEN RAISE EXCEPTION 'unrelated metadata blocked'; END IF;

    IF NOT has_function_privilege('service_role',
        'public.complete_public_onboarding(uuid,text,text,text)', 'EXECUTE')
       OR has_function_privilege('authenticated',
        'public.complete_public_onboarding(uuid,text,text,text)', 'EXECUTE')
       OR has_function_privilege('anon',
        'public.complete_public_onboarding(uuid,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public onboarding grants changed';
    END IF;
END;
$$;
ROLLBACK;

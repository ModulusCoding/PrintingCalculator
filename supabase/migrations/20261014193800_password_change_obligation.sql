-- Versioned, administrator-issued password change obligation.
-- The trigger versions INSERTs with an active obligation and false -> true transitions.
-- Re-emitting an obligation while it is already true does not increment it; a future
-- administrative issue/reset command must explicitly version that case.
BEGIN;

-- Existing core already contains this column; this assertion keeps the contract explicit.
ALTER TABLE public.users
    ALTER COLUMN password_change_version SET DEFAULT 0;

UPDATE public.users
   SET password_change_version = CASE WHEN must_change_password THEN 1 ELSE 0 END
 WHERE password_change_version = 0 AND must_change_password;

CREATE OR REPLACE FUNCTION public.modulus_password_change_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.must_change_password THEN
        NEW.password_change_version := GREATEST(NEW.password_change_version, 1);
    ELSIF TG_OP = 'UPDATE' AND NEW.must_change_password AND NOT OLD.must_change_password THEN
        NEW.password_change_version := OLD.password_change_version + 1;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_password_change_version
BEFORE INSERT OR UPDATE OF must_change_password ON public.users
FOR EACH ROW EXECUTE FUNCTION public.modulus_password_change_version();

CREATE FUNCTION public.get_required_password_change(
    p_auth_user_id UUID, p_issuer TEXT
)
RETURNS TABLE(user_id UUID, identity_id UUID, obligation_version BIGINT, required BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_auth_user_id IS NULL OR p_issuer IS NULL OR pg_catalog.btrim(p_issuer) = '' THEN
        RAISE EXCEPTION 'invalid password change identity' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT u.id, ai.id, u.password_change_version, u.must_change_password
      FROM public.auth_identities AS ai
      JOIN public.users AS u ON u.id = ai.user_id
      JOIN private.auth_issuer_config AS ic ON ic.issuer = ai.issuer
       AND ic.provider = 'supabase' AND ic.status = 'active'
     WHERE ai.provider = 'supabase' AND ai.issuer = pg_catalog.btrim(p_issuer)
       AND ai.subject = p_auth_user_id::text AND ai.status = 'active';
END;
$$;

CREATE FUNCTION public.release_required_password_change(
    p_auth_user_id UUID, p_issuer TEXT, p_expected_version BIGINT
)
RETURNS TABLE(status TEXT, obligation_version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_identity UUID;
    v_version BIGINT;
    v_required BOOLEAN;
BEGIN
    IF p_auth_user_id IS NULL
       OR p_issuer IS NULL
       OR pg_catalog.btrim(p_issuer) = ''
       OR p_expected_version IS NULL
       OR p_expected_version < 0 THEN
        RAISE EXCEPTION 'invalid password change release' USING ERRCODE = '22023';
    END IF;

    SELECT ai.user_id, ai.id
      INTO v_user, v_identity
      FROM public.auth_identities AS ai
      JOIN private.auth_issuer_config AS ic
        ON ic.issuer = ai.issuer
       AND ic.provider = 'supabase'
       AND ic.status = 'active'
     WHERE ai.provider = 'supabase'
       AND ai.issuer = pg_catalog.btrim(p_issuer)
       AND ai.subject = p_auth_user_id::text
       AND ai.status = 'active';
    IF v_identity IS NULL THEN
        RAISE EXCEPTION 'identity not found' USING ERRCODE = '28000';
    END IF;

    -- Serialize release decisions for this internal user.
    SELECT u.password_change_version, u.must_change_password
      INTO v_version, v_required
      FROM public.users AS u
     WHERE u.id = v_user
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0001';
    END IF;

    IF v_required AND v_version = p_expected_version THEN
        UPDATE public.users AS u
           SET must_change_password = false,
               password_changed_at = pg_catalog.now(),
               password_change_version = u.password_change_version + 1
         WHERE u.id = v_user;
        RETURN QUERY SELECT 'released'::text, (p_expected_version + 1)::BIGINT;
        RETURN;
    END IF;

    IF NOT v_required AND v_version = p_expected_version + 1 THEN
        RETURN QUERY SELECT 'already_released'::text, v_version;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'version_conflict'::text, v_version;
END;
$$;

ALTER FUNCTION public.modulus_password_change_version() OWNER TO postgres;
ALTER FUNCTION public.get_required_password_change(UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.release_required_password_change(UUID,TEXT,BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.modulus_password_change_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_required_password_change(UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_required_password_change(UUID,TEXT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_required_password_change(UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_required_password_change(UUID,TEXT,BIGINT) TO service_role;
COMMIT;

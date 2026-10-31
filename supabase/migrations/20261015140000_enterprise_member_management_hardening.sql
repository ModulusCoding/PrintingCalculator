-- Definitive hardening migration for enterprise management and member mutations.
-- Review and apply explicitly. Do not alter previous migrations.
BEGIN;

DROP FUNCTION IF EXISTS public.list_my_enterprise_members(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_my_enterprise_member(UUID, TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.update_my_enterprise_member(UUID, TEXT, TEXT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.set_my_enterprise_member_status(UUID, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.increment_enterprise_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.increment_enterprise_member_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.get_my_enterprise()
RETURNS TABLE(name TEXT, created_at TIMESTAMPTZ, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx RECORD;
BEGIN
    SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
    IF v_ctx.state <> 'business_ready'
       OR NOT private.can_access_enterprise(v_ctx.enterprise_id, 'enterprise.manage') THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT enterprise.name, enterprise.created_at, enterprise.version
      FROM public.enterprises AS enterprise WHERE enterprise.id = v_ctx.enterprise_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_my_enterprise_name(p_name TEXT, p_expected_version BIGINT)
RETURNS TABLE(status TEXT, name TEXT, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx RECORD; v_name TEXT; v_issuer TEXT; v_identity public.auth_identities%ROWTYPE;
  v_actor public.users%ROWTYPE; v_member public.enterprise_members%ROWTYPE; v_enterprise public.enterprises%ROWTYPE;
BEGIN
    v_name := pg_catalog.btrim(p_name);
    IF p_expected_version IS NULL OR p_expected_version < 0 OR v_name IS NULL OR v_name = '' OR pg_catalog.length(v_name) > 200 THEN
        RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::TEXT, NULL::BIGINT; RETURN;
    END IF;
    -- Shared administrative lock is acquired before every row lock. It serializes
    -- member mutations and enterprise-name changes, including crossed enterprises.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
    SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
    IF v_ctx.state <> 'business_ready' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    v_issuer := auth.jwt()->>'iss';
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::TEXT, 0));
    SELECT identity.* INTO v_identity FROM public.auth_identities AS identity
      JOIN private.auth_issuer_config AS issuer ON issuer.issuer=identity.issuer AND issuer.provider='supabase' AND issuer.status='active'
      WHERE identity.provider='supabase' AND identity.issuer=v_issuer AND identity.subject=auth.uid()::TEXT AND identity.status='active' FOR UPDATE OF identity;
    IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    SELECT person.* INTO v_actor FROM public.users AS person WHERE person.id=v_identity.user_id FOR UPDATE;
    IF NOT FOUND OR v_actor.status<>'active' OR v_actor.must_change_password THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    SELECT member.* INTO v_member FROM public.enterprise_members AS member WHERE member.user_id=v_actor.id AND member.enterprise_id=v_ctx.enterprise_id AND member.status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
    IF (SELECT pg_catalog.count(*) FROM public.enterprise_members AS other_member JOIN public.enterprises AS other_enterprise ON other_enterprise.id=other_member.enterprise_id WHERE other_member.user_id=v_actor.id AND other_member.status='active' AND other_enterprise.status='active')<>1 THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise WHERE enterprise.id=v_member.enterprise_id AND enterprise.status='active' FOR UPDATE;
    IF NOT FOUND OR NOT private.can_access_enterprise(v_enterprise.id, 'enterprise.manage') THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    UPDATE public.enterprises AS enterprise SET name = v_name
     WHERE enterprise.id = v_enterprise.id AND enterprise.version = p_expected_version;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'version_conflict'::TEXT, enterprise.name, enterprise.version
          FROM public.enterprises AS enterprise WHERE enterprise.id = v_enterprise.id; RETURN;
    END IF;
    RETURN QUERY SELECT 'updated'::TEXT, enterprise.name, enterprise.version
      FROM public.enterprises AS enterprise WHERE enterprise.id = v_enterprise.id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_my_enterprise_members(
 p_search TEXT DEFAULT '', p_status TEXT DEFAULT 'active', p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 20)
RETURNS TABLE(membership_id UUID, full_name TEXT, email TEXT, role TEXT, membership_status TEXT,
 membership_created_at TIMESTAMPTZ, must_change_password BOOLEAN, version BIGINT, is_self BOOLEAN,
 is_protected BOOLEAN, name_editable BOOLEAN, total_count BIGINT, unfiltered_visible_total BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx RECORD; v_query TEXT; v_offset BIGINT; v_admin BOOLEAN; v_operator BOOLEAN;
BEGIN
 IF p_page IS NULL OR p_page < 1 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100
    OR p_status IS NULL OR p_status NOT IN ('active','inactive','all') THEN
   RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023';
 END IF;
 v_query := pg_catalog.btrim(COALESCE(p_search,''));
 IF pg_catalog.length(v_query)>200 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 v_offset := (p_page::BIGINT - 1) * p_page_size::BIGINT;
 IF v_offset > 2147483647 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE='22023'; END IF;
 SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
 IF v_ctx.state <> 'business_ready' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 v_admin := private.can_access_enterprise(v_ctx.enterprise_id,'members.manage_admins');
 v_operator := private.can_access_enterprise(v_ctx.enterprise_id,'members.manage_operators');
 IF NOT (v_admin OR v_operator) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH visible AS (
   SELECT member.id AS m_id, member.user_id AS m_user_id, member.role AS m_role, member.status AS m_status,
          member.created_at AS m_created_at, member.version AS m_version, person.full_name AS p_full_name,
          person.email AS p_email, person.must_change_password AS p_must_change_password
     FROM public.enterprise_members AS member
     JOIN public.users AS person ON person.id = member.user_id
    WHERE member.enterprise_id = v_ctx.enterprise_id AND (v_admin OR member.role = 'operator')
 ), filtered AS (
   SELECT visible.* FROM visible
    WHERE (p_status = 'all' OR visible.m_status = p_status)
      AND (v_query = '' OR pg_catalog.strpos(pg_catalog.lower(visible.p_full_name), pg_catalog.lower(v_query)) > 0
           OR pg_catalog.strpos(pg_catalog.lower(visible.p_email), pg_catalog.lower(v_query)) > 0)
 )
 SELECT filtered.m_id, filtered.p_full_name, filtered.p_email, filtered.m_role, filtered.m_status,
        filtered.m_created_at, filtered.p_must_change_password, filtered.m_version,
        filtered.m_user_id = v_ctx.user_id,
        (filtered.m_user_id = v_ctx.user_id OR filtered.m_role = 'owner'),
        (filtered.m_user_id <> v_ctx.user_id AND filtered.m_role <> 'owner' AND
           (SELECT pg_catalog.count(*) FROM public.enterprise_members AS other WHERE other.user_id = filtered.m_user_id) = 1),
        (SELECT pg_catalog.count(*) FROM filtered), (SELECT pg_catalog.count(*) FROM visible)
   FROM filtered ORDER BY filtered.m_created_at DESC, filtered.m_id
   LIMIT p_page_size OFFSET v_offset;
END; $$;

CREATE OR REPLACE FUNCTION public.update_my_enterprise_member(
 p_membership_id UUID, p_full_name TEXT, p_role TEXT, p_expected_version BIGINT, p_expected_full_name TEXT)
RETURNS TABLE(status TEXT, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx RECORD; v_issuer TEXT; v_identity public.auth_identities%ROWTYPE;
 v_actor public.users%ROWTYPE; v_actor_member public.enterprise_members%ROWTYPE;
 v_enterprise public.enterprises%ROWTYPE; v_target public.enterprise_members%ROWTYPE;
 v_person public.users%ROWTYPE; v_name TEXT; v_expected_name TEXT; v_admin BOOLEAN; v_operator BOOLEAN;
BEGIN
 v_name := pg_catalog.btrim(p_full_name);
 v_expected_name := pg_catalog.btrim(p_expected_full_name);
 IF p_membership_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
    OR p_role IS NULL OR p_role NOT IN ('admin','operator')
    OR v_name IS NULL OR v_name = '' OR pg_catalog.length(v_name) > 200
    OR v_expected_name IS NULL OR v_expected_name = '' OR pg_catalog.length(v_expected_name) > 200 THEN
   RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::BIGINT; RETURN;
 END IF;
 SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
 IF v_ctx.state <> 'business_ready' THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 -- Common lock precedes actor/target row locks and prevents crossed-enterprise cycles.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
 v_issuer := auth.jwt()->>'iss';
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::TEXT, 0));
 SELECT identity.* INTO v_identity FROM public.auth_identities AS identity
 JOIN private.auth_issuer_config AS issuer ON issuer.issuer = identity.issuer AND issuer.provider = 'supabase' AND issuer.status = 'active'
 WHERE identity.provider = 'supabase' AND identity.issuer = v_issuer AND identity.subject = auth.uid()::TEXT AND identity.status = 'active' FOR UPDATE OF identity;
 IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT person.* INTO v_actor FROM public.users AS person WHERE person.id = v_identity.user_id FOR UPDATE;
 IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.must_change_password THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT member.* INTO v_actor_member FROM public.enterprise_members AS member
 JOIN public.enterprises AS enterprise ON enterprise.id = member.enterprise_id
 WHERE member.user_id = v_actor.id AND member.status = 'active' AND enterprise.status = 'active' FOR UPDATE OF member;
 IF NOT FOUND OR v_actor_member.enterprise_id <> v_ctx.enterprise_id OR
    (SELECT pg_catalog.count(*) FROM public.enterprise_members AS member JOIN public.enterprises AS enterprise ON enterprise.id = member.enterprise_id WHERE member.user_id = v_actor.id AND member.status = 'active' AND enterprise.status = 'active') <> 1 THEN
   RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN;
 END IF;
 SELECT member.* INTO v_target FROM public.enterprise_members AS member WHERE member.id = p_membership_id AND member.enterprise_id = v_actor_member.enterprise_id;
 IF NOT FOUND THEN RETURN QUERY SELECT 'target_unavailable'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT person.* INTO v_person FROM public.users AS person WHERE person.id = v_target.user_id FOR UPDATE;
 SELECT member.* INTO v_target FROM public.enterprise_members AS member WHERE member.id = p_membership_id AND member.enterprise_id = v_actor_member.enterprise_id FOR UPDATE;
 IF v_target.id IS NULL OR v_person.id IS NULL THEN RETURN QUERY SELECT 'target_unavailable'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise WHERE enterprise.id = v_actor_member.enterprise_id AND enterprise.status = 'active' FOR UPDATE OF enterprise;
 IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 IF v_target.user_id = v_actor.id OR v_target.role = 'owner' THEN RETURN QUERY SELECT 'protected'::TEXT, v_target.version; RETURN; END IF;
 IF v_expected_name IS DISTINCT FROM v_person.full_name THEN RETURN QUERY SELECT 'conflict'::TEXT, v_target.version; RETURN; END IF;
 v_admin := private.can_access_enterprise(v_enterprise.id, 'members.manage_admins');
 v_operator := private.can_access_enterprise(v_enterprise.id, 'members.manage_operators');
 IF NOT v_operator OR ((v_target.role = 'admin' OR p_role = 'admin') AND NOT v_admin)
    OR (v_actor_member.role = 'admin' AND (v_target.role <> 'operator' OR p_role <> 'operator')) THEN
   RETURN QUERY SELECT 'permission_denied'::TEXT, v_target.version; RETURN;
 END IF;
 IF v_target.version <> p_expected_version THEN RETURN QUERY SELECT 'conflict'::TEXT, v_target.version; RETURN; END IF;
 IF v_name <> v_person.full_name AND (SELECT pg_catalog.count(*) FROM public.enterprise_members AS other WHERE other.user_id = v_person.id) > 1 THEN
   RETURN QUERY SELECT 'name_not_editable'::TEXT, v_target.version; RETURN;
 END IF;
 IF v_name <> v_person.full_name THEN UPDATE public.users AS person SET full_name = v_name WHERE person.id = v_person.id; END IF;
 UPDATE public.enterprise_members AS member SET role = p_role WHERE member.id = v_target.id;
 RETURN QUERY SELECT 'success'::TEXT, v_target.version + 1;
END; $$;

CREATE OR REPLACE FUNCTION public.set_my_enterprise_member_status(
 p_membership_id UUID, p_status TEXT, p_expected_version BIGINT)
RETURNS TABLE(status TEXT, version BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx RECORD; v_issuer TEXT; v_identity public.auth_identities%ROWTYPE;
 v_actor public.users%ROWTYPE; v_actor_member public.enterprise_members%ROWTYPE;
 v_enterprise public.enterprises%ROWTYPE; v_target public.enterprise_members%ROWTYPE;
 v_person public.users%ROWTYPE; v_admin BOOLEAN; v_operator BOOLEAN;
BEGIN
 IF p_membership_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
    OR p_status IS NULL OR p_status NOT IN ('active','inactive') THEN
   RETURN QUERY SELECT 'invalid_input'::TEXT, NULL::BIGINT; RETURN;
 END IF;
 SELECT context.* INTO v_ctx FROM public.get_my_access_context() AS context;
 IF v_ctx.state <> 'business_ready' THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 -- Common lock precedes actor/target row locks and prevents crossed-enterprise cycles.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members', 0));
 v_issuer := auth.jwt()->>'iss';
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:employee-provisioning:actor:' || v_issuer || ':' || auth.uid()::TEXT, 0));
 SELECT identity.* INTO v_identity FROM public.auth_identities AS identity
 JOIN private.auth_issuer_config AS issuer ON issuer.issuer = identity.issuer AND issuer.provider = 'supabase' AND issuer.status = 'active'
 WHERE identity.provider = 'supabase' AND identity.issuer = v_issuer AND identity.subject = auth.uid()::TEXT AND identity.status = 'active' FOR UPDATE OF identity;
 IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT person.* INTO v_actor FROM public.users AS person WHERE person.id = v_identity.user_id FOR UPDATE;
 IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.must_change_password THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT member.* INTO v_actor_member FROM public.enterprise_members AS member
 JOIN public.enterprises AS enterprise ON enterprise.id = member.enterprise_id
 WHERE member.user_id = v_actor.id AND member.status = 'active' AND enterprise.status = 'active' FOR UPDATE OF member;
 IF NOT FOUND OR v_actor_member.enterprise_id <> v_ctx.enterprise_id OR
    (SELECT pg_catalog.count(*) FROM public.enterprise_members AS member JOIN public.enterprises AS enterprise ON enterprise.id = member.enterprise_id WHERE member.user_id = v_actor.id AND member.status = 'active' AND enterprise.status = 'active') <> 1 THEN
   RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN;
 END IF;
 SELECT member.* INTO v_target FROM public.enterprise_members AS member WHERE member.id = p_membership_id AND member.enterprise_id = v_actor_member.enterprise_id;
 IF NOT FOUND THEN RETURN QUERY SELECT 'target_unavailable'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT person.* INTO v_person FROM public.users AS person WHERE person.id = v_target.user_id FOR UPDATE;
 SELECT member.* INTO v_target FROM public.enterprise_members AS member WHERE member.id = p_membership_id AND member.enterprise_id = v_actor_member.enterprise_id FOR UPDATE;
 IF v_target.id IS NULL OR v_person.id IS NULL THEN RETURN QUERY SELECT 'target_unavailable'::TEXT, NULL::BIGINT; RETURN; END IF;
 SELECT enterprise.* INTO v_enterprise FROM public.enterprises AS enterprise WHERE enterprise.id = v_actor_member.enterprise_id AND enterprise.status = 'active' FOR UPDATE OF enterprise;
 IF NOT FOUND THEN RETURN QUERY SELECT 'permission_denied'::TEXT, NULL::BIGINT; RETURN; END IF;
 IF v_target.user_id = v_actor.id OR v_target.role = 'owner' THEN RETURN QUERY SELECT 'protected'::TEXT, v_target.version; RETURN; END IF;
 v_admin := private.can_access_enterprise(v_enterprise.id, 'members.manage_admins');
 v_operator := private.can_access_enterprise(v_enterprise.id, 'members.manage_operators');
 IF NOT v_operator OR (v_target.role = 'admin' AND NOT v_admin) OR (v_actor_member.role = 'admin' AND v_target.role <> 'operator') THEN
   RETURN QUERY SELECT 'permission_denied'::TEXT, v_target.version; RETURN;
 END IF;
 IF v_target.version <> p_expected_version THEN RETURN QUERY SELECT 'conflict'::TEXT, v_target.version; RETURN; END IF;
 IF v_target.status = p_status THEN RETURN QUERY SELECT 'success'::TEXT, v_target.version; RETURN; END IF;
 UPDATE public.enterprise_members AS member SET status = p_status WHERE member.id = v_target.id;
 RETURN QUERY SELECT 'success'::TEXT, v_target.version + 1;
END; $$;

ALTER FUNCTION public.increment_enterprise_version() OWNER TO postgres;
ALTER FUNCTION public.increment_enterprise_member_version() OWNER TO postgres;
ALTER FUNCTION public.get_my_enterprise() OWNER TO postgres;
ALTER FUNCTION public.update_my_enterprise_name(TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.list_my_enterprise_members(TEXT, TEXT, INTEGER, INTEGER) OWNER TO postgres;
ALTER FUNCTION public.update_my_enterprise_member(UUID, TEXT, TEXT, BIGINT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.set_my_enterprise_member_status(UUID, TEXT, BIGINT) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.increment_enterprise_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.increment_enterprise_member_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_my_enterprise() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_my_enterprise_name(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.list_my_enterprise_members(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_my_enterprise_member(UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_my_enterprise_member_status(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_enterprise(), public.update_my_enterprise_name(TEXT, BIGINT), public.list_my_enterprise_members(TEXT, TEXT, INTEGER, INTEGER), public.update_my_enterprise_member(UUID, TEXT, TEXT, BIGINT, TEXT), public.set_my_enterprise_member_status(UUID, TEXT, BIGINT) TO authenticated;
COMMIT;

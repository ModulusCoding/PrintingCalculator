-- Incremental team-management migration. Review and apply explicitly.
BEGIN;

ALTER TABLE public.enterprise_members ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.enterprise_members ADD CONSTRAINT enterprise_members_version_check CHECK (version >= 0);
CREATE FUNCTION public.increment_enterprise_member_version() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN NEW.version := OLD.version + 1; RETURN NEW; END; $$;
CREATE TRIGGER enterprise_members_increment_version BEFORE UPDATE ON public.enterprise_members FOR EACH ROW EXECUTE FUNCTION public.increment_enterprise_member_version();

DROP FUNCTION IF EXISTS public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER);
CREATE FUNCTION public.list_my_enterprise_members(p_search TEXT DEFAULT '', p_status TEXT DEFAULT 'active', p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 20)
RETURNS TABLE(membership_id UUID, full_name TEXT, email TEXT, role TEXT, membership_status TEXT, membership_created_at TIMESTAMPTZ, must_change_password BOOLEAN, version BIGINT, is_self BOOLEAN, is_protected BOOLEAN, name_editable BOOLEAN, total_count BIGINT, unfiltered_visible_total BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c RECORD; q TEXT := pg_catalog.btrim(COALESCE(p_search,'')); can_admin BOOLEAN; can_operator BOOLEAN;
BEGIN
 IF p_page<1 OR p_page_size<1 OR p_page_size>100 OR p_status IS NULL OR p_status NOT IN ('active','inactive','all') OR pg_catalog.length(q)>200 THEN RAISE EXCEPTION 'invalid_arguments' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.get_my_access_context(); IF c.state <> 'business_ready' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 can_admin:=private.can_access_enterprise(c.enterprise_id,'members.manage_admins'); can_operator:=private.can_access_enterprise(c.enterprise_id,'members.manage_operators'); IF NOT(can_admin OR can_operator) THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY WITH v AS (SELECT em.*,u.full_name,u.email,u.must_change_password FROM public.enterprise_members em JOIN public.users u ON u.id=em.user_id WHERE em.enterprise_id=c.enterprise_id AND (can_admin OR em.role='operator')), f AS (SELECT * FROM v WHERE (p_status='all' OR status=p_status) AND (q='' OR pg_catalog.strpos(pg_catalog.lower(full_name),pg_catalog.lower(q))>0 OR pg_catalog.strpos(pg_catalog.lower(email),pg_catalog.lower(q))>0)) SELECT f.id,f.full_name,f.email,f.role,f.status,f.created_at,f.must_change_password,f.version,(f.user_id=c.user_id),(f.user_id=c.user_id OR f.role='owner'),(f.user_id<>c.user_id AND f.role<>'owner' AND (SELECT count(*) FROM public.enterprise_members other WHERE other.user_id=f.user_id)=1),(SELECT count(*) FROM f),(SELECT count(*) FROM v) FROM f ORDER BY f.created_at DESC,f.id LIMIT p_page_size OFFSET (p_page-1)*p_page_size;
END; $$;

CREATE FUNCTION public.update_my_enterprise_member(p_membership_id UUID,p_full_name TEXT,p_role TEXT,p_expected_version BIGINT)
RETURNS TABLE(status TEXT, version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c RECORD; locked_c RECORD; m public.enterprise_members%ROWTYPE; u public.users%ROWTYPE; n TEXT:=pg_catalog.btrim(p_full_name); allowed BOOLEAN;
BEGIN
 IF p_membership_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_role IS NULL OR p_role NOT IN ('admin','operator') OR n IS NULL OR n='' OR pg_catalog.length(n)>200 THEN RETURN QUERY SELECT 'unknown',NULL::BIGINT; RETURN; END IF;
 SELECT * INTO c FROM public.get_my_access_context(); IF c.state<>'business_ready' THEN RETURN QUERY SELECT 'permission_denied',NULL::BIGINT; RETURN; END IF;
 SELECT * INTO m FROM public.enterprise_members WHERE id=p_membership_id AND enterprise_id=c.enterprise_id; IF NOT FOUND THEN RETURN QUERY SELECT 'target_unavailable',NULL::BIGINT; RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:member:'||m.user_id::TEXT,0));
 SELECT * INTO u FROM public.users WHERE id=m.user_id FOR UPDATE; SELECT * INTO m FROM public.enterprise_members WHERE id=m.id FOR UPDATE;
 SELECT * INTO locked_c FROM public.get_my_access_context();
 IF locked_c.state<>'business_ready' OR locked_c.enterprise_id<>c.enterprise_id OR locked_c.user_id<>c.user_id THEN RETURN QUERY SELECT 'permission_denied',NULL::BIGINT; RETURN; END IF;
 IF m.id IS NULL OR u.id IS NULL OR m.enterprise_id<>locked_c.enterprise_id THEN RETURN QUERY SELECT 'target_unavailable',NULL::BIGINT; RETURN; END IF;
 IF m.user_id=locked_c.user_id OR m.role='owner' THEN RETURN QUERY SELECT 'protected',m.version; RETURN; END IF;
 allowed := CASE WHEN m.role='admin' OR p_role='admin' THEN private.can_access_enterprise(locked_c.enterprise_id,'members.manage_admins') ELSE private.can_access_enterprise(locked_c.enterprise_id,'members.manage_operators') END;
 IF NOT allowed OR (locked_c.role='admin' AND (m.role<>'operator' OR p_role<>'operator')) THEN RETURN QUERY SELECT 'permission_denied',m.version; RETURN; END IF;
 IF m.version<>p_expected_version THEN RETURN QUERY SELECT 'conflict',m.version; RETURN; END IF;
 IF n<>u.full_name AND (SELECT count(*) FROM public.enterprise_members WHERE user_id=m.user_id)>1 THEN RETURN QUERY SELECT 'name_not_editable',m.version; RETURN; END IF;
 IF n<>u.full_name THEN UPDATE public.users SET full_name=n WHERE id=u.id; END IF;
 UPDATE public.enterprise_members SET role=p_role WHERE id=m.id; RETURN QUERY SELECT 'success',m.version+1;
END; $$;

CREATE FUNCTION public.set_my_enterprise_member_status(p_membership_id UUID,p_status TEXT,p_expected_version BIGINT)
RETURNS TABLE(status TEXT, version BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c RECORD; locked_c RECORD; m public.enterprise_members%ROWTYPE; u public.users%ROWTYPE; allowed BOOLEAN;
BEGIN
 IF p_membership_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_status IS NULL OR p_status NOT IN ('active','inactive') THEN RETURN QUERY SELECT 'unknown',NULL::BIGINT; RETURN; END IF;
 SELECT * INTO c FROM public.get_my_access_context(); IF c.state<>'business_ready' THEN RETURN QUERY SELECT 'permission_denied',NULL::BIGINT; RETURN; END IF;
 SELECT * INTO m FROM public.enterprise_members WHERE id=p_membership_id AND enterprise_id=c.enterprise_id; IF NOT FOUND THEN RETURN QUERY SELECT 'target_unavailable',NULL::BIGINT; RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:member:'||m.user_id::TEXT,0));
 SELECT * INTO u FROM public.users WHERE id=m.user_id FOR UPDATE; SELECT * INTO m FROM public.enterprise_members WHERE id=m.id FOR UPDATE;
 SELECT * INTO locked_c FROM public.get_my_access_context();
 IF locked_c.state<>'business_ready' OR locked_c.enterprise_id<>c.enterprise_id OR locked_c.user_id<>c.user_id THEN RETURN QUERY SELECT 'permission_denied',NULL::BIGINT; RETURN; END IF;
 IF m.id IS NULL OR u.id IS NULL OR m.enterprise_id<>locked_c.enterprise_id THEN RETURN QUERY SELECT 'target_unavailable',NULL::BIGINT; RETURN; END IF;
 IF m.user_id=locked_c.user_id OR m.role='owner' THEN RETURN QUERY SELECT 'protected',m.version; RETURN; END IF;
 allowed:=CASE WHEN m.role='admin' THEN private.can_access_enterprise(locked_c.enterprise_id,'members.manage_admins') ELSE private.can_access_enterprise(locked_c.enterprise_id,'members.manage_operators') END;
 IF NOT allowed OR (locked_c.role='admin' AND m.role<>'operator') THEN RETURN QUERY SELECT 'permission_denied',m.version; RETURN; END IF;
 IF m.version<>p_expected_version THEN RETURN QUERY SELECT 'conflict',m.version; RETURN; END IF;
 IF m.status=p_status THEN RETURN QUERY SELECT 'success',m.version; RETURN; END IF;
 UPDATE public.enterprise_members SET status=p_status WHERE id=m.id; RETURN QUERY SELECT 'success',m.version+1;
END; $$;

ALTER FUNCTION public.increment_enterprise_member_version() OWNER TO postgres; ALTER FUNCTION public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER) OWNER TO postgres; ALTER FUNCTION public.update_my_enterprise_member(UUID,TEXT,TEXT,BIGINT) OWNER TO postgres; ALTER FUNCTION public.set_my_enterprise_member_status(UUID,TEXT,BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.increment_enterprise_member_version(),public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER),public.update_my_enterprise_member(UUID,TEXT,TEXT,BIGINT),public.set_my_enterprise_member_status(UUID,TEXT,BIGINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_enterprise_members(TEXT,TEXT,INTEGER,INTEGER),public.update_my_enterprise_member(UUID,TEXT,TEXT,BIGINT),public.set_my_enterprise_member_status(UUID,TEXT,BIGINT) TO authenticated;
COMMIT;

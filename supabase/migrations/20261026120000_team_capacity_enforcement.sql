-- Team composition only. No pricing, authorization matrix, TTL or automatic cleanup.
-- Existing active legacy admins retain their role/status/permissions. They count
-- as operational seats ONLY when admitting a new active member/reservation.
-- An inactive legacy admin may reactivate only with capacity (product decision:
-- preservation is not permission to expand). Active admin -> operator is neutral
-- in total seats, but must still fit the operator + pending-operator sublimit.
-- No owner uniqueness constraint/index or legacy data rewrite without audit.
BEGIN;

-- Statement locks precede target row locks for direct INSERT/UPDATE. Application
-- RPCs also acquire this global lock before actor/identity/user row locks below.
-- Privileged clients must not take unrelated row locks before invoking team DML.
CREATE FUNCTION private.team_capacity_statement_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  RETURN NULL;
END $$;
ALTER FUNCTION private.team_capacity_statement_lock() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.team_capacity_statement_lock() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER team_capacity_member_statement BEFORE INSERT OR UPDATE ON public.enterprise_members
FOR EACH STATEMENT EXECUTE FUNCTION private.team_capacity_statement_lock();
CREATE TRIGGER team_capacity_operation_statement BEFORE INSERT OR UPDATE ON private.employee_provisioning_operations
FOR EACH STATEMENT EXECUTE FUNCTION private.team_capacity_statement_lock();

CREATE OR REPLACE FUNCTION private.stage6b_team_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  eid uuid;
  lim bigint;
  n bigint;
  plan public.modulus_plan_code;
  increases boolean;
  operator_increases boolean := false;
BEGIN
  eid := NEW.enterprise_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:team-limit:'||eid::text,0));
  IF TG_TABLE_NAME = 'employee_provisioning_operations' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
         OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
         OR NEW.actor_identity_id IS DISTINCT FROM OLD.actor_identity_id
         OR NEW.auth_issuer IS DISTINCT FROM OLD.auth_issuer
         OR NEW.email_normalized IS DISTINCT FROM OLD.email_normalized
         OR NEW.requested_role IS DISTINCT FROM OLD.requested_role THEN
        RAISE EXCEPTION 'team_identity_immutable' USING ERRCODE='42501';
      END IF;
      -- Existing pending admins may be marked failed for audited remediation,
      -- but cannot be finalized, revived, or otherwise made into new admins.
      IF NEW.requested_role = 'admin' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'failed' THEN
        RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
      END IF;
      increases := NEW.status = 'pending' AND OLD.status <> 'pending';
    ELSE
      IF NEW.requested_role <> 'operator' THEN
        RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
      END IF;
      increases := NEW.status = 'pending';
    END IF;
    IF NOT increases THEN RETURN NEW; END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'team_identity_immutable' USING ERRCODE='42501';
      END IF;
      IF NEW.role IS DISTINCT FROM OLD.role AND NEW.role IN ('owner','admin') THEN
        RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
      END IF;
      increases := NEW.status = 'active' AND NEW.role IN ('admin','operator')
        AND NOT (OLD.status = 'active' AND OLD.role IN ('admin','operator'));
      operator_increases := NEW.status = 'active' AND NEW.role = 'operator'
        AND NOT (OLD.status = 'active' AND OLD.role = 'operator');
    ELSE
      IF NEW.role = 'admin' THEN
        RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
      END IF;
      IF NEW.role = 'owner' THEN
        IF EXISTS (SELECT 1 FROM public.enterprise_members m WHERE m.enterprise_id=eid AND m.role='owner') THEN
          RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
        END IF;
        RETURN NEW;
      END IF;
      increases := NEW.status = 'active' AND NEW.role = 'operator';
    END IF;
    -- Active admin->operator is neutral in total seats, but must not produce
    -- a second operator or bypass Free's zero operator allowance.
    IF NOT increases AND NOT operator_increases THEN RETURN NEW; END IF;
  END IF;

  SELECT effective_plan INTO plan FROM private.resolve_enterprise_plan(eid);
  SELECT operator_limit INTO lim FROM public.modulus_plan_limits(coalesce(plan,'free'));
  IF operator_increases THEN
    SELECT count(*) INTO n FROM public.enterprise_members m
      WHERE m.enterprise_id=eid AND m.status='active' AND m.role='operator';
    n := n + (SELECT count(*) FROM private.employee_provisioning_operations o
      WHERE o.enterprise_id=eid AND o.status='pending' AND o.requested_role='operator');
    IF n >= coalesce(lim,0) THEN
      RAISE EXCEPTION 'team_limit_reached' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NOT increases THEN RETURN NEW; END IF;
  SELECT count(*) INTO n FROM public.enterprise_members m
    WHERE m.enterprise_id=eid AND m.status='active' AND m.role IN ('admin','operator');
  n := n + (SELECT count(*) FROM private.employee_provisioning_operations o
    WHERE o.enterprise_id=eid AND o.status='pending' AND o.requested_role='operator');
  IF n >= coalesce(lim,0) THEN
    RAISE EXCEPTION 'team_limit_reached' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION private.stage6b_team_limit_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.stage6b_team_limit_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER stage6b_team_limit_operation ON private.employee_provisioning_operations;
CREATE TRIGGER stage6b_team_limit_operation BEFORE INSERT OR UPDATE ON private.employee_provisioning_operations
FOR EACH ROW EXECUTE FUNCTION private.stage6b_team_limit_guard();
DROP TRIGGER stage6b_team_limit_member ON public.enterprise_members;
CREATE TRIGGER stage6b_team_limit_member BEFORE INSERT OR UPDATE ON public.enterprise_members
FOR EACH ROW EXECUTE FUNCTION private.stage6b_team_limit_guard();

-- Validate an already-reserved operation without counting its own seat twice.
-- Called only AFTER the original RPC has authenticated/authorized the actor.
CREATE FUNCTION private.team_capacity_check_pending(p_operation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o private.employee_provisioning_operations%ROWTYPE; lim bigint; n bigint; plan public.modulus_plan_code;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
  SELECT * INTO STRICT o FROM private.employee_provisioning_operations WHERE id=p_operation_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:team-limit:'||o.enterprise_id::text,0));
  IF o.status <> 'pending' THEN RETURN; END IF;
  IF o.requested_role <> 'operator' THEN
    RAISE EXCEPTION 'team_role_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT effective_plan INTO plan FROM private.resolve_enterprise_plan(o.enterprise_id);
  SELECT operator_limit INTO lim FROM public.modulus_plan_limits(coalesce(plan,'free'));
  SELECT count(*) INTO n FROM public.enterprise_members m
    WHERE m.enterprise_id=o.enterprise_id AND m.status='active' AND m.role IN ('admin','operator');
  n := n + (SELECT count(*) FROM private.employee_provisioning_operations r
    WHERE r.enterprise_id=o.enterprise_id AND r.status='pending' AND r.requested_role='operator');
  -- Includes this reservation already: equality is admissible, > is not.
  IF n > coalesce(lim,0) THEN
    RAISE EXCEPTION 'team_limit_reached' USING ERRCODE='P0001';
  END IF;
END $$;
ALTER FUNCTION private.team_capacity_check_pending(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.team_capacity_check_pending(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Signature-preserving surgical replacements of the audited original RPCs.
-- Fetching the installed definition preserves every identity/issuer/Auth-marker,
-- authorization, optimistic-version and correlation check. Each exact anchor
-- MUST occur once; unexpected catalog drift aborts the entire migration rather
-- than silently installing an unguarded or partially patched function.
DO $migration$
DECLARE
  signatures text[] := ARRAY[
    'public.start_employee_provisioning(uuid,text,text,text,text)',
    'public.finish_employee_provisioning(uuid,uuid,text,uuid,text)',
    'public.resume_employee_provisioning(uuid,uuid,text)'
  ];
  signature text;
  definition text;
  anchor text;
  replacement text;
BEGIN
  FOREACH signature IN ARRAY signatures LOOP
    SELECT replace(pg_catalog.pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n') INTO definition;
    anchor := CASE
      WHEN signature LIKE 'public.start_%' THEN E'BEGIN\n    v_issuer := pg_catalog.btrim(p_actor_issuer);'
      WHEN signature LIKE 'public.finish_%' THEN E'BEGIN\n    v_actor_issuer := pg_catalog.btrim(p_actor_issuer);'
      ELSE E'BEGIN\n    IF p_operation_id IS NULL OR p_actor_auth_user_id IS NULL'
    END;
    IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
      RAISE EXCEPTION 'unexpected team RPC definition: % (entry)', signature;
    END IF;
    replacement := replace(anchor,E'BEGIN\n',E'BEGIN\n    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''modulus:enterprise-management:all-members'',0));\n');
    definition := replace(definition,anchor,replacement);

    IF signature LIKE 'public.start_%' THEN
      -- Completed admin retries retain the original authorized read contract;
      -- pending admin retries are denied BEFORE the backend creates Auth.
      anchor := E'        -- Retomada: não criar outra operação nem outra conta Auth.';
      replacement := E'        IF v_operation.status = ''pending'' THEN\n            PERFORM private.team_capacity_check_pending(v_operation.id);\n        END IF;\n' || anchor;
      IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
        RAISE EXCEPTION 'unexpected team RPC definition: % (retry)', signature;
      END IF;
      definition := replace(definition,anchor,replacement);
      anchor := E'    IF EXISTS (\n        SELECT 1\n          FROM public.users AS u\n         WHERE u.email_normalized = v_email';
      replacement := E'    IF p_role <> ''operator'' THEN\n        RAISE EXCEPTION ''team_role_not_allowed'' USING ERRCODE=''42501'';\n    END IF;\n\n' || anchor;
    ELSIF signature LIKE 'public.finish_%' THEN
      anchor := E'    SELECT\n        au.id,\n        au.email,';
      replacement := E'    PERFORM private.team_capacity_check_pending(v_op.id);\n\n' || anchor;
      IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
        RAISE EXCEPTION 'unexpected team RPC definition: % (role)', signature;
      END IF;
      definition := replace(definition,anchor,replacement);
      anchor := E'    INSERT INTO public.enterprise_members AS em (';
      -- Consume ONLY this operation's reservation, after all original Auth and
      -- identity checks. 'failed' is a transaction-local non-reserving state:
      -- NEVER committed by finish; success writes completed, errors roll back.
      -- No GUC bypass, no reservation exemption for unrelated direct inserts.
      -- Member guard now sees active members + ALL OTHER pending reservations.
      replacement := E'    UPDATE private.employee_provisioning_operations AS reservation\n       SET status = ''failed''\n     WHERE reservation.id = v_op.id AND reservation.status = ''pending'';\n    IF NOT FOUND THEN\n        RAISE EXCEPTION ''provisioning operation cannot be finalized'' USING ERRCODE=''P0004'';\n    END IF;\n\n' || anchor;
    ELSE
      anchor := E'    -- Marker ONLY, including duplicates whose email does not match. Lock every match.';
      replacement := E'    IF v_op.status = ''pending'' THEN\n        PERFORM private.team_capacity_check_pending(v_op.id);\n    END IF;\n\n' || anchor;
    END IF;
    IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1 THEN
      RAISE EXCEPTION 'unexpected team RPC definition: % (mutation)', signature;
    END IF;
    definition := replace(definition,anchor,replacement);
    EXECUTE definition;
  END LOOP;
END $migration$;

-- CREATE OR REPLACE above preserves owners/grants/signatures and service-only
-- provisioning. Authenticated member-management RPCs retain their existing
-- return contracts; guard violations propagate with stable SQLSTATE/message.
-- Error contract:
--   42501 team_role_not_allowed: new admin, promotion, pending-admin recovery,
--                              second owner or promotion to owner.
--   42501 team_identity_immutable: relocating/reidentifying member/reservation.
--   P0001 team_limit_reached: active non-owner + pending operator capacity full.
-- Existing completed receipts are not rewritten; no auto-conversion/deactivation.
COMMIT;

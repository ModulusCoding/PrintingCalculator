-- M8 proposal ONLY. Do not apply without coverage-policy/product/security review.
BEGIN;
-- Fail closed on a mismatched baseline/owner. No applied history is rewritten.
DO $$ BEGIN
 IF current_user<>'postgres' OR to_regclass('public.enterprise_plan_access') IS NULL
 OR to_regclass('private.enterprise_authorization_receipts') IS NULL
 OR to_regprocedure('private.resolve_enterprise_plan(uuid)') IS NULL
 OR to_regprocedure('public.get_my_access_context()') IS NULL
 OR to_regprocedure('public.confirm_enterprise_paid_access(uuid,public.modulus_plan_code,timestamp with time zone,text,bigint)') IS NULL
 OR to_regprocedure('public.cancel_enterprise_paid_access(uuid,bigint)') IS NULL THEN
  RAISE EXCEPTION 'm8_baseline_or_owner_mismatch';
 END IF;
END $$;
ALTER TABLE public.enterprise_plan_access ADD COLUMN paid_from timestamptz;
ALTER TABLE public.enterprise_plan_access ADD CONSTRAINT enterprise_paid_interval_check
 CHECK (paid_from IS NULL OR (isfinite(paid_from) AND paid_until IS NOT NULL AND paid_from < paid_until));
-- Legacy grants retain their original semantics (NULL start). New integration
-- must provide both endpoints; no financial date is silently interpreted here.
CREATE OR REPLACE FUNCTION private.resolve_enterprise_plan(p_enterprise_id uuid)
RETURNS TABLE(selected_plan public.modulus_plan_code,effective_plan public.modulus_plan_code,access_state public.modulus_access_state,paid_until timestamptz,cancelled_at timestamptz,authorization_version bigint,selection_required boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.selected_plan,
 CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL
 AND (a.paid_from IS NULL OR a.paid_from<=statement_timestamp()) AND a.paid_until>statement_timestamp()
 THEN 'intermediate'::public.modulus_plan_code ELSE 'free'::public.modulus_plan_code END,
 CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL
 AND (a.paid_until<=statement_timestamp() OR a.paid_from>statement_timestamp())
 THEN 'expired'::public.modulus_access_state ELSE a.access_state END,
 a.paid_until,a.cancelled_at,a.authorization_version,(a.selected_plan IS NULL AND a.access_state='selection_required')
 FROM public.enterprise_plan_access a WHERE a.enterprise_id=p_enterprise_id
 UNION ALL SELECT NULL::public.modulus_plan_code,'free'::public.modulus_plan_code,'selection_required'::public.modulus_access_state,NULL::timestamptz,NULL::timestamptz,0::bigint,true
 WHERE p_enterprise_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.enterprise_plan_access a WHERE a.enterprise_id=p_enterprise_id) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.resolve_enterprise_plan(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.saas_billing_accounts (
 enterprise_id uuid PRIMARY KEY REFERENCES public.enterprises(id) ON DELETE RESTRICT,
 customer_id text NOT NULL UNIQUE CHECK (customer_id ~ '^cus_[A-Za-z0-9_-]+$'),
 subscription_id text UNIQUE CHECK (subscription_id ~ '^sub_[A-Za-z0-9_-]+$'),
 checkout_id uuid UNIQUE,
 authorization_id text,
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'review' CHECK (state IN ('review','pending','cancel_unknown','cancelled')),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE private.saas_billing_attempts (
 id uuid PRIMARY KEY, enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
 operation text NOT NULL CHECK (operation IN ('checkout','cancel')),
 state text NOT NULL CHECK (state IN ('reserved','unknown','confirmed','rejected')),
 provider_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE UNIQUE INDEX saas_billing_unresolved_attempt ON private.saas_billing_attempts(enterprise_id)
 WHERE state IN ('reserved','unknown');
CREATE TABLE private.saas_billing_events (
 id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
 event_type text NOT NULL CHECK (event_type ~ '^[A-Z_]{1,100}$'),
 resource_kind text NOT NULL CHECK (resource_kind IN ('payment','subscription','checkout','other')),
 resource_id text CHECK (resource_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','observed','review','failed')),
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), processed_at timestamptz
);
CREATE TABLE private.saas_billing_payments (
 payment_id text PRIMARY KEY CHECK (payment_id ~ '^pay_[A-Za-z0-9_-]+$'),
 enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(length(status)<=100), value_cents integer NOT NULL,
 due_date date NOT NULL, invoice_url text, observed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- No payload, card data, document, email, token or API key is stored.
ALTER TABLE private.saas_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.saas_billing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.saas_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.saas_billing_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.saas_billing_accounts,private.saas_billing_attempts,private.saas_billing_events,private.saas_billing_payments FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.m8_receive_billing_event(p_id text,p_type text,p_kind text,p_resource text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.saas_billing_events%ROWTYPE;
BEGIN
 INSERT INTO private.saas_billing_events(id,event_type,resource_kind,resource_id)
 VALUES(p_id,p_type,p_kind,p_resource) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO e FROM private.saas_billing_events WHERE id=p_id;
 IF e.event_type IS DISTINCT FROM p_type OR e.resource_kind IS DISTINCT FROM p_kind OR e.resource_id IS DISTINCT FROM p_resource
 THEN RAISE EXCEPTION 'event_conflict' USING ERRCODE='23505'; END IF;
END $$;

CREATE FUNCTION public.m8_billing_work(p_id text DEFAULT NULL)
RETURNS TABLE(id text,event_type text,resource_kind text,resource_id text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT e.id,e.event_type,e.resource_kind,e.resource_id FROM private.saas_billing_events e
 WHERE ((p_id IS NULL AND e.state IN ('pending','failed')) OR (p_id IS NOT NULL AND e.id=p_id))
 ORDER BY e.created_at LIMIT 20;
$$;

CREATE FUNCTION public.m8_billing_link(p_kind text,p_id text)
RETURNS TABLE(enterprise_id uuid,customer_id text,subscription_id text,checkout_id uuid,state text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT a.enterprise_id,a.customer_id,a.subscription_id,a.checkout_id,a.state FROM private.saas_billing_accounts a
 WHERE (p_kind='subscription' AND a.subscription_id=p_id) OR (p_kind='checkout' AND a.checkout_id::text=p_id);
$$;

CREATE FUNCTION public.m8_observe_billing_payment(p_event text,p_enterprise uuid,p_payment text,p_customer text,p_subscription text,p_checkout uuid,p_status text,p_value integer,p_due date,p_invoice text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE;
BEGIN
 -- Observe only. Deliberately no call to confirm_enterprise_paid_access.
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=p_enterprise FOR UPDATE;
 IF NOT FOUND OR a.customer_id IS DISTINCT FROM p_customer OR
 NOT ((a.subscription_id IS NOT NULL AND a.subscription_id=p_subscription) OR (a.checkout_id IS NOT NULL AND a.checkout_id=p_checkout))
 THEN RAISE EXCEPTION 'billing_link_conflict' USING ERRCODE='42501'; END IF;
 IF a.subscription_id IS NULL AND a.checkout_id IS NOT NULL AND a.checkout_id=p_checkout AND p_subscription IS NOT NULL THEN
  UPDATE private.saas_billing_accounts SET subscription_id=p_subscription WHERE enterprise_id=p_enterprise;
  a.subscription_id:=p_subscription;
 END IF;
 IF (p_subscription IS NOT NULL AND a.subscription_id IS DISTINCT FROM p_subscription)
 OR (p_checkout IS NOT NULL AND a.checkout_id IS DISTINCT FROM p_checkout)
 THEN RAISE EXCEPTION 'billing_link_conflict' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.saas_billing_payments WHERE payment_id=p_payment AND (enterprise_id<>p_enterprise OR generation IS DISTINCT FROM a.generation))
 THEN RAISE EXCEPTION 'billing_link_conflict' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.saas_billing_payments WHERE payment_id=p_payment AND (value_cents<>p_value OR due_date<>p_due)) THEN RAISE EXCEPTION 'immutable_payment_identity'; END IF;
 IF p_invoice IS NOT NULL AND p_invoice !~ '^https://(www\.)?(sandbox\.)?asaas\.com/i/[A-Za-z0-9_-]+$'
 THEN RAISE EXCEPTION 'invalid_invoice'; END IF;
 INSERT INTO private.saas_billing_payments(payment_id,enterprise_id,status,value_cents,due_date,invoice_url,generation)
 VALUES(p_payment,p_enterprise,p_status,p_value,p_due,p_invoice,a.generation)
 ON CONFLICT(payment_id) DO UPDATE SET status=EXCLUDED.status,value_cents=EXCLUDED.value_cents,due_date=EXCLUDED.due_date,invoice_url=EXCLUDED.invoice_url,observed_at=statement_timestamp();
 UPDATE private.saas_billing_events SET state='observed',attempts=attempts+1,processed_at=statement_timestamp() WHERE id=p_event;
END $$;
CREATE FUNCTION public.m8_billing_event_review(p_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE private.saas_billing_events SET state='review',attempts=attempts+1,processed_at=statement_timestamp() WHERE id=p_id;
$$;
REVOKE ALL ON FUNCTION public.m8_billing_event_review(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_billing_event_review(text) TO service_role;

CREATE FUNCTION public.m8_billing_event_failed(p_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE private.saas_billing_events SET state='failed',attempts=attempts+1 WHERE id=p_id;
$$;

CREATE FUNCTION public.get_my_saas_billing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; result jsonb;
BEGIN
 SELECT * INTO c FROM public.get_my_access_context();
 IF c.state IS DISTINCT FROM 'business_ready' OR c.role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('state',a.state,'payments',COALESCE((SELECT jsonb_agg(x) FROM (
 SELECT p.payment_id,p.status,p.value_cents,p.due_date,p.invoice_url FROM private.saas_billing_payments p
 WHERE p.enterprise_id=c.enterprise_id ORDER BY p.due_date DESC LIMIT 24) x),'[]'::jsonb)) INTO result
 FROM private.saas_billing_accounts a WHERE a.enterprise_id=c.enterprise_id;
 RETURN COALESCE(result,jsonb_build_object('state','not_configured','payments','[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.m8_receive_billing_event(text,text,text,text),public.m8_billing_work(text),public.m8_billing_link(text,text),public.m8_observe_billing_payment(text,uuid,text,text,text,uuid,text,integer,date,text),public.m8_billing_event_failed(text),public.get_my_saas_billing() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_receive_billing_event(text,text,text,text),public.m8_billing_work(text),public.m8_billing_link(text,text),public.m8_observe_billing_payment(text,uuid,text,text,text,uuid,text,integer,date,text),public.m8_billing_event_failed(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_saas_billing() TO authenticated;
-- Cancellation remains available for deliberately linked existing accounts even
-- while checkout is blocked. Store unknown BEFORE DELETE; crashes cannot retry it.
CREATE FUNCTION public.m8_reserve_my_cancellation(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; a private.saas_billing_accounts%ROWTYPE; r private.saas_billing_attempts%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO c FROM public.get_my_access_context();
 IF c.state IS DISTINCT FROM 'business_ready' OR c.role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=c.enterprise_id FOR UPDATE;
 IF NOT FOUND OR a.subscription_id IS NULL THEN RAISE EXCEPTION 'billing_not_linked'; END IF;
 SELECT * INTO r FROM private.saas_billing_attempts WHERE id=p_attempt;
 IF FOUND THEN
  IF r.enterprise_id<>c.enterprise_id OR r.operation<>'cancel' OR r.generation IS DISTINCT FROM a.generation THEN RAISE EXCEPTION 'attempt_conflict'; END IF;
  RETURN jsonb_build_object('state',r.state,'subscription_id',a.subscription_id);
 END IF;
 IF a.state IN ('cancel_unknown','cancelled') THEN RAISE EXCEPTION 'billing_locked'; END IF;
 INSERT INTO private.saas_billing_attempts(id,enterprise_id,operation,state,generation) VALUES(p_attempt,c.enterprise_id,'cancel','unknown',a.generation);
 UPDATE private.saas_billing_accounts SET state='cancel_unknown',updated_at=statement_timestamp() WHERE enterprise_id=c.enterprise_id;
 RETURN jsonb_build_object('state','reserved','subscription_id',a.subscription_id);
END $$;
-- Confirmation MUST NOT be callable by authenticated: provider result cannot be
-- trusted from a browser RPC. Server service boundary confirms the reservation.
CREATE FUNCTION public.m8_confirm_my_cancellation(p_attempt uuid,p_subscription text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.saas_billing_attempts%ROWTYPE; a private.saas_billing_accounts%ROWTYPE; v bigint;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO r FROM private.saas_billing_attempts WHERE id=p_attempt AND operation='cancel' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt_missing'; END IF;
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=r.enterprise_id FOR UPDATE;
 IF a.subscription_id IS DISTINCT FROM p_subscription OR a.generation IS DISTINCT FROM r.generation THEN RAISE EXCEPTION 'billing_link_conflict'; END IF;
 IF r.state='confirmed' THEN RETURN; END IF;
 IF r.state<>'unknown' OR a.state<>'cancel_unknown' THEN RAISE EXCEPTION 'attempt_conflict'; END IF;
 SELECT authorization_version INTO v FROM public.enterprise_plan_access WHERE enterprise_id=r.enterprise_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.enterprise_plan_access pa WHERE pa.enterprise_id=r.enterprise_id AND pa.selected_plan='intermediate' AND pa.authorization_id=a.authorization_id)
 THEN PERFORM public.cancel_enterprise_paid_access(r.enterprise_id,v); END IF;
 UPDATE private.saas_billing_attempts SET state='confirmed',provider_id=p_subscription WHERE id=p_attempt;
 UPDATE private.saas_billing_accounts SET state='cancelled',updated_at=statement_timestamp() WHERE enterprise_id=r.enterprise_id;
END $$;
REVOKE ALL ON FUNCTION public.m8_reserve_my_cancellation(uuid),public.m8_confirm_my_cancellation(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_reserve_my_cancellation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m8_confirm_my_cancellation(uuid,text) TO service_role;
-- Fenced per-account reconciliation: claim before authoritative GET, reject
-- expired or superseded snapshots at commit. No event can reactivate access.
ALTER TABLE private.saas_billing_accounts ADD COLUMN sync_version bigint NOT NULL DEFAULT 0;
ALTER TABLE private.saas_billing_accounts ADD COLUMN lease_token uuid;
ALTER TABLE private.saas_billing_accounts ADD COLUMN lease_until timestamptz;
CREATE UNIQUE INDEX saas_billing_authorization_uidx ON private.saas_billing_accounts(authorization_id) WHERE authorization_id IS NOT NULL;
-- Only explicit immutable financial provenance permits payment revocation.
CREATE TABLE private.saas_payment_authorizations (
 payment_id text PRIMARY KEY REFERENCES private.saas_billing_payments(payment_id) ON DELETE RESTRICT,
 authorization_id text NOT NULL UNIQUE REFERENCES private.enterprise_authorization_receipts(authorization_id) ON DELETE RESTRICT,
 enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT
);
ALTER TABLE private.saas_payment_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.saas_payment_authorizations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.m8_claim_billing_account(p_enterprise uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE;
BEGIN
 IF p_enterprise IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'invalid_billing_claim'; END IF;
 UPDATE private.saas_billing_accounts SET lease_token=p_token,lease_until=statement_timestamp()+interval '45 seconds',sync_version=sync_version+1
 WHERE enterprise_id=p_enterprise AND (lease_until IS NULL OR lease_until<=statement_timestamp()) RETURNING * INTO a;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',a.sync_version,'customer_id',a.customer_id,'subscription_id',a.subscription_id,'state',a.state);
END $$;
CREATE FUNCTION private.m8_check_billing_fence(p_enterprise uuid,p_token uuid,p_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM private.saas_billing_accounts WHERE enterprise_id=p_enterprise AND lease_token=p_token AND sync_version=p_version AND lease_until>statement_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_billing_snapshot' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION public.m8_apply_subscription_snapshot(p_enterprise uuid,p_token uuid,p_version bigint,p_subscription text,p_customer text,p_deleted boolean,p_status text,p_event text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE; v bigint;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 PERFORM private.m8_check_billing_fence(p_enterprise,p_token,p_version);
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=p_enterprise;
 IF a.customer_id IS DISTINCT FROM p_customer OR a.subscription_id IS DISTINCT FROM p_subscription THEN RAISE EXCEPTION 'billing_link_conflict'; END IF;
 IF p_deleted IS TRUE OR p_status='INACTIVE' THEN
  -- Bound authorization only: never cancel a different/newer manual grant.
  SELECT authorization_version INTO v FROM public.enterprise_plan_access WHERE enterprise_id=p_enterprise AND authorization_id=a.authorization_id AND selected_plan='intermediate' FOR UPDATE;
  IF FOUND THEN PERFORM public.cancel_enterprise_paid_access(p_enterprise,v); END IF;
  UPDATE private.saas_billing_accounts SET state='cancelled' WHERE enterprise_id=p_enterprise;
  UPDATE private.saas_billing_attempts SET state='confirmed' WHERE enterprise_id=p_enterprise AND operation='cancel' AND state='unknown';
 END IF;
 UPDATE private.saas_billing_accounts SET lease_token=NULL,lease_until=NULL WHERE enterprise_id=p_enterprise;
 IF p_event IS NOT NULL THEN UPDATE private.saas_billing_events SET state='observed',attempts=attempts+1,processed_at=statement_timestamp() WHERE id=p_event; END IF;
END $$;
CREATE FUNCTION public.m8_apply_payment_snapshot(p_enterprise uuid,p_token uuid,p_version bigint,p_event text,p_payment text,p_customer text,p_subscription text,p_checkout uuid,p_status text,p_value integer,p_due date,p_invoice text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 PERFORM private.m8_check_billing_fence(p_enterprise,p_token,p_version);
 -- The payment trigger persists the cycle or immutable reversal atomically.
 PERFORM public.m8_observe_billing_payment(p_event,p_enterprise,p_payment,p_customer,p_subscription,p_checkout,p_status,p_value,p_due,p_invoice);
 UPDATE private.saas_billing_accounts SET lease_token=NULL,lease_until=NULL WHERE enterprise_id=p_enterprise;
END $$;
CREATE FUNCTION public.m8_unknown_cancellations()
RETURNS TABLE(enterprise_id uuid,subscription_id text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT a.enterprise_id,a.subscription_id FROM private.saas_billing_accounts a WHERE a.state='cancel_unknown' AND a.subscription_id IS NOT NULL ORDER BY a.updated_at LIMIT 20;
$$;
REVOKE ALL ON FUNCTION private.m8_check_billing_fence(uuid,uuid,bigint),public.m8_claim_billing_account(uuid,uuid),public.m8_apply_subscription_snapshot(uuid,uuid,bigint,text,text,boolean,text,text),public.m8_apply_payment_snapshot(uuid,uuid,bigint,text,text,text,text,uuid,text,integer,date,text),public.m8_unknown_cancellations() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_claim_billing_account(uuid,uuid),public.m8_apply_subscription_snapshot(uuid,uuid,bigint,text,text,boolean,text,text),public.m8_apply_payment_snapshot(uuid,uuid,bigint,text,text,text,text,uuid,text,integer,date,text),public.m8_unknown_cancellations() TO service_role;
-- Only fenced wrapper can persist provider observations.
REVOKE ALL ON FUNCTION public.m8_observe_billing_payment(text,uuid,text,text,text,uuid,text,integer,date,text) FROM service_role;
-- Any cancellation transition invalidates an outstanding reconciliation lease.
CREATE FUNCTION private.m8_invalidate_cancel_lease()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.generation IS DISTINCT FROM OLD.generation OR (NEW.state IN ('cancel_unknown','cancelled') AND NEW.state IS DISTINCT FROM OLD.state) THEN
  NEW.sync_version:=OLD.sync_version+1; NEW.lease_token:=NULL; NEW.lease_until:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m8_invalidate_cancel_lease BEFORE UPDATE ON private.saas_billing_accounts
FOR EACH ROW EXECUTE FUNCTION private.m8_invalidate_cancel_lease();
REVOKE ALL ON FUNCTION private.m8_invalidate_cancel_lease() FROM PUBLIC,anon,authenticated,service_role;
-- Approved M8 final extension. Candidate only; never executed by this task.
ALTER TABLE private.saas_billing_accounts ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE private.saas_billing_accounts ADD COLUMN method text CHECK(method IN ('PIX','CREDIT_CARD'));
ALTER TABLE private.saas_billing_accounts ADD COLUMN checkout_url text;
ALTER TABLE private.saas_billing_attempts ADD COLUMN phase text NOT NULL DEFAULT 'reserved';
ALTER TABLE private.saas_billing_attempts ADD COLUMN method text;
ALTER TABLE private.saas_billing_attempts ADD COLUMN generation uuid;
ALTER TABLE private.saas_billing_attempts ADD COLUMN customer_id text;
ALTER TABLE private.saas_billing_payments ADD COLUMN generation uuid NOT NULL;
CREATE TABLE private.saas_coverage_cycles (
 payment_id text PRIMARY KEY REFERENCES private.saas_billing_payments(payment_id),
 enterprise_id uuid NOT NULL REFERENCES public.enterprises(id), generation uuid NOT NULL,
 authorization_id text NOT NULL UNIQUE REFERENCES private.enterprise_authorization_receipts(authorization_id),
 confirmed_at timestamptz NOT NULL, paid_from timestamptz NOT NULL, paid_until timestamptz NOT NULL,
 anchor_local timestamp NOT NULL, month_index integer NOT NULL CHECK(month_index>0),
 provider_due_date date NOT NULL, UNIQUE(enterprise_id,generation,provider_due_date),
 CHECK(paid_from<paid_until), UNIQUE(enterprise_id,generation,paid_from)
);
CREATE TABLE private.saas_coverage_reversals (
 payment_id text PRIMARY KEY REFERENCES private.saas_billing_payments(payment_id),
 reason text NOT NULL, observed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
-- Composite provenance prevents cross-enterprise/payment receipt association.
ALTER TABLE private.enterprise_authorization_receipts ADD CONSTRAINT m8_receipt_identity UNIQUE(authorization_id,enterprise_id);
ALTER TABLE private.saas_billing_payments ADD CONSTRAINT m8_payment_identity UNIQUE(payment_id,enterprise_id,generation);
ALTER TABLE private.saas_payment_authorizations ADD CONSTRAINT m8_origin_identity UNIQUE(payment_id,authorization_id,enterprise_id);
ALTER TABLE private.saas_payment_authorizations ADD CONSTRAINT m8_origin_receipt_fk FOREIGN KEY(authorization_id,enterprise_id) REFERENCES private.enterprise_authorization_receipts(authorization_id,enterprise_id);
ALTER TABLE private.saas_coverage_cycles ADD CONSTRAINT m8_cycle_payment_fk FOREIGN KEY(payment_id,enterprise_id,generation) REFERENCES private.saas_billing_payments(payment_id,enterprise_id,generation);
ALTER TABLE private.saas_coverage_cycles ADD CONSTRAINT m8_cycle_origin_fk FOREIGN KEY(payment_id,authorization_id,enterprise_id) REFERENCES private.saas_payment_authorizations(payment_id,authorization_id,enterprise_id);
ALTER TABLE private.saas_coverage_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.saas_coverage_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.saas_coverage_cycles,private.saas_coverage_reversals FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.m8_immutable_ledger() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'immutable_billing_ledger'; END $$;
CREATE TRIGGER m8_origins_immutable BEFORE UPDATE OR DELETE ON private.saas_payment_authorizations FOR EACH ROW EXECUTE FUNCTION private.m8_immutable_ledger();
CREATE TRIGGER m8_cycles_immutable BEFORE UPDATE OR DELETE ON private.saas_coverage_cycles FOR EACH ROW EXECUTE FUNCTION private.m8_immutable_ledger();
CREATE TRIGGER m8_reversals_immutable BEFORE UPDATE OR DELETE ON private.saas_coverage_reversals FOR EACH ROW EXECUTE FUNCTION private.m8_immutable_ledger();
REVOKE ALL ON FUNCTION private.m8_immutable_ledger() FROM PUBLIC,anon,authenticated,service_role;
-- Month offset is always applied to ORIGINAL anchor, not clamped previous month.
CREATE FUNCTION private.m8_calendar_end(p_anchor timestamp,p_month integer) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (date_trunc('month',p_anchor)+make_interval(months=>p_month)
 +make_interval(days=>least(extract(day FROM p_anchor)::integer,extract(day FROM date_trunc('month',p_anchor)+make_interval(months=>p_month+1)-interval '1 day')::integer)-1)
 +(p_anchor-date_trunc('day',p_anchor))) AT TIME ZONE 'America/Sao_Paulo';
$$;
REVOKE ALL ON FUNCTION private.m8_calendar_end(timestamp,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.m8_grant_verified_payment(p_enterprise uuid,p_payment text,p_status text,p_value integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE; prev private.saas_coverage_cycles%ROWTYPE;
 t timestamptz:=statement_timestamp(); f timestamptz; u timestamptz; anchor timestamp; n integer; v bigint; auth text; confirmation record;
BEGIN
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=p_enterprise FOR UPDATE;
 IF p_status IN ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') THEN
  INSERT INTO private.saas_coverage_reversals(payment_id,reason) VALUES(p_payment,p_status) ON CONFLICT DO NOTHING;
  RETURN;
 END IF;
 IF p_status NOT IN ('CONFIRMED','RECEIVED') OR p_value<>3990 OR a.state IN ('cancel_unknown','cancelled') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM private.saas_coverage_cycles WHERE payment_id=p_payment) OR EXISTS(SELECT 1 FROM private.saas_coverage_reversals WHERE payment_id=p_payment) THEN RETURN; END IF;
 SELECT * INTO prev FROM private.saas_coverage_cycles WHERE enterprise_id=p_enterprise AND generation=a.generation ORDER BY paid_until DESC LIMIT 1;
 IF FOUND AND prev.paid_until>=t THEN f:=prev.paid_until; anchor:=prev.anchor_local; n:=prev.month_index+1;
 ELSE f:=t; anchor:=t AT TIME ZONE 'America/Sao_Paulo'; n:=1; END IF;
 -- Never mutate access before the historical confirmer accepts a NEW receipt.
 -- u exceeds the previous end for both continuous and late renewal, so the
 -- existing paid_from remains valid through the historical UPDATE's CHECK.
 u:=private.m8_calendar_end(anchor,n); auth:='m8:'||a.generation::text||':'||p_payment;
 SELECT authorization_version INTO v FROM public.enterprise_plan_access WHERE enterprise_id=p_enterprise FOR UPDATE;
 -- Do not replace an independent still-live manual/other-generation grant.
 IF EXISTS(SELECT 1 FROM public.enterprise_plan_access pa WHERE pa.enterprise_id=p_enterprise AND pa.access_state='paid' AND pa.cancelled_at IS NULL AND pa.paid_until>t AND pa.authorization_id IS DISTINCT FROM a.authorization_id) THEN
  RAISE EXCEPTION 'independent_authorization_conflict' USING ERRCODE='40001';
 END IF;
 -- A receipt replay is historical recovery, NOT a grant. Roll back rather than
 -- attach a fresh ledger cycle to a receipt that did not change current access.
 SELECT result.* INTO confirmation FROM public.confirm_enterprise_paid_access(p_enterprise,'intermediate',u,auth,COALESCE(v,0)) AS result;
 IF confirmation.status IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'billing_receipt_conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO private.saas_payment_authorizations VALUES(p_payment,auth,p_enterprise);
 INSERT INTO private.saas_coverage_cycles VALUES(p_payment,p_enterprise,a.generation,auth,t,f,u,anchor,n,(SELECT due_date FROM private.saas_billing_payments WHERE payment_id=p_payment));
 UPDATE public.enterprise_plan_access SET paid_from=(SELECT min(paid_from) FROM private.saas_coverage_cycles WHERE enterprise_id=p_enterprise AND generation=a.generation) WHERE enterprise_id=p_enterprise;
 UPDATE private.saas_billing_accounts SET authorization_id=auth WHERE enterprise_id=p_enterprise;
END $$;
REVOKE ALL ON FUNCTION private.m8_grant_verified_payment(uuid,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
-- Observe wrapper invokes grant inside the SAME fenced transaction.
CREATE FUNCTION private.m8_after_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.m8_grant_verified_payment(NEW.enterprise_id,NEW.payment_id,NEW.status,NEW.value_cents); RETURN NEW; END $$;
CREATE TRIGGER m8_payment_grant AFTER INSERT OR UPDATE ON private.saas_billing_payments FOR EACH ROW EXECUTE FUNCTION private.m8_after_payment();
REVOKE ALL ON FUNCTION private.m8_after_payment() FROM PUBLIC,anon,authenticated,service_role;
-- Reversal of a cycle never cancels independent later cycles. Resolver evaluates
-- immutable non-reversed intervals against DB clock, including prepaid intervals.
CREATE OR REPLACE FUNCTION private.resolve_enterprise_plan(p_enterprise_id uuid)
RETURNS TABLE(selected_plan public.modulus_plan_code,effective_plan public.modulus_plan_code,access_state public.modulus_access_state,paid_until timestamptz,cancelled_at timestamptz,authorization_version bigint,selection_required boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH access AS (
 SELECT a.*, CASE WHEN a.authorization_id LIKE 'm8:%' THEN EXISTS(
 SELECT 1 FROM private.saas_coverage_cycles cy JOIN private.saas_billing_accounts ba ON ba.enterprise_id=cy.enterprise_id AND ba.generation=cy.generation
 WHERE cy.enterprise_id=a.enterprise_id AND ba.authorization_id=a.authorization_id AND ba.state<>'cancelled' AND cy.paid_from<=statement_timestamp() AND statement_timestamp()<cy.paid_until
 AND NOT EXISTS(SELECT 1 FROM private.saas_coverage_reversals r WHERE r.payment_id=cy.payment_id))
 ELSE (a.paid_from IS NULL OR a.paid_from<=statement_timestamp()) AND a.paid_until>statement_timestamp() END AS covered
 FROM public.enterprise_plan_access a WHERE a.enterprise_id=p_enterprise_id)
 SELECT a.selected_plan, CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL AND a.covered THEN 'intermediate'::public.modulus_plan_code ELSE 'free'::public.modulus_plan_code END,
 CASE WHEN a.selected_plan='intermediate' AND a.access_state='paid' AND a.cancelled_at IS NULL AND NOT a.covered THEN 'expired'::public.modulus_access_state ELSE a.access_state END,
 a.paid_until,a.cancelled_at,a.authorization_version,(a.selected_plan IS NULL AND a.access_state='selection_required') FROM access a
 UNION ALL SELECT NULL::public.modulus_plan_code,'free'::public.modulus_plan_code,'selection_required'::public.modulus_access_state,NULL::timestamptz,NULL::timestamptz,0::bigint,true
 WHERE p_enterprise_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM access) LIMIT 1;
$$;
CREATE FUNCTION public.m8_reserve_my_checkout(p_attempt uuid,p_method text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; a private.saas_billing_accounts%ROWTYPE; r private.saas_billing_attempts%ROWTYPE; g uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO c FROM public.get_my_access_context();
 IF c.state IS DISTINCT FROM 'business_ready' OR c.role IS DISTINCT FROM 'owner' OR p_method IS NULL OR p_method NOT IN ('PIX','CREDIT_CARD') THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=c.enterprise_id FOR UPDATE;
 SELECT * INTO r FROM private.saas_billing_attempts WHERE enterprise_id=c.enterprise_id AND operation='checkout' AND state IN ('reserved','unknown') ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN to_jsonb(r)||jsonb_build_object('fresh',false); END IF;
 IF a.state='cancel_unknown' THEN RAISE EXCEPTION 'billing_locked'; END IF;
 IF a.enterprise_id IS NOT NULL AND a.state<>'cancelled' AND (a.subscription_id IS NOT NULL OR a.checkout_id IS NOT NULL) THEN
 RETURN jsonb_build_object('state','existing','enterprise_id',c.enterprise_id,'customer_id',a.customer_id,'generation',a.generation,'subscription_id',a.subscription_id,'checkout_url',a.checkout_url); END IF;
 g:=gen_random_uuid();
 INSERT INTO private.saas_billing_accounts(enterprise_id,state,generation,method) VALUES(c.enterprise_id,'pending',g,p_method)
 ON CONFLICT(enterprise_id) DO UPDATE SET generation=g,state='pending',method=p_method,subscription_id=NULL,checkout_id=NULL,checkout_url=NULL,authorization_id=NULL;
 INSERT INTO private.saas_billing_attempts(id,enterprise_id,operation,state,phase,method,generation,customer_id)
 VALUES(p_attempt,c.enterprise_id,'checkout','unknown','customer',p_method,g,a.customer_id) RETURNING * INTO r;
 RETURN to_jsonb(r)||jsonb_build_object('fresh',true);
END $$;
CREATE FUNCTION public.m8_checkout_progress(p_attempt uuid,p_phase text,p_customer text DEFAULT NULL,p_subscription text DEFAULT NULL,p_checkout uuid DEFAULT NULL,p_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.saas_billing_attempts%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO r FROM private.saas_billing_attempts WHERE id=p_attempt AND operation='checkout' FOR UPDATE;
 IF NOT FOUND OR r.state<>'unknown' OR p_phase NOT IN ('resource','complete','review') OR (p_phase='resource' AND r.phase<>'customer') THEN RAISE EXCEPTION 'attempt_conflict'; END IF;
 PERFORM 1 FROM private.saas_billing_accounts WHERE enterprise_id=r.enterprise_id AND generation=r.generation AND state='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'generation_conflict'; END IF;
 UPDATE private.saas_billing_accounts SET customer_id=COALESCE(p_customer,customer_id),subscription_id=COALESCE(p_subscription,subscription_id),checkout_id=COALESCE(p_checkout,checkout_id),checkout_url=COALESCE(p_url,checkout_url) WHERE enterprise_id=r.enterprise_id;
 UPDATE private.saas_billing_attempts SET phase=p_phase,customer_id=COALESCE(p_customer,customer_id),state=CASE WHEN p_phase='complete' THEN 'confirmed' ELSE 'unknown' END WHERE id=p_attempt;
END $$;
CREATE FUNCTION public.m8_scan_accounts(p_enterprise uuid DEFAULT NULL) RETURNS TABLE(enterprise_id uuid,customer_id text,subscription_id text,checkout_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT a.enterprise_id,a.customer_id,a.subscription_id,a.checkout_id FROM private.saas_billing_accounts a WHERE a.state='pending' AND a.customer_id IS NOT NULL AND (p_enterprise IS NULL OR a.enterprise_id=p_enterprise) ORDER BY a.updated_at LIMIT 20 $$;
REVOKE ALL ON FUNCTION public.m8_reserve_my_checkout(uuid,text),public.m8_checkout_progress(uuid,text,text,text,uuid,text),public.m8_scan_accounts(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_reserve_my_checkout(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m8_checkout_progress(uuid,text,text,text,uuid,text),public.m8_scan_accounts(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.get_my_saas_billing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; result jsonb;
BEGIN
 SELECT * INTO c FROM public.get_my_access_context();
 IF c.state IS DISTINCT FROM 'business_ready' OR c.role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('state',a.state,'method',a.method,'checkout_url',a.checkout_url,
 'selected_plan',(SELECT selected_plan FROM private.resolve_enterprise_plan(c.enterprise_id)),
 'effective_plan',(SELECT effective_plan FROM private.resolve_enterprise_plan(c.enterprise_id)),
 'coverage',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT cy.paid_from,cy.paid_until,EXISTS(SELECT 1 FROM private.saas_coverage_reversals r WHERE r.payment_id=cy.payment_id) AS reversed FROM private.saas_coverage_cycles cy WHERE cy.enterprise_id=c.enterprise_id AND cy.generation=a.generation ORDER BY cy.paid_from DESC LIMIT 24) x),
 'next_due_date',(SELECT min(due_date) FROM private.saas_billing_payments WHERE enterprise_id=c.enterprise_id AND status IN ('PENDING','OVERDUE')),
 'payments',COALESCE((SELECT jsonb_agg(x) FROM (SELECT p.payment_id,p.status,p.value_cents,p.due_date,p.invoice_url FROM private.saas_billing_payments p WHERE p.enterprise_id=c.enterprise_id ORDER BY p.due_date DESC LIMIT 24) x),'[]'::jsonb)) INTO result FROM private.saas_billing_accounts a WHERE a.enterprise_id=c.enterprise_id;
 RETURN COALESCE(result,jsonb_build_object('state','not_configured','payments','[]'::jsonb));
END $$;
-- Resumable fair page queue. A claim advances a monotonic fairness ticket even
-- on failure; checkpoint advances ONLY together with durable page notifications.
CREATE SEQUENCE private.m8_scan_ticket;
REVOKE ALL ON SEQUENCE private.m8_scan_ticket FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_ticket bigint NOT NULL DEFAULT 0;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_offset integer NOT NULL DEFAULT 0 CHECK(scan_offset>=0);
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_generation uuid;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_subscription text;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_version bigint NOT NULL DEFAULT 0;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_token uuid;
ALTER TABLE private.saas_billing_accounts ADD COLUMN scan_until timestamptz;
ALTER TABLE private.saas_billing_events ADD COLUMN enterprise_id uuid REFERENCES public.enterprises(id);
CREATE FUNCTION public.m8_claim_scan_page(p_enterprise uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE;
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'invalid_scan_claim'; END IF;
 SELECT * INTO a FROM private.saas_billing_accounts
 WHERE state IN ('pending','cancel_unknown') AND customer_id IS NOT NULL AND (subscription_id IS NOT NULL OR checkout_id IS NOT NULL)
 AND (p_enterprise IS NULL OR enterprise_id=p_enterprise) AND (scan_until IS NULL OR scan_until<=statement_timestamp())
 ORDER BY scan_ticket,enterprise_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE private.saas_billing_accounts SET scan_ticket=nextval('private.m8_scan_ticket'),scan_version=scan_version+1,
 scan_token=p_token,scan_until=statement_timestamp()+interval '45 seconds',
 scan_offset=CASE WHEN scan_generation IS DISTINCT FROM generation OR scan_subscription IS DISTINCT FROM subscription_id THEN 0 ELSE scan_offset END,
 scan_generation=generation,scan_subscription=subscription_id WHERE enterprise_id=a.enterprise_id RETURNING * INTO a;
 RETURN jsonb_build_object('enterprise_id',a.enterprise_id,'generation',a.generation,'customer_id',a.customer_id,'subscription_id',a.subscription_id,'checkout_id',a.checkout_id,'scan_offset',a.scan_offset,'scan_version',a.scan_version);
END $$;
CREATE FUNCTION public.m8_commit_scan_page(p_enterprise uuid,p_generation uuid,p_token uuid,p_version bigint,p_offset integer,p_count integer,p_more boolean,p_payments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a private.saas_billing_accounts%ROWTYPE; item jsonb;
BEGIN
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=p_enterprise FOR UPDATE;
 IF NOT FOUND OR a.generation IS DISTINCT FROM p_generation OR a.scan_generation IS DISTINCT FROM p_generation OR a.scan_subscription IS DISTINCT FROM a.subscription_id
 OR p_token IS NULL OR p_version IS NULL OR p_offset IS NULL OR a.scan_token IS DISTINCT FROM p_token OR a.scan_version<>p_version OR a.scan_until IS NULL OR a.scan_until<=statement_timestamp() OR a.scan_offset<>p_offset
 OR a.state NOT IN ('pending','cancel_unknown') THEN RAISE EXCEPTION 'stale_scan_page' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' OR p_count IS NULL OR p_more IS NULL THEN RAISE EXCEPTION 'invalid_scan_page'; END IF;
 IF p_count<>jsonb_array_length(p_payments) OR p_count<0 OR p_count>100 OR (p_more AND p_count<>100) THEN RAISE EXCEPTION 'invalid_scan_page'; END IF;
 IF a.subscription_id IS NOT NULL THEN
  INSERT INTO private.saas_billing_events(id,event_type,resource_kind,resource_id,enterprise_id)
  VALUES('scan-sub:'||p_generation::text||':'||a.subscription_id,'SUBSCRIPTION_SCAN','subscription',a.subscription_id,p_enterprise)
  ON CONFLICT(id) DO UPDATE SET state=CASE WHEN private.saas_billing_events.state='observed' THEN 'pending' ELSE private.saas_billing_events.state END;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
  IF (item->>'id' ~ '^pay_[A-Za-z0-9_-]+$' AND item->>'status' ~ '^[A-Z_]{1,100}$') IS NOT TRUE THEN RAISE EXCEPTION 'invalid_scan_item'; END IF;
  INSERT INTO private.saas_billing_events(id,event_type,resource_kind,resource_id,enterprise_id)
  VALUES('scan:'||p_generation::text||':'||(item->>'id')||':'||(item->>'status'),'PAYMENT_SCAN','payment',item->>'id',p_enterprise)
  ON CONFLICT(id) DO UPDATE SET state=CASE WHEN private.saas_billing_events.state='observed' THEN 'pending' ELSE private.saas_billing_events.state END;
 END LOOP;
 UPDATE private.saas_billing_accounts SET scan_offset=CASE WHEN p_more THEN p_offset+p_count ELSE 0 END,scan_token=NULL,scan_until=NULL WHERE enterprise_id=p_enterprise;
END $$;
CREATE FUNCTION public.m8_billing_work_scoped(p_id text,p_enterprise uuid)
RETURNS TABLE(id text,event_type text,resource_kind text,resource_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY WITH picked AS (
 SELECT e.id FROM private.saas_billing_events e
 WHERE ((p_id IS NULL AND e.state IN ('pending','failed')) OR (p_id IS NOT NULL AND e.id=p_id))
 AND (p_enterprise IS NULL OR e.enterprise_id=p_enterprise)
 ORDER BY e.attempts,e.created_at,e.id FOR UPDATE SKIP LOCKED LIMIT 20)
 UPDATE private.saas_billing_events e SET attempts=e.attempts+1 FROM picked WHERE e.id=picked.id
 RETURNING e.id,e.event_type,e.resource_kind,e.resource_id;
END $$;
REVOKE ALL ON FUNCTION public.m8_claim_scan_page(uuid,uuid),public.m8_commit_scan_page(uuid,uuid,uuid,bigint,integer,integer,boolean,jsonb),public.m8_billing_work_scoped(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_claim_scan_page(uuid,uuid),public.m8_commit_scan_page(uuid,uuid,uuid,bigint,integer,integer,boolean,jsonb),public.m8_billing_work_scoped(text,uuid) TO service_role;
-- Cancel pre-payment checkout via documented POST, not DELETE subscription.
ALTER TABLE private.saas_billing_attempts DROP CONSTRAINT saas_billing_attempts_operation_check;
ALTER TABLE private.saas_billing_attempts ADD CONSTRAINT saas_billing_attempts_operation_check CHECK(operation IN ('checkout','cancel','checkout_cancel'));
CREATE FUNCTION public.m8_reserve_my_checkout_cancel(p_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c record; a private.saas_billing_accounts%ROWTYPE; r private.saas_billing_attempts%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO c FROM public.get_my_access_context();
 IF c.state IS DISTINCT FROM 'business_ready' OR c.role IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'unauthorized'; END IF;
 SELECT * INTO a FROM private.saas_billing_accounts WHERE enterprise_id=c.enterprise_id FOR UPDATE;
 IF NOT FOUND OR a.checkout_id IS NULL OR a.subscription_id IS NOT NULL THEN RAISE EXCEPTION 'checkout_not_cancellable'; END IF;
 SELECT * INTO r FROM private.saas_billing_attempts WHERE id=p_attempt;
 IF FOUND THEN
 IF r.enterprise_id<>c.enterprise_id OR r.operation<>'checkout_cancel' OR r.generation IS DISTINCT FROM a.generation THEN RAISE EXCEPTION 'attempt_conflict'; END IF;
 RETURN jsonb_build_object('state',r.state,'checkout_id',a.checkout_id);
 END IF;
 IF a.state<>'pending' THEN RAISE EXCEPTION 'billing_locked'; END IF;
 INSERT INTO private.saas_billing_attempts(id,enterprise_id,operation,state,generation) VALUES(p_attempt,c.enterprise_id,'checkout_cancel','unknown',a.generation);
 UPDATE private.saas_billing_accounts SET state='cancel_unknown' WHERE enterprise_id=c.enterprise_id;
 RETURN jsonb_build_object('state','reserved','checkout_id',a.checkout_id);
END $$;
CREATE FUNCTION public.m8_confirm_checkout_cancel(p_attempt uuid,p_checkout uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.saas_billing_attempts%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('modulus:enterprise-management:all-members',0));
 SELECT * INTO r FROM private.saas_billing_attempts WHERE id=p_attempt AND operation='checkout_cancel' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt_missing'; END IF;
 IF r.state='confirmed' THEN RETURN; END IF;
 PERFORM 1 FROM private.saas_billing_accounts WHERE enterprise_id=r.enterprise_id AND generation=r.generation AND checkout_id=p_checkout AND subscription_id IS NULL AND state='cancel_unknown' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_conflict'; END IF;
 UPDATE private.saas_billing_accounts SET state='cancelled' WHERE enterprise_id=r.enterprise_id;
 UPDATE private.saas_billing_attempts SET state='confirmed' WHERE id=p_attempt;
END $$;
REVOKE ALL ON FUNCTION public.m8_reserve_my_checkout_cancel(uuid),public.m8_confirm_checkout_cancel(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.m8_reserve_my_checkout_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.m8_confirm_checkout_cancel(uuid,uuid) TO service_role;
-- Retire the former first-20-only API; all production scans use durable queue.
REVOKE ALL ON FUNCTION public.m8_scan_accounts(uuid),public.m8_billing_work(text) FROM service_role;
COMMIT;

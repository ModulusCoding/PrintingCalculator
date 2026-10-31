-- Self-contained rollback regression; migrations through 20261026050000 required.
-- ONLY run against an explicitly authorized disposable database, as postgres:
-- psql -X -v ON_ERROR_STOP=1 -f tests/sql/20261026050000_initial_free_plan_assertions.sql
-- Includes its sibling fixture via psql \ir (relative to this script).
-- No SQL was executed while authoring this suite.
\set ON_ERROR_STOP on
BEGIN;
\ir 20261026050000_initial_free_plan_fixture.sql

-- Catalog contract: no target enterprise or plan parameter and no paid overload.
SELECT pg_temp.check_true('only zero-argument selector',
 (SELECT count(*)=1 AND bool_and(pronargs=0 AND prosecdef)
  FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='select_initial_free_plan'));
SELECT pg_temp.check_true('aggregate-only bigint result',
 pg_get_function_result('public.get_my_plan_usage()'::regprocedure)=
 'TABLE(products bigint, shared_materials bigint, operators bigint, printers bigint)');
SELECT pg_temp.check_true('RPC grants',
 has_function_privilege('authenticated','public.select_initial_free_plan()','EXECUTE')
 AND has_function_privilege('authenticated','public.get_my_plan_usage()','EXECUTE')
 AND NOT has_function_privilege('anon','public.select_initial_free_plan()','EXECUTE')
 AND NOT has_function_privilege('service_role','public.select_initial_free_plan()','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_my_plan_usage()','EXECUTE')
 AND NOT has_function_privilege('service_role','public.get_my_plan_usage()','EXECUTE'));

-- Use real authenticated execution for public calls. Privileged inspection and
-- fixture setup occur separately; no direct paid-table grants are needed.
GRANT SELECT ON _initial_free_fixture TO authenticated;
SELECT pg_temp.jwt('owner_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('absent selection usage includes archives, excludes deleted/reference rows',
 (SELECT count(*)=1 AND bool_and((products,shared_materials,operators,printers)=(2::bigint,4::bigint,1::bigint,2::bigint))
 FROM public.get_my_plan_usage()));
SELECT pg_temp.check_true('absent row selected exactly once',
 (SELECT count(*)=1 AND min(status)='selected' FROM public.select_initial_free_plan()));
RESET ROLE;
CREATE TEMP TABLE _selected AS SELECT to_jsonb(a) AS row FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a');
CREATE TEMP TABLE _audit_selected AS SELECT to_jsonb(a) AS row FROM public.enterprise_plan_access_audit a WHERE enterprise_id=pg_temp.f('a');
SELECT pg_temp.check_true('selected row fields and attribution',
 (SELECT selected_plan='free' AND effective_plan='free' AND access_state='free'
 AND authorization_version=1 AND changed_by=pg_temp.f('owner_a') AND authorization_id IS NULL
 AND paid_until IS NULL AND cancelled_at IS NULL AND changed_at IS NOT NULL
 FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('one attributed free_selected audit',
 (SELECT count(*)=1 AND bool_and(operation='free_selected' AND selected_plan='free'
 AND effective_plan='free' AND access_state='free' AND authorization_version=1
 AND changed_by=pg_temp.f('owner_a') AND integration_actor IS NULL
 AND paid_until IS NULL AND cancelled_at IS NULL AND authorization_id IS NULL)
 FROM public.enterprise_plan_access_audit WHERE enterprise_id=pg_temp.f('a')));
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('repetition is no_change',
 (SELECT count(*)=1 AND min(status)='no_change' FROM public.select_initial_free_plan()));
SELECT pg_temp.check_true('second repetition is no_change',
 (SELECT count(*)=1 AND min(status)='no_change' FROM public.select_initial_free_plan()));
RESET ROLE;
SELECT pg_temp.check_true('entire row stable including version and timestamps',
 (SELECT to_jsonb(a)=(SELECT row FROM _selected) FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('entire audit stable',
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.enterprise_plan_access_audit a WHERE enterprise_id=pg_temp.f('a'))=
 (SELECT jsonb_agg(row ORDER BY (row->>'id')::bigint) FROM _audit_selected));
SELECT pg_temp.check_true('A did not select B',NOT EXISTS(SELECT 1 FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('b')));

-- Explicit selection_required uses the existing version, not a reset to 1.
INSERT INTO public.enterprise_plan_access(enterprise_id,authorization_version) VALUES (pg_temp.f('b'),7);
SELECT pg_temp.jwt('owner_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('B usage is B only',
 (SELECT count(*)=1 AND bool_and((products,shared_materials,operators,printers)=(1::bigint,2::bigint,0::bigint,1::bigint)) FROM public.get_my_plan_usage()));
SELECT pg_temp.check_true('explicit selection_required selected',
 (SELECT count(*)=1 AND min(status)='selected' FROM public.select_initial_free_plan()));
RESET ROLE;
SELECT pg_temp.check_true('explicit selection increments existing version',
 (SELECT authorization_version=8 AND selected_plan='free' AND changed_by=pg_temp.f('owner_b')
 FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('b')));
SELECT pg_temp.check_true('B selection leaves A unchanged',
 (SELECT to_jsonb(a)=(SELECT row FROM _selected) FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));

-- Operator AND admin denied both owner-only endpoints; claims resolve real users.
SELECT pg_temp.jwt('operator');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('operator selection','SELECT * FROM public.select_initial_free_plan()','42501');
SELECT pg_temp.expect_error('operator usage','SELECT * FROM public.get_my_plan_usage()','42501');
RESET ROLE;
SELECT pg_temp.jwt('admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('admin selection','SELECT * FROM public.select_initial_free_plan()','42501');
SELECT pg_temp.expect_error('admin usage','SELECT * FROM public.get_my_plan_usage()','42501');
RESET ROLE;
SELECT pg_temp.jwt('owner_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('intermediate parameter rejected',
 'SELECT * FROM public.select_initial_free_plan(''intermediate''::public.modulus_plan_code)','42883');
SELECT pg_temp.expect_error('advanced parameter rejected',
 'SELECT * FROM public.select_initial_free_plan(''advanced''::public.modulus_plan_code)','42883');
SELECT pg_temp.expect_error('foreign enterprise parameter rejected',
 format('SELECT * FROM public.select_initial_free_plan(%L::uuid)',pg_temp.f('b')),'42883');
RESET ROLE;
SELECT pg_temp.check_true('denied calls and invalid arguments leave A row stable',
 (SELECT to_jsonb(a)=(SELECT row FROM _selected) FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('still exactly one audit per tenant',
 (SELECT count(*)=2 FROM public.enterprise_plan_access_audit WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'))));

-- Subtransactions reset scenario setup and preserve immutable audit history.
-- Calls below run as the authenticated role even though setup is privileged.
DO $$
DECLARE scenario text; before_row jsonb; before_audit jsonb; result text;
BEGIN
 FOREACH scenario IN ARRAY ARRAY['paid','clock_expired_paid','expired','cancelled','receipt_history','paid_audit_history','cancelled_audit_history'] LOOP
  BEGIN
   DELETE FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a');
   IF scenario IN ('paid','clock_expired_paid','expired','cancelled') THEN
    INSERT INTO public.enterprise_plan_access(enterprise_id,selected_plan,effective_plan,access_state,
      paid_until,cancelled_at,authorization_id,authorization_version,changed_by)
    VALUES (pg_temp.f('a'),'intermediate',
      CASE WHEN scenario IN ('paid','clock_expired_paid') THEN 'intermediate'::public.modulus_plan_code ELSE 'free'::public.modulus_plan_code END,
      CASE WHEN scenario='clock_expired_paid' THEN 'paid'::public.modulus_access_state ELSE scenario::public.modulus_access_state END,
      CASE WHEN scenario='paid' THEN clock_timestamp()+interval '1 day' ELSE clock_timestamp()-interval '1 day' END,
      CASE WHEN scenario='cancelled' THEN clock_timestamp() END,
      'initial-free-'||pg_temp.f('a')::text,12,pg_temp.f('owner_a'));
   ELSIF scenario='receipt_history' THEN
    INSERT INTO private.enterprise_authorization_receipts(authorization_id,payload,authorization_version,enterprise_id)
    VALUES ('initial-free-history-'||pg_temp.f('a')::text,'{}',1,pg_temp.f('a'));
   ELSE
    -- Explicit unselected row with historical billing audit also cannot reactivate.
    INSERT INTO public.enterprise_plan_access(enterprise_id) VALUES (pg_temp.f('a'));
    INSERT INTO public.enterprise_plan_access_audit(enterprise_id,operation,selected_plan,effective_plan,
      access_state,authorization_version,integration_actor)
    VALUES (pg_temp.f('a'),CASE WHEN scenario='paid_audit_history' THEN 'paid_confirmed' ELSE 'cancelled' END,
      'intermediate','free','expired',11,'initial-free-test');
   END IF;
   SELECT to_jsonb(a) INTO before_row FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a');
   SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_audit FROM public.enterprise_plan_access_audit a WHERE enterprise_id=pg_temp.f('a');
   SET LOCAL ROLE authenticated;
   SELECT status INTO STRICT result FROM public.select_initial_free_plan();
   RESET ROLE;
   PERFORM pg_temp.check_true(scenario||' returns conflict',result='conflict');
   PERFORM pg_temp.check_true(scenario||' row unchanged',before_row IS NOT DISTINCT FROM
     (SELECT to_jsonb(a) FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));
   PERFORM pg_temp.check_true(scenario||' audit unchanged',before_audit IS NOT DISTINCT FROM
     (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.enterprise_plan_access_audit a WHERE enterprise_id=pg_temp.f('a')));
   -- Deliberate exception rolls back only this scenario, not the whole suite.
   RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback scenario';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
END $$;
SELECT pg_temp.check_true('all fixture scenarios restored',
 (SELECT to_jsonb(a)=(SELECT row FROM _selected) FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));
ROLLBACK;
-- Identity sequences may advance despite rollback; no fixture rows persist.

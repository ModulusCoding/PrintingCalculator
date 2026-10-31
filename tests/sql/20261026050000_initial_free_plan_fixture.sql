-- Shared fixture ONLY: caller must BEGIN and ultimately ROLLBACK (or use a
-- disposable database per the concurrency guide). Run as postgres, never via API.
-- No auth.users rows, existing tenant data, policies or triggers are modified.
CREATE TEMP TABLE _initial_free_fixture(k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO _initial_free_fixture SELECT k,gen_random_uuid()
FROM unnest(ARRAY['a','b','owner_a','owner_b','operator','admin','inactive_operator','material_a','material_b']) k;
CREATE FUNCTION pg_temp.f(k text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pg_temp._initial_free_fixture WHERE _initial_free_fixture.k=$1 $$;
CREATE FUNCTION pg_temp.check_true(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(label text, statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
  IF caught IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: SQLSTATE %, expected %',label,coalesce(caught,'success'),expected;
  END IF;
END $$;
CREATE FUNCTION pg_temp.jwt(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.f(who)::text,
 'iss','initial-free-test-'||pg_temp.f('a')::text,'role','authenticated')::text,true);
END $$;
INSERT INTO private.auth_issuer_config(issuer,provider,status)
VALUES ('initial-free-test-'||pg_temp.f('a')::text,'supabase','active');
INSERT INTO public.enterprises(id,name,status)
SELECT id,'Initial Free fixture '||k,'active' FROM _initial_free_fixture WHERE k IN ('a','b');
INSERT INTO public.users(id,full_name,email,status,must_change_password)
SELECT id,'Initial Free '||k,id::text||'@example.test','active',false
FROM _initial_free_fixture WHERE k IN ('owner_a','owner_b','operator','admin','inactive_operator');
INSERT INTO public.auth_identities(provider,issuer,subject,user_id,status)
SELECT 'supabase','initial-free-test-'||pg_temp.f('a')::text,id::text,id,'active'
FROM _initial_free_fixture WHERE k IN ('owner_a','owner_b','operator','admin','inactive_operator');
INSERT INTO public.enterprise_members(enterprise_id,user_id,role,status) VALUES
(pg_temp.f('a'),pg_temp.f('owner_a'),'owner','active'),
(pg_temp.f('b'),pg_temp.f('owner_b'),'owner','active'),
(pg_temp.f('a'),pg_temp.f('operator'),'operator','active'),
(pg_temp.f('a'),pg_temp.f('admin'),'admin','active'),
(pg_temp.f('a'),pg_temp.f('inactive_operator'),'operator','inactive');
-- A: two live registrations (including archived), one soft-deleted of each kind.
-- B: one of each; distinct counts expose cross-tenant leakage.
INSERT INTO public.products(enterprise_id,name,active,deleted_at)
SELECT pg_temp.f(t), 'Product '||n, n=1, CASE WHEN n=3 THEN clock_timestamp() END
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.materials(id,enterprise_id,name,material_type,reference_weight_grams,reference_price)
VALUES (pg_temp.f('material_a'),pg_temp.f('a'),'Reference A','PLA',1000,20),
       (pg_temp.f('material_b'),pg_temp.f('b'),'Reference B','PLA',1000,20);
INSERT INTO public.filament_spools(enterprise_id,material_id,internal_identifier,
 original_filament_grams,current_balance_grams,purchase_price,active,deleted_at,
 create_attempt_id,create_actor_id,create_internal_identifier,create_initial_balance_grams,create_purchase_price)
SELECT pg_temp.f(t),pg_temp.f('material_'||t),'Spool '||n,1000,0,20,n=1,
 CASE WHEN n=3 THEN clock_timestamp() END,gen_random_uuid(),pg_temp.f('owner_'||t),'Spool '||n,0,20
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.general_materials(enterprise_id,name,control_unit,reference_quantity,reference_price,
 active,deleted_at,create_actor_id,create_attempt_id,create_payload)
SELECT pg_temp.f(t),'General '||n,'unidade',1,1,n=1,
 CASE WHEN n=3 THEN clock_timestamp() END,pg_temp.f('owner_'||t),gen_random_uuid(),'{}'::jsonb
FROM (VALUES ('a',3),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;
INSERT INTO public.printers(enterprise_id,name,purchase_price,estimated_life_hours,average_power_watts,active)
SELECT pg_temp.f(t),'Printer '||n,100,1000,100,n=1
FROM (VALUES ('a',2),('b',1)) v(t,total) CROSS JOIN LATERAL generate_series(1,total) n;

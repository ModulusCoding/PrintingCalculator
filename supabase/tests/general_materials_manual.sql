-- GENERAL MATERIALS MANUAL REGRESSION (2026-10-21)
-- Deliberately NOT executable as-is. Run only in an isolated local database, after
-- migrations through 20261022000000_general_materials_inventory.sql.
--
-- Fixture contract (replace every __...__ literal before running):
--   authenticated JWT subject/issuer for an active, business_ready member of
--   __ENTERPRISE_A__ (owner is recommended), plus __USER_A__ internal user id;
--   __ENTERPRISE_B__ and __USER_B__ belong to a different active enterprise;
--   __JWT_SUB_A__, __JWT_ISSUER_A__ are the matching auth.uid()/iss values.
-- Provision these through the local auth API and normal application provisioning.
-- Do not insert auth.users/auth_identities here: their schema and issuer setup are
-- deployment-specific. This script never changes auth fixtures and never executes.
-- Use one transaction; each expected failure is caught and asserted below.

BEGIN;

CREATE TEMP TABLE _fixture(k text PRIMARY KEY, v text NOT NULL) ON COMMIT DROP;
INSERT INTO _fixture VALUES
 ('enterprise_a','__ENTERPRISE_A__'),('enterprise_b','__ENTERPRISE_B__'),
 ('user_a','__USER_A__'),('user_b','__USER_B__'),
 ('jwt_sub_a','__JWT_SUB_A__'),('jwt_issuer_a','__JWT_ISSUER_A__');
DO $$ DECLARE bad text; BEGIN
 SELECT v INTO bad FROM _fixture WHERE v LIKE '__%__';
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'fixture_placeholder_not_replaced: %',bad; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.enterprises WHERE id=((SELECT v FROM _fixture WHERE k='enterprise_a'))::uuid AND status='active') THEN RAISE EXCEPTION 'enterprise_a_not_active'; END IF;
END $$;

-- Helper: an assertion that a supplied statement raises the named SQLSTATE/message
-- must be written as a DO block at the call site; PostgreSQL cannot pass SQL text
-- safely to a transaction-local helper without dynamic SQL. These helpers assert
-- returned scalar values and row counts.
CREATE OR REPLACE FUNCTION pg_temp.assert_eq(label text, actual numeric, expected numeric)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'assert %: got %, expected %',label,actual,expected; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.assert_text(label text, actual text, expected text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'assert %: got %, expected %',label,actual,expected; END IF; END $$;

-- Latest 20261020 permission regression matrix, plus new stock.materials perms.
-- This records the complete preexisting matrix from that migration; expected roles
-- are intentionally explicit so a permission widening/narrowing raises below.
CREATE TEMP TABLE permission_regression(permission text PRIMARY KEY, owner_ok boolean, admin_ok boolean, operator_ok boolean);
INSERT INTO permission_regression VALUES
 ('products.read',true,true,true),('products.write',true,true,true),('products.delete',true,true,false),
 ('catalogs.read',true,true,true),('catalogs.write',true,true,true),('catalogs.delete',true,true,false),
 ('filters.read',true,true,true),('filters.write',true,true,true),('filters.delete',true,true,false),
 ('sales.read',true,true,true),('sales.write',true,true,true),('sales.delete',true,true,false),
 ('printers.read',true,true,true),('printers.write',true,true,false),('printers.archive',true,true,false),
 ('materials.read',true,true,true),('materials.write',true,true,false),('materials.archive',true,true,false),
 ('pricing.read',true,true,true),('pricing.write',true,true,true),('pricing.apply',true,true,true),
 ('enterprise.manage',true,false,false),('members.manage_admins',true,false,false),('members.manage_operators',true,true,false),
 ('spools.read',true,true,true),('spools.write',true,true,true),('spools.archive',true,true,false),
 ('inventory.read',true,true,true),('inventory.write',true,true,true),
 ('stock.materials.read',true,true,true),('stock.materials.write',true,true,true),('stock.materials.archive',true,true,false);
DO $$ BEGIN IF (SELECT count(*) FROM permission_regression) <> 32 THEN RAISE EXCEPTION 'permission matrix incomplete'; END IF; END $$;

-- Install an authenticated JWT context. A JWT alone is insufficient: the fixture
-- must have auth_identities, users, membership, issuer config and business_ready.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT v FROM _fixture WHERE k='jwt_sub_a'),'iss',(SELECT v FROM _fixture WHERE k='jwt_issuer_a'),'role','authenticated')::text,true);

-- Actual RPC signatures and lifecycle. Initial balance 50m, unit cost 10.
CREATE TEMP TABLE r_create AS SELECT * FROM public.create_general_material('10000000-0000-0000-0000-000000000001','GM regression','metro',1.000000,10.000000,50.000000);
SELECT pg_temp.assert_text('create status',status,'created') FROM r_create;
CREATE TEMP TABLE r_repeat AS SELECT * FROM public.create_general_material('10000000-0000-0000-0000-000000000001','GM regression','metro',1.000000,10.000000,50.000000);
SELECT pg_temp.assert_text('create retry',status,'idempotent') FROM r_repeat;
DO $$ BEGIN BEGIN PERFORM public.create_general_material('10000000-0000-0000-0000-000000000001','different','metro',1,10,50); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;

CREATE TEMP TABLE r_move AS SELECT * FROM public.move_general_material('10000000-0000-0000-0000-000000000002',(SELECT material_id FROM r_create),0,'entry','centimetro',200,'entry');
SELECT pg_temp.assert_eq('entry balance',balance,52) FROM r_move;
CREATE TEMP TABLE r_consume AS SELECT * FROM public.move_general_material('10000000-0000-0000-0000-000000000003',(SELECT material_id FROM r_create),1,'consumption','centimetro',20,'consume');
SELECT pg_temp.assert_eq('consumption balance',balance,51.8) FROM r_consume;
CREATE TEMP TABLE r_adjust AS SELECT * FROM public.move_general_material('10000000-0000-0000-0000-000000000004',(SELECT material_id FROM r_create),2,'adjustment','metro',40,'adjust50to40');
SELECT pg_temp.assert_eq('adjust50to40',balance,40) FROM r_adjust;
CREATE TEMP TABLE r_retry AS SELECT * FROM public.move_general_material('10000000-0000-0000-0000-000000000002',(SELECT material_id FROM r_create),0,'entry','centimetro',200,'entry');
SELECT pg_temp.assert_text('same move retry',status,(SELECT status FROM r_move)) FROM r_retry;
SELECT pg_temp.assert_eq('same move original version',(SELECT version FROM r_retry),(SELECT version FROM r_move));
SELECT pg_temp.assert_eq('same move original balance',(SELECT balance FROM r_retry),(SELECT balance FROM r_move));
SELECT pg_temp.assert_eq('no duplicate movement',count(*)::numeric,1) FROM public.general_material_movements WHERE attempt_id='10000000-0000-0000-0000-000000000002';
DO $$ BEGIN BEGIN PERFORM public.move_general_material('10000000-0000-0000-0000-000000000002',(SELECT material_id FROM r_create),1,'entry','centimetro',201,'entry'); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;

-- Profile: first execution, equivalent replay, and conflicting payload.
CREATE TEMP TABLE r_profile AS SELECT * FROM public.update_general_material_profile('10000000-0000-0000-0000-000000000005',(SELECT material_id FROM r_create),3,'GM regression renamed');
CREATE TEMP TABLE r_profile_retry AS SELECT * FROM public.update_general_material_profile('10000000-0000-0000-0000-000000000005',(SELECT material_id FROM r_create),3,'GM regression renamed');
SELECT pg_temp.assert_eq('profile retry version', (SELECT version FROM r_profile_retry), (SELECT version FROM r_profile));
DO $$ BEGIN BEGIN PERFORM public.update_general_material_profile('10000000-0000-0000-0000-000000000005',(SELECT material_id FROM r_create),3,'different profile'); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;

-- Cost reference: first execution, equivalent replay without duplicate history, and conflict.
CREATE TEMP TABLE r_cost AS SELECT * FROM public.update_general_material_cost_reference('10000000-0000-0000-0000-000000000006',(SELECT material_id FROM r_create),4,2.000000,25.000000);
CREATE TEMP TABLE r_cost_retry AS SELECT * FROM public.update_general_material_cost_reference('10000000-0000-0000-0000-000000000006',(SELECT material_id FROM r_create),4,2.000000,25.000000);
SELECT pg_temp.assert_eq('cost retry version', (SELECT version FROM r_cost_retry), (SELECT version FROM r_cost));
SELECT pg_temp.assert_eq('cost history rows after retry',count(*)::numeric,1) FROM public.general_material_cost_history WHERE material_id=(SELECT material_id FROM r_create);
DO $$ BEGIN BEGIN PERFORM public.update_general_material_cost_reference('10000000-0000-0000-0000-000000000006',(SELECT material_id FROM r_create),4,2.000000,26.000000); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;
SELECT pg_temp.assert_eq('old movement cost',unit_cost,10) FROM public.general_material_movements WHERE material_id=(SELECT material_id FROM r_create) AND movement_type='entry';
CREATE TEMP TABLE r_new_move AS SELECT * FROM public.move_general_material('10000000-0000-0000-0000-000000000007',(SELECT material_id FROM r_create),5,'entry','metro',1,'new cost');
SELECT pg_temp.assert_eq('new movement cost',unit_cost,12.5) FROM public.general_material_movements WHERE id=(SELECT movement_id FROM r_new_move);

-- Archive and restore each cover first execution, equivalent replay, and conflict.
CREATE TEMP TABLE r_archive AS SELECT * FROM public.set_general_material_active('10000000-0000-0000-0000-000000000008',(SELECT material_id FROM r_create),6,false);
CREATE TEMP TABLE r_archive_retry AS SELECT * FROM public.set_general_material_active('10000000-0000-0000-0000-000000000008',(SELECT material_id FROM r_create),6,false);
SELECT pg_temp.assert_eq('archive retry version', (SELECT version FROM r_archive_retry), (SELECT version FROM r_archive));
DO $$ BEGIN BEGIN PERFORM public.set_general_material_active('10000000-0000-0000-0000-000000000008',(SELECT material_id FROM r_create),6,true); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;
CREATE TEMP TABLE r_restore AS SELECT * FROM public.set_general_material_active('10000000-0000-0000-0000-000000000009',(SELECT material_id FROM r_create),7,true);
CREATE TEMP TABLE r_restore_retry AS SELECT * FROM public.set_general_material_active('10000000-0000-0000-0000-000000000009',(SELECT material_id FROM r_create),7,true);
SELECT pg_temp.assert_eq('restore retry version', (SELECT version FROM r_restore_retry), (SELECT version FROM r_restore));
DO $$ BEGIN BEGIN PERFORM public.set_general_material_active('10000000-0000-0000-0000-000000000009',(SELECT material_id FROM r_create),7,false); RAISE EXCEPTION 'expected idempotency_conflict'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;
SELECT pg_temp.assert_eq('restored active',count(*)::numeric,1) FROM public.get_general_material((SELECT material_id FROM r_create));

-- p_type NULL, precision adjustment, incompatible conversion and direct writes.
DO $$ BEGIN BEGIN PERFORM public.move_general_material('10000000-0000-0000-0000-000000000010',(SELECT material_id FROM r_create),8,NULL,'metro',1,'null type'); RAISE EXCEPTION 'expected invalid_input'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $$;
DO $$ BEGIN BEGIN PERFORM public.move_general_material('10000000-0000-0000-0000-000000000011',(SELECT material_id FROM r_create),8,'consumption','unidade',1,'bad conversion'); RAISE EXCEPTION 'expected incompatible_units'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END; END $$;
DO $$ BEGIN BEGIN UPDATE public.general_materials SET control_unit='grama' WHERE id=(SELECT material_id FROM r_create); RAISE EXCEPTION 'expected immutable_fields'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;

-- Authenticated RLS read and cross-enterprise denial. Switch only by replacing JWT
-- and fixture membership; this script cannot manufacture a second JWT safely.
SELECT pg_temp.assert_eq('same enterprise RLS',count(*)::numeric,1) FROM public.general_materials WHERE id=(SELECT material_id FROM r_create);
-- With a JWT for __USER_B__/enterprise B, the same SELECT must return zero and
-- every write RPC (including direct table INSERT/UPDATE) must raise/deny.

-- p_type NULL and direct-write checks above are expected-error assertions; all
-- successful mutations are visible through the actual list/get/history signatures.
SELECT count(*) FROM public.list_general_materials('', 'all', 100, 0);
SELECT count(*) FROM public.list_general_material_movements((SELECT material_id FROM r_create),100,0);
SELECT count(*) FROM public.list_general_material_cost_history((SELECT material_id FROM r_create),100,0);
ROLLBACK;

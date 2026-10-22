-- Stage 5 transactional regression; run ONLY against an isolated database with migrations
-- through 20261024000000 applied. Example:
--   psql -X -v ON_ERROR_STOP=1 -f tests/sql/20261024000000_stage5_assertions.sql
-- Replace EVERY __...__ below with approved, pre-provisioned fixture IDs. Never seed
-- auth.users/auth_identities here. JWT subject + issuer must resolve to the internal
-- user and exactly one active/business_ready enterprise membership. A is owner/admin,
-- OP is operator in A, B is owner/admin of a DIFFERENT active enterprise. Each entity
-- ID below must be distinct and belong to A, except b_product (belongs to B).
-- Fixtures must be disposable and may have existing history. All changes roll back.
-- a_product: active, zero (or absent) product_inventory balance, no pending references;
-- a_product_archived: active=false, zero inventory; a_product_stock: positive inventory.
-- a_spool: active, balance=0; a_spool_archived: active=false, balance=0;
-- a_spool_stock: positive balance. a_general: active, balance=0;
-- a_general_archived: active=false, balance=0; a_general_stock: positive balance.
-- For history checks, a_spool and a_general MUST each have >=1 movement before run.
-- The fixtures should have no pending pricing/reservation references. Do not reuse
-- the fixed attempt UUIDs below in persistent records; verify that no collision exists.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _stage5_fixture(k text PRIMARY KEY, v text NOT NULL) ON COMMIT DROP;
INSERT INTO _stage5_fixture(k,v) VALUES
 ('enterprise_a','__ENTERPRISE_A__'), ('enterprise_b','__ENTERPRISE_B__'),
 ('user_a','__USER_A__'), ('user_op','__USER_OPERATOR_A__'), ('user_b','__USER_B__'),
 ('jwt_sub_a','__JWT_SUB_A__'), ('jwt_issuer_a','__JWT_ISSUER_A__'),
 ('jwt_sub_op','__JWT_SUB_OPERATOR_A__'), ('jwt_issuer_op','__JWT_ISSUER_OPERATOR_A__'),
 ('jwt_sub_b','__JWT_SUB_B__'), ('jwt_issuer_b','__JWT_ISSUER_B__'),
 ('a_product','__A_PRODUCT__'), ('a_product_archived','__A_PRODUCT_ARCHIVED__'),
 ('a_product_stock','__A_PRODUCT_WITH_STOCK__'), ('b_product','__B_PRODUCT__'),
 ('a_spool','__A_SPOOL__'), ('a_spool_archived','__A_SPOOL_ARCHIVED__'),
 ('a_spool_stock','__A_SPOOL_WITH_STOCK__'),
 ('a_general','__A_GENERAL__'), ('a_general_archived','__A_GENERAL_ARCHIVED__'),
 ('a_general_stock','__A_GENERAL_WITH_STOCK__');

CREATE FUNCTION pg_temp.f(k text) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT v FROM _stage5_fixture WHERE _stage5_fixture.k=$1 $$;
CREATE FUNCTION pg_temp.assert_eq(label text, actual numeric, expected numeric)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'assert %: got %, expected %',label,actual,expected; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(label text, ok boolean)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assert %: not true',label; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_error(label text, statement text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE caught text; BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 IF caught IS DISTINCT FROM expected_state THEN
   RAISE EXCEPTION 'assert %: SQLSTATE %, expected %',label,coalesce(caught,'success'),expected_state;
 END IF;
END $$;
CREATE FUNCTION pg_temp.jwt(who text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
   'sub',pg_temp.f('jwt_sub_'||who),'iss',pg_temp.f('jwt_issuer_'||who),
   'role','authenticated')::text,true);
END $$;

DO $$ DECLARE k text; eid uuid; BEGIN
 SELECT k INTO k FROM _stage5_fixture WHERE v LIKE '__%__' LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'Replace placeholder for % before running',k; END IF;
 IF pg_temp.f('enterprise_a')::uuid=pg_temp.f('enterprise_b')::uuid THEN RAISE EXCEPTION 'Enterprises must differ'; END IF;
 FOREACH k IN ARRAY ARRAY['a_product','a_product_archived','a_product_stock','b_product','a_spool','a_spool_archived','a_spool_stock','a_general','a_general_archived','a_general_stock'] LOOP
   eid:=CASE WHEN k='b_product' THEN pg_temp.f('enterprise_b')::uuid ELSE pg_temp.f('enterprise_a')::uuid END;
   IF k LIKE '%product%' THEN
     IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=pg_temp.f(k)::uuid AND enterprise_id=eid AND deleted_at IS NULL AND active=(k NOT LIKE '%archived')) THEN RAISE EXCEPTION 'Invalid product fixture %',k; END IF;
   ELSIF k LIKE '%spool%' THEN
     IF NOT EXISTS(SELECT 1 FROM public.filament_spools WHERE id=pg_temp.f(k)::uuid AND enterprise_id=eid AND deleted_at IS NULL AND active=(k NOT LIKE '%archived') AND (current_balance_grams>0)=(k LIKE '%stock')) THEN RAISE EXCEPTION 'Invalid spool fixture %',k; END IF;
   ELSE
     IF NOT EXISTS(SELECT 1 FROM public.general_materials WHERE id=pg_temp.f(k)::uuid AND enterprise_id=eid AND deleted_at IS NULL AND active=(k NOT LIKE '%archived') AND (current_balance>0)=(k LIKE '%stock')) THEN RAISE EXCEPTION 'Invalid general fixture %',k; END IF;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.product_inventory WHERE product_id IN (pg_temp.f('a_product')::uuid,pg_temp.f('a_product_archived')::uuid) AND balance<>0)
    OR NOT EXISTS(SELECT 1 FROM public.product_inventory WHERE product_id=pg_temp.f('a_product_stock')::uuid AND balance>0)
 THEN RAISE EXCEPTION 'Invalid product inventory fixtures'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.filament_spool_movements WHERE spool_id=pg_temp.f('a_spool')::uuid)
    OR NOT EXISTS(SELECT 1 FROM public.general_material_movements WHERE material_id=pg_temp.f('a_general')::uuid)
 THEN RAISE EXCEPTION 'Movement history required on zero-balance fixtures'; END IF;
 FOREACH k IN ARRAY ARRAY['user_a','user_op','user_b'] LOOP
   IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=pg_temp.f(k)::uuid AND status='active' AND NOT must_change_password) THEN RAISE EXCEPTION 'Invalid user fixture %',k; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.enterprise_members WHERE user_id=pg_temp.f('user_a')::uuid AND enterprise_id=pg_temp.f('enterprise_a')::uuid AND status='active' AND role IN ('owner','admin'))
 OR NOT EXISTS(SELECT 1 FROM public.enterprise_members WHERE user_id=pg_temp.f('user_op')::uuid AND enterprise_id=pg_temp.f('enterprise_a')::uuid AND status='active' AND role='operator')
 OR NOT EXISTS(SELECT 1 FROM public.enterprise_members WHERE user_id=pg_temp.f('user_b')::uuid AND enterprise_id=pg_temp.f('enterprise_b')::uuid AND status='active' AND role IN ('owner','admin'))
 OR NOT EXISTS(SELECT 1 FROM public.enterprises WHERE id IN (pg_temp.f('enterprise_a')::uuid,pg_temp.f('enterprise_b')::uuid) AND status='active' HAVING count(*)=2)
 THEN RAISE EXCEPTION 'Invalid enterprise memberships'; END IF;
 IF EXISTS(SELECT 1 FROM private.stage5_delete_receipts WHERE attempt_id::text LIKE '50000000-0000-0000-0000-0000000000%') THEN RAISE EXCEPTION 'Stage 5 test attempt IDs already in use'; END IF;
END $$;

SELECT pg_temp.assert_eq('three nullable deleted_at columns',count(*)::numeric,3)
FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('products','filament_spools','general_materials') AND column_name='deleted_at' AND is_nullable='YES';
SELECT pg_temp.assert_true('receipt composite PK',(
 SELECT array_agg(a.attname ORDER BY a.attname)=ARRAY['actor_id','attempt_id','enterprise_id','entity']::name[]
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
 WHERE n.nspname='private' AND t.relname='stage5_delete_receipts' AND c.contype='p'));
SELECT pg_temp.assert_eq('partial live indexes',count(*)::numeric,3) FROM pg_indexes
WHERE schemaname='public' AND indexname IN ('products_not_deleted_idx','filament_spools_not_deleted_idx','general_materials_not_deleted_idx') AND indexdef LIKE '%deleted_at IS NULL%';
SELECT pg_temp.assert_true('authenticated delete RPC grants',
 has_function_privilege('authenticated','public.delete_internal_product(uuid,uuid,bigint)','EXECUTE')
 AND has_function_privilege('authenticated','public.delete_filament_spool(uuid,uuid,bigint)','EXECUTE')
 AND has_function_privilege('authenticated','public.delete_general_material(uuid,uuid,bigint)','EXECUTE')
 AND NOT has_function_privilege('anon','public.delete_internal_product(uuid,uuid,bigint)','EXECUTE'));

SELECT pg_temp.jwt('a');
SELECT pg_temp.assert_true('A JWT resolves to correct internal user',private.current_internal_user_id()=pg_temp.f('user_a')::uuid);
CREATE TEMP TABLE _before AS SELECT * FROM public.get_my_deletion_counts();
SELECT pg_temp.assert_eq('counts return exactly one row',count(*)::numeric,1) FROM _before;
SELECT pg_temp.assert_eq('product counts include active AND archived, exclude B and FDM reference materials',products::numeric,
 (SELECT count(*) FROM public.products WHERE enterprise_id=pg_temp.f('enterprise_a')::uuid AND deleted_at IS NULL)::numeric) FROM _before;
SELECT pg_temp.assert_eq('spool counts include active, archived, empty',filament_spools::numeric,
 (SELECT count(*) FROM public.filament_spools WHERE enterprise_id=pg_temp.f('enterprise_a')::uuid AND deleted_at IS NULL)::numeric) FROM _before;
SELECT pg_temp.assert_eq('general counts include active, archived, zero',general_materials::numeric,
 (SELECT count(*) FROM public.general_materials WHERE enterprise_id=pg_temp.f('enterprise_a')::uuid AND deleted_at IS NULL)::numeric) FROM _before;
SELECT pg_temp.assert_true('counts include selected archived and zero rows',
 (SELECT products>=2 AND filament_spools>=3 AND general_materials>=3 FROM _before));

-- Cross-tenant ID lookup must not mutate B or create receipts; stale versions and
-- nonzero balances must fail before a receipt is written.
SELECT pg_temp.assert_error('B product inaccessible to A',format('SELECT public.delete_internal_product(%L,%L,0)',
 '50000000-0000-0000-0000-000000000001',pg_temp.f('b_product')),'P0002');
SELECT pg_temp.assert_error('product stock blocks deletion',format('SELECT public.delete_internal_product(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000002',pg_temp.f('a_product_stock'),(SELECT version FROM public.products WHERE id=pg_temp.f('a_product_stock')::uuid)),'22023');
SELECT pg_temp.assert_error('spool stock blocks deletion',format('SELECT public.delete_filament_spool(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000003',pg_temp.f('a_spool_stock'),(SELECT version FROM public.filament_spools WHERE id=pg_temp.f('a_spool_stock')::uuid)),'22023');
SELECT pg_temp.assert_error('general stock blocks deletion',format('SELECT public.delete_general_material(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000004',pg_temp.f('a_general_stock'),(SELECT version FROM public.general_materials WHERE id=pg_temp.f('a_general_stock')::uuid)),'22023');
SELECT pg_temp.assert_error('stale product version',format('SELECT public.delete_internal_product(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000005',pg_temp.f('a_product'),(SELECT version+1 FROM public.products WHERE id=pg_temp.f('a_product')::uuid)),'40001');
SELECT pg_temp.assert_error('stale spool version',format('SELECT public.delete_filament_spool(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000006',pg_temp.f('a_spool'),(SELECT version+1 FROM public.filament_spools WHERE id=pg_temp.f('a_spool')::uuid)),'40001');
SELECT pg_temp.assert_error('stale general version',format('SELECT public.delete_general_material(%L,%L,%s)',
 '50000000-0000-0000-0000-000000000007',pg_temp.f('a_general'),(SELECT version+1 FROM public.general_materials WHERE id=pg_temp.f('a_general')::uuid)),'40001');
SELECT pg_temp.assert_eq('failed deletes have no receipts',count(*)::numeric,0) FROM private.stage5_delete_receipts WHERE attempt_id::text LIKE '50000000-0000-0000-0000-0000000000%';

-- Archive is reversible but deletion of an archived, zero-balance row is permitted.
CREATE TEMP TABLE _deleted_product AS SELECT * FROM public.delete_internal_product('50000000-0000-0000-0000-000000000011',pg_temp.f('a_product')::uuid,(SELECT version FROM public.products WHERE id=pg_temp.f('a_product')::uuid));
CREATE TEMP TABLE _deleted_spool AS SELECT * FROM public.delete_filament_spool('50000000-0000-0000-0000-000000000012',pg_temp.f('a_spool')::uuid,(SELECT version FROM public.filament_spools WHERE id=pg_temp.f('a_spool')::uuid));
CREATE TEMP TABLE _deleted_general AS SELECT * FROM public.delete_general_material('50000000-0000-0000-0000-000000000013',pg_temp.f('a_general')::uuid,(SELECT version FROM public.general_materials WHERE id=pg_temp.f('a_general')::uuid));
CREATE TEMP TABLE _deleted_archived_product AS SELECT * FROM public.delete_internal_product('50000000-0000-0000-0000-000000000014',pg_temp.f('a_product_archived')::uuid,(SELECT version FROM public.products WHERE id=pg_temp.f('a_product_archived')::uuid));
CREATE TEMP TABLE _deleted_archived_spool AS SELECT * FROM public.delete_filament_spool('50000000-0000-0000-0000-000000000015',pg_temp.f('a_spool_archived')::uuid,(SELECT version FROM public.filament_spools WHERE id=pg_temp.f('a_spool_archived')::uuid));
CREATE TEMP TABLE _deleted_archived_general AS SELECT * FROM public.delete_general_material('50000000-0000-0000-0000-000000000016',pg_temp.f('a_general_archived')::uuid,(SELECT version FROM public.general_materials WHERE id=pg_temp.f('a_general_archived')::uuid));
SELECT pg_temp.assert_true('six deletes succeed',
 (SELECT status='deleted' FROM _deleted_product) AND (SELECT status='deleted' FROM _deleted_spool)
 AND (SELECT status='deleted' FROM _deleted_general) AND (SELECT status='deleted' FROM _deleted_archived_product)
 AND (SELECT status='deleted' FROM _deleted_archived_spool) AND (SELECT status='deleted' FROM _deleted_archived_general));
SELECT pg_temp.assert_eq('six receipts',count(*)::numeric,6) FROM private.stage5_delete_receipts WHERE enterprise_id=pg_temp.f('enterprise_a')::uuid AND actor_id=pg_temp.f('user_a')::uuid AND attempt_id::text LIKE '50000000-0000-0000-0000-0000000000%';
SELECT pg_temp.assert_true('all six rows retained, stamped with deleter',
 (SELECT count(*)=2 FROM public.products WHERE id IN(pg_temp.f('a_product')::uuid,pg_temp.f('a_product_archived')::uuid) AND deleted_at IS NOT NULL AND deleted_by=pg_temp.f('user_a')::uuid)
 AND (SELECT count(*)=2 FROM public.filament_spools WHERE id IN(pg_temp.f('a_spool')::uuid,pg_temp.f('a_spool_archived')::uuid) AND deleted_at IS NOT NULL AND deleted_by=pg_temp.f('user_a')::uuid)
 AND (SELECT count(*)=2 FROM public.general_materials WHERE id IN(pg_temp.f('a_general')::uuid,pg_temp.f('a_general_archived')::uuid) AND deleted_at IS NOT NULL AND deleted_by=pg_temp.f('user_a')::uuid));
SELECT pg_temp.assert_true('existing movement history retained',
 EXISTS(SELECT 1 FROM public.filament_spool_movements WHERE spool_id=pg_temp.f('a_spool')::uuid)
 AND EXISTS(SELECT 1 FROM public.general_material_movements WHERE material_id=pg_temp.f('a_general')::uuid));
SELECT pg_temp.assert_true('shared totals fall by two each (reference materials excluded)',
 (SELECT b.products=c.products+2 AND b.filament_spools=c.filament_spools+2 AND b.general_materials=c.general_materials+2 FROM _before b CROSS JOIN public.get_my_deletion_counts() c));
SELECT pg_temp.assert_eq('deleted spool excluded from all-status list',count(*)::numeric,0)
FROM public.list_filament_spools('', 'all',50,0) WHERE id=pg_temp.f('a_spool')::uuid;
SELECT pg_temp.assert_eq('deleted general excluded from all-status list',count(*)::numeric,0)
FROM public.list_general_materials('', 'all',100,0) WHERE id=pg_temp.f('a_general')::uuid;
SELECT pg_temp.assert_eq('deleted general excluded from get',count(*)::numeric,0) FROM public.get_general_material(pg_temp.f('a_general')::uuid);

-- Receipts must be returned unchanged on identical retry even though the row is now
-- deleted; no second version increment and no second audit record.
SELECT pg_temp.assert_true('product identical retry', (SELECT (status,product_id,version)=(d.status,d.product_id,d.version) FROM public.delete_internal_product('50000000-0000-0000-0000-000000000011',pg_temp.f('a_product')::uuid,(SELECT version-1 FROM _deleted_product)) r CROSS JOIN _deleted_product d));
SELECT pg_temp.assert_true('spool identical retry', (SELECT (status,spool_id,version)=(d.status,d.spool_id,d.version) FROM public.delete_filament_spool('50000000-0000-0000-0000-000000000012',pg_temp.f('a_spool')::uuid,(SELECT version-1 FROM _deleted_spool)) r CROSS JOIN _deleted_spool d));
SELECT pg_temp.assert_true('general identical retry', (SELECT (status,material_id,version)=(d.status,d.material_id,d.version) FROM public.delete_general_material('50000000-0000-0000-0000-000000000013',pg_temp.f('a_general')::uuid,(SELECT version-1 FROM _deleted_general)) r CROSS JOIN _deleted_general d));
SELECT pg_temp.assert_true('retry leaves versions unchanged',
 (SELECT version=(SELECT version FROM _deleted_product) FROM public.products WHERE id=pg_temp.f('a_product')::uuid)
 AND (SELECT version=(SELECT version FROM _deleted_spool) FROM public.filament_spools WHERE id=pg_temp.f('a_spool')::uuid)
 AND (SELECT version=(SELECT version FROM _deleted_general) FROM public.general_materials WHERE id=pg_temp.f('a_general')::uuid));
SELECT pg_temp.assert_eq('retry creates no receipt',count(*)::numeric,6) FROM private.stage5_delete_receipts WHERE actor_id=pg_temp.f('user_a')::uuid AND attempt_id::text LIKE '50000000-0000-0000-0000-0000000000%';
SELECT pg_temp.assert_error('same attempt different product payload',format('SELECT public.delete_internal_product(%L,%L,%s)', '50000000-0000-0000-0000-000000000011',pg_temp.f('a_product'),(SELECT version FROM _deleted_product)),'23505');
SELECT pg_temp.assert_error('same attempt different spool payload',format('SELECT public.delete_filament_spool(%L,%L,%s)', '50000000-0000-0000-0000-000000000012',pg_temp.f('a_spool'),(SELECT version FROM _deleted_spool)),'23505');
SELECT pg_temp.assert_error('same attempt different general payload',format('SELECT public.delete_general_material(%L,%L,%s)', '50000000-0000-0000-0000-000000000013',pg_temp.f('a_general'),(SELECT version FROM _deleted_general)),'23505');
SELECT pg_temp.assert_error('new attempt cannot delete again',format('SELECT public.delete_internal_product(%L,%L,%s)', '50000000-0000-0000-0000-000000000017',pg_temp.f('a_product'),(SELECT version FROM _deleted_product)),'P0002');

SELECT pg_temp.assert_error('deleted product restore rejected',format('SELECT public.set_internal_product_active(%L,%s,true)',pg_temp.f('a_product'),(SELECT version FROM _deleted_product)),'P0002');
SELECT pg_temp.assert_error('deleted spool restore rejected',format('SELECT public.set_filament_spool_active(%L,%s,true)',pg_temp.f('a_spool'),(SELECT version FROM _deleted_spool)),'P0002');
SELECT pg_temp.assert_error('deleted general restore rejected',format('SELECT public.set_general_material_active(%L,%L,%s,true)', '50000000-0000-0000-0000-000000000018',pg_temp.f('a_general'),(SELECT version FROM _deleted_general)),'P0002');
SELECT pg_temp.assert_error('deleted spool movement rejected',format('SELECT public.create_filament_spool_movement(%L,%L,%s,%L,1,NULL,%L)', '50000000-0000-0000-0000-000000000019',pg_temp.f('a_spool'),(SELECT version FROM _deleted_spool),'entry','test'),'P0002');
SELECT pg_temp.assert_error('deleted general movement rejected',format('SELECT public.move_general_material(%L,%L,%s,%L,%L,1,%L)', '50000000-0000-0000-0000-000000000020',pg_temp.f('a_general'),(SELECT version FROM _deleted_general),'entry','metro','test'),'P0002');
SELECT pg_temp.assert_error('deleted general edit rejected',format('SELECT public.update_general_material_profile(%L,%L,%s,%L)', '50000000-0000-0000-0000-000000000021',pg_temp.f('a_general'),(SELECT version FROM _deleted_general),'Stage5 renamed'),'P0002');

SELECT pg_temp.jwt('op');
SELECT pg_temp.assert_true('operator JWT resolves',private.current_internal_user_id()=pg_temp.f('user_op')::uuid);
SELECT pg_temp.assert_error('operator product delete denied',format('SELECT public.delete_internal_product(%L,%L,%s)', '50000000-0000-0000-0000-000000000022',pg_temp.f('a_product_stock'),(SELECT version FROM public.products WHERE id=pg_temp.f('a_product_stock')::uuid)),'42501');
SELECT pg_temp.assert_error('operator spool delete denied',format('SELECT public.delete_filament_spool(%L,%L,%s)', '50000000-0000-0000-0000-000000000023',pg_temp.f('a_spool_stock'),(SELECT version FROM public.filament_spools WHERE id=pg_temp.f('a_spool_stock')::uuid)),'42501');
SELECT pg_temp.assert_error('operator general delete denied',format('SELECT public.delete_general_material(%L,%L,%s)', '50000000-0000-0000-0000-000000000024',pg_temp.f('a_general_stock'),(SELECT version FROM public.general_materials WHERE id=pg_temp.f('a_general_stock')::uuid)),'42501');
SELECT pg_temp.jwt('b');
SELECT pg_temp.assert_true('B JWT resolves',private.current_internal_user_id()=pg_temp.f('user_b')::uuid);
SELECT pg_temp.assert_eq('B counts are B only',products::numeric,(SELECT count(*) FROM public.products WHERE enterprise_id=pg_temp.f('enterprise_b')::uuid AND deleted_at IS NULL)::numeric) FROM public.get_my_deletion_counts();
SELECT pg_temp.assert_error('B cannot delete A spool',format('SELECT public.delete_filament_spool(%L,%L,%s)', '50000000-0000-0000-0000-000000000025',pg_temp.f('a_spool_stock'),(SELECT version FROM public.filament_spools WHERE id=pg_temp.f('a_spool_stock')::uuid)),'P0002');
SELECT pg_temp.assert_error('B cannot delete A general',format('SELECT public.delete_general_material(%L,%L,%s)', '50000000-0000-0000-0000-000000000026',pg_temp.f('a_general_stock'),(SELECT version FROM public.general_materials WHERE id=pg_temp.f('a_general_stock')::uuid)),'P0002');

-- Manual integration coverage (NOT asserted by this transaction):
-- 1. Pricing guard: create a valid V2 pricing snapshot referencing a spool/general
--    material, then delete that zero-balance row under A; a NEW save_pricing_attempt
--    with that deleted reference must fail (P0002/contract error), not write history.
--    Use the full validated V2 snapshot + service_role actor/issuer signature from
--    tests/sql/20261023000000_fdm_pricing_v2_assertions.sql. Also try applying a
--    previously saved calculation to a deleted product: apply_pricing_price must
--    reject, leaving product version/price and application ledger unchanged.
--    These are instructions, NOT claims of automated pricing coverage here.
-- 2. Two-session race, isolated disposable fixtures, both sessions using approved A
--    JWT. Session 1: BEGIN; SELECT ... FROM public.products WHERE id=<zero-stock
--    product> FOR UPDATE; keep transaction open. Session 2: BEGIN; call
--    delete_internal_product(new_attempt,id,version) (blocks). Session 1: update
--    product version / create positive inventory, COMMIT. Session 2 must fail with
--    version_conflict or balance_not_zero; verify no deletion/receipt, ROLLBACK.
--    Repeat with a spool/general row, concurrently moving stock into it. For an
--    opposite race, let deletion commit first and verify movements/edits reject.
--    A single psql transaction cannot test lock waiting or cross-session ordering.
ROLLBACK;

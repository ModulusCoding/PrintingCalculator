-- NOT EXECUTED. Preparation only. NON-DESTRUCTIVE retirement inventory.
-- This suite creates persistent, immutable application evidence. There is NO safe
-- row-level cleanup: deleting orders/users/products cannot erase ledgers and may
-- violate FKs, auditability, identity history, and reservation reconciliation.
-- Do NOT disable triggers/guards, mutate immutable rows, TRUNCATE, or drop the
-- harness schema. Keep registry, calls and checkpoints together with app evidence.
BEGIN TRANSACTION READ ONLY;
SELECT flex_manual_test.assert_run('REPLACE_RUN_UUID','REPLACE_PROJECT_REF');
SELECT * FROM flex_manual_test.config;
SELECT * FROM flex_manual_test.actors ORDER BY label;
SELECT * FROM flex_manual_test.objects ORDER BY label;
SELECT 'registered_objects' AS scope,count(*) AS rows FROM flex_manual_test.objects
UNION ALL SELECT 'calls',count(*) FROM flex_manual_test.calls
UNION ALL SELECT 'checkpoints',count(*) FROM flex_manual_test.checkpoints
UNION ALL SELECT 'fixture_orders',count(*) FROM public.orders o WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=o.id)
UNION ALL SELECT 'fixture_items',count(*) FROM public.order_items x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_events',count(*) FROM public.order_events x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_reservations',count(*) FROM public.order_stock_reservations x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_settlements',count(*) FROM public.order_stock_settlements x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_manifests',count(*) FROM public.order_delivery_manifest x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_undos',count(*) FROM public.order_delivery_undos x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_compensations',count(*) FROM public.order_delivery_compensations x
 WHERE EXISTS (SELECT 1 FROM public.order_stock_settlements s JOIN flex_manual_test.objects f ON f.id=s.order_id
  WHERE s.enterprise_id=x.enterprise_id AND s.id=x.settlement_id)
UNION ALL SELECT 'fixture_receipts',count(*) FROM private.order_operation_receipts x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'fixture_payments',count(*) FROM public.order_payments x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.order_id)
UNION ALL SELECT 'registered_product_movements',count(*) FROM public.product_inventory_movements x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.objects f WHERE f.id=x.product_id)
UNION ALL SELECT 'fixture_internal_users',count(*) FROM public.users x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.actors a WHERE a.internal_user_id=x.id)
UNION ALL SELECT 'fixture_enterprises',count(*) FROM public.enterprises x WHERE EXISTS
 (SELECT 1 FROM flex_manual_test.actors a WHERE a.enterprise_id=x.id);
SELECT label,rpc,payload,result FROM flex_manual_test.calls ORDER BY label;
SELECT label,data FROM flex_manual_test.checkpoints ORDER BY label;
SELECT 'RETAIN evidence exports securely, then DISCARD THE WHOLE DISPOSABLE PROJECT manually through its approved administrative process. Verify Dashboard project ref and obtain explicit owner authorization; this script does not delete any project or data.' AS retirement_instruction;
COMMIT;
-- Stop here. Export logs, SQLSTATEs, installed definitions, migration file hashes,
-- fixture registry, calls, checkpoints, concurrent-session evidence and final audit.
-- Only after evidence retention and separate approval should the operator retire
-- the entire isolated project (including its Auth/Storage) outside this SQL file.
-- If this project is not fully disposable, DO NOT clean it: retain fixtures and
-- escalate to the owner for an approved retention plan. Never retrofit test data
-- into production, and never delete shared infrastructure or another run's data.

# M7.2-C.1 approval checklist — staged only

Migration remains unapplied. This checklist separates read-only evidence from write tests.

## A. Read-only remote evidence

Run `orders_stage72c1_remote_preflight_readonly.sql` in the intended Supabase project. It contains SELECTs only. Archive output and compare exact columns/types/nullability, constraints/FK actions, indexes, enabled triggers and function bodies, enums/plans, ACL/owners/search_path, RLS/policies and effective product/inventory RPCs. A missing catalog object is an explicit block, not an assumed match.

## B. Disposable PostgreSQL validation (writes allowed only in isolated disposable DB)

1. Create fresh disposable DB matching extensions/roles and apply A, B, B.1, then candidate C.1 in order. Never use production or shared remote SQL Editor for this phase.
2. Parse/install candidate; capture PostgreSQL version, full errors, migration hash, catalog output and rollback state. Verify role names and authenticated JWT context.
3. Run `orders_stage72c1_structure_manual.sql` and functional cases from `orders_stage72c1_functional_manual.sql`; assert changes/rollback with fixtures.
4. Auth/perms: no JWT, wrong tenant, missing `sales.write`, anon, direct DML, helper EXECUTE denial and valid authenticated RPC. Verify no cross-tenant product/order/receipt disclosure.
5. Finance: fixed/percent, caps, negotiated prices, decimal grammar and exact persisted item/order equations; compare numerics without float conversion.
6. Receipts: create/update same attempt same payload replay exact stored result; changed payload conflicts; corrupt fixture receipt fields in disposable DB and assert fail-closed (do not mutate production receipts).
7. Concurrency: multiple sessions with same create attempt; distinct create attempts on Aprendiz quota boundary; same-tenant numbering; two updates using same expected version; concurrent plan mutation; product archive/deactivation versus order creation. Capture wait graphs and final order/counter/event/receipt/product states. Repeat enough to exercise both commit orderings.
8. Failure injection: force event/receipt/item write failure and confirm whole transaction rolls back counter and all aggregate writes.

## C. Lock-order review required before concurrency sign-off

C.1 takes global enterprise-management advisory lock before context/identity checks; create then quota mutex, idempotency key, product locks UUID sorted, counter row; update takes idempotency key, order row, reservation rows ordered by id, product locks UUID sorted. B.1 RPC sources reportedly use context/helper/product/position patterns but exact effective remote bodies must be inspected. Confirm no reverse acquisition against (a) enterprise-management mutex/context writers, (b) B.1 product-row operations and (c) any reservation writer. Since C.1 accepts only `untracked`, it creates no reservation/position lock path; this does not by itself prove the product-row lock order is safe.

## D. Approval gate

Do not approve/apply until A read-only catalog evidence is reviewed, B syntax/install and all functional/auth/financial/failure tests pass in disposable PostgreSQL, and C concurrency tests plus lock-order review pass. Static review and `git diff --check` alone are insufficient. This workspace currently has no PostgreSQL client/parser and Docker daemon is unavailable; none of the above DB tests is represented as passed.

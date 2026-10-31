# Printer MVP final SQL audit

Migration: `supabase/migrations/20261015180000_internal_printers_mvp.sql`. This review does not apply or execute it.

## Concrete issues fixed

- Replaced the compressed RPCs with formatted, executable PostgreSQL and explicit `pg_catalog` qualification under empty search paths.
- Preserved the original `private.can_access_enterprise` decision table and eligibility semantics, adding only `printers.read`, `printers.write`, and `printers.archive`.
- Rebuilt mutation authorization around the compatible identity/current-context helpers: verified issuer plus `auth.uid()`, active identity, locked user, membership, and enterprise.
- Implemented the team lock order: global `modulus:enterprise-management:all-members`, exact provisioning actor lock including issuer, then identity/user/membership/enterprise/printer; context and permission are re-resolved while locks are held in every mutation RPC.
- Ensured an unauthenticated caller alone gets `session_expired`; every other blocked context returns `permission_denied`.
- Added pre-cast validation for NULL, NaN/infinity, numeric scale, range, integer life, and text. Names are trimmed; blank brand/model normalize to NULL.
- Made archived updates unavailable; the state RPC supports archive and restore. It checks expected version before idempotency and returns success/current version without incrementing when the requested state already matches. All RPCs return exactly `(status, printer_id, version)` and errors expose NULL id/version.
- Made the trigger set the post-update version exactly and reject enterprise changes. No client table writes are granted; helper/trigger execution is revoked from PUBLIC, anon, and authenticated as appropriate.
- Added the tenant/active/created index without requiring `pg_trgm`.

## Contract

Owner/admin can create, edit, archive, and restore. Operators can read only. Technology is fixed to `fdm`; enterprise ownership is immutable. Purchase is `0..1,000,000` with scale <=2; life is integer `1..100,000`; watts is `>0..10,000` with scale <=2; maintenance is `0..1,000` with scale <=4.

## Manual disposable-database checklist

- [ ] Review prerequisites and ownership; apply only in a disposable/local database. Do not run this audit file in production.
- [ ] Unauthenticated calls return `session_expired`; unknown issuer, blocked/inactive account, password-obligation account, inactive membership/enterprise, and ambiguous context return `permission_denied`.
- [ ] Owner create succeeds with trimmed name and whitespace-only brand/model; two printers with the same model both succeed and remain distinct.
- [ ] Admin create/update/archive/restore succeeds; operator SELECT succeeds but all three mutations return `permission_denied`.
- [ ] Verify permissions regression: products/catalogs/filters/sales/enterprise/member helper behavior is unchanged, including operator product-write behavior and owner-only enterprise/member-admin behavior.
- [ ] Unknown, cross-tenant, archived update, repeated archive/restore, and missing printer return the documented NULL tuple; stale expected version returns `version_conflict` with NULL id/version.
- [ ] Test every numeric boundary, excess scale, NULL, NaN/infinity, fractional life, overflow, blank/overlong text, and untrimmed input; invalid data returns `invalid_input` without a constrained cast.
- [ ] Concurrent update attempts serialize; exactly one call with an expected version succeeds.
- [ ] Direct anon/authenticated INSERT, UPDATE, DELETE, helper, and trigger calls are denied; authenticated SELECT exposes only granted columns and RLS limits it to `printers.read` tenants.
- [ ] Confirm enterprise_id cannot be changed by a direct privileged table update and version/updated_at advance exactly once per successful mutation.

This document is a manual review contract, not evidence that the migration has been applied or tested.

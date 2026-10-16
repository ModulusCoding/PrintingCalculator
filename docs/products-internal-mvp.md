# Internal Products MVP

This document outlines the internal product management system for printing-calculator.

## Overview
Replaces legacy product management with a hardened, tenant-isolated system.

## Contracts
- **Server Actions**: `listInternalProducts`, `getInternalProduct`, `createInternalProduct`, `updateInternalProduct`, `setInternalProductActive`.
- **Authorization**: Enforced via `private.lock_internal_product_context` within RPC calls. Requires `business_ready` state and specific enterprise permissions.

## Manual Checklist
- [ ] Keep `MODULUS_LEGACY_FEATURES_ENABLED` unset or `false` in production. Legacy catalogs, sales, and public catalog routes are disabled by default; set it to `true` only for an explicitly enabled legacy deployment.
- [ ] Verify RLS policies on `public.products` and `public.product_images`.
- [ ] Validate RPC input constraints (name length, price finiteness/bounds).
- [ ] Confirm no image_url or legacy catalog table joins in new system.

## Concurrency
Optimistic locking using `version` column. `version_conflict` error returned if stale data is updated.

## Archive/Restore
- Archive: `setInternalProductActive(..., false)` (only via admin/owner with write permissions).
- Restore: `setInternalProductActive(..., true)` (only via admin/owner).
- No legacy physical delete; logical active flag only.

## Data API
RPC strict status discriminants (success, invalid_input, permission_denied, product_unavailable, version_conflict, technical, unknown).

## Legacy Deployment Caveat
Legacy code is preserved via feature gates. Do not remove unless specifically authorized in the migration plan. Ensure public catalog/sales entrypoints are gated to prevent queries against absent/legacy tables.

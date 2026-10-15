# Enterprise management review

## Scope
The enterprise management migration uses `public.get_my_access_context()` and `private.can_access_enterprise()` for every RPC. Authentication and blocked states fail explicitly with SQLSTATE `42501` (`unauthorized`); malformed pagination/search arguments fail with `42000`.

## Migration
The complete reviewed SQL is in `supabase/migrations/20261015120000_enterprise_management.sql` and is reproduced below.

```sql
-- See the migration file in this repository; it is intentionally the source of truth.
```

The migration adds an enterprise version and a `BEFORE UPDATE` trigger, ensuring every enterprise update increments the version. Name updates use a qualified expected-version predicate, making concurrent writes atomic. RPCs are owned by postgres, have an empty search path, and are not executable by PUBLIC or anonymous users.

## Contracts
- `get_my_enterprise`: one row containing `name`, `created_at`, and `version`.
- `update_my_enterprise_name`: `invalid_input`, `updated`, or `version_conflict`; authorization errors are SQLSTATE `42501`.
- `list_my_enterprise_members`: paged rows with `total_count` for the filtered set and `unfiltered_visible_total` for the visible set. Empty pages intentionally return no rows; clients treat that as a zero-row page while retaining the distinction through the envelope contract when rows exist.
- Search is lower-case `strpos`, so user input has no wildcard semantics. Results have stable membership ordering.

## Manual tests
1. Call every RPC as anonymous: verify no execution grant.
2. Call as authenticated user with each blocked context: verify SQLSTATE `42501`.
3. Owner updates with current version: verify version increments exactly once.
4. Repeat the same expected version: verify `version_conflict` and current values.
5. List with `active`, `inactive`, and `all`; search `%` and `_`; verify literals, bounds, and stable order.
6. Request a page beyond the end and verify the client can distinguish an empty page from no visible members using the envelope totals.
7. Verify owner sees admins/operators and admin sees operators only.

## Checks
`npx tsc --noEmit` passes after regenerating `.next`. ESLint flat config does not accept the legacy `--file` option; run `npm run lint` for the repository-level check.

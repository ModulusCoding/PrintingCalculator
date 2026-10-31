# Team management review

The incremental migration `20261015130000_employee_management.sql` adds member versions and target-scoped RPCs. All mutations use the session Supabase client; no service role is involved.

## Lock contract

Mutations discover the target inside the enterprise, serialize on a deterministic target-user advisory lock, then lock the target user and membership. They re-check the optimistic version after locking. Actor context is checked before mutation and target permissions exclude self and owners. Status changes are idempotent only at the expected version.

## Manual checklist

- owner sees owners, admins, and operators; admin sees operators only;
- self and owner rows have no actions;
- stale edit/status versions return `conflict`;
- changing a sole-membership name returns `name_not_editable` without changing role;
- anonymous and blocked sessions cannot execute RPCs;
- active/inactive/all, literal search, empty results, pagination and password-change badge;
- confirm Portuguese phrases before role/status changes and preserve URL filters after refresh.

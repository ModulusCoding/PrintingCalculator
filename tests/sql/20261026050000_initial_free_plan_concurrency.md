# Initial Free: manual two-session concurrency harness

**Not executed.** This is a manual harness, not an automated concurrency test.
Use only an explicitly authorized **disposable, isolated database**, with all
migrations through `20261026050000` applied and Supabase roles/auth helpers.
Both connections must be direct PostgreSQL connections (not transaction-pooler
connections) as `postgres`, with permission to `SET ROLE authenticated`.
Never point these steps at production or a shared development database.

A single rollback transaction cannot share newly inserted fixtures with another
session. Therefore fixture setup below **commits**. Use a fresh disposable
database for each run, and dispose of that database using your approved local
test-environment teardown afterwards. Do not delete audit rows, disable their
immutable trigger, or claim rollback cleans committed fixtures. If interrupted,
rollback/close both sessions and dispose of the same database. No fixture cleanup
against a persistent database is provided intentionally.

## Setup, in session A

Start `psql -X -v ON_ERROR_STOP=1` on the approved disposable database, from the
repository root. Keep this session open: its temporary fixture lookup/functions
are connection-local and survive COMMIT.

```sql
BEGIN;
\i tests/sql/20261026050000_initial_free_plan_fixture.sql
GRANT SELECT ON _initial_free_fixture TO authenticated;
SELECT pg_temp.f('a') AS enterprise_id,
       pg_temp.f('owner_a') AS subject,
       'initial-free-test-'||pg_temp.f('a')::text AS issuer;
COMMIT;
```

Record the three generated values. Do not rerun setup in session B: that would
create a different tenant. Ensure both sessions use the default READ COMMITTED
isolation level. In B, configure a recognizable application name and obtain PID:

```sql
SET application_name = 'initial-free-session-b';
SELECT pg_backend_pid();
```

## Run 1: winner commits, waiter is idempotent

In A:

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT pg_temp.jwt('owner_a');
SET LOCAL ROLE authenticated;
SELECT * FROM public.select_initial_free_plan(); -- exactly one row: selected
RESET ROLE;
-- Leave transaction open, retaining the administrative advisory lock.
```

In B (substitute the generated subject/issuer, not the enterprise UUID):

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout = '120s';
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub','<subject>','iss','<issuer>',
                    'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT * FROM public.select_initial_free_plan(); -- MUST block until A ends
```

While B is blocked, in A verify actual blocking, replacing `<B_PID>` with its
numeric PID. Do not rely on a sleep as proof of overlap:

```sql
SELECT pg_temp.check_true('B blocked by A',
  pg_backend_pid() = ANY(pg_blocking_pids(<B_PID>)));
CREATE TEMP TABLE _winner AS
 SELECT to_jsonb(a) AS row FROM public.enterprise_plan_access a
 WHERE enterprise_id=pg_temp.f('a');
CREATE TEMP TABLE _winner_audit AS
 SELECT to_jsonb(a) AS row FROM public.enterprise_plan_access_audit a
 WHERE enterprise_id=pg_temp.f('a');
COMMIT;
```

B must now return exactly one `no_change`, not `selected`, `conflict`, a timeout,
or an error. Finish B with `COMMIT;` so any erroneous second write is observable.
In A, assert:

```sql
SELECT pg_temp.check_true('one free selection version',
 (SELECT count(*)=1 AND bool_and(selected_plan='free' AND effective_plan='free'
  AND access_state='free' AND authorization_version=1
  AND changed_by=pg_temp.f('owner_a'))
 FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('waiter leaves entire row unchanged',
 (SELECT to_jsonb(a)=(SELECT row FROM _winner)
 FROM public.enterprise_plan_access a WHERE enterprise_id=pg_temp.f('a')));
SELECT pg_temp.check_true('exactly one unchanged audit',
 (SELECT count(*)=1 FROM public.enterprise_plan_access_audit WHERE enterprise_id=pg_temp.f('a'))
 AND (SELECT jsonb_agg(to_jsonb(a) ORDER BY id)
 FROM public.enterprise_plan_access_audit a WHERE enterprise_id=pg_temp.f('a'))=
 (SELECT jsonb_agg(row ORDER BY (row->>'id')::bigint) FROM _winner_audit));
SELECT pg_temp.check_true('other tenant untouched',
 NOT EXISTS(SELECT 1 FROM public.enterprise_plan_access WHERE enterprise_id=pg_temp.f('b'))
 AND NOT EXISTS(SELECT 1 FROM public.enterprise_plan_access_audit WHERE enterprise_id=pg_temp.f('b')));
```

Close both sessions and dispose of the test database with approved environment
teardown. Fixture commits and winning selection are otherwise persistent.

## Run 2: first selector rolls back

Use a **new disposable database** and repeat setup and the two calls. Verify
blocking with `pg_blocking_pids` as above, then use `ROLLBACK` in A instead of
creating snapshots/committing. B must return exactly one `selected`: the absent
row from A was rolled back. Keep B open. In A a fresh statement must see no plan
row or audit for A (B's selection is still uncommitted). Then `ROLLBACK` in B;
assert in A that both counts are still zero. All *selection* changes rolled back;
the committed shared fixture still requires disposable-environment teardown.

## Run 3: explicit selection_required race

Use another fresh disposable database. After setup, in A commit:

```sql
BEGIN;
INSERT INTO public.enterprise_plan_access(enterprise_id,authorization_version)
VALUES (pg_temp.f('a'),7);
COMMIT;
```

Repeat Run 1 exactly, but expect final authorization_version **8**, not 1.
The first call returns `selected`, the blocked call `no_change`; assert one audit
with version 8 and unchanged full row/audit snapshots.

## Scope / gaps

These steps cover absent-row serialization, commit/replay, rollback/retry, and
explicit-row serialization. They are not evidence until run and outputs reviewed.
They do not exercise concurrent billing confirmation, owner revocation, a real
HTTP/PostgREST JWT, or SERIALIZABLE retries. Those require separately approved
integration scenarios. The sibling rollback suite checks paid/expired/cancelled
conflicts and tenant-scoped usage deterministically, not concurrent billing.

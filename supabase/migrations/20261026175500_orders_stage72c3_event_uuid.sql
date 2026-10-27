-- M7.2-C.3 compatibility: additive UUID event identity; review/manual application only.
-- Keep bigint GENERATED ALWAYS PK, FKs, ACLs and immutable row triggers unchanged.
BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('public.order_events') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
       WHERE a.attrelid='public.order_events'::regclass AND a.attname='id'
         AND a.atttypid='pg_catalog.int8'::regtype AND a.attidentity='a' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'orders_c3_event_schema_incompatible';
  END IF;
END $preflight$;
-- ADD COLUMN with a volatile DEFAULT populates each pre-existing row with its own
-- UUID during PostgreSQL's table rewrite. It is DDL, not an UPDATE: the BEFORE
-- UPDATE/DELETE row trigger is neither invoked nor disabled. NOT NULL and UNIQUE
-- validate the backfill in this transaction; any failure rolls back the DDL.
-- Requires an ACCESS EXCLUSIVE table lock and potentially a full rewrite/index
-- build: plan a maintenance window and disk/WAL headroom for large event tables.
ALTER TABLE public.order_events
  ADD COLUMN event_uuid uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
  ADD CONSTRAINT order_events_event_uuid_key UNIQUE (event_uuid);
COMMENT ON COLUMN public.order_events.event_uuid IS
  'Immutable UUID event identity for order RPC receipts; bigint primary key remains unchanged.';
COMMIT;

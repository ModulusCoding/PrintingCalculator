-- Stage 7.2-A: tenant-safe structural schema for the Orders aggregate.
-- Additive only. Does not alter closed_sales, products, inventory, plans, or auth.
-- No RPCs, operational writes, reservation execution, or direct client grants here.
BEGIN;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  display_number bigint NOT NULL,
  operational_status text NOT NULL DEFAULT 'em_conversao',
  version bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  buyer_name text NOT NULL,
  buyer_phone text,
  buyer_email text,
  buyer_address text,
  currency text NOT NULL DEFAULT 'BRL',
  subtotal numeric NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'fixed',
  discount_input numeric NOT NULL DEFAULT 0,
  discount_base numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  shipping_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,

  CONSTRAINT orders_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT orders_enterprise_display_number_key UNIQUE (enterprise_id, display_number),
  CONSTRAINT orders_creator_enterprise_fk
    FOREIGN KEY (enterprise_id, created_by)
    REFERENCES public.enterprise_members (enterprise_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT orders_display_number_check CHECK (display_number BETWEEN 1 AND 9007199254740991),
  CONSTRAINT orders_status_check CHECK (operational_status IN
    ('em_conversao', 'orcado', 'pago', 'modelando', 'imprimindo', 'entregue', 'cancelado')),
  CONSTRAINT orders_version_check CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT orders_buyer_name_check CHECK
    (pg_catalog.btrim(buyer_name) = buyer_name AND pg_catalog.length(buyer_name) BETWEEN 1 AND 255),
  CONSTRAINT orders_buyer_phone_check CHECK (buyer_phone IS NULL OR pg_catalog.length(buyer_phone) <= 50),
  CONSTRAINT orders_buyer_email_check CHECK (buyer_email IS NULL OR pg_catalog.length(buyer_email) <= 320),
  CONSTRAINT orders_buyer_address_check CHECK (buyer_address IS NULL OR pg_catalog.length(buyer_address) <= 2000),
  CONSTRAINT orders_currency_check CHECK (currency = 'BRL'),
  CONSTRAINT orders_subtotal_check CHECK
    (subtotal::text NOT IN ('NaN', 'Infinity', '-Infinity') AND subtotal BETWEEN 0 AND 999999999999.99 AND pg_catalog.scale(subtotal) <= 2),
  CONSTRAINT orders_discount_type_check CHECK (discount_type IN ('fixed', 'percent')),
  CONSTRAINT orders_discount_input_check CHECK
    (discount_input::text NOT IN ('NaN', 'Infinity', '-Infinity') AND discount_input >= 0
      AND pg_catalog.scale(discount_input) <= 2
      AND ((discount_type = 'fixed' AND discount_input <= 999999999999.99)
        OR (discount_type = 'percent' AND discount_input <= 100))),
  CONSTRAINT orders_discount_base_check CHECK
    (discount_base::text NOT IN ('NaN', 'Infinity', '-Infinity') AND discount_base BETWEEN 0 AND 999999999999.99 AND pg_catalog.scale(discount_base) <= 2),
  CONSTRAINT orders_discount_amount_check CHECK
    (discount_amount::text NOT IN ('NaN', 'Infinity', '-Infinity') AND discount_amount BETWEEN 0 AND 999999999999.99
      AND discount_amount <= discount_base AND pg_catalog.scale(discount_amount) <= 2),
  CONSTRAINT orders_discount_calculation_check CHECK (
    discount_base = subtotal
    AND discount_amount <= subtotal
    AND ((discount_type = 'fixed' AND discount_amount = pg_catalog.least(discount_input, subtotal))
      OR (discount_type = 'percent' AND discount_amount = pg_catalog.round(subtotal * discount_input / 100, 2)))
  ),
  CONSTRAINT orders_shipping_amount_check CHECK
    (shipping_amount::text NOT IN ('NaN', 'Infinity', '-Infinity') AND shipping_amount BETWEEN 0 AND 999999999999.99 AND pg_catalog.scale(shipping_amount) <= 2),
  CONSTRAINT orders_total_amount_check CHECK
    (total_amount::text NOT IN ('NaN', 'Infinity', '-Infinity') AND total_amount BETWEEN 0 AND 999999999999.99 AND pg_catalog.scale(total_amount) <= 2),
  CONSTRAINT orders_notes_check CHECK (notes IS NULL OR pg_catalog.length(notes) <= 5000),
  CONSTRAINT orders_terminal_timestamp_check CHECK (
    (operational_status = 'entregue' AND delivered_at IS NOT NULL)
    OR (operational_status <> 'entregue' AND delivered_at IS NULL)
  ),
  CONSTRAINT orders_cancel_timestamp_check CHECK (
    (operational_status = 'cancelado' AND cancelled_at IS NOT NULL)
    OR (operational_status <> 'cancelado' AND cancelled_at IS NULL)
  ),
  CONSTRAINT orders_created_at_finite_check CHECK (isfinite(created_at) AND isfinite(updated_at)),
  CONSTRAINT orders_optional_timestamps_finite_check CHECK (
    (delivered_at IS NULL OR isfinite(delivered_at))
    AND (cancelled_at IS NULL OR isfinite(cancelled_at))
    AND (archived_at IS NULL OR isfinite(archived_at))
  )
);

CREATE INDEX orders_enterprise_status_created_idx
  ON public.orders (enterprise_id, operational_status, created_at DESC, id DESC);
CREATE INDEX orders_enterprise_created_idx
  ON public.orders (enterprise_id, created_at DESC, id DESC);
CREATE INDEX orders_enterprise_archived_idx
  ON public.orders (enterprise_id, archived_at, created_at DESC, id DESC);

-- One counter row per enterprise. Future create_order locks this row, increments
-- next_number and inserts the order in the same transaction; never MAX()+1.
CREATE TABLE public.order_number_counters (
  enterprise_id uuid PRIMARY KEY REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  next_number bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT order_number_counters_next_number_check
    CHECK (next_number BETWEEN 1 AND 9007199254740991),
  CONSTRAINT order_number_counters_updated_at_finite_check CHECK (isfinite(updated_at))
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  line_number smallint NOT NULL,
  origin text NOT NULL,
  product_id uuid,
  product_name_snapshot text NOT NULL,
  product_description_snapshot text,
  quantity bigint NOT NULL,
  unit_price numeric NOT NULL,
  line_subtotal numeric NOT NULL,
  fulfillment_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT order_items_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT order_items_enterprise_order_id_key UNIQUE (enterprise_id, order_id, id),
  CONSTRAINT order_items_enterprise_order_id_product_key UNIQUE (enterprise_id, order_id, id, product_id),
  CONSTRAINT order_items_enterprise_order_line_key UNIQUE (enterprise_id, order_id, line_number),
  CONSTRAINT order_items_order_fk FOREIGN KEY (enterprise_id, order_id)
    REFERENCES public.orders (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_items_product_fk FOREIGN KEY (enterprise_id, product_id)
    REFERENCES public.products (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_items_line_number_check CHECK (line_number BETWEEN 1 AND 100),
  CONSTRAINT order_items_origin_check CHECK (origin IN ('catalog', 'custom')),
  CONSTRAINT order_items_origin_product_check CHECK (
    (origin = 'catalog' AND product_id IS NOT NULL)
    OR origin = 'custom'
  ),
  CONSTRAINT order_items_product_name_check CHECK
    (pg_catalog.btrim(product_name_snapshot) = product_name_snapshot AND pg_catalog.length(product_name_snapshot) BETWEEN 1 AND 255),
  CONSTRAINT order_items_product_description_check CHECK
    (product_description_snapshot IS NULL OR pg_catalog.length(product_description_snapshot) <= 3000),
  CONSTRAINT order_items_quantity_check CHECK (quantity BETWEEN 1 AND 1000000000),
  CONSTRAINT order_items_unit_price_check CHECK
    (unit_price::text NOT IN ('NaN', 'Infinity', '-Infinity') AND unit_price BETWEEN 0 AND 1000000 AND pg_catalog.scale(unit_price) <= 2),
  CONSTRAINT order_items_line_subtotal_check CHECK
    (line_subtotal::text NOT IN ('NaN', 'Infinity', '-Infinity') AND line_subtotal BETWEEN 0 AND 999999999999.99 AND pg_catalog.scale(line_subtotal) <= 2),
  CONSTRAINT order_items_fulfillment_mode_check CHECK
    (fulfillment_mode IN ('stock', 'make_to_order', 'untracked')),
  CONSTRAINT order_items_timestamps_finite_check CHECK (isfinite(created_at) AND isfinite(updated_at))
);

CREATE INDEX order_items_enterprise_order_idx
  ON public.order_items (enterprise_id, order_id, line_number);
CREATE INDEX order_items_enterprise_product_idx
  ON public.order_items (enterprise_id, product_id) WHERE product_id IS NOT NULL;

CREATE TABLE public.order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  order_version bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT order_events_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT order_events_order_fk FOREIGN KEY (enterprise_id, order_id)
    REFERENCES public.orders (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_events_actor_enterprise_fk FOREIGN KEY (enterprise_id, actor_id)
    REFERENCES public.enterprise_members (enterprise_id, user_id) ON DELETE RESTRICT,

  CONSTRAINT order_events_type_check CHECK (event_type IN
    ('created', 'updated', 'status_changed', 'cancelled', 'reopened', 'delivered', 'payment_received', 'payment_refunded', 'stock_allocated', 'archived')),
  CONSTRAINT order_events_from_status_check CHECK
    (from_status IS NULL OR from_status IN ('em_conversao', 'orcado', 'pago', 'modelando', 'imprimindo', 'entregue', 'cancelado')),
  CONSTRAINT order_events_to_status_check CHECK
    (to_status IS NULL OR to_status IN ('em_conversao', 'orcado', 'pago', 'modelando', 'imprimindo', 'entregue', 'cancelado')),
  CONSTRAINT order_events_status_pair_check CHECK (
    (event_type = 'created' AND from_status IS NULL AND to_status = 'em_conversao')
    OR (event_type IN ('status_changed', 'cancelled', 'reopened', 'delivered')
      AND from_status IS NOT NULL AND to_status IS NOT NULL)
    OR (event_type = 'updated' AND ((from_status IS NULL AND to_status IS NULL)
      OR (from_status IS NOT NULL AND to_status IS NOT NULL)))
    OR (event_type IN ('payment_received', 'payment_refunded', 'stock_allocated', 'archived')
      AND from_status IS NULL AND to_status IS NULL)
  ),
  CONSTRAINT order_events_version_check CHECK (order_version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT order_events_reason_check CHECK (reason IS NULL OR pg_catalog.length(reason) <= 1000),
  CONSTRAINT order_events_metadata_check CHECK
    (pg_catalog.jsonb_typeof(metadata) = 'object' AND pg_catalog.octet_length(metadata::text) <= 8192),
  CONSTRAINT order_events_recorded_at_finite_check CHECK (isfinite(recorded_at))
);

CREATE INDEX order_events_enterprise_order_history_idx
  ON public.order_events (enterprise_id, order_id, id);
CREATE INDEX order_events_enterprise_recorded_idx
  ON public.order_events (enterprise_id, recorded_at DESC, id DESC);

CREATE TABLE public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  entry_type text NOT NULL,
  amount numeric NOT NULL,
  method text NOT NULL,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  reverses_payment_id uuid,
  note text,

  CONSTRAINT order_payments_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT order_payments_enterprise_order_id_key UNIQUE (enterprise_id, order_id, id),
  CONSTRAINT order_payments_order_fk FOREIGN KEY (enterprise_id, order_id)
    REFERENCES public.orders (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_payments_actor_enterprise_fk FOREIGN KEY (enterprise_id, actor_id)
    REFERENCES public.enterprise_members (enterprise_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT order_payments_reversal_fk FOREIGN KEY (enterprise_id, order_id, reverses_payment_id)
    REFERENCES public.order_payments (enterprise_id, order_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_payments_type_check CHECK (entry_type IN ('receipt', 'refund')),
  CONSTRAINT order_payments_amount_check CHECK
    (amount::text NOT IN ('NaN', 'Infinity', '-Infinity') AND amount BETWEEN 0.01 AND 999999999999.99 AND pg_catalog.scale(amount) <= 2),
  CONSTRAINT order_payments_method_check CHECK
    (method IN ('pix', 'card', 'cash', 'bank_transfer', 'other')),
  CONSTRAINT order_payments_reversal_shape_check CHECK
    ((entry_type = 'receipt' AND reverses_payment_id IS NULL)
      OR (entry_type = 'refund' AND reverses_payment_id IS NOT NULL)),
  CONSTRAINT order_payments_not_self_reversal_check CHECK (reverses_payment_id IS NULL OR reverses_payment_id <> id),
  CONSTRAINT order_payments_note_check CHECK (note IS NULL OR pg_catalog.length(note) <= 1000),
  CONSTRAINT order_payments_timestamps_finite_check CHECK (isfinite(effective_at) AND isfinite(recorded_at))
);

CREATE INDEX order_payments_enterprise_order_history_idx
  ON public.order_payments (enterprise_id, order_id, recorded_at DESC, id DESC);
CREATE INDEX order_payments_enterprise_reversal_idx
  ON public.order_payments (enterprise_id, reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;

CREATE TABLE public.order_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  order_item_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL,
  state text NOT NULL DEFAULT 'active',
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  finalized_at timestamptz,
  finalization_reason text,

  CONSTRAINT order_stock_reservations_enterprise_id_id_key UNIQUE (enterprise_id, id),
  CONSTRAINT order_stock_reservations_order_item_fk FOREIGN KEY (enterprise_id, order_id, order_item_id)
    REFERENCES public.order_items (enterprise_id, order_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_reservations_item_product_fk FOREIGN KEY (enterprise_id, order_id, order_item_id, product_id)
    REFERENCES public.order_items (enterprise_id, order_id, id, product_id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_reservations_product_fk FOREIGN KEY (enterprise_id, product_id)
    REFERENCES public.products (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_reservations_actor_enterprise_fk FOREIGN KEY (enterprise_id, actor_id)
    REFERENCES public.enterprise_members (enterprise_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT order_stock_reservations_quantity_check CHECK (quantity BETWEEN 1 AND 1000000000),
  CONSTRAINT order_stock_reservations_state_check CHECK (state IN ('active', 'released', 'consumed')),
  CONSTRAINT order_stock_reservations_finalization_check CHECK (
    (state = 'active' AND finalized_at IS NULL AND finalization_reason IS NULL)
    OR (state IN ('released', 'consumed') AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT order_stock_reservations_reason_check CHECK
    (finalization_reason IS NULL OR pg_catalog.length(finalization_reason) <= 1000),
  CONSTRAINT order_stock_reservations_timestamps_finite_check CHECK
    (isfinite(created_at) AND (finalized_at IS NULL OR isfinite(finalized_at)))
);

-- Multiple historical cycles are retained; at most one current full allocation
-- exists for a given order item. A released/consumed row never blocks a new one.
CREATE UNIQUE INDEX order_stock_reservations_one_active_item_idx
  ON public.order_stock_reservations (enterprise_id, order_item_id)
  WHERE state = 'active';
CREATE INDEX order_stock_reservations_enterprise_product_active_idx
  ON public.order_stock_reservations (enterprise_id, product_id, order_id)
  WHERE state = 'active';
CREATE INDEX order_stock_reservations_enterprise_order_idx
  ON public.order_stock_reservations (enterprise_id, order_id, created_at, id);

CREATE TABLE private.order_operation_receipts (
  enterprise_id uuid NOT NULL REFERENCES public.enterprises(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  command_name text NOT NULL,
  attempt_id uuid NOT NULL,
  payload_hash text NOT NULL,
  order_id uuid,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT order_operation_receipts_pk
    PRIMARY KEY (enterprise_id, actor_id, command_name, attempt_id),
  CONSTRAINT order_operation_receipts_order_fk FOREIGN KEY (enterprise_id, order_id)
    REFERENCES public.orders (enterprise_id, id) ON DELETE RESTRICT,
  CONSTRAINT order_operation_receipts_actor_enterprise_fk FOREIGN KEY (enterprise_id, actor_id)
    REFERENCES public.enterprise_members (enterprise_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT order_operation_receipts_command_check CHECK
    (command_name IN ('create', 'update', 'transition', 'cancel', 'reopen', 'allocate_stock', 'deliver', 'record_payment', 'reverse_payment', 'archive')),
  CONSTRAINT order_operation_receipts_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT order_operation_receipts_result_check CHECK
    (pg_catalog.jsonb_typeof(result) = 'object' AND pg_catalog.octet_length(result::text) <= 8192),
  CONSTRAINT order_operation_receipts_created_at_finite_check CHECK (isfinite(created_at))
);

-- Operational stock linkage is intentionally deferred to M7.2-B: the local
-- inventory migration labels product_inventory_movements NEW / UNAPPLIED. Adding
-- an FK here could make this otherwise additive migration order-dependent.
-- M7.2-B must add a tenant-safe order_stock_settlements table/FKs after verifying
-- the target database's effective inventory schema.

CREATE OR REPLACE FUNCTION public.orders_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_forbid_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'order_hard_delete_forbidden' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.order_events_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'order_events_immutable' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.order_payments_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'order_payments_immutable' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.order_reservations_validate_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_reservation_delete_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'order_reservation_identity_immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.state <> 'active'
     OR NEW.state NOT IN ('released', 'consumed')
     OR NEW.finalized_at IS NULL
     OR NEW.finalized_at < OLD.created_at
     OR (NEW.state = 'released' AND NEW.finalization_reason IS NULL)
     OR (NEW.state = 'consumed' AND NEW.finalization_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'order_reservation_transition_invalid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_set_updated_at();

CREATE TRIGGER orders_forbid_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_forbid_delete();

CREATE TRIGGER order_events_immutable
BEFORE UPDATE OR DELETE ON public.order_events
FOR EACH ROW EXECUTE FUNCTION public.order_events_forbid_mutation();

CREATE TRIGGER order_payments_immutable
BEFORE UPDATE OR DELETE ON public.order_payments
FOR EACH ROW EXECUTE FUNCTION public.order_payments_forbid_mutation();

CREATE TRIGGER order_stock_reservations_transition_guard
BEFORE UPDATE OR DELETE ON public.order_stock_reservations
FOR EACH ROW EXECUTE FUNCTION public.order_reservations_validate_transition();

CREATE OR REPLACE FUNCTION public.order_number_counters_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_number_counters_set_updated_at
BEFORE UPDATE ON public.order_number_counters
FOR EACH ROW EXECUTE FUNCTION public.order_number_counters_set_updated_at();

ALTER TABLE public.orders OWNER TO postgres;
ALTER TABLE public.order_number_counters OWNER TO postgres;
ALTER TABLE public.order_items OWNER TO postgres;
ALTER TABLE public.order_events OWNER TO postgres;
ALTER TABLE public.order_payments OWNER TO postgres;
ALTER TABLE public.order_stock_reservations OWNER TO postgres;
ALTER TABLE private.order_operation_receipts OWNER TO postgres;

ALTER FUNCTION public.orders_set_updated_at() OWNER TO postgres;
ALTER FUNCTION public.orders_forbid_delete() OWNER TO postgres;
ALTER FUNCTION public.order_events_forbid_mutation() OWNER TO postgres;
ALTER FUNCTION public.order_payments_forbid_mutation() OWNER TO postgres;
ALTER FUNCTION public.order_reservations_validate_transition() OWNER TO postgres;
ALTER FUNCTION public.order_number_counters_set_updated_at() OWNER TO postgres;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.order_operation_receipts ENABLE ROW LEVEL SECURITY;

-- RLS has no client policies yet. Default-deny is intentional until narrow,
-- authorized read contracts are delivered in M7.2-C/D.
REVOKE ALL ON TABLE public.orders, public.order_number_counters, public.order_items,
  public.order_events, public.order_payments, public.order_stock_reservations
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.order_operation_receipts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.order_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.orders_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.orders_forbid_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_events_forbid_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_payments_forbid_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_reservations_validate_transition() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_number_counters_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

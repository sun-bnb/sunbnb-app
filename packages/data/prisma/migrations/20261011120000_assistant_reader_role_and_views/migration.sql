-- Track 030 (D1): a database-enforced, read-only, per-site sandbox for the partner assistant's
-- model-written SQL.
--
--   * role `assistant_reader`  - NOLOGIN here (an ops script sets LOGIN + PASSWORD; no credential
--                                ever lives in git), read-only, 3 s statement timeout, no CREATE.
--   * schema `assistant`       - friendly views exposing ONLY allowlisted columns, all
--                                security_invoker so base-table RLS applies to the invoker.
--   * signed site claim        - `assistant.current_site_id()` verifies an HMAC-signed
--                                `siteId.accountId.expiresEpoch.hexHmac` carried in the
--                                transaction-local GUC `assistant.claim`. The secret sits in a
--                                table the reader cannot read. A forged / absent / expired claim
--                                resolves to NULL, so every policy yields zero rows.
--   * RLS (ENABLE, not FORCE)  - policies are `TO assistant_reader` only; the table owner (the
--                                role every app connects as) keeps bypassing RLS, so nothing in
--                                the apps changes.
--
-- Purely additive and idempotent (roles / grants / policies / views are re-runnable). Contract
-- note: a later migration that drops/renames/retypes a column used by a view below fails with
-- "cannot drop column ... because other objects depend on it" until the view is dropped first.
-- See .claude/rules/migrations.md ("assistant views").

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── role ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'assistant_reader') THEN
    CREATE ROLE assistant_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
  END IF;
END
$$;

ALTER ROLE assistant_reader CONNECTION LIMIT 5;
ALTER ROLE assistant_reader SET statement_timeout = '3s';
ALTER ROLE assistant_reader SET lock_timeout = '2s';
ALTER ROLE assistant_reader SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE assistant_reader SET default_transaction_read_only = on;
ALTER ROLE assistant_reader SET search_path = assistant, public;

-- The role is cluster-global but privileges are per database: start from zero in this one.
-- (REVOKE FROM the role only removes grants made TO the role; PUBLIC defaults - PostGIS
-- functions, spatial_ref_sys - stay, deliberately: they are read-only reference data.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM assistant_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM assistant_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM assistant_reader;
REVOKE CREATE ON SCHEMA public FROM assistant_reader;

-- ── schema + claim secret ───────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS assistant;
REVOKE ALL ON SCHEMA assistant FROM PUBLIC;
GRANT USAGE ON SCHEMA assistant TO assistant_reader;

CREATE TABLE IF NOT EXISTS assistant.claim_secret (
  id     integer PRIMARY KEY CHECK (id = 1),
  secret bytea   NOT NULL
);
REVOKE ALL ON assistant.claim_secret FROM PUBLIC;
REVOKE ALL ON assistant.claim_secret FROM assistant_reader;
-- Belt and braces: even if a grant ever slipped in, RLS with no policy hides every row.
ALTER TABLE assistant.claim_secret ENABLE ROW LEVEL SECURITY;

-- Verifies `siteId.accountId.expiresEpoch.hexHmac` (HMAC-SHA256 over the first three fields).
-- NULL on anything wrong: no claim, malformed, no secret provisioned, bad signature, expired,
-- or expiry more than 5 minutes ahead. SECURITY DEFINER so it can read claim_secret.
CREATE OR REPLACE FUNCTION assistant.current_site_id() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  claim   text := current_setting('assistant.claim', true);
  parts   text[];
  key     bytea;
  now_ep  double precision := extract(epoch FROM now());
  exp_ep  bigint;
BEGIN
  IF claim IS NULL OR claim = '' THEN RETURN NULL; END IF;
  parts := string_to_array(claim, '.');
  IF array_length(parts, 1) IS DISTINCT FROM 4 THEN RETURN NULL; END IF;
  IF parts[1] = '' OR parts[2] = '' OR parts[3] !~ '^[0-9]{1,12}$' THEN RETURN NULL; END IF;
  SELECT s.secret INTO key FROM assistant.claim_secret s WHERE s.id = 1;
  IF key IS NULL THEN RETURN NULL; END IF;
  IF encode(hmac(convert_to(parts[1] || '.' || parts[2] || '.' || parts[3], 'UTF8'), key, 'sha256'), 'hex')
       <> lower(parts[4]) THEN
    RETURN NULL;
  END IF;
  exp_ep := parts[3]::bigint;
  IF exp_ep <= now_ep OR exp_ep > now_ep + 300 THEN RETURN NULL; END IF;
  RETURN parts[1];
END
$fn$;
REVOKE ALL ON FUNCTION assistant.current_site_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant.current_site_id() TO assistant_reader;

-- Provider label derived from a payment ref prefix (mirrors @repo/data/payment-refs). The reader
-- has no SELECT on payment_ref, and a security_invoker view cannot read a column its invoker
-- cannot, so the derivation lives in a definer function that re-checks the site itself.
CREATE OR REPLACE FUNCTION assistant.reservation_paid_via(p_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE
    WHEN r.payment_ref IS NULL OR r.payment_ref = '' THEN NULL
    WHEN r.payment_ref LIKE 'pi\_demo\_%' THEN 'demo'
    WHEN r.payment_ref LIKE 'stripe\_cs\_%' THEN 'stripe'
    WHEN r.payment_ref LIKE 'stripe\_pi\_%' THEN 'stripe-terminal'
    WHEN r.payment_ref LIKE 'tr\_%' THEN 'mollie'
    WHEN r.payment_ref LIKE 'vso\_%' THEN 'viva'
    WHEN r.payment_ref LIKE 'viva\_%' THEN 'viva-terminal'
    ELSE 'other'
  END
  FROM "Reservation" r
  WHERE r.id = p_id AND r.site_id = assistant.current_site_id()
$fn$;
REVOKE ALL ON FUNCTION assistant.reservation_paid_via(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant.reservation_paid_via(text) TO assistant_reader;

CREATE OR REPLACE FUNCTION assistant.order_paid_via(p_id text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE
    WHEN o.payment_ref IS NULL OR o.payment_ref = '' THEN NULL
    WHEN o.payment_ref LIKE 'pi\_demo\_%' THEN 'demo'
    WHEN o.payment_ref LIKE 'stripe\_cs\_%' THEN 'stripe'
    WHEN o.payment_ref LIKE 'stripe\_pi\_%' THEN 'stripe-terminal'
    WHEN o.payment_ref LIKE 'tr\_%' THEN 'mollie'
    WHEN o.payment_ref LIKE 'vso\_%' THEN 'viva'
    WHEN o.payment_ref LIKE 'viva\_%' THEN 'viva-terminal'
    ELSE 'other'
  END
  FROM "Order" o
  WHERE o.id = p_id AND o.site_id = assistant.current_site_id()
$fn$;
REVOKE ALL ON FUNCTION assistant.order_paid_via(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant.order_paid_via(text) TO assistant_reader;

-- Lenient text -> float8 for the legacy text lat/lng columns (NULL when not a plain number).
CREATE OR REPLACE FUNCTION assistant.to_num(v text) RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $fn$ SELECT CASE WHEN v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN v::double precision END $fn$;
REVOKE ALL ON FUNCTION assistant.to_num(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant.to_num(text) TO assistant_reader;

-- ── column-level grants on the base tables (required by security_invoker) ───
-- Exactly the columns the views read plus the ids the RLS policies join on. Anything not listed
-- (guest identity, payment refs, IBAN/VAT ids, notes, tokens, user ids ...) is "permission denied"
-- even when queried straight from the base table.
GRANT SELECT (id, name, description, type, status, code, slug, layout_mode, layout_width, layout_height,
              location_lat, location_lng, time_zone, price, vat, rental_vat, rental_payment_type,
              order_payment_type, app_sales_enabled, payment_provider, features, services,
              partial_group_booking_enabled, no_show_deadline_minutes, "createdAt")
  ON "Site" TO assistant_reader;
GRANT SELECT (site_id, day, open_time, close_time) ON "SiteWorkingHours" TO assistant_reader;
GRANT SELECT (id, site_id, number, seat_label, "group", item_group_id, sunbed_group_id, status,
              location_lat, location_lng, schematic_x, schematic_y, rotation, label, category, price)
  ON "InventoryItem" TO assistant_reader;
GRANT SELECT (id, site_id, parcel, row_idx, seq) ON "SunbedGroup" TO assistant_reader;
GRANT SELECT (id, number, label, rows, seats_per_row, rotation, horizontal_gap, vertical_gap, pair_gap,
              location_lat, location_lng, schematic_x, schematic_y, status, category, price)
  ON "ItemGroup" TO assistant_reader;
GRANT SELECT (id, site_id, type, shape, x, y, width, height, rotation, z, label, color)
  ON layout_element TO assistant_reader;
GRANT SELECT (id, site_id, status, operational_status, type, "from", "to", payment_amount, is_comp,
              refunded_at, checked_in_at, departed_at, split_from_id, "createdAt")
  ON "Reservation" TO assistant_reader;
GRANT SELECT ("A", "B") ON "_InventoryItemToReservation" TO assistant_reader;
GRANT SELECT (site_id, name, description, category, price, tax, "totalPrice", active, sold_out, prep_time)
  ON "Product" TO assistant_reader;
GRANT SELECT (id, site_id, status, price, tax, "totalPrice", payment_amount, seat_id, reservation_id,
              table_id, reject_reason, "createdAt", accepted_at, ready_at, delivered_at)
  ON "Order" TO assistant_reader;
GRANT SELECT (order_id, name, category, quantity, price, tax, "totalPrice") ON "OrderItem" TO assistant_reader;
GRANT SELECT (id, invoice_number, issuer_type, status, total_charge, total_tax, total_amount, processing_fee,
              reverse_charge, series_code, tipo_factura, product, reservation_id, order_id,
              credits_invoice_id, invoiced_at)
  ON "Invoice" TO assistant_reader;
GRANT SELECT (site_id, name, description, category, price_per_hour, price_per_day, total_quantity, active)
  ON "RentalItem" TO assistant_reader;

-- ── row-level security: ENABLE (owner bypasses), policies only for assistant_reader ─────────
ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "Site";
CREATE POLICY assistant_site ON "Site" FOR SELECT TO assistant_reader
  USING (id = (SELECT assistant.current_site_id()));

ALTER TABLE "SiteWorkingHours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "SiteWorkingHours";
CREATE POLICY assistant_site ON "SiteWorkingHours" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "InventoryItem";
CREATE POLICY assistant_site ON "InventoryItem" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "SunbedGroup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "SunbedGroup";
CREATE POLICY assistant_site ON "SunbedGroup" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

-- ItemGroup (a parcel) has no site_id: it belongs to the site through its sunbeds.
ALTER TABLE "ItemGroup" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "ItemGroup";
CREATE POLICY assistant_site ON "ItemGroup" FOR SELECT TO assistant_reader
  USING (id IN (SELECT i.item_group_id FROM "InventoryItem" i WHERE i.site_id = (SELECT assistant.current_site_id())));

ALTER TABLE layout_element ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON layout_element;
CREATE POLICY assistant_site ON layout_element FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "Reservation";
CREATE POLICY assistant_site ON "Reservation" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "_InventoryItemToReservation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "_InventoryItemToReservation";
CREATE POLICY assistant_site ON "_InventoryItemToReservation" FOR SELECT TO assistant_reader
  USING ("B" IN (SELECT r.id FROM "Reservation" r WHERE r.site_id = (SELECT assistant.current_site_id())));

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "Product";
CREATE POLICY assistant_site ON "Product" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "Order";
CREATE POLICY assistant_site ON "Order" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "OrderItem";
CREATE POLICY assistant_site ON "OrderItem" FOR SELECT TO assistant_reader
  USING (order_id IN (SELECT o.id FROM "Order" o WHERE o.site_id = (SELECT assistant.current_site_id())));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "Invoice";
CREATE POLICY assistant_site ON "Invoice" FOR SELECT TO assistant_reader
  USING (
    reservation_id IN (SELECT r.id FROM "Reservation" r WHERE r.site_id = (SELECT assistant.current_site_id()))
    OR order_id IN (SELECT o.id FROM "Order" o WHERE o.site_id = (SELECT assistant.current_site_id()))
  );

ALTER TABLE "RentalItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_site ON "RentalItem";
CREATE POLICY assistant_site ON "RentalItem" FOR SELECT TO assistant_reader
  USING (site_id = (SELECT assistant.current_site_id()));

-- ── views (friendly names; real cuids only where another view joins on them) ─
-- Stored timestamps are UTC `timestamp` columns; the views expose timestamptz so the session
-- TimeZone (the runner sets the site's zone) renders them in local time.
CREATE OR REPLACE VIEW assistant.site WITH (security_invoker = true, security_barrier = true) AS
SELECT s.name, s.description, s.type, s.status, s.code, s.slug, s.layout_mode, s.layout_width, s.layout_height,
       assistant.to_num(s.location_lat) AS lat, assistant.to_num(s.location_lng) AS lng, s.time_zone,
       s.price AS default_seat_price, s.vat, s.rental_vat, s.rental_payment_type, s.order_payment_type,
       s.app_sales_enabled, s.payment_provider, s.features, s.services, s.partial_group_booking_enabled,
       s.no_show_deadline_minutes, s."createdAt" AT TIME ZONE 'UTC' AS created_at
FROM "Site" s;

CREATE OR REPLACE VIEW assistant.parcel WITH (security_invoker = true, security_barrier = true) AS
SELECT g.id, g.number, g.label, g.rows, g.seats_per_row, g.rotation,
       g.horizontal_gap AS gap_between_seats, g.vertical_gap AS gap_between_rows, g.pair_gap AS gap_between_paired_beds,
       assistant.to_num(g.location_lat) AS anchor_lat, assistant.to_num(g.location_lng) AS anchor_lng,
       g.schematic_x AS anchor_x, g.schematic_y AS anchor_y, g.status, g.category, g.price
FROM "ItemGroup" g;

CREATE OR REPLACE VIEW assistant.unit WITH (security_invoker = true, security_barrier = true) AS
SELECT u.id, u.parcel, u.row_idx, u.seq,
       (SELECT count(*)::int FROM "InventoryItem" i WHERE i.sunbed_group_id = u.id) AS sunbed_count
FROM "SunbedGroup" u;

CREATE OR REPLACE VIEW assistant.sunbed WITH (security_invoker = true, security_barrier = true) AS
SELECT i.id, i.number, i.seat_label, i."group" AS parcel, i.item_group_id AS parcel_id, i.sunbed_group_id AS unit_id,
       (i.sunbed_group_id IS NOT NULL AND count(*) OVER (PARTITION BY i.sunbed_group_id) > 1) AS paired,
       i.status, assistant.to_num(i.location_lat) AS lat, assistant.to_num(i.location_lng) AS lng,
       i.schematic_x AS x, i.schematic_y AS y, i.rotation, i.label, i.category, i.price
FROM "InventoryItem" i;

CREATE OR REPLACE VIEW assistant.layout_element WITH (security_invoker = true, security_barrier = true) AS
SELECT right(e.id, 6) AS handle, e.type, e.shape, e.x, e.y, e.width, e.height, e.rotation, e.z, e.label, e.color
FROM public.layout_element e;

CREATE OR REPLACE VIEW assistant.product WITH (security_invoker = true, security_barrier = true) AS
SELECT p.name, p.description, p.category, p.price, p.tax, p."totalPrice" AS total_price, p.active, p.sold_out, p.prep_time
FROM "Product" p;

CREATE OR REPLACE VIEW assistant.rental_item WITH (security_invoker = true, security_barrier = true) AS
SELECT r.name, r.description, r.category, r.price_per_hour, r.price_per_day, r.total_quantity, r.active
FROM "RentalItem" r;

CREATE OR REPLACE VIEW assistant.working_hours WITH (security_invoker = true, security_barrier = true) AS
SELECT w.day, to_char(w.open_time, 'HH24:MI') AS open_time, to_char(w.close_time, 'HH24:MI') AS close_time
FROM "SiteWorkingHours" w;

CREATE OR REPLACE VIEW assistant.reservation WITH (security_invoker = true, security_barrier = true) AS
SELECT r.id, r.status, r.operational_status, r.type,
       r."from" AT TIME ZONE 'UTC' AS starts_at, r."to" AT TIME ZONE 'UTC' AS ends_at,
       r.payment_amount AS amount, assistant.reservation_paid_via(r.id) AS paid_via, r.is_comp,
       r.refunded_at AT TIME ZONE 'UTC' AS refunded_at, r.checked_in_at AT TIME ZONE 'UTC' AS checked_in_at,
       r.departed_at AT TIME ZONE 'UTC' AS departed_at, r.split_from_id,
       (SELECT count(*)::int FROM "_InventoryItemToReservation" x WHERE x."B" = r.id) AS seat_count,
       r."createdAt" AT TIME ZONE 'UTC' AS created_at
FROM "Reservation" r;

CREATE OR REPLACE VIEW assistant.reservation_seat WITH (security_invoker = true, security_barrier = true) AS
SELECT x."B" AS reservation_id, x."A" AS sunbed_id
FROM "_InventoryItemToReservation" x;

CREATE OR REPLACE VIEW assistant.food_order WITH (security_invoker = true, security_barrier = true) AS
SELECT o.id, o.status, o.price, o.tax, o."totalPrice" AS total_price, o.payment_amount AS amount,
       assistant.order_paid_via(o.id) AS paid_via, o.seat_id AS sunbed_id, o.reservation_id, o.table_id AS table_label,
       o.reject_reason, o."createdAt" AT TIME ZONE 'UTC' AS created_at, o.accepted_at AT TIME ZONE 'UTC' AS accepted_at,
       o.ready_at AT TIME ZONE 'UTC' AS ready_at, o.delivered_at AT TIME ZONE 'UTC' AS delivered_at
FROM "Order" o;

CREATE OR REPLACE VIEW assistant.food_order_item WITH (security_invoker = true, security_barrier = true) AS
SELECT i.order_id, i.name, i.category, i.quantity, i.price, i.tax, i."totalPrice" AS total_price
FROM "OrderItem" i;

CREATE OR REPLACE VIEW assistant.invoice WITH (security_invoker = true, security_barrier = true) AS
SELECT v.id, v.invoice_number, v.issuer_type, v.status, v.total_charge, v.total_tax, v.total_amount, v.processing_fee,
       v.reverse_charge, v.series_code, v.tipo_factura, v.product, v.reservation_id, v.order_id, v.credits_invoice_id,
       v.invoiced_at AT TIME ZONE 'UTC' AS invoiced_at
FROM "Invoice" v;

GRANT SELECT ON assistant.site, assistant.parcel, assistant.unit, assistant.sunbed, assistant.layout_element,
  assistant.product, assistant.rental_item, assistant.working_hours, assistant.reservation,
  assistant.reservation_seat, assistant.food_order, assistant.food_order_item, assistant.invoice
  TO assistant_reader;

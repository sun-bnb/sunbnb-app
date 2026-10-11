/**
 * The per-site data snapshot the assistant's `sql` tool queries (track 030 G1).
 *
 * WHY a copy: model-written SQL cannot be tenant-isolated against the real database (a `SET` /
 * `set_config` defeats GUC- or RLS-based scoping), so `load.ts` copies ONLY the open site's rows,
 * ONLY the columns listed here, into a throwaway in-process Postgres (PGlite) and the model
 * queries that.
 *
 * THIS FILE IS THE ALLOWLIST. A column reaches the model only if it is listed below AND `load.ts`
 * maps it — new Prisma columns are never exposed automatically. Join keys are per-snapshot
 * surrogate integers (`id` 1..n), never the real cuids, so nothing the model reads can be passed
 * back to a write tool as an id; the model-facing handles stay parcel numbers, seat labels,
 * element handles and names.
 *
 * To expose a new column: (1) add it to the table below with a one-line doc (the doc is shown to
 * the model in the tool description), (2) map it in that table's mapper in `load.ts`, (3) make
 * sure its name does not match `DENIED_COLUMN` — the test fails otherwise, and the deny-list is
 * deliberately never relaxed for convenience (no IBAN, tokens, payment refs, emails, phones,
 * personal ids, provider ids, guest names).
 */

export type SqlType = 'text' | 'integer' | 'double precision' | 'boolean' | 'timestamptz' | 'date' | 'text[]'

export interface ColumnDef {
  name: string
  type: SqlType
  doc: string
}

export interface TableDef {
  name: string
  doc: string
  columns: readonly ColumnDef[]
}

const c = (name: string, type: SqlType, doc: string): ColumnDef => ({ name, type, doc })
const ID = c('id', 'integer', 'snapshot row id (join key only)')

export const SNAPSHOT_TABLES = [
  {
    name: 'site',
    doc: 'the open site (one row)',
    columns: [
      c('name', 'text', ''),
      c('description', 'text', ''),
      c('type', 'text', 'venue type'),
      c('status', 'text', ''),
      c('code', 'text', 'public site code printed on QR cards'),
      c('slug', 'text', 'public page slug'),
      c('layout_mode', 'text', "'geo' = seats on the map (lat/lng), 'schematic' = seats on a plan (x/y metres)"),
      c('layout_width', 'double precision', 'schematic canvas width, m'),
      c('layout_height', 'double precision', 'schematic canvas height, m'),
      c('lat', 'double precision', 'site centre'),
      c('lng', 'double precision', 'site centre'),
      c('time_zone', 'text', 'IANA zone; this database runs in it'),
      c('default_seat_price', 'double precision', 'site-level sunbed price per day (VAT incl.)'),
      c('vat', 'double precision', 'sunbed VAT %'),
      c('rental_vat', 'double precision', 'rental VAT %'),
      c('rental_payment_type', 'text', ''),
      c('order_payment_type', 'text', ''),
      c('app_sales_enabled', 'boolean', 'online sales on'),
      c('payment_provider', 'text', 'effective consumer payment rail name'),
      c('features', 'text[]', "e.g. {sunbeds,rentals}"),
      c('services', 'text[]', 'amenities shown to guests'),
      c('partial_group_booking_enabled', 'boolean', 'guests may book part of a unit'),
      c('no_show_deadline_minutes', 'integer', ''),
      c('created_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'parcel',
    doc: 'parcels = blocks of sunbeds generated as a grid (ItemGroup)',
    columns: [
      ID,
      c('number', 'integer', 'parcel number shown on the map (the handle for parcel tools)'),
      c('label', 'text', ''),
      c('rows', 'integer', ''),
      c('seats_per_row', 'integer', ''),
      c('rotation', 'integer', 'degrees'),
      c('gap_between_seats', 'double precision', 'm'),
      c('gap_between_rows', 'double precision', 'm'),
      c('gap_between_paired_beds', 'double precision', 'm'),
      c('anchor_lat', 'double precision', 'geo anchor (first seat corner)'),
      c('anchor_lng', 'double precision', ''),
      c('anchor_x', 'double precision', 'schematic anchor, m'),
      c('anchor_y', 'double precision', ''),
      c('status', 'text', ''),
      c('category', 'text', 'price category'),
      c('price', 'double precision', 'parcel price per seat per day, overrides the site price'),
    ],
  },
  {
    name: 'seat',
    doc: 'every sunbed (InventoryItem)',
    columns: [
      ID,
      c('number', 'integer', 'internal running number'),
      c('seat_label', 'text', "stored label 'parcel-RowSeq-member', e.g. '3-102-1'"),
      c('parcel', 'integer', 'parcel number; 0 = in no parcel'),
      c('parcel_id', 'integer', 'FK parcel.id'),
      c('unit_id', 'integer', 'beds standing together under one parasol share a unit_id'),
      c('paired', 'boolean', 'unit has more than one bed'),
      c('status', 'text', "'active' | 'disabled' | 'new' | 'pool' (unplaced spare)"),
      c('lat', 'double precision', 'geo sites'),
      c('lng', 'double precision', ''),
      c('x', 'double precision', 'schematic sites, m'),
      c('y', 'double precision', ''),
      c('rotation', 'integer', 'degrees'),
      c('label', 'text', 'custom display label'),
      c('category', 'text', ''),
      c('price', 'double precision', 'own price per day; NULL = parcel/site price'),
    ],
  },
  {
    name: 'layout_element',
    doc: 'non-seat things on the map/plan (bar, water, path, ...)',
    columns: [
      ID,
      c('handle', 'text', 'the element handle used by the layout tools'),
      c('type', 'text', ''),
      c('shape', 'text', ''),
      c('x', 'double precision', 'm'),
      c('y', 'double precision', 'm'),
      c('width', 'double precision', 'm'),
      c('height', 'double precision', 'm'),
      c('rotation', 'double precision', 'degrees'),
      c('z', 'integer', 'stacking order'),
      c('label', 'text', ''),
      c('color', 'text', ''),
    ],
  },
  {
    name: 'product',
    doc: 'food & drink menu',
    columns: [
      ID,
      c('name', 'text', ''),
      c('description', 'text', ''),
      c('category', 'text', ''),
      c('price', 'double precision', 'net'),
      c('tax', 'double precision', 'VAT amount'),
      c('total_price', 'double precision', 'VAT incl. (what guests pay)'),
      c('active', 'boolean', ''),
      c('sold_out', 'boolean', ''),
      c('prep_time', 'integer', 'minutes'),
    ],
  },
  {
    name: 'rental_item',
    doc: 'rentable equipment',
    columns: [
      ID,
      c('name', 'text', ''),
      c('description', 'text', ''),
      c('category', 'text', ''),
      c('price_per_hour', 'double precision', ''),
      c('price_per_day', 'double precision', ''),
      c('total_quantity', 'integer', ''),
      c('active', 'boolean', ''),
    ],
  },
  {
    name: 'working_hours',
    doc: 'opening ranges',
    columns: [
      c('day', 'integer', '0 = Sunday .. 6 = Saturday'),
      c('open_time', 'text', "'HH:MM' local"),
      c('close_time', 'text', "'HH:MM' local"),
    ],
  },
  {
    name: 'reservation',
    doc: 'sunbed bookings, newest first, capped (see snapshot_info). No guest identity',
    columns: [
      ID,
      c('status', 'text', "payment status: 'pending' | 'confirmed' | 'cancelled' | ..."),
      c('operational_status', 'text', "'expected' | 'checked-in' | 'walked-in' | 'departed' | 'no-show' | 'comp'"),
      c('type', 'text', "'days' (sunbeds) or 'hours'"),
      c('starts_at', 'timestamptz', ''),
      c('ends_at', 'timestamptz', ''),
      c('amount', 'double precision', 'amount paid, VAT incl.; NULL = unpaid/held'),
      c('paid_via', 'text', "'mollie' | 'stripe' | 'stripe-terminal' | 'viva' | 'viva-terminal' | 'demo' | 'other' | NULL (cash/none)"),
      c('is_comp', 'boolean', 'complimentary'),
      c('refunded_at', 'timestamptz', ''),
      c('checked_in_at', 'timestamptz', ''),
      c('departed_at', 'timestamptz', ''),
      c('split_from_id', 'integer', 'FK reservation.id it was split from'),
      c('seat_count', 'integer', ''),
      c('created_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'reservation_seat',
    doc: 'which seats a reservation holds',
    columns: [c('reservation_id', 'integer', 'FK reservation.id'), c('seat_id', 'integer', 'FK seat.id')],
  },
  {
    name: 'food_order',
    doc: "F&B orders ('order' is reserved), newest first, capped. No guest notes",
    columns: [
      ID,
      c('status', 'text', ''),
      c('price', 'double precision', 'net'),
      c('tax', 'double precision', ''),
      c('total_price', 'double precision', 'VAT incl.'),
      c('amount', 'double precision', 'amount paid'),
      c('paid_via', 'text', 'as reservation.paid_via'),
      c('seat_id', 'integer', 'FK seat.id delivered to'),
      c('reservation_id', 'integer', 'FK reservation.id'),
      c('table_label', 'text', 'dine-in table'),
      c('reject_reason', 'text', ''),
      c('created_at', 'timestamptz', ''),
      c('accepted_at', 'timestamptz', ''),
      c('ready_at', 'timestamptz', ''),
      c('delivered_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'food_order_item',
    doc: 'order lines',
    columns: [
      c('order_id', 'integer', 'FK food_order.id'),
      c('name', 'text', 'product name at order time'),
      c('category', 'text', ''),
      c('quantity', 'integer', ''),
      c('price', 'double precision', 'net unit price'),
      c('tax', 'double precision', ''),
      c('total_price', 'double precision', 'VAT incl.'),
    ],
  },
  {
    name: 'invoice',
    doc: "invoices of this site's reservations and orders. PARTNER = your receipt to the guest (gross); PLATFORM = Sunbnb's commission invoice to you; they do not sum",
    columns: [
      ID,
      c('invoice_number', 'text', ''),
      c('issuer_type', 'text', "'PARTNER' | 'PLATFORM'"),
      c('status', 'text', ''),
      c('total_charge', 'double precision', 'net'),
      c('total_tax', 'double precision', 'VAT'),
      c('total_amount', 'double precision', 'gross'),
      c('processing_fee', 'double precision', 'payment processing fee, VAT-exempt'),
      c('reverse_charge', 'boolean', 'EU B2B reverse charge (0 VAT)'),
      c('series_code', 'text', "'F' invoice | 'R' credit note"),
      c('tipo_factura', 'text', ''),
      c('product', 'text', ''),
      c('reservation_id', 'integer', 'FK reservation.id'),
      c('order_id', 'integer', 'FK food_order.id'),
      c('credits_invoice_id', 'integer', 'credit note: FK invoice.id it rectifies'),
      c('invoiced_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'snapshot_info',
    doc: 'one row about this copy',
    columns: [
      c('loaded_at', 'timestamptz', 'data is as of this moment'),
      c('reservations_total', 'integer', 'all reservations of the site'),
      c('reservations_loaded', 'integer', ''),
      c('orders_total', 'integer', ''),
      c('orders_loaded', 'integer', ''),
    ],
  },
] as const satisfies readonly TableDef[]

export type SnapshotTableName = (typeof SNAPSHOT_TABLES)[number]['name']

export interface ViewDef {
  name: string
  doc: string
  sql: string
}

export const SNAPSHOT_VIEWS: readonly ViewDef[] = [
  {
    name: 'parcel_summary',
    doc: 'per parcel: number, rows, seats_per_row, seats, active, disabled, new_seats, units, price, category',
    sql: `SELECT p.number, p.rows, p.seats_per_row, count(s.id)::int AS seats,
        count(*) FILTER (WHERE s.status = 'active')::int AS active,
        count(*) FILTER (WHERE s.status = 'disabled')::int AS disabled,
        count(*) FILTER (WHERE s.status = 'new')::int AS new_seats,
        count(DISTINCT s.unit_id)::int AS units, p.price, p.category
      FROM parcel p LEFT JOIN seat s ON s.parcel_id = p.id AND s.status <> 'pool'
      GROUP BY p.id ORDER BY p.number`,
  },
  {
    name: 'reservation_seat_label',
    doc: 'reservation_id, starts_at, ends_at, status, seat_label, parcel — one row per booked seat',
    sql: `SELECT r.id AS reservation_id, r.starts_at, r.ends_at, r.status, s.seat_label, s.parcel
      FROM reservation r JOIN reservation_seat rs ON rs.reservation_id = r.id JOIN seat s ON s.id = rs.seat_id`,
  },
]

/**
 * Column names that must NEVER exist in the snapshot, whatever a future edit adds. Matched
 * against every table and view column (test: `snapshot.test.ts`).
 */
export const DENIED_COLUMN =
  /iban|bank|token|secret|password|hash|payment_?ref|ref$|email|phone|contact|guest|anon|user_?id|employee|account|vat_?number|nif|dni|passport|personal|kyc|stripe|mollie|_viva|viva_|provider_id|terminal|recipient|issuer_(vat|company)|notes?$/i

/** Compact schema listing for the tool description: `table — doc: col type (doc), ...`. */
export function describeSnapshotSchema(): string {
  const tables = SNAPSHOT_TABLES.map((t) => {
    const cols = t.columns.map((col) => `${col.name} ${col.type === 'double precision' ? 'float' : col.type}${col.doc ? ` (${col.doc})` : ''}`)
    return `${t.name} — ${t.doc}: ${cols.join(', ')}`
  })
  const views = SNAPSHOT_VIEWS.map((v) => `view ${v.name}: ${v.doc}`)
  return [...tables, ...views].join('\n')
}

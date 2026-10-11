/**
 * Static description of the `assistant.*` views the `sql` tool queries (track 030 D2).
 *
 * The views live in Postgres (migration `20261011120000_assistant_reader_role_and_views`, owned by
 * `packages/data`); Postgres is the allowlist and the tenant boundary (role `assistant_reader`,
 * column grants, RLS on a signed site claim). THIS file only tells the model what exists, so it is
 * pure documentation: a column listed here that the view lacks fails the integration test
 * (`sql.integration.test.ts` compares it with the live view's columns), and the unit test refuses
 * any column name matching `DENIED_COLUMN`.
 *
 * Ids: real cuids appear only where another view joins on them (parcel/unit/sunbed/reservation/
 * food_order/invoice `id`). They are join keys, never names -- refer to parcels by number, seats by
 * seat_label, elements by handle, products by name.
 */

export type SqlType = 'text' | 'integer' | 'double precision' | 'boolean' | 'timestamptz' | 'text[]'

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
const ID = c('id', 'text', 'join key only')

export const ASSISTANT_VIEWS = [
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
      c('time_zone', 'text', 'IANA zone; timestamps render in it'),
      c('default_seat_price', 'double precision', 'site-level sunbed price per day (VAT incl.)'),
      c('vat', 'double precision', 'sunbed VAT %'),
      c('rental_vat', 'double precision', 'rental VAT %'),
      c('rental_payment_type', 'text', ''),
      c('order_payment_type', 'text', ''),
      c('app_sales_enabled', 'boolean', 'online sales on'),
      c('payment_provider', 'text', 'effective consumer payment rail name'),
      c('features', 'text[]', 'e.g. {sunbeds,rentals}'),
      c('services', 'text[]', 'amenities shown to guests'),
      c('partial_group_booking_enabled', 'boolean', 'guests may book part of a unit'),
      c('no_show_deadline_minutes', 'integer', ''),
      c('created_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'parcel',
    doc: 'parcels = blocks of sunbeds generated as a grid',
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
    name: 'unit',
    doc: 'a spot under one parasol: one bed or a pair; the thing a QR card and a device name',
    columns: [
      ID,
      c('parcel', 'integer', 'parcel number'),
      c('row_idx', 'integer', 'row inside the parcel'),
      c('seq', 'integer', 'position inside the row'),
      c('sunbed_count', 'integer', 'beds in the unit (2 = a pair)'),
    ],
  },
  {
    name: 'sunbed',
    doc: 'every sunbed / seat',
    columns: [
      ID,
      c('number', 'integer', 'internal running number'),
      c('seat_label', 'text', "stored label 'parcel-RowSeq-member', e.g. '3-102-1'"),
      c('parcel', 'integer', 'parcel number; 0 = in no parcel'),
      c('parcel_id', 'text', 'FK parcel.id'),
      c('unit_id', 'text', 'FK unit.id; beds sharing a unit_id stand together under one parasol'),
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
      c('open_time', 'text', "'HH24:MI' local"),
      c('close_time', 'text', "'HH24:MI' local"),
    ],
  },
  {
    name: 'reservation',
    doc: 'sunbed bookings. No guest identity',
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
      c('split_from_id', 'text', 'FK reservation.id it was split from'),
      c('seat_count', 'integer', ''),
      c('created_at', 'timestamptz', ''),
    ],
  },
  {
    name: 'reservation_seat',
    doc: 'which sunbeds a reservation holds',
    columns: [c('reservation_id', 'text', 'FK reservation.id'), c('sunbed_id', 'text', 'FK sunbed.id')],
  },
  {
    name: 'food_order',
    doc: 'F&B orders. No guest notes',
    columns: [
      ID,
      c('status', 'text', ''),
      c('price', 'double precision', 'net'),
      c('tax', 'double precision', ''),
      c('total_price', 'double precision', 'VAT incl.'),
      c('amount', 'double precision', 'amount paid'),
      c('paid_via', 'text', 'as reservation.paid_via'),
      c('sunbed_id', 'text', 'FK sunbed.id delivered to'),
      c('reservation_id', 'text', 'FK reservation.id'),
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
      c('order_id', 'text', 'FK food_order.id'),
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
      c('reservation_id', 'text', 'FK reservation.id'),
      c('order_id', 'text', 'FK food_order.id'),
      c('credits_invoice_id', 'text', 'credit note: FK invoice.id it rectifies'),
      c('invoiced_at', 'timestamptz', ''),
    ],
  },
] as const satisfies readonly TableDef[]

export type AssistantViewName = (typeof ASSISTANT_VIEWS)[number]['name']
export const VIEW_NAMES: readonly AssistantViewName[] = ASSISTANT_VIEWS.map((v) => v.name)

/**
 * Column names that must NEVER be documented (or exist) in these views, whatever a future edit adds.
 * Defence in depth on top of the database column grants (test: `sql-schema.test.ts`).
 */
export const DENIED_COLUMN =
  /iban|bank|token|secret|password|hash|payment_?ref|ref$|email|phone|contact|guest|anon|user_?id|employee|account|vat_?number|nif|dni|passport|personal|kyc|stripe|mollie|_viva|viva_|provider_id|terminal|recipient|issuer_(vat|company)|notes?$/i

/** Compact schema listing for tool descriptions: `view -- doc: col type (doc), ...`. */
export function describeAssistantSchema(): string {
  return ASSISTANT_VIEWS.map((t) => {
    const cols = t.columns.map((col) => `${col.name} ${col.type === 'double precision' ? 'float' : col.type}${col.doc ? ` (${col.doc})` : ''}`)
    return `${t.name} -- ${t.doc}: ${cols.join(', ')}`
  }).join('\n')
}

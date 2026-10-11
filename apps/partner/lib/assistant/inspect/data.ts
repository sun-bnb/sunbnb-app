/**
 * `data` aspect: the entity-relationship model of what `sql` can query. Views, columns, types and
 * meanings are GENERATED from `sql-schema.ts` (the static description of the `assistant.*` views),
 * so a column added there shows up here. Only the relationships and their example queries are
 * written by hand (`RELATIONSHIPS`); the unit test checks every one against the schema and the
 * integration test (`sql.integration.test.ts`) runs the examples and the column lists against the
 * real `assistant_reader` views.
 */
import { assistantDataConfigured, DATA_ACCESS_NOT_CONFIGURED } from '../data-access'
import { ASSISTANT_VIEWS, type ColumnDef } from '../sql-schema'
import type { InspectProvider } from './types'

export interface Relationship {
  /** `table.column` on the many side (or `table` when the link is implicit). */
  from: string
  /** `table.column` on the one side (or `table`). */
  to: string
  meaning: string
  sql: string
}

export const RELATIONSHIPS: readonly Relationship[] = [
  {
    from: 'site',
    to: 'parcel',
    meaning: 'Every view holds ONE site: every row in every view belongs to the open site, so there is no site_id to join or filter on.',
    sql: 'SELECT s.name, s.layout_mode, (SELECT count(*) FROM parcel) AS parcels FROM site s',
  },
  {
    from: 'sunbed.parcel_id',
    to: 'parcel.id',
    meaning: 'A parcel (grid block of sunbeds) holds many sunbeds. sunbed.parcel is the parcel NUMBER (0 = none); sunbed.parcel_id is the join key.',
    sql: "SELECT p.number, count(*) AS seats FROM parcel p JOIN sunbed s ON s.parcel_id = p.id WHERE s.status <> 'pool' GROUP BY p.number ORDER BY p.number",
  },
  {
    from: 'sunbed.unit_id',
    to: 'unit.id',
    meaning: 'Beds sharing a unit_id stand under one parasol (a pair). A unit is the spot a QR card and a device name.',
    sql: 'SELECT u.parcel, u.row_idx, u.seq, u.sunbed_count FROM unit u WHERE u.sunbed_count > 1 ORDER BY u.parcel, u.row_idx, u.seq LIMIT 20',
  },
  {
    from: 'reservation_seat.reservation_id',
    to: 'reservation.id',
    meaning: 'A reservation holds one or more sunbeds through reservation_seat (many to many with sunbed).',
    sql: 'SELECT r.id, r.starts_at, count(rs.sunbed_id) AS seats FROM reservation r JOIN reservation_seat rs ON rs.reservation_id = r.id GROUP BY r.id, r.starts_at ORDER BY r.starts_at DESC LIMIT 10',
  },
  {
    from: 'reservation_seat.sunbed_id',
    to: 'sunbed.id',
    meaning: 'Which physical sunbeds a booking holds; join sunbed for the seat_label.',
    sql: "SELECT s.seat_label, count(*) AS bookings FROM reservation r JOIN reservation_seat rs ON rs.reservation_id = r.id JOIN sunbed s ON s.id = rs.sunbed_id WHERE r.status = 'confirmed' GROUP BY s.seat_label ORDER BY bookings DESC LIMIT 10",
  },
  {
    from: 'reservation.split_from_id',
    to: 'reservation.id',
    meaning: 'A reservation created by splitting another one (depart / per-seat split) points at its origin.',
    sql: 'SELECT id, split_from_id FROM reservation WHERE split_from_id IS NOT NULL LIMIT 10',
  },
  {
    from: 'food_order.sunbed_id',
    to: 'sunbed.id',
    meaning: 'The sunbed an F&B order is delivered to (null for dine-in tables, see table_label).',
    sql: 'SELECT s.seat_label, count(*) AS orders, sum(o.total_price) AS revenue FROM food_order o JOIN sunbed s ON s.id = o.sunbed_id GROUP BY s.seat_label ORDER BY revenue DESC LIMIT 10',
  },
  {
    from: 'food_order.reservation_id',
    to: 'reservation.id',
    meaning: 'The booking an order was placed under, when there is one.',
    sql: 'SELECT r.id, count(o.id) AS orders FROM reservation r JOIN food_order o ON o.reservation_id = r.id GROUP BY r.id ORDER BY orders DESC LIMIT 10',
  },
  {
    from: 'food_order_item.order_id',
    to: 'food_order.id',
    meaning: 'Order lines. name is the product name at order time (join to product by name, not id).',
    sql: 'SELECT name, sum(quantity) AS sold FROM food_order_item GROUP BY name ORDER BY sold DESC LIMIT 10',
  },
  {
    from: 'invoice.reservation_id',
    to: 'reservation.id',
    meaning: 'Invoices of a booking: a PARTNER receipt (gross) and a PLATFORM commission invoice; they do not sum.',
    sql: 'SELECT issuer_type, count(*) AS invoices, sum(total_amount) AS gross FROM invoice WHERE reservation_id IS NOT NULL GROUP BY issuer_type',
  },
  {
    from: 'invoice.order_id',
    to: 'food_order.id',
    meaning: 'Invoices of an F&B order.',
    sql: 'SELECT issuer_type, sum(total_amount) AS gross FROM invoice WHERE order_id IS NOT NULL GROUP BY issuer_type',
  },
  {
    from: 'invoice.credits_invoice_id',
    to: 'invoice.id',
    meaning: 'A credit note (series_code R) points at the invoice it rectifies.',
    sql: 'SELECT id, invoice_number, credits_invoice_id FROM invoice WHERE credits_invoice_id IS NOT NULL LIMIT 10',
  },
  {
    from: 'layout_element',
    to: 'sunbed',
    meaning: 'Schematic sites only: elements (water, bar, deck) and sunbeds share the x/y metre canvas; relate them with describe_site_area / measure rather than SQL. PostGIS (ST_Distance, ST_MakePoint ...) is available for ad-hoc geometry.',
    sql: 'SELECT type, label, x, y, width, height FROM layout_element ORDER BY z LIMIT 20',
  },
  {
    from: 'product',
    to: 'food_order_item',
    meaning: 'Menu items; order lines keep their own name/price copies, so history survives product edits.',
    sql: 'SELECT name, category, total_price, active, sold_out FROM product ORDER BY category, name LIMIT 30',
  },
  {
    from: 'rental_item',
    to: 'working_hours',
    meaning: 'Rental equipment and opening hours are standalone catalogues (rental bookings are not queryable).',
    sql: 'SELECT day, open_time, close_time FROM working_hours ORDER BY day, open_time',
  },
]

const TREE =
  'site (1 row) -> parcel -> unit -> sunbed; layout_element, product, rental_item, working_hours hang off the site; reservation <-> sunbed via reservation_seat; food_order -> food_order_item; invoice -> reservation | food_order. All are views in schema `assistant` (bare names work).'

/** Unit hint derived from the column's name/doc/type so the model reads numbers correctly. */
export function columnUnit(table: string, col: ColumnDef): string | null {
  const n = col.name
  if (/(^|_)(lat|lng)$/.test(n)) return 'degrees (WGS84)'
  if (/rotation$/.test(n)) return 'degrees'
  if (/^gap_|^layout_(width|height)$|^(width|height)$|(^|_)(x|y)$/.test(n)) return 'metres'
  if (/(^|_)vat$/.test(n)) return 'percent'
  if (/minutes$/.test(n) || n === 'prep_time') return 'minutes'
  if (col.type === 'timestamptz') return 'timestamp (site time zone)'
  if (col.type === 'double precision' && /price|amount|tax|charge|fee/.test(n)) return table === 'sunbed' || table === 'parcel' ? 'EUR per day' : 'EUR'
  return null
}

const involves = (rel: Relationship, table: string) => rel.from.split('.')[0] === table || rel.to.split('.')[0] === table

export const dataProvider: InspectProvider = {
  name: 'data',
  summary: 'Entity-relationship model of the site data the sql tool can query: views, columns with meaning and units, keys, relationships, example SQL.',
  examples: ['What tables and columns can I query?', 'How do reservations connect to seats?', 'Where do I find revenue per product?'],
  topics: 'a view name (e.g. sunbed, reservation, parcel) for its columns and relationships',
  describe(_ctx, topic) {
    if (!assistantDataConfigured()) {
      return { ok: false, error: DATA_ACCESS_NOT_CONFIGURED, reason: DATA_ACCESS_NOT_CONFIGURED, detail: 'The sql tool is switched off on this deployment, so there is no queryable data model. Use the specific read tools.' }
    }
    if (!topic) {
      return {
        ok: true,
        model: TREE,
        tables: ASSISTANT_VIEWS.map((t) => ({ name: t.name, about: t.doc, columns: t.columns.length })),
        relationships: RELATIONSHIPS.map((r) => ({ from: r.from, to: r.to, meaning: r.meaning, sql: r.sql })),
        notes: [
          'The data is live and limited to the open site by the database: there is no site_id, and other sites cannot be read.',
          'Join keys (id, *_id, unit_id) are opaque ids: use them to join, never to name things. Refer to parcels by number, seats by seat_label, elements by handle, products by name.',
          'No guest names, emails, phones, payment references or bank data exist in this data.',
          'Pass topic = a view name for its columns and units.',
        ],
      }
    }
    const t = ASSISTANT_VIEWS.find((x) => x.name === topic)
    if (t) {
      return {
        ok: true,
        table: t.name,
        about: t.doc,
        columns: t.columns.map((c) => ({ name: c.name, type: c.type, ...(c.doc ? { meaning: c.doc } : {}), ...(columnUnit(t.name, c) ? { unit: columnUnit(t.name, c) } : {}) })),
        relationships: RELATIONSHIPS.filter((r) => involves(r, t.name)),
      }
    }
    return { ok: false, error: 'unknown_topic', detail: `topic must be one of: ${ASSISTANT_VIEWS.map((x) => x.name).join(', ')}` }
  },
}

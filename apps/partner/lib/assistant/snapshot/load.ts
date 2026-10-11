/**
 * Build (and cache) the per-site PGlite snapshot the `sql` tool queries (track 030 G1).
 *
 * Isolation is structural: the snapshot is a separate in-process Postgres holding ONLY the bound
 * site's rows, so model SQL cannot reach another tenant whatever it does. Every read below is
 * site-scoped in the query AND re-filtered here (rows without a matching `siteId`, and children
 * whose parent was not loaded, are dropped) — a wrong `where` cannot leak another site.
 * Only columns listed in `schema.ts` are inserted; everything else on the Prisma row is ignored.
 *
 * The caller (the tool) has already run `requireSiteOwner(ctx.siteId)`; the site id comes from the
 * route-bound ctx, never from the model.
 *
 * Memory: one PGlite instance is ~250 MB of WASM heap (the first one in a process also pays
 * ~0.6 GB for the compiled module), so the cache (`cache.ts`) keeps at most `MAX_ENTRIES` snapshots and closes
 * evicted ones. `statement_timeout` is a no-op in PGlite (single-threaded WASM, no SIGALRM) — the
 * `sql` tool bounds runtime with a planner-cost gate instead.
 */
import { PGlite } from '@electric-sql/pglite'
import prisma from '@repo/data/PrismaCient'
import { providerFromRef } from '@repo/data/payment-refs'
import { resolveSiteTimeZone } from '@repo/data/site-day'
import { elementHandle } from '../tools/helpers'
import { cacheGet, cacheSet, cacheTouch, TTL_MS } from './cache'
import { SNAPSHOT_TABLES, SNAPSHOT_VIEWS, type SnapshotTableName } from './schema'

/** Newest-first caps for the tables that grow forever. snapshot_info says when they bite. */
export const RESERVATION_CAP = 20_000
export const ORDER_CAP = 20_000

type Row = Record<string, unknown>
type Rows = Record<SnapshotTableName, Row[]>

export interface Snapshot {
  db: PGlite
  siteId: string
  loadedAt: Date
  fingerprint: string
  loadMs: number
  counts: Record<string, number>
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)
const hhmm = (v: unknown): string | null => {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
const paidVia = (ref: unknown): string | null => {
  if (typeof ref !== 'string' || !ref) return null
  return providerFromRef(ref) ?? 'other'
}

/** cuid -> 1..n surrogate, per table; unknown ids map to null (the row's parent was not loaded). */
class Ids {
  private map = new Map<string, number>()
  add(id: string): number {
    let n = this.map.get(id)
    if (n == null) this.map.set(id, (n = this.map.size + 1))
    return n
  }
  get(id: unknown): number | null {
    return typeof id === 'string' ? (this.map.get(id) ?? null) : null
  }
  has(id: unknown): boolean {
    return typeof id === 'string' && this.map.has(id)
  }
}

/** Read the site's allowlisted rows through Prisma and map them to snapshot rows. */
export async function readSiteRows(siteId: string): Promise<{ rows: Rows; timeZone: string }> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true, name: true, description: true, type: true, status: true, code: true, slug: true, layoutMode: true,
      layoutWidth: true, layoutHeight: true, locationLat: true, locationLng: true, timeZone: true, price: true, vat: true,
      rentalVat: true, rentalPaymentType: true, orderPaymentType: true, appSalesEnabled: true, paymentProvider: true,
      features: true, services: true, partialGroupBookingEnabled: true, noShowDeadlineMinutes: true, createdAt: true,
    },
  })
  if (!site || site.id !== siteId) throw new Error('site_not_found')
  const lat = num(site.locationLat)
  const lng = num(site.locationLng)
  const timeZone = resolveSiteTimeZone({ timeZone: site.timeZone, latitude: lat, longitude: lng })

  const mine = <T extends { siteId?: unknown }>(rows: T[]) => rows.filter((r) => r.siteId === siteId)

  const [items, elements, products, rentals, hours, reservations, orders, reservationsTotal, ordersTotal] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { siteId },
      select: {
        id: true, siteId: true, number: true, seatLabel: true, group: true, itemGroupId: true, sunbedGroupId: true, status: true,
        locationLat: true, locationLng: true, schematicX: true, schematicY: true, rotation: true, label: true, category: true, price: true,
      },
      orderBy: { number: 'asc' },
    }),
    prisma.layoutElement.findMany({
      where: { siteId },
      select: { id: true, siteId: true, type: true, shape: true, x: true, y: true, width: true, height: true, rotation: true, z: true, label: true, color: true },
    }),
    prisma.product.findMany({
      where: { siteId },
      select: { id: true, siteId: true, name: true, description: true, category: true, price: true, tax: true, totalPrice: true, active: true, soldOut: true, prepTime: true },
    }),
    prisma.rentalItem.findMany({
      where: { siteId },
      select: { id: true, siteId: true, name: true, description: true, category: true, pricePerHour: true, pricePerDay: true, totalQuantity: true, active: true },
    }),
    prisma.siteWorkingHours.findMany({ where: { siteId }, select: { siteId: true, day: true, openTime: true, closeTime: true } }),
    prisma.reservation.findMany({
      where: { siteId },
      orderBy: { from: 'desc' },
      take: RESERVATION_CAP,
      select: {
        id: true, siteId: true, status: true, operationalStatus: true, type: true, from: true, to: true, paymentAmount: true,
        paymentRef: true, isComp: true, refundedAt: true, checkedInAt: true, departedAt: true, splitFromId: true, createdAt: true,
        items: { select: { id: true } },
      },
    }),
    prisma.order.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
      take: ORDER_CAP,
      select: {
        id: true, siteId: true, status: true, price: true, tax: true, totalPrice: true, paymentAmount: true, paymentRef: true,
        seatId: true, reservationId: true, tableId: true, rejectReason: true, createdAt: true, acceptedAt: true, readyAt: true,
        deliveredAt: true,
        orderItems: { select: { name: true, category: true, quantity: true, price: true, tax: true, totalPrice: true } },
      },
    }),
    prisma.reservation.count({ where: { siteId } }),
    prisma.order.count({ where: { siteId } }),
  ])

  // ── seats + parcels (ItemGroup has no siteId: a parcel belongs to the site through its seats) ──
  const seatIds = new Ids()
  const parcelIds = new Ids()
  const unitIds = new Ids()
  const mySeats = mine(items)
  const unitSize = new Map<string, number>()
  for (const s of mySeats) if (s.sunbedGroupId) unitSize.set(s.sunbedGroupId, (unitSize.get(s.sunbedGroupId) ?? 0) + 1)
  const groupIdList = [...new Set(mySeats.map((s) => s.itemGroupId).filter((id): id is string => !!id))]
  const groups = groupIdList.length
    ? await prisma.itemGroup.findMany({
        where: { id: { in: groupIdList } },
        select: {
          id: true, number: true, label: true, rows: true, seatsPerRow: true, rotation: true, horizontalGap: true, verticalGap: true,
          pairGap: true, locationLat: true, locationLng: true, schematicX: true, schematicY: true, status: true, category: true, price: true,
        },
      })
    : []
  const groupSet = new Set(groupIdList)
  const parcel = groups.filter((g) => groupSet.has(g.id)).map((g) => ({
    id: parcelIds.add(g.id), number: g.number, label: g.label, rows: g.rows, seats_per_row: g.seatsPerRow, rotation: g.rotation,
    gap_between_seats: g.horizontalGap, gap_between_rows: g.verticalGap, gap_between_paired_beds: g.pairGap,
    anchor_lat: num(g.locationLat), anchor_lng: num(g.locationLng), anchor_x: g.schematicX, anchor_y: g.schematicY,
    status: g.status, category: g.category, price: g.price,
  }))
  const seat = mySeats.map((s) => ({
    id: seatIds.add(s.id), number: s.number, seat_label: s.seatLabel, parcel: s.group, parcel_id: parcelIds.get(s.itemGroupId),
    unit_id: s.sunbedGroupId ? unitIds.add(s.sunbedGroupId) : null, paired: (unitSize.get(s.sunbedGroupId ?? '') ?? 0) > 1,
    status: s.status, lat: num(s.locationLat), lng: num(s.locationLng), x: s.schematicX, y: s.schematicY, rotation: s.rotation,
    label: s.label, category: s.category, price: s.price,
  }))

  // ── reservations / orders (+ children only when the parent is this site's) ──
  const resIds = new Ids()
  const myRes = mine(reservations)
  for (const r of myRes) resIds.add(r.id)
  const reservation = myRes.map((r) => ({
    id: resIds.get(r.id), status: r.status, operational_status: r.operationalStatus, type: r.type, starts_at: iso(r.from),
    ends_at: iso(r.to), amount: r.paymentAmount, paid_via: paidVia(r.paymentRef), is_comp: r.isComp, refunded_at: iso(r.refundedAt),
    checked_in_at: iso(r.checkedInAt), departed_at: iso(r.departedAt), split_from_id: resIds.get(r.splitFromId),
    seat_count: (r.items ?? []).length, created_at: iso(r.createdAt),
  }))
  const reservation_seat = myRes.flatMap((r) =>
    (r.items ?? []).filter((i) => seatIds.has(i.id)).map((i) => ({ reservation_id: resIds.get(r.id), seat_id: seatIds.get(i.id) })),
  )

  const orderIds = new Ids()
  const myOrders = mine(orders)
  const food_order = myOrders.map((o) => ({
    id: orderIds.add(o.id), status: o.status, price: o.price, tax: o.tax, total_price: o.totalPrice, amount: o.paymentAmount,
    paid_via: paidVia(o.paymentRef), seat_id: seatIds.get(o.seatId), reservation_id: resIds.get(o.reservationId),
    table_label: o.tableId, reject_reason: o.rejectReason, created_at: iso(o.createdAt), accepted_at: iso(o.acceptedAt),
    ready_at: iso(o.readyAt), delivered_at: iso(o.deliveredAt),
  }))
  const food_order_item = myOrders.flatMap((o) =>
    (o.orderItems ?? []).map((li) => ({
      order_id: orderIds.get(o.id), name: li.name, category: li.category, quantity: li.quantity, price: li.price, tax: li.tax,
      total_price: li.totalPrice,
    })),
  )

  // ── invoices: linked to a LOADED reservation/order of this site, else dropped ──
  const rawInvoices = await prisma.invoice.findMany({
    where: { OR: [{ reservation: { siteId } }, { order: { siteId } }] },
    orderBy: { invoicedAt: 'desc' },
    take: RESERVATION_CAP + ORDER_CAP,
    select: {
      id: true, invoiceNumber: true, issuerType: true, status: true, totalCharge: true, totalTax: true, totalAmount: true,
      processingFee: true, reverseCharge: true, seriesCode: true, tipoFactura: true, product: true, reservationId: true,
      orderId: true, creditsInvoiceId: true, invoicedAt: true,
    },
  })
  const invIds = new Ids()
  const myInvoices = rawInvoices.filter((i) => resIds.has(i.reservationId) || orderIds.has(i.orderId))
  for (const i of myInvoices) invIds.add(i.id)
  const invoice = myInvoices.map((i) => ({
    id: invIds.get(i.id), invoice_number: i.invoiceNumber, issuer_type: i.issuerType, status: i.status, total_charge: i.totalCharge,
    total_tax: i.totalTax, total_amount: i.totalAmount, processing_fee: i.processingFee, reverse_charge: i.reverseCharge,
    series_code: i.seriesCode, tipo_factura: i.tipoFactura, product: i.product, reservation_id: resIds.get(i.reservationId),
    order_id: orderIds.get(i.orderId), credits_invoice_id: invIds.get(i.creditsInvoiceId), invoiced_at: iso(i.invoicedAt),
  }))

  const rows: Rows = {
    site: [{
      name: site.name, description: site.description, type: site.type, status: site.status, code: site.code, slug: site.slug,
      layout_mode: site.layoutMode, layout_width: site.layoutWidth, layout_height: site.layoutHeight, lat, lng, time_zone: timeZone,
      default_seat_price: site.price, vat: site.vat, rental_vat: site.rentalVat, rental_payment_type: site.rentalPaymentType,
      order_payment_type: site.orderPaymentType, app_sales_enabled: site.appSalesEnabled, payment_provider: site.paymentProvider,
      features: site.features ?? [], services: site.services ?? [], partial_group_booking_enabled: site.partialGroupBookingEnabled,
      no_show_deadline_minutes: site.noShowDeadlineMinutes, created_at: iso(site.createdAt),
    }],
    parcel,
    seat,
    layout_element: mine(elements).map((e, i) => ({
      id: i + 1, handle: elementHandle(e.id), type: e.type, shape: e.shape, x: e.x, y: e.y, width: e.width, height: e.height,
      rotation: e.rotation, z: e.z, label: e.label, color: e.color,
    })),
    product: mine(products).map((p, i) => ({
      id: i + 1, name: p.name, description: p.description, category: p.category, price: p.price, tax: p.tax, total_price: p.totalPrice,
      active: p.active, sold_out: p.soldOut, prep_time: p.prepTime,
    })),
    rental_item: mine(rentals).map((r, i) => ({
      id: i + 1, name: r.name, description: r.description, category: r.category, price_per_hour: r.pricePerHour,
      price_per_day: r.pricePerDay, total_quantity: r.totalQuantity, active: r.active,
    })),
    working_hours: mine(hours).map((h) => ({ day: h.day, open_time: hhmm(h.openTime), close_time: hhmm(h.closeTime) })),
    reservation,
    reservation_seat,
    food_order,
    food_order_item,
    invoice,
    snapshot_info: [{
      loaded_at: new Date().toISOString(), reservations_total: reservationsTotal, reservations_loaded: reservation.length,
      orders_total: ordersTotal, orders_loaded: food_order.length,
    }],
  }
  return { rows, timeZone }
}

// ── PGlite ────────────────────────────────────────────────────────────────────

/** An initdb'd empty data dir, made once per process: later instances skip initdb (~570 ms -> ~110 ms). */
let template: Promise<Blob> | null = null
function emptyDataDir(): Promise<Blob> {
  template ??= (async () => {
    const seed = await PGlite.create()
    try {
      return (await seed.dumpDataDir('gzip')) as Blob
    } finally {
      await seed.close()
    }
  })().catch((err) => {
    template = null
    throw err
  })
  return template
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Create the tables + views and bulk-insert the rows (one JSON parameter per table). */
export async function buildDatabase(rows: Rows, timeZone: string): Promise<PGlite> {
  const db = await PGlite.create({ loadDataDir: await emptyDataDir() })
  try {
    const ddl = SNAPSHOT_TABLES.map(
      (t) => `CREATE TABLE ${quoteIdent(t.name)} (${t.columns.map((c) => `${quoteIdent(c.name)} ${c.type}${c.name === 'id' ? ' PRIMARY KEY' : ''}`).join(', ')});`,
    )
    await db.exec(ddl.join('\n'))
    for (const t of SNAPSHOT_TABLES) {
      const data = rows[t.name]
      if (!data.length) continue
      // Only the allowlisted column names are read off each mapped row.
      const picked = data.map((r) => Object.fromEntries(t.columns.map((c) => [c.name, r[c.name] ?? null])))
      await db.query(`INSERT INTO ${quoteIdent(t.name)} SELECT * FROM json_populate_recordset(NULL::${quoteIdent(t.name)}, $1::json)`, [
        JSON.stringify(picked),
      ])
    }
    await db.exec(
      [
        `CREATE INDEX ON seat (parcel); CREATE INDEX ON seat (seat_label); CREATE INDEX ON reservation (starts_at);`,
        `CREATE INDEX ON reservation_seat (reservation_id); CREATE INDEX ON reservation_seat (seat_id);`,
        `CREATE INDEX ON food_order_item (order_id);`,
        ...SNAPSHOT_VIEWS.map((v) => `CREATE VIEW ${quoteIdent(v.name)} AS ${v.sql};`),
        // Accurate planner estimates are what the sql tool's cost gate relies on.
        'ANALYZE;',
        `SET TIME ZONE ${quoteLiteral(timeZone)};`,
      ].join('\n'),
    )
    return db
  } catch (err) {
    await db.close().catch(() => {})
    throw err
  }
}

// ── freshness + cache ─────────────────────────────────────────────────────────

/**
 * Cheap change detector: row counts + newest `updatedAt` of the tables the partner edits outside
 * the assistant (editor, manage grid, bookings). A changed fingerprint reloads the snapshot, so
 * the model never answers from data older than the last edit; the TTL bounds the rest.
 */
export async function fingerprint(siteId: string): Promise<string> {
  const agg = { _count: { _all: true }, _max: { updatedAt: true } } as const
  const parts = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { updatedAt: true } }),
    prisma.inventoryItem.aggregate({ where: { siteId }, ...agg }),
    prisma.layoutElement.aggregate({ where: { siteId }, ...agg }),
    prisma.product.aggregate({ where: { siteId }, ...agg }),
    prisma.rentalItem.aggregate({ where: { siteId }, ...agg }),
    prisma.siteWorkingHours.aggregate({ where: { siteId }, ...agg }),
    prisma.reservation.aggregate({ where: { siteId }, ...agg }),
    prisma.order.aggregate({ where: { siteId }, ...agg }),
  ])
  return JSON.stringify(parts)
}

export async function loadSnapshot(siteId: string): Promise<Snapshot> {
  const started = Date.now()
  const [{ rows, timeZone }, print] = await Promise.all([readSiteRows(siteId), fingerprint(siteId)])
  const readMs = Date.now() - started
  const db = await buildDatabase(rows, timeZone)
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]))
  const loadMs = Date.now() - started
  console.info(`[assistant] snapshot ${siteId}: read ${readMs} ms, total ${loadMs} ms`, counts)
  return { db, siteId, loadedAt: new Date(), fingerprint: print, loadMs, counts }
}

/** The site's snapshot: cached if fresh (TTL + unchanged fingerprint), else (re)built. */
export async function getSnapshot(siteId: string): Promise<Snapshot> {
  const now = Date.now()
  const hit = cacheGet(siteId)
  if (hit && hit.expiresAt > now) {
    try {
      const snap = (await hit.promise) as Snapshot
      if (!snap.db.closed && snap.fingerprint === (await fingerprint(siteId))) {
        cacheTouch(siteId)
        return snap
      }
    } catch {
      // a failed load falls through to a rebuild
    }
  }
  const promise = loadSnapshot(siteId)
  cacheSet(siteId, { promise, expiresAt: now + TTL_MS })
  return promise
}

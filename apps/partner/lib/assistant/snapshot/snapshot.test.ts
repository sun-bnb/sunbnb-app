/**
 * The `sql` tool and its per-site snapshot (track 030 G1), against a REAL PGlite.
 *
 * Requirements: the snapshot holds only the bound site's rows (even when a query returns
 * another tenant's rows), never a denied column or a secret value, refuses anything but one
 * read-only SELECT, refuses runaway queries before they run, caps output, and is rebuilt after a
 * change. The Prisma mock deliberately IGNORES `where` and returns both sites' rows, so isolation
 * is proven by the loader, not by the fake.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { checkSql, MAX_ROWS, runReadOnly } from '../tools/sql'
import { cachedSiteIds, invalidateSnapshot, resetSnapshotCache } from './cache'
import { getSnapshot, loadSnapshot } from './load'
import { DENIED_COLUMN, SNAPSHOT_TABLES, SNAPSHOT_VIEWS } from './schema'

const OWNER = 'owner-1'
const A = 'site-a'
const B = 'site-b'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: A, locale: 'en' }

const SECRETS = ['guest@example.com', 'Jane Guest', '+34600111222', 'tr_SECRETref123', 'ES9121000418450200051332', 'tml_terminal', 'anon-xyz', 'NIF-B12345678', 'Call me at the bar']

const T0 = new Date('2026-07-01T10:00:00Z')
const seat = (site: string, n: number, over: Record<string, unknown> = {}) => ({
  id: `${site}-seat-${n}`, siteId: site, userId: OWNER, number: n, seatLabel: `1-1${String(n).padStart(2, '0')}-1`, group: 1,
  itemGroupId: `${site}-ig1`, sunbedGroupId: `${site}-unit-${Math.ceil(n / 2)}`, status: 'active', locationLat: '39.5',
  locationLng: '2.6', schematicX: null, schematicY: null, rotation: 0, label: null, category: 'PRICE1', price: null,
  notes: SECRETS[8], ...over,
})

let world: Record<string, any[]>
function seedWorld(seatsA = 6) {
  world = {
    site: [
      { id: A, userId: OWNER, name: 'Playa A', description: null, type: 'beach', status: 'active', code: 'S-AAAAAA', slug: 'playa-a',
        layoutMode: 'geo', layoutWidth: null, layoutHeight: null, locationLat: '39.5', locationLng: '2.6', timeZone: 'Europe/Madrid',
        price: 15, vat: 21, rentalVat: 21, rentalPaymentType: null, orderPaymentType: null, appSalesEnabled: true, paymentProvider: 'mollie',
        features: ['sunbeds'], services: [], partialGroupBookingEnabled: false, noShowDeadlineMinutes: null, createdAt: T0, updatedAt: T0,
        iban: SECRETS[4], stripeTerminalLocationId: SECRETS[5] },
      { id: B, userId: 'other', name: 'Playa B SECRET', updatedAt: T0 },
    ],
    inventoryItem: [
      ...Array.from({ length: seatsA }, (_, i) => seat(A, i + 1)),
      seat(B, 1, { seatLabel: '9-999-9', group: 9 }),
    ],
    itemGroup: [
      { id: `${A}-ig1`, number: 1, label: null, rows: 1, seatsPerRow: seatsA, rotation: 0, horizontalGap: 1, verticalGap: 1.5, pairGap: 0.4,
        locationLat: '39.5', locationLng: '2.6', schematicX: null, schematicY: null, status: 'active', category: 'PRICE1', price: 12 },
      { id: `${B}-ig1`, number: 777, rows: 1, seatsPerRow: 1, locationLat: '0', locationLng: '0', horizontalGap: 1, verticalGap: 1, pairGap: 0 },
    ],
    layoutElement: [{ id: 'cm-elem-abc123', siteId: A, type: 'bar', shape: 'rect', x: 1, y: 2, width: 3, height: 4, rotation: 0, z: 0, label: 'Bar', color: null }],
    product: [
      { id: 'p1', siteId: A, name: 'Mojito', description: null, category: 'drinks', price: 8.26, tax: 1.74, totalPrice: 10, active: true, soldOut: false, prepTime: 5 },
      { id: 'p2', siteId: B, name: 'Foreign Beer', price: 1, tax: 0, totalPrice: 1 },
    ],
    rentalItem: [{ id: 'r1', siteId: B, name: 'Foreign Kayak' }],
    siteWorkingHours: [{ siteId: A, day: 1, openTime: new Date('1970-01-01T09:00:00Z'), closeTime: new Date('1970-01-01T19:30:00Z') }],
    reservation: [
      { id: 'res-a1', siteId: A, userId: 'guest-user', status: 'confirmed', operationalStatus: 'expected', type: 'days', from: T0, to: T0,
        paymentAmount: 30, paymentRef: SECRETS[3], isComp: false, refundedAt: null, checkedInAt: null, departedAt: null, splitFromId: null,
        createdAt: T0, guestEmail: SECRETS[0], guestName: SECRETS[1], guestContact: SECRETS[2], anonId: SECRETS[6], internalNotes: SECRETS[8],
        items: [{ id: `${A}-seat-1` }, { id: `${A}-seat-2` }, { id: `${B}-seat-1` }] },
      { id: 'res-b1', siteId: B, status: 'confirmed', from: T0, to: T0, paymentAmount: 999, items: [{ id: `${B}-seat-1` }] },
    ],
    order: [
      { id: 'ord-a1', siteId: A, status: 'delivered', price: 8.26, tax: 1.74, totalPrice: 10, paymentAmount: 10, paymentRef: null, seatId: `${A}-seat-1`,
        reservationId: 'res-a1', tableId: null, rejectReason: null, createdAt: T0, acceptedAt: null, readyAt: null, deliveredAt: null,
        notes: SECRETS[8], orderItems: [{ name: 'Mojito', category: 'drinks', quantity: 1, price: 8.26, tax: 1.74, totalPrice: 10, notes: SECRETS[8] }] },
      { id: 'ord-b1', siteId: B, status: 'delivered', totalPrice: 555, orderItems: [{ name: 'Foreign Paella', quantity: 1 }] },
    ],
    invoice: [
      { id: 'inv-a1', invoiceNumber: 'P-2026-1', issuerType: 'PARTNER', status: 'created', totalCharge: 24.79, totalTax: 5.21, totalAmount: 30,
        processingFee: null, reverseCharge: false, seriesCode: 'F', tipoFactura: 'F2', product: 'beachclub', reservationId: 'res-a1', orderId: null,
        creditsInvoiceId: null, invoicedAt: T0, paymentRef: SECRETS[3], recipientVatNumber: SECRETS[7], issuerVatNumber: SECRETS[7], hash: 'h' },
      { id: 'inv-b1', invoiceNumber: 'FOREIGN-1', issuerType: 'PARTNER', totalAmount: 999, reservationId: 'res-b1', orderId: null, invoicedAt: T0 },
    ],
  }
}

/** Every findMany returns ALL seeded rows regardless of `where` (isolation must come from the loader). */
function wirePrisma() {
  const all = (model: string) => vi.fn(async () => world[model]!.map((r) => ({ ...r })))
  vi.mocked(prisma.site.findUnique).mockImplementation((async (args: any) => {
    const s = world.site!.find((r) => r.id === args.where.id)
    return s ? { ...s } : null
  }) as never)
  for (const m of ['inventoryItem', 'itemGroup', 'layoutElement', 'product', 'rentalItem', 'siteWorkingHours', 'reservation', 'order', 'invoice']) {
    ;(prisma as any)[m].findMany = all(m)
    ;(prisma as any)[m].aggregate = vi.fn(async () => ({ _count: { _all: world[m]!.length }, _max: { updatedAt: T0 } }))
  }
  vi.mocked(prisma.reservation.count).mockResolvedValue(2)
  ;(prisma.order as any).count = vi.fn(async () => 2)
}

const tools = getAssistantTools()
async function sqlCall(query: string, c: AssistantToolCtx = ctx) {
  const ex = await executeToolCall(tools, { id: 't1', name: 'sql', arguments: JSON.stringify({ query }) }, c)
  return ex.result as Record<string, any>
}

beforeEach(async () => {
  await resetSnapshotCache()
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  seedWorld()
  wirePrisma()
})
afterAll(() => resetSnapshotCache())

describe('allowlist', () => {
  it('no table or view column matches the hard deny-list (IBAN, tokens, payment refs, emails, phones, ids, guests)', () => {
    const names = SNAPSHOT_TABLES.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`))
    expect(names.filter((n) => DENIED_COLUMN.test(n.split('.')[1]!))).toEqual([])
    for (const bad of ['iban', 'payment_ref', 'guest_email', 'guest_contact', 'phone', 'access_token', 'anon_id', 'user_id', 'recipient_vat_number', 'stripe_account_id', 'notes', 'internal_notes', 'hash']) {
      expect(DENIED_COLUMN.test(bad), bad).toBe(true)
    }
  })

  it('the built database exposes no denied column and none of the secret values anywhere', async () => {
    const snap = await loadSnapshot(A)
    const cols = await snap.db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    )
    expect(cols.rows.length).toBeGreaterThan(50)
    expect(cols.rows.filter((r) => DENIED_COLUMN.test(r.column_name))).toEqual([])
    const views = await snap.db.query<{ table_name: string }>("select table_name from information_schema.views where table_schema = 'public'")
    expect(views.rows.map((r) => r.table_name).sort()).toEqual(SNAPSHOT_VIEWS.map((v) => v.name).sort())

    const dump = JSON.stringify(
      await Promise.all(SNAPSHOT_TABLES.map((t) => snap.db.query(`select row_to_json(_r) from ${t.name} _r`).then((r) => r.rows))),
    )
    for (const s of SECRETS) expect(dump, s).not.toContain(s)
    expect(dump).not.toMatch(/cm-elem-abc123|res-a1|site-a-seat/) // real cuids never leave; surrogate ids only
    await snap.db.close()
  })
})

describe('tenant isolation', () => {
  it("only the bound site's rows are present, even though every Prisma read returned both sites", async () => {
    const q = async (sql: string) => (await sqlCall(sql)).rows
    expect(await q('select name from site')).toEqual([['Playa A']])
    expect(await q('select count(*)::int from seat')).toEqual([[6]])
    expect(await q("select count(*)::int from seat where seat_label = '9-999-9' or parcel = 9")).toEqual([[0]])
    expect(await q('select number from parcel')).toEqual([[1]])
    expect(await q('select name from product')).toEqual([['Mojito']])
    expect(await q('select count(*)::int from rental_item')).toEqual([[0]])
    expect(await q('select amount from reservation')).toEqual([[30]])
    // The foreign seat a reservation pointed at is dropped from the join table.
    expect(await q('select seat_label from reservation_seat_label order by seat_label')).toEqual([['1-101-1'], ['1-102-1']])
    expect(await q('select total_price from food_order')).toEqual([[10]])
    expect(await q('select name from food_order_item')).toEqual([['Mojito']])
    expect(await q('select invoice_number from invoice')).toEqual([['P-2026-1']])
  })

  it('every Prisma read is scoped to the bound site in the query too', async () => {
    await getSnapshot(A)
    for (const m of ['inventoryItem', 'layoutElement', 'product', 'rentalItem', 'siteWorkingHours', 'reservation', 'order']) {
      expect((prisma as any)[m].findMany.mock.calls[0][0].where, m).toEqual({ siteId: A })
    }
    expect((prisma as any).itemGroup.findMany.mock.calls[0][0].where).toEqual({ id: { in: [`${A}-ig1`] } })
    expect((prisma as any).invoice.findMany.mock.calls[0][0].where).toEqual({ OR: [{ reservation: { siteId: A } }, { order: { siteId: A } }] })
  })

  it('the site comes from the route-bound ctx: a non-owner is refused before anything is loaded', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'someone-else' } as never)
    expect(await sqlCall('select name from site')).toEqual({ ok: false, error: 'forbidden' })
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled()
    expect(cachedSiteIds()).toEqual([])
  })

  it('the tool takes no site argument (strict schema)', () => {
    const tool = tools.find((t) => t.name === 'sql')!
    expect(Object.keys((tool.inputSchema as any).properties)).toEqual(['query'])
    expect((tool.inputSchema as any).additionalProperties).toBe(false)
  })
})

describe('statement gate', () => {
  it.each([
    ['multiple statements', 'select 1; select 2', 'single_statement_only'],
    ['DML', 'delete from seat', 'select_only'],
    ['DDL', 'create table x (a int)', 'select_only'],
    ['DML in a CTE', 'with d as (delete from seat returning 1) select * from d', 'forbidden_keyword'],
    ['UPDATE in a CTE', 'with u as (update seat set price = 0 returning 1) select 1', 'forbidden_keyword'],
    ['COPY', 'copy seat to stdout', 'select_only'],
    ['SET', "set statement_timeout = 0", 'select_only'],
    ['set_config', "select set_config('search_path', 'x', false)", 'forbidden_function'],
    ['pg_sleep', 'select pg_sleep(10)', 'forbidden_function'],
    ['pg_read_file', "select pg_read_file('/etc/passwd')", 'forbidden_function'],
    ['catalog access', 'select * from pg_catalog.pg_tables', 'forbidden_schema'],
    ['recursive CTE', 'with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r', 'forbidden_keyword'],
    ['comment hiding a statement', 'select 1 -- ; drop table seat', 'comments_not_allowed'],
    ['dollar quoting', 'select $$x$$', 'dollar_quoting_not_allowed'],
    ['quoted keyword', 'select * from "seat"', 'quoted_identifiers_not_allowed'],
    ['SELECT INTO', 'select * into newtab from seat', 'forbidden_keyword'],
    ['row locks', 'select * from seat for update', 'forbidden_keyword'],
    ['repeat (memory bomb)', "select repeat('x', 1000000000)", 'forbidden_function'],
  ])('%s is rejected', (_n, query, error) => {
    expect(checkSql(query)).toMatchObject({ ok: false, error })
  })

  it('accepts ordinary reads, a trailing semicolon, and keywords inside string literals', () => {
    expect(checkSql("select count(*) from seat where label = 'delete; drop'")).toMatchObject({ ok: true })
    expect(checkSql('select 1;')).toEqual({ ok: true, query: 'select 1' })
    expect(checkSql('with x as (select parcel from seat) select count(*) from x')).toMatchObject({ ok: true })
  })

  it('the database itself refuses a write that got past the gate (READ ONLY transaction, rolled back)', async () => {
    const snap = await loadSnapshot(A)
    const w = await runReadOnly(snap.db, 'with d as (delete from seat returning 1) select * from d')
    expect(w).toMatchObject({ ok: false, error: 'sql_error' })
    expect((await snap.db.query<{ n: number }>('select count(*)::int as n from seat')).rows[0]!.n).toBe(6)
    await snap.db.close()
  })
})

describe('runaway queries and output caps', () => {
  it('is refused BEFORE running when the planner says it is expensive (PGlite has no statement_timeout)', async () => {
    seedWorld(400)
    wirePrisma()
    await getSnapshot(A)
    const started = Date.now()
    expect(await sqlCall('select count(*) from generate_series(1, 300000000)')).toMatchObject({ ok: false, error: 'query_too_expensive' })
    expect(await sqlCall('select count(*) from seat a, seat b, seat c')).toMatchObject({ ok: false, error: 'query_too_expensive' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it(`caps rows at ${MAX_ROWS} and reports the real total`, async () => {
    seedWorld(250)
    wirePrisma()
    const res = await sqlCall('select seat_label from seat order by number')
    expect(res).toMatchObject({ ok: true, columns: ['seat_label'], rowCount: MAX_ROWS, truncated: true, totalRows: 250 })
    expect(res.rows).toHaveLength(MAX_ROWS)
    expect(res.dataAsOf).toMatch(/^\d{4}-/)
  })

  it('caps the serialized size (~30 KB) and says so', async () => {
    seedWorld(150)
    wirePrisma()
    const res = await sqlCall("select seat_label, agg.x from seat, (select string_agg(seat_label, ',') as x from seat) agg")
    expect(res).toMatchObject({ ok: true, truncated: true, totalRows: 150 })
    expect(JSON.stringify(res.rows).length).toBeLessThanOrEqual(30_000)
    expect(res.rowCount).toBeLessThan(150)
  })

  it('returns duplicate column names intact (array rows) and an untruncated small result as-is', async () => {
    const res = await sqlCall('select s.id, p.id, s.seat_label from seat s join parcel p on p.id = s.parcel_id order by s.number limit 2')
    expect(res).toMatchObject({ ok: true, columns: ['id', 'id', 'seat_label'], rowCount: 2, truncated: false, totalRows: 2 })
    expect(res.rows[0]).toEqual([1, 1, '1-101-1'])
  })

  it('a SQL error comes back as a short message the model can fix', async () => {
    expect(await sqlCall('select nope from seat')).toMatchObject({ ok: false, error: 'sql_error', detail: expect.stringContaining('nope') })
  })
})

describe('cache', () => {
  it('reuses the snapshot while nothing changed, and rebuilds after invalidateSnapshot', async () => {
    await sqlCall('select 1')
    await sqlCall('select 2')
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(1)
    expect(cachedSiteIds()).toEqual([A])
    invalidateSnapshot(A)
    expect(cachedSiteIds()).toEqual([])
    await sqlCall('select 3')
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(2)
  })

  it('rebuilds when the data changed outside the assistant (fingerprint), so answers are never older than the last edit', async () => {
    expect((await sqlCall('select count(*)::int from seat')).rows).toEqual([[6]])
    seedWorld(9)
    wirePrisma()
    expect((await sqlCall('select count(*)::int from seat')).rows).toEqual([[9]])
  })

  it('keeps at most 2 snapshots (each PGlite is ~250 MB) and drops the least recently used', async () => {
    world.site!.push({ ...world.site![0], id: 'site-c', name: 'Playa C' })
    await getSnapshot(A)
    await getSnapshot(B)
    await getSnapshot('site-c')
    expect(cachedSiteIds()).toEqual([B, 'site-c'])
  })
})

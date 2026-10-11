/**
 * Track 030 D1 - the `assistant_reader` sandbox, attacked from the inside.
 *
 * Every test connects as the REAL `assistant_reader` role to sunbnb_test (never as the owner) and
 * tries to read another tenant's data, read a denied column, forge/replay a claim, write, or reach
 * the OS. The guarantees under test are Postgres's (RLS + column grants + role settings), not the
 * app's SQL checker.
 *
 * Needs the role provisioned: `./scripts/setup-assistant-reader.sh integration` with
 * ASSISTANT_DB_PASSWORD / ASSISTANT_DB_CLAIM_SECRET in packages/data/.env.local (or the env).
 */
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signAssistantClaim, runAssistantSql, closeAssistantPool } from './assistant-claim'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, createTestInventoryItem, createTestReservation, createTestProduct, createTestOrder, createTestOrderItem, createTestRentalItem, createTestSunbedGroup } from './test/fixtures'

function fromEnvFile(key: string): string | undefined {
  try {
    const t = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    const m = new RegExp(`^(?:export )?${key}=(.*)$`, 'm').exec(t)
    return m?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}
const PASSWORD = process.env.ASSISTANT_DB_PASSWORD ?? fromEnvFile('ASSISTANT_DB_PASSWORD')
if (!PASSWORD) throw new Error('assistant_reader password missing: run scripts/setup-assistant-reader.sh integration (see file header)')
const SECRET = process.env.ASSISTANT_DB_CLAIM_SECRET ?? fromEnvFile('ASSISTANT_DB_CLAIM_SECRET') ?? randomBytes(32).toString('hex')
const READER_URL = `postgres://assistant_reader:${PASSWORD}@localhost:5432/sunbnb_test`

const REF_A = 'tr_SECRETREFAAAA'
const REF_B = 'stripe_cs_SECRETREFBBBB'

interface World {
  a: { accountId: string; siteId: string; resId: string; orderId: string; invoiceId: string }
  b: { accountId: string; siteId: string; resId: string; orderId: string; invoiceId: string }
}
let w: World
let reader: pg.Client

async function mkTenant(label: string, ref: string, seats: number) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, { bankAccount: `IBAN-${label}-SECRET` })
  const site = await createTestSite(user.id, { name: `Beach ${label}`, locationLat: '38.5', locationLng: '-0.1' })
  const group = await prisma.itemGroup.create({
    data: { number: 7, rows: 1, seatsPerRow: seats, locationLat: '38.5', locationLng: '-0.1', horizontalGap: 1, verticalGap: 1, pairGap: 0.5, label: `Parcel ${label}` },
  })
  const unit = await createTestSunbedGroup(site.id, { parcel: 7, row: 1, seq: 1 })
  const items = []
  for (let n = 1; n <= seats; n++) {
    items.push(await createTestInventoryItem(user.id, site.id, { number: n, itemGroupId: group.id, sunbedGroupId: unit.id, group: 7, seatLabel: `7-10${n}-1`, notes: `NOTE-${label}` }))
  }
  const res = await createTestReservation(user.id, site.id, items.map((i) => i.id), {
    paymentRef: ref, paymentAmount: 42.5, guestEmail: `guest-${label}@secret.test`, guestName: `Guest ${label}`, internalNotes: `INTERNAL-${label}`,
  })
  const product = await createTestProduct(site.id, { name: `Drink ${label}` })
  const order = await createTestOrder(user.id, site.id, { paymentRef: ref, notes: `ORDER-NOTE-${label}`, reservationId: res.id, seatId: items[0]!.id })
  await createTestOrderItem(order.id, product.id, { name: `Drink ${label}`, notes: `ITEM-NOTE-${label}` })
  await createTestRentalItem(site.id, { name: `Board ${label}` })
  await prisma.layoutElement.create({ data: { siteId: site.id, type: 'bar', shape: 'rect', x: 1, y: 2, width: 3, height: 4 } })
  await prisma.siteWorkingHours.create({ data: { siteId: site.id, day: 1, openTime: new Date('1970-01-01T09:00:00Z'), closeTime: new Date('1970-01-01T18:30:00Z') } })
  const inv = await prisma.invoice.create({
    data: { accountId: user.id, reservationId: res.id, totalCharge: 34, totalTax: 8.5, totalAmount: 42.5, invoiceNumber: `INV-${label}-${randomBytes(3).toString('hex')}`, issuerVatNumber: `VAT-${label}-SECRET`, paymentRef: ref },
  })
  return { accountId: user.id, siteId: site.id, resId: res.id, orderId: order.id, invoiceId: inv.id }
}

/** One read-only transaction as the reader, the way the runner does it. `claim` null = none set. */
async function asReader<T = Record<string, unknown>>(sql: string, claim: string | null, params: unknown[] = []): Promise<T[]> {
  await reader.query('BEGIN READ ONLY')
  try {
    if (claim !== null) await reader.query({ text: "SELECT set_config('assistant.claim', $1, true)", values: [claim] })
    return (await reader.query({ text: sql, values: params })).rows as T[]
  } finally {
    await reader.query('ROLLBACK')
  }
}
const claimFor = (siteId: string, accountId = 'acct', ttl = 60) => signAssistantClaim({ siteId, accountId, ttlSec: ttl }, SECRET)
const forge = (siteId: string, accountId: string, expires: number, secret = SECRET) => {
  const body = `${siteId}.${accountId}.${expires}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`
}
const nowSec = () => Math.floor(Date.now() / 1000)

const VIEWS = ['site', 'parcel', 'unit', 'sunbed', 'layout_element', 'product', 'rental_item', 'working_hours', 'reservation', 'reservation_seat', 'food_order', 'food_order_item', 'invoice'] as const

beforeAll(async () => {
  await cleanDatabase()
  await prisma.$executeRawUnsafe(
    `INSERT INTO assistant.claim_secret (id, secret) VALUES (1, convert_to($1, 'UTF8')) ON CONFLICT (id) DO UPDATE SET secret = excluded.secret`,
    SECRET,
  )
  w = { a: await mkTenant('A', REF_A, 2), b: await mkTenant('B', REF_B, 3) }
  reader = new pg.Client({ connectionString: READER_URL })
  await reader.connect()
})
afterAll(async () => {
  await reader?.end()
  await closeAssistantPool()
  await disconnectDatabase()
})

describe('assistant_reader: tenant isolation', () => {
  it('each view returns exactly the claimed site\'s rows (and only those)', async () => {
    const expectA = { site: 1, parcel: 1, unit: 1, sunbed: 2, layout_element: 1, product: 1, rental_item: 1, working_hours: 1, reservation: 1, reservation_seat: 2, food_order: 1, food_order_item: 1, invoice: 1 }
    const expectB = { ...expectA, sunbed: 3, reservation_seat: 3 }
    for (const [who, exp] of [['a', expectA], ['b', expectB]] as const) {
      const claim = claimFor(w[who].siteId)
      for (const v of VIEWS) {
        const n = (await asReader<{ n: number }>(`SELECT count(*)::int AS n FROM assistant.${v}`, claim))[0]!.n
        expect(n, `${who}.${v}`).toBe(exp[v])
      }
    }
    // Content, not just counts: A's claim never shows B's names.
    const names = await asReader<{ name: string }>('SELECT name FROM assistant.site', claimFor(w.a.siteId))
    expect(names).toEqual([{ name: 'Beach A' }])
  })

  it('derived columns come out right (paid_via, lat/lng, paired, unit count, HH:MM, handle)', async () => {
    const claim = claimFor(w.a.siteId)
    expect(await asReader('SELECT paid_via, amount, seat_count FROM assistant.reservation', claim)).toEqual([{ paid_via: 'mollie', amount: 42.5, seat_count: 2 }])
    expect(await asReader('SELECT paid_via, sunbed_id IS NOT NULL AS has_seat FROM assistant.food_order', claim)).toEqual([{ paid_via: 'mollie', has_seat: true }])
    expect(await asReader('SELECT lat, lng FROM assistant.site', claim)).toEqual([{ lat: 38.5, lng: -0.1 }])
    expect((await asReader<{ paired: boolean }>('SELECT paired FROM assistant.sunbed', claim)).every((r) => r.paired)).toBe(true)
    expect(await asReader('SELECT sunbed_count FROM assistant.unit', claim)).toEqual([{ sunbed_count: 2 }])
    expect(await asReader('SELECT open_time, close_time FROM assistant.working_hours', claim)).toEqual([{ open_time: '09:00', close_time: '18:30' }])
    expect((await asReader<{ handle: string }>('SELECT handle FROM assistant.layout_element', claim))[0]!.handle).toHaveLength(6)
    expect(await asReader('SELECT paid_via FROM assistant.reservation', claimFor(w.b.siteId))).toEqual([{ paid_via: 'stripe' }])
    // The joins the model will actually write.
    const j = await asReader<{ n: number }>(
      `SELECT count(*)::int AS n FROM assistant.reservation r JOIN assistant.reservation_seat rs ON rs.reservation_id = r.id JOIN assistant.sunbed s ON s.id = rs.sunbed_id`,
      claim,
    )
    expect(j[0]!.n).toBe(2)
  })

  it('PostGIS functions still work for the reader', async () => {
    const r = await asReader<{ d: number }>(`SELECT round(ST_DistanceSphere(ST_MakePoint(0,0), ST_MakePoint(0,1))::numeric) AS d`, claimFor(w.a.siteId))
    expect(Number(r[0]!.d)).toBeGreaterThan(100000)
  })

  it('no claim, empty claim, garbage claim -> zero rows on every view and every base table', async () => {
    for (const claim of [null, '', 'garbage', 'a.b.c.d', `${w.a.siteId}.acct.${nowSec() + 60}.`]) {
      for (const v of VIEWS) expect((await asReader<{ n: number }>(`SELECT count(*)::int AS n FROM assistant.${v}`, claim))[0]!.n, `${claim}:${v}`).toBe(0)
    }
    for (const t of ['"Site"', '"InventoryItem"', '"ItemGroup"', '"SunbedGroup"', 'layout_element', '"Reservation"', '"_InventoryItemToReservation"', '"Product"', '"Order"', '"OrderItem"', '"Invoice"', '"RentalItem"', '"SiteWorkingHours"']) {
      expect((await asReader<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`, null))[0]!.n, t).toBe(0)
    }
  })

  it('the base tables obey the same claim (other tenants invisible there too)', async () => {
    const claim = claimFor(w.a.siteId)
    expect((await asReader<{ n: number }>('SELECT count(id)::int AS n FROM "Site"', claim))[0]!.n).toBe(1)
    expect((await asReader<{ n: number }>('SELECT count(id)::int AS n FROM "InventoryItem"', claim))[0]!.n).toBe(2)
    expect((await asReader<{ n: number }>('SELECT count(id)::int AS n FROM "ItemGroup"', claim))[0]!.n).toBe(1)
    expect((await asReader<{ n: number }>('SELECT count(id)::int AS n FROM "Invoice"', claim))[0]!.n).toBe(1)
    expect((await asReader<{ n: number }>('SELECT count(order_id)::int AS n FROM "OrderItem"', claim))[0]!.n).toBe(1)
    expect((await asReader<{ n: number }>('SELECT count("A")::int AS n FROM "_InventoryItemToReservation"', claim))[0]!.n).toBe(2)
  })

  it('cannot reach another site by id, subquery, union or join', async () => {
    const claim = claimFor(w.a.siteId)
    expect(await asReader('SELECT id FROM "Site" WHERE id = $1', claim, [w.b.siteId])).toEqual([])
    expect(await asReader('SELECT id FROM "Reservation" WHERE id = $1', claim, [w.b.resId])).toEqual([])
    expect(await asReader('SELECT id FROM "Invoice" WHERE id = $1', claim, [w.b.invoiceId])).toEqual([])
    expect(await asReader(`SELECT name FROM assistant.site UNION ALL SELECT name FROM assistant.product WHERE name LIKE '%B'`, claim)).toEqual([{ name: 'Beach A' }])
    // The definer helper re-checks the site itself: B's reservation id yields NULL under A's claim.
    expect(await asReader('SELECT assistant.reservation_paid_via($1) AS v', claim, [w.b.resId])).toEqual([{ v: null }])
    expect(await asReader('SELECT assistant.order_paid_via($1) AS v', claim, [w.b.orderId])).toEqual([{ v: null }])
    expect(await asReader('SELECT assistant.reservation_paid_via($1) AS v', claim, [w.a.resId])).toEqual([{ v: 'mollie' }])
  })
})

describe('assistant_reader: claim forgery and replay', () => {
  const rows = (claim: string | null) => asReader<{ n: number }>('SELECT count(*)::int AS n FROM assistant.site', claim).then((r) => r[0]!.n)

  it('a valid claim works (control) and current_site_id() resolves it', async () => {
    expect(await rows(claimFor(w.a.siteId))).toBe(1)
    expect(await asReader('SELECT assistant.current_site_id() AS s', claimFor(w.a.siteId))).toEqual([{ s: w.a.siteId }])
  })

  it('rejects: wrong secret, tampered site, tampered account, extended expiry, truncated mac, wrong field count', async () => {
    const good = claimFor(w.a.siteId, 'acct')
    const [site, acct, exp, mac] = good.split('.') as [string, string, string, string]
    const bad = [
      forge(w.a.siteId, 'acct', nowSec() + 60, 'not-the-secret'),
      `${w.b.siteId}.${acct}.${exp}.${mac}`, // swap in B's site, keep A's mac
      `${site}.other.${exp}.${mac}`,
      `${site}.${acct}.${Number(exp) + 100}.${mac}`,
      `${site}.${acct}.${exp}.${mac.slice(0, 40)}`,
      `${site}.${acct}.${exp}`,
      `${good}.extra`,
      `${site}.${acct}.-5.${mac}`,
    ]
    for (const c of bad) expect(await rows(c), c.slice(0, 30)).toBe(0)
  })

  it('rejects an expired claim and a claim expiring more than 5 minutes ahead', async () => {
    expect(await rows(forge(w.a.siteId, 'acct', nowSec() - 5))).toBe(0)
    expect(await rows(signAssistantClaim({ siteId: w.a.siteId, accountId: 'acct', ttlSec: 30 }, SECRET, Date.now() - 120_000))).toBe(0)
    expect(await rows(forge(w.a.siteId, 'acct', nowSec() + 3600))).toBe(0)
  })

  it('a claim cannot be reused after it expires', async () => {
    const c = claimFor(w.a.siteId, 'acct', 1)
    expect(await rows(c)).toBe(1)
    await new Promise((r) => setTimeout(r, 2200))
    expect(await rows(c)).toBe(0)
  })

  it('model SQL that swaps the claim (set_config) loses access instead of gaining it', async () => {
    const forged = forge(w.b.siteId, 'acct', nowSec() + 60, 'attacker-secret')
    // Swap to a forged B claim; the same query then reads the table in a later statement.
    await reader.query('BEGIN READ ONLY')
    try {
      await reader.query({ text: "SELECT set_config('assistant.claim', $1, true)", values: [claimFor(w.a.siteId)] })
      await reader.query({ text: "SELECT set_config('assistant.claim', $1, true)", values: [forged] })
      expect((await reader.query('SELECT count(*)::int AS n FROM assistant.site')).rows[0].n).toBe(0)
      // Even a session-level (non-local) set_config cannot manufacture a signature.
      await reader.query({ text: "SELECT set_config('assistant.claim', $1, false)", values: [forged] })
      expect((await reader.query('SELECT count(*)::int AS n FROM "Site"')).rows[0].n).toBe(0)
    } finally {
      await reader.query('ROLLBACK')
      await reader.query("SELECT set_config('assistant.claim', '', false)")
    }
  })

  it('a claim set transaction-locally does not survive the transaction', async () => {
    expect(await rows(claimFor(w.a.siteId))).toBe(1)
    const after = await reader.query('SELECT count(*)::int AS n FROM assistant.site') // autocommit, no claim
    expect(after.rows[0].n).toBe(0)
  })

  it('claim_secret is unreadable and current_site_id() cannot be coaxed into leaking it', async () => {
    await expect(asReader('SELECT secret FROM assistant.claim_secret', claimFor(w.a.siteId))).rejects.toThrow(/permission denied/)
    await expect(asReader('SELECT count(*) FROM assistant.claim_secret', claimFor(w.a.siteId))).rejects.toThrow(/permission denied/)
  })
})

describe('assistant_reader: denied data', () => {
  const claim = () => claimFor(w.a.siteId)
  const denied = [
    'SELECT payment_ref FROM "Reservation"',
    'SELECT guest_email FROM "Reservation"',
    'SELECT guest_name FROM "Reservation"',
    'SELECT internal_notes FROM "Reservation"',
    'SELECT user_id FROM "Reservation"',
    'SELECT anon_id FROM "Reservation"',
    'SELECT payment_ref FROM "Order"',
    'SELECT notes FROM "Order"',
    'SELECT notes FROM "OrderItem"',
    'SELECT notes FROM "InventoryItem"',
    'SELECT user_id FROM "Site"',
    'SELECT coords FROM "Site"',
    'SELECT stripe_terminal_location_id FROM "Site"',
    'SELECT issuer_vat_number FROM "Invoice"',
    'SELECT recipient_vat_number FROM "Invoice"',
    'SELECT payment_ref FROM "Invoice"',
    'SELECT account_id FROM "Invoice"',
    'SELECT hash FROM "Invoice"',
    'SELECT * FROM "Reservation"',
    'SELECT * FROM "Site"',
    'SELECT r FROM "Reservation" r',
    'SELECT to_jsonb(s) FROM "Site" s',
    'SELECT bank_account FROM "PartnerAccount"',
    'SELECT * FROM "PartnerAccount"',
    'SELECT email FROM "User"',
    'SELECT * FROM "Account"',
    'SELECT * FROM "SecurityToken"',
    'SELECT * FROM password_reset_token',
    'SELECT * FROM "Employee"',
    'SELECT * FROM "RentalBooking"',
    'SELECT * FROM "Settlement"',
    'SELECT * FROM device',
    'SELECT * FROM lead',
    'SELECT * FROM assistant_conversation',
    'SELECT * FROM _prisma_migrations',
  ]
  it.each(denied)('permission denied: %s', async (sql) => {
    await expect(asReader(sql, claim())).rejects.toThrow(/permission denied/)
  })

  it('no view exposes a column that matches the assistant deny-list', async () => {
    // Mirror of DENIED_COLUMN in apps/partner/lib/assistant/snapshot/schema.ts.
    const DENIED = /iban|bank|token|secret|password|hash|payment_?ref|ref$|email|phone|contact|guest|anon|user_?id|employee|account|vat_?number|nif|dni|passport|personal|kyc|stripe|mollie|_viva|viva_|provider_id|terminal|recipient|issuer_(vat|company)|notes?$/i
    const cols = await asReader<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'assistant' AND table_name <> 'claim_secret'`,
      claim(),
    )
    expect(cols.length).toBeGreaterThan(100)
    expect(cols.filter((c) => DENIED.test(c.column_name))).toEqual([])
  })

  it('the secret values seeded for tenant A never appear in any view cell', async () => {
    const dump: unknown[] = []
    for (const v of VIEWS) dump.push(await asReader(`SELECT t::text AS row FROM assistant.${v} t`, claim()))
    const hay = JSON.stringify(dump)
    expect(hay).toContain('Beach A') // the dump is not vacuous
    for (const needle of [REF_A, 'secret.test', 'IBAN-A', 'VAT-A', 'INTERNAL-A', 'NOTE-A', 'ORDER-NOTE-A', 'Guest A']) expect(hay).not.toContain(needle)
  })
})

describe('assistant_reader: cannot write, create, or escape', () => {
  const claim = () => claimFor(w.a.siteId)
  const forbidden = [
    `INSERT INTO "Site" (id, name) VALUES ('x', 'x')`,
    `UPDATE "Site" SET name = 'pwned'`,
    `DELETE FROM "Reservation"`,
    `TRUNCATE "Reservation"`,
    `UPDATE assistant.site SET name = 'x'`,
    `INSERT INTO assistant.claim_secret VALUES (1, 'x')`,
    `CREATE TABLE public.pwn (id int)`,
    `CREATE TABLE assistant.pwn (id int)`,
    `CREATE VIEW assistant.pwn AS SELECT 1`,
    `CREATE FUNCTION public.pwn() RETURNS int LANGUAGE sql AS 'select 1'`,
    `DROP VIEW assistant.site`,
    `ALTER TABLE "Site" DISABLE ROW LEVEL SECURITY`,
    `DROP POLICY assistant_site ON "Site"`,
    `GRANT ALL ON "User" TO assistant_reader`,
    `CREATE ROLE evil SUPERUSER`,
    `ALTER ROLE assistant_reader BYPASSRLS`,
    `SET ROLE postgres`,
    `SET SESSION AUTHORIZATION postgres`,
    `COPY "Site" TO PROGRAM 'id'`,
    `COPY (SELECT 1) TO '/tmp/assistant_pwn'`,
    `COPY "Site" FROM '/etc/passwd'`,
    `CREATE EXTENSION dblink`,
    `SELECT pg_read_file('/etc/passwd')`,
    `SELECT pg_read_binary_file('/etc/passwd')`,
    `SELECT pg_ls_dir('/')`,
    `SELECT lo_import('/etc/passwd')`,
    `SELECT lo_export(1, '/tmp/assistant_pwn')`,
    `SELECT * FROM dblink('host=localhost dbname=postgres', 'select 1') AS t(a int)`,
    `SELECT pg_reload_conf()`,
    `SELECT pg_switch_wal()`,
  ]
  it.each(forbidden)('rejected: %s', async (sql) => {
    await expect(asReader(sql, claim())).rejects.toThrow(/permission denied|must be|read-only|does not exist|not allowed|superuser|only roles|cannot|insufficient|unrecognized|syntax|is not|requires/i)
  })

  it('writes fail even when the model flips the transaction to read-write', async () => {
    const r = new pg.Client({ connectionString: READER_URL })
    await r.connect()
    try {
      await r.query('BEGIN')
      await r.query('SET TRANSACTION READ WRITE')
      await expect(r.query(`UPDATE "Site" SET name = 'pwned'`)).rejects.toThrow(/permission denied/)
      await r.query('ROLLBACK')
      await r.query('SET default_transaction_read_only = off')
      await expect(r.query(`DELETE FROM "Product"`)).rejects.toThrow(/permission denied/)
      await expect(r.query(`CREATE TEMP TABLE t AS SELECT 1`)).resolves.toBeDefined() // temp is session-private; harmless
    } finally {
      await r.end()
    }
    // Owner still sees both tenants' untouched rows.
    expect(await prisma.site.count()).toBe(2)
    expect((await prisma.site.findMany({ select: { name: true }, orderBy: { name: 'asc' } })).map((s) => s.name)).toEqual(['Beach A', 'Beach B'])
  })

  it('role settings: read-only by default, 3 s statement timeout, connection limit, no superuser/bypassrls', async () => {
    const [s] = await prisma.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolconnlimit: number; cfg: string[] }>>(
      `SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolconnlimit,
              coalesce((SELECT array_agg(c) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = r.oid), '{}') AS cfg
       FROM pg_roles r WHERE r.rolname = 'assistant_reader'`,
    )
    expect(s).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 5 })
    expect(s!.cfg).toEqual(expect.arrayContaining(['statement_timeout=3s', 'default_transaction_read_only=on', 'idle_in_transaction_session_timeout=10s']))
  })

  it('statement_timeout fires on pg_sleep(5)', async () => {
    const t0 = Date.now()
    await expect(asReader('SELECT pg_sleep(5)', claim())).rejects.toMatchObject({ code: '57014' })
    expect(Date.now() - t0).toBeLessThan(4500)
  }, 10000)
})

describe('assistant_reader: the app role is unaffected (RLS enabled, not forced)', () => {
  it('the owner (Prisma) sees every tenant\'s rows and every column', async () => {
    expect(await prisma.reservation.count()).toBe(2)
    expect(await prisma.invoice.count()).toBe(2)
    const rows = await prisma.reservation.findMany({ select: { paymentRef: true, guestEmail: true } })
    expect(rows.map((r) => r.paymentRef).sort()).toEqual([REF_A, REF_B].sort())
    const n = (await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*)::int AS n FROM "InventoryItem"'))[0]!.n
    expect(n).toBe(5)
  })

  it('RLS is enabled but not forced on every covered table, and the policies are scoped to assistant_reader', async () => {
    const t = await prisma.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('Site','SiteWorkingHours','InventoryItem','SunbedGroup','ItemGroup','layout_element','Reservation','_InventoryItemToReservation','Product','Order','OrderItem','Invoice','RentalItem') AND relkind = 'r'`,
    )
    expect(t).toHaveLength(13)
    for (const r of t) expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: false })
    const pol = await prisma.$queryRawUnsafe<Array<{ roles: string[]; cmd: string }>>(`SELECT roles::text[] AS roles, cmd FROM pg_policies WHERE policyname = 'assistant_site'`)
    expect(pol).toHaveLength(13)
    for (const p of pol) expect(p).toMatchObject({ roles: ['assistant_reader'], cmd: 'SELECT' })
  })

  it('the owner can still write (Prisma create/update/delete round trip)', async () => {
    const p = await createTestProduct(w.a.siteId, { name: 'Round trip' })
    await prisma.product.update({ where: { id: p.id }, data: { name: 'Round trip 2' } })
    await prisma.product.delete({ where: { id: p.id } })
  })
})

describe('runAssistantSql (the runner the sql tool calls)', () => {
  const ctx = () => ({ siteId: w.a.siteId, accountId: w.a.accountId })
  beforeAll(() => {
    process.env.ASSISTANT_DB_URL = READER_URL
    process.env.ASSISTANT_DB_CLAIM_SECRET = SECRET
  })

  it('returns columns/rows scoped to the claimed site, numbers as numbers, timestamps as ISO', async () => {
    const r = await runAssistantSql('SELECT count(*) AS n, min(starts_at) AS first_start, sum(amount) AS total FROM assistant.reservation;', [], ctx())
    expect(r.columns).toEqual(['n', 'first_start', 'total'])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]![0]).toBe(1)
    expect(typeof r.rows[0]![1]).toBe('string')
    expect(r.rows[0]![2]).toBe(42.5)
    expect(r.truncated).toBe(false)
    const other = await runAssistantSql('SELECT count(*) FROM assistant.sunbed', [], { siteId: w.b.siteId, accountId: w.b.accountId })
    expect(other.rows[0]![0]).toBe(3)
  })

  it('binds params, handles duplicate column names and trailing comments', async () => {
    const r = await runAssistantSql('SELECT a.number, b.number FROM assistant.sunbed a, assistant.sunbed b WHERE a.number = $1 AND b.number = $1 -- trailing comment', [1], ctx())
    expect(r.columns).toEqual(['number', 'number'])
    expect(r.rows).toEqual([[1, 1]])
  })

  it('truncates at maxRows and says so', async () => {
    const r = await runAssistantSql('SELECT generate_series(1, 50) AS g', [], { ...ctx(), maxRows: 10 })
    expect(r.rows).toHaveLength(10)
    expect(r.truncated).toBe(true)
  })

  it('applies the site time zone to timestamptz', async () => {
    const utc = await runAssistantSql("SELECT to_char(starts_at, 'HH24') AS h, current_setting('TimeZone') AS tz FROM assistant.reservation", [], ctx())
    const madrid = await runAssistantSql("SELECT current_setting('TimeZone') AS tz", [], { ...ctx(), timeZone: 'Europe/Madrid' })
    expect(madrid.rows[0]![0]).toBe('Europe/Madrid')
    expect(utc.rows[0]![1]).not.toBe('Europe/Madrid')
    await expect(runAssistantSql('SELECT 1', [], { ...ctx(), timeZone: "x'; DROP" })).rejects.toThrow(/invalid timeZone/)
  })

  it('a stacked second statement is a protocol error, writes are denied, and the connection stays usable', async () => {
    await expect(runAssistantSql('SELECT 1); DELETE FROM "Product"; SELECT (1', [], ctx())).rejects.toThrow()
    await expect(runAssistantSql('SELECT 1 AS x; SELECT 2 AS y', [], ctx())).rejects.toThrow()
    await expect(runAssistantSql(`UPDATE "Site" SET name = 'x' RETURNING 1`, [], ctx())).rejects.toThrow()
    await expect(runAssistantSql('SELECT payment_ref FROM "Reservation"', [], ctx())).rejects.toThrow(/permission denied/)
    expect((await runAssistantSql('SELECT count(*) FROM assistant.site', [], ctx())).rows[0]![0]).toBe(1)
  })

  it('a session-level set_config smuggled into one query does not leak into the next request', async () => {
    // Tries to persist a B claim + disable the timeout on the pooled connection (is_local = false).
    const forged = forge(w.b.siteId, 'x', nowSec() + 60, 'attacker')
    await runAssistantSql(`SELECT set_config('assistant.claim', '${forged}', false), set_config('statement_timeout', '0', false)`, [], ctx())
    for (let i = 0; i < 4; i++) {
      expect((await runAssistantSql('SELECT name FROM assistant.site', [], ctx())).rows).toEqual([['Beach A']])
    }
    await expect(runAssistantSql('SELECT pg_sleep(5)', [], ctx())).rejects.toMatchObject({ code: '57014' })
  }, 15000)

  it('refuses an unconfigured environment and bad claim input', async () => {
    expect(() => signAssistantClaim({ siteId: 'a.b', accountId: 'x' }, SECRET)).toThrow(/invalid/)
    expect(() => signAssistantClaim({ siteId: 'a', accountId: 'x', ttlSec: 301 }, SECRET)).toThrow(/ttlSec/)
    expect(() => signAssistantClaim({ siteId: 'a', accountId: 'x' }, 'short')).toThrow(/secret/)
  })
})

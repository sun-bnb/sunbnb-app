/**
 * The assistant `sql` tool and `run_js` data inputs against the REAL `assistant_reader` role on
 * sunbnb_test (track 030 D2). Two tenants exist; the tool is bound to tenant A and must see only
 * A's rows, whatever the query asks for. Isolation is Postgres's (RLS on a signed claim + column
 * grants); this proves the app mints the claim from the route-bound ids and maps what comes back.
 *
 * Needs the role provisioned (`packages/data/scripts/setup-assistant-reader.sh integration`) and
 * ASSISTANT_DB_URL / ASSISTANT_DB_CLAIM_SECRET in apps/partner/.env.local (or the environment); the
 * URL's database is swapped for sunbnb_test here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)) }))
let mockUserId: string | null = null

function fromEnvFile(key: string): string | undefined {
  try {
    const t = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8')
    const m = new RegExp(`^(?:export )?${key}=(.*)$`, 'm').exec(t)
    return m?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}
const READER_URL = (process.env.ASSISTANT_DB_URL ?? fromEnvFile('ASSISTANT_DB_URL'))?.replace(/\/[^/?]+(\?.*)?$/, '/sunbnb_test$1')
const SECRET = process.env.ASSISTANT_DB_CLAIM_SECRET ?? fromEnvFile('ASSISTANT_DB_CLAIM_SECRET')
if (!READER_URL || !SECRET) throw new Error('ASSISTANT_DB_URL / ASSISTANT_DB_CLAIM_SECRET missing (apps/partner/.env.local)')
process.env.ASSISTANT_DB_URL = READER_URL
process.env.ASSISTANT_DB_CLAIM_SECRET = SECRET

import { executeToolCall } from '@repo/agent/loop'
import { closeAssistantPool, runAssistantSql } from '@repo/data/assistant-claim'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, createTestInventoryItem, createTestProduct, createTestReservation } from '@/app/test/fixtures'
import { RELATIONSHIPS } from '@/lib/assistant/inspect/data'
import { readAssistantTables } from '@/lib/assistant/sandbox/inputs'
import { ASSISTANT_VIEWS } from '@/lib/assistant/sql-schema'
import { runChecked, sqlTool } from '@/lib/assistant/tools/sql'
import type { AssistantToolCtx } from '@/lib/assistant/tools'

interface Tenant { accountId: string; siteId: string; resId: string; labels: string[]; name: string }
let a: Tenant
let b: Tenant

async function mkTenant(label: string, seats: number): Promise<Tenant> {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const name = `Beach ${label}`
  const site = await createTestSite(user.id, { name, timeZone: 'Europe/Madrid' })
  const labels: string[] = []
  const items = []
  for (let n = 1; n <= seats; n++) {
    const seatLabel = `${label === 'A' ? 1 : 9}-10${n}-1`
    labels.push(seatLabel)
    items.push(await createTestInventoryItem(user.id, site.id, { number: n, group: label === 'A' ? 1 : 9, seatLabel, notes: `NOTE-${label}` }))
  }
  const res = await createTestReservation(user.id, site.id, items.map((i) => i.id), { status: 'confirmed', paymentAmount: label === 'A' ? 25 : 99, guestEmail: `guest-${label}@secret.test` })
  await createTestProduct(site.id, { name: `Drink ${label}` })
  return { accountId: user.id, siteId: site.id, resId: res.id, labels, name }
}

const ctxFor = (t: Tenant): AssistantToolCtx => ({ session: { user: { id: t.accountId } }, accountId: t.accountId, siteId: t.siteId, locale: 'en' })
async function sql(query: string, t: Tenant = a) {
  mockUserId = t.accountId
  const ex = await executeToolCall([sqlTool], { id: 't1', name: 'sql', arguments: JSON.stringify({ query }) }, ctxFor(t))
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}

beforeAll(async () => {
  await cleanDatabase()
  // The database verifies claims against assistant.claim_secret; make it the secret this process signs with.
  await prisma.$executeRawUnsafe(
    `INSERT INTO assistant.claim_secret (id, secret) VALUES (1, convert_to($1, 'UTF8')) ON CONFLICT (id) DO UPDATE SET secret = excluded.secret`,
    SECRET,
  )
  a = await mkTenant('A', 2)
  b = await mkTenant('B', 3)
})
afterAll(async () => {
  await closeAssistantPool()
  await cleanDatabase()
  await disconnectDatabase()
})

describe('sql tool: tenant isolation through the real reader', () => {
  it("returns only the claimed site's rows", async () => {
    expect(await sql('select name from site')).toMatchObject({ ok: true, rows: [[a.name]] })
    expect((await sql('select seat_label from sunbed order by number')).rows).toEqual(a.labels.map((l) => [l]))
    expect((await sql('select count(*) as n from sunbed')).rows).toEqual([[2]])
    expect((await sql('select amount from reservation')).rows).toEqual([[25]])
    expect((await sql('select name from product')).rows).toEqual([['Drink A']])
    expect((await sql('select count(*) as n from reservation_seat')).rows).toEqual([[2]])
  })

  it('the same query bound to the other tenant returns that tenant only', async () => {
    expect((await sql('select count(*) as n from sunbed', b)).rows).toEqual([[3]])
    expect((await sql('select name from site', b)).rows).toEqual([[b.name]])
  })

  it("a forged query that names the other site's data returns nothing", async () => {
    expect((await sql(`select * from sunbed where seat_label in ('${b.labels.join("','")}')`)).rows).toEqual([])
    expect((await sql(`select * from reservation where id = '${b.resId}'`)).rows).toEqual([])
    expect((await sql(`select * from site where name = '${b.name}'`)).rows).toEqual([])
    expect((await sql(`select * from reservation_seat where reservation_id = '${b.resId}'`)).rows).toEqual([])
    expect((await sql(`select * from assistant.product where name = 'Drink B'`)).rows).toEqual([])
  })

  it('a forged claim smuggled in through SQL (bypassing the app checker) still sees nothing of the other site', async () => {
    // set_config of the claim inside the query, with a body naming site B but no valid MAC.
    const forged = `${b.siteId}.${b.accountId}.${Math.floor(Date.now() / 1000) + 60}.${'0'.repeat(64)}`
    const r = await runChecked(`select set_config('assistant.claim', '${forged}', true), (select count(*) from sunbed) as n`, { siteId: a.siteId, accountId: a.accountId })
    const after = await runChecked("select seat_label from sunbed where seat_label like '9-%'", { siteId: a.siteId, accountId: a.accountId })
    expect(JSON.stringify(r)).not.toContain('9-10')
    expect(after).toMatchObject({ ok: true, rows: [] })
  })

  it('PostGIS functions work', async () => {
    const r = await sql('select ST_Distance(ST_MakePoint(lng, lat)::geography, ST_MakePoint(lng, lat + 0.001)::geography) as m from site')
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.rows[0][0]).toBeGreaterThan(100)
  })
})

describe('sql tool: Postgres errors reach the model in friendly form', () => {
  it('a non-allowlisted base column -> "not available to the assistant" (checker bypassed to hit the DB)', async () => {
    const r = await runChecked('select payment_ref from public."Reservation"', { siteId: a.siteId, accountId: a.accountId })
    expect(r).toMatchObject({ ok: false, error: 'column_not_available', detail: expect.stringMatching(/not available to the assistant/) })
  })

  it('an undocumented column on a view is a short sql_error', async () => {
    expect(await sql('select guest_email from reservation')).toMatchObject({ ok: false, error: 'sql_error', detail: expect.stringContaining('guest_email') })
  })

  it('a query over the statement timeout -> query too slow', async () => {
    const r = await runChecked('select pg_sleep(5)', { siteId: a.siteId, accountId: a.accountId })
    expect(r).toMatchObject({ ok: false, error: 'query_too_slow' })
  }, 15_000)

  it('writes are impossible even past the checker (READ ONLY + no grants)', async () => {
    const r = await runChecked("with d as (delete from public.\"Site\" returning 1) select * from d", { siteId: a.siteId, accountId: a.accountId })
    expect(r.ok).toBe(false)
    expect(await prisma.site.count()).toBe(2)
  })
})

describe('documentation matches the live views', () => {
  it('every documented view exists and exposes exactly the documented columns', async () => {
    for (const v of ASSISTANT_VIEWS) {
      const res = await runAssistantSql(`SELECT * FROM assistant.${v.name}`, [], { siteId: a.siteId, accountId: a.accountId, maxRows: 1 })
      expect(res.columns, v.name).toEqual(v.columns.map((c) => c.name))
    }
  })

  it('every inspect:data example query runs against the real views', async () => {
    for (const r of RELATIONSHIPS) {
      const res = await sql(r.sql)
      expect(res.ok, `${r.from} -> ${r.to}: ${JSON.stringify(res)}`).toBe(true)
    }
  })
})

describe('run_js data inputs through the real reader', () => {
  it("fetches the claimed site's rows only", async () => {
    const read = await readAssistantTables(a.siteId, a.accountId, ['sunbed', 'reservation', 'site'])
    expect(read.notes).toEqual([])
    expect(read.data.sunbed!.map((r) => r.seat_label).sort()).toEqual(a.labels)
    expect(read.data.reservation).toHaveLength(1)
    expect(read.data.site![0]!.name).toBe(a.name)
    expect(JSON.stringify(read.data)).not.toContain('9-10')
    expect(read.truncated).toEqual({})
  })

  it('reports truncation with the real total when over the cap', async () => {
    const read = await readAssistantTables(a.siteId, a.accountId, ['sunbed'], 1)
    expect(read.data.sunbed).toHaveLength(1)
    expect(read.truncated).toEqual({ sunbed: { loaded: 1, total: 2 } })
  })
})

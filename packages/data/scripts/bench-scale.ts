/**
 * Query-shape benchmark for the scale fixture (track 020 P0).
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS) over the SQL shapes the apps actually issue
 * against `InventoryItem` and `Reservation`, and prints scan type + timing per
 * shape. Its job is to make P1 (indexes) *provable*: the same script run before
 * and after the migration shows Seq Scan → Index Scan and the timing delta.
 *
 * Read-only. It never writes, so it is safe to run against any database the
 * guard permits — but it is only meaningful against a seeded fixture, since
 * Postgres correctly prefers a sequential scan on a small table regardless of
 * what indexes exist.
 *
 * Each shape below is annotated with the call site it mirrors. When a call site
 * changes, this file must change with it — a benchmark measuring a query the
 * app no longer issues is worse than no benchmark, because it looks like
 * evidence.
 *
 * Usage:
 *   npm run scale:bench                 # human-readable table
 *   npm run scale:bench -- --json       # machine-readable, for baseline diffs
 *   npm run scale:bench -- --plans      # full EXPLAIN output per shape
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTarget, maskDbUrl } from './scale-fixture-guard'
import {
  BLOCKING_STATUSES,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
} from '../src/reservation-status'

const args = process.argv.slice(2)
const AS_JSON = args.includes('--json')
const SHOW_PLANS = args.includes('--plans')
/** Repetitions per shape; the reported time is the median. */
const RUNS = 5

let url: URL
try {
  ;({ url } = assertSafeTarget(process.env.POSTGRES_URL, { force: true }))
} catch (e) {
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.POSTGRES_URL! }),
})

interface Shape {
  key: string
  /** The call site this mirrors — keep in sync or delete the shape. */
  source: string
  sql: string
  params: (ctx: Ctx) => unknown[]
}

interface Ctx {
  bigSiteId: string
  controlSiteId: string
  todayStart: Date
  todayEnd: Date
  sampleItemIds: string[]
}

const blocking = BLOCKING_STATUSES

const SHAPES: Shape[] = [
  {
    key: 'inventory:by-site',
    source: 'apps/partner/app/sites/site-page.tsx:29 — every partner site tab',
    sql: `SELECT id, number, status, "group" FROM "InventoryItem"
          WHERE site_id = $1 ORDER BY number ASC`,
    params: (c) => [c.bigSiteId],
  },
  {
    key: 'inventory:by-site-active',
    source: 'apps/user availabilityService.ts:62 + api/sites/[id] — consumer reads',
    sql: `SELECT id FROM "InventoryItem" WHERE site_id = $1 AND status = 'active'`,
    params: (c) => [c.bigSiteId],
  },
  {
    key: 'inventory:by-site-CONTROL',
    source: 'same as inventory:by-site, but for a SMALL tenant — shows cross-tenant cost',
    sql: `SELECT id, number, status FROM "InventoryItem"
          WHERE site_id = $1 ORDER BY number ASC`,
    params: (c) => [c.controlSiteId],
  },
  {
    key: 'inventory:by-site-group',
    source: 'apps/partner inventory/actions.ts:382 moveParcel · inventory-actions.ts:377 deleteItemsByGroup',
    sql: `SELECT id, location_lat, location_lng FROM "InventoryItem"
          WHERE site_id = $1 AND "group" = $2`,
    params: (c) => [c.bigSiteId, 7],
  },
  {
    key: 'inventory:max-number',
    source: 'apps/partner inventory-actions.ts:16 createInventoryItem — next seat number',
    sql: `SELECT number FROM "InventoryItem" WHERE site_id = $1
          ORDER BY number DESC LIMIT 1`,
    params: (c) => [c.bigSiteId],
  },
  {
    key: 'reservation:overlap-window',
    source: 'apps/user availabilityService.ts:80 · partner manage/sunbeds/page.tsx:60',
    sql: `SELECT id, "from", "to", status FROM "Reservation"
          WHERE site_id = $1 AND status = ANY($2)
            AND "from" <= $3 AND "to" >= $4`,
    params: (c) => [c.bigSiteId, blocking, c.todayEnd, c.todayStart],
  },
  {
    key: 'reservation:conflict-guard',
    source: 'packages/data/src/reservations.ts:132 findConflictingReservation — RUNS INSIDE THE FOR UPDATE LOCK',
    sql: `SELECT r.id FROM "Reservation" r
          WHERE r.site_id = $1 AND r.status = ANY($2)
            AND r."from" < $3 AND r."to" > $4
            AND EXISTS (
              SELECT 1 FROM "_InventoryItemToReservation" j
              WHERE j."B" = r.id AND j."A" = ANY($5)
            )
          LIMIT 1`,
    params: (c) => [c.bigSiteId, blocking, c.todayEnd, c.todayStart, c.sampleItemIds],
  },
  {
    key: 'reservation:revenue-month',
    source: 'packages/data/src/analytics.ts getRevenueByDay — accounting month window',
    sql: `SELECT date_trunc('day', "from") AS day, count(*), sum(payment_amount)
          FROM "Reservation"
          WHERE site_id = $1 AND status = ANY($2)
            AND "from" >= $3 AND "from" < $4
          GROUP BY 1`,
    params: (c) => [
      c.bigSiteId,
      [RESERVATION_COMPLETE, RESERVATION_PAID_IN_CASH],
      new Date(c.todayStart.getTime() - 30 * 86400000),
      c.todayEnd,
    ],
  },
  {
    key: 'reservation:all-for-items',
    source: 'apps/partner site-page.tsx:32 — the UNFILTERED per-item reservations include',
    sql: `SELECT j."A" AS item_id, r.id
          FROM "_InventoryItemToReservation" j
          JOIN "Reservation" r ON r.id = j."B"
          WHERE j."A" = ANY($1)`,
    params: (c) => [c.sampleItemIds],
  },
]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Summarise a plan into the one fact P1 is about: how was each table reached? */
function scanSummary(plan: string): string {
  const scans = new Set<string>()
  for (const line of plan.split('\n')) {
    // Two plan-node spellings: "Seq Scan on <table>" and, for anything
    // index-backed, "Index Scan using <index> on <table>". Matching only the
    // first would silently report "—" for every indexed query, i.e. exactly
    // the case this benchmark exists to detect.
    const m = line.match(
      /(Seq Scan|Parallel Seq Scan|Index Scan|Index Only Scan|Bitmap Heap Scan|Bitmap Index Scan)(?: using [\w"]+)? on ("?[\w]+"?)/
    )
    if (!m) continue
    const kind = m[1]!.replace('Parallel ', '')
    const table = m[2]!.replace(/"/g, '')
    if (table === 'InventoryItem' || table === 'Reservation' || table.startsWith('_Inventory')) {
      scans.add(`${table}:${kind}`)
    }
  }
  return scans.size ? [...scans].sort().join(', ') : '—'
}

async function buildContext(): Promise<Ctx> {
  const site = await prisma.site.findFirst({
    where: { name: { startsWith: 'SCALE FIXTURE — Big' } },
    select: { id: true },
  })
  const control = await prisma.site.findFirst({
    where: { name: { startsWith: 'SCALE FIXTURE — Control' } },
    select: { id: true },
  })
  if (!site || !control) {
    throw new Error(
      'Scale fixture not found. Run `npm run scale:seed` first — this benchmark ' +
        'is meaningless against an unseeded database.'
    )
  }

  const items = await prisma.inventoryItem.findMany({
    where: { siteId: site.id },
    select: { id: true },
    take: 20,
    orderBy: { number: 'asc' },
  })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart.getTime() + 86399000)

  return {
    bigSiteId: site.id,
    controlSiteId: control.id,
    todayStart,
    todayEnd,
    sampleItemIds: items.map((i) => i.id),
  }
}

async function run() {
  console.log(`\n▶ Scale benchmark — ${maskDbUrl(url)}`)

  const ctx = await buildContext()

  const [items, reservations] = await Promise.all([
    prisma.inventoryItem.count(),
    prisma.reservation.count(),
  ])
  const bigItems = await prisma.inventoryItem.count({ where: { siteId: ctx.bigSiteId } })
  console.log(
    `  ${items.toLocaleString()} items (${bigItems.toLocaleString()} on the big site), ` +
      `${reservations.toLocaleString()} reservations · median of ${RUNS} runs\n`
  )

  const results: Array<{ key: string; ms: number; scans: string; source: string }> = []

  for (const shape of SHAPES) {
    const params = shape.params(ctx)
    const timings: number[] = []
    let lastPlan = ''

    // One untimed warm-up so the comparison measures the plan, not cold cache.
    await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${shape.sql}`, ...params)

    for (let i = 0; i < RUNS; i++) {
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
        `EXPLAIN (ANALYZE, BUFFERS) ${shape.sql}`,
        ...params
      )
      lastPlan = rows.map((r) => Object.values(r)[0]).join('\n')
      const m = lastPlan.match(/Execution Time: ([\d.]+) ms/)
      if (m) timings.push(Number(m[1]))
    }

    results.push({
      key: shape.key,
      ms: median(timings),
      scans: scanSummary(lastPlan),
      source: shape.source,
    })

    if (SHOW_PLANS) {
      console.log(`\n── ${shape.key} ──\n${lastPlan}\n`)
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ items, bigItems, reservations, results }, null, 2))
    return
  }

  const keyWidth = Math.max(...results.map((r) => r.key.length))
  const scanWidth = Math.max(...results.map((r) => r.scans.length), 20)
  console.log(
    `  ${'shape'.padEnd(keyWidth)}  ${'ms'.padStart(9)}  ${'table access'.padEnd(scanWidth)}`
  )
  console.log(`  ${'─'.repeat(keyWidth)}  ${'─'.repeat(9)}  ${'─'.repeat(scanWidth)}`)
  for (const r of results) {
    const seq = r.scans.includes('Seq Scan')
    console.log(
      `  ${r.key.padEnd(keyWidth)}  ${r.ms.toFixed(2).padStart(9)}  ${r.scans.padEnd(scanWidth)}${seq ? '  ⚠' : ''}`
    )
  }
  console.log(`\n  ⚠ = sequential scan\n`)
}

run()
  .catch((e) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

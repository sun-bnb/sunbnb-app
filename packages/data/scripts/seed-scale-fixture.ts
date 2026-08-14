/**
 * Seed a large synthetic venue for scale benchmarking (track 020 P0).
 *
 * Track 020 asks how the platform behaves for "a single beach with dozens of
 * parcels and thousands of sunbeds". Every figure in that track was read from
 * source, never profiled — this script exists to replace judgment with
 * measurement. Pair it with `bench-scale.ts`, which runs EXPLAIN ANALYZE over
 * the canonical query shapes against whatever this seeds.
 *
 * Why a volume fixture is mandatory, not nice-to-have: Postgres picks a
 * sequential scan for small tables no matter what indexes exist, so on a
 * near-empty dev DB an index change is unobservable — you cannot tell a
 * working index from a broken one. Only at volume does the planner reveal its
 * hand.
 *
 * WHAT IT BUILDS (deterministic — a fixed PRNG seed, so two runs on two
 * machines produce byte-identical data and therefore comparable timings):
 *
 *   - 1 BIG site      — PARCELS × SEATS_PER_PARCEL seats (default 40 × 75 = 3 000)
 *   - N CONTROL sites — small ordinary venues (default 20 × 100 = 2 000 seats)
 *   - today's bookings on both, at a realistic occupancy
 *   - HISTORY_MONTHS of past reservations (what makes the partner inventory
 *     tab's unfiltered `reservations` include expensive)
 *   - one sticky out-of-service block per site (`to` = 2999-12-31), which is
 *     the real-world row that makes `getOccupancyByDay` re-walk seat lists
 *     once per day of a trend window
 *
 * The control sites are not decoration. `InventoryItem.site_id` is unindexed,
 * so a query for a SMALL site still scans past the big site's rows — the
 * cross-tenant cost is the single widest-blast finding in track 020, and it is
 * invisible in a fixture containing only one site.
 *
 * SAFETY — this script TRUNCATEs before seeding, so it is destructive by
 * design. Three independent guards keep that contained:
 *   1. the database name must be on ALLOWED_DATABASES (default `sunbnb_scale`)
 *   2. the host must be local (localhost / 127.0.0.1)
 *   3. `--force` is required to run against any database other than the default
 * `sunbnb_test` is deliberately NOT allowed: the integration suites own it and
 * TRUNCATE it between files, so a fixture there would be both destroyed and
 * destructive.
 *
 * Usage:
 *   npm run scale:seed                 # default 3 000-seat fixture
 *   npm run scale:seed -- --parcels=60 --seats=100
 *   npm run scale:reset                # drop the fixture data, leave the DB
 *
 * One-time setup:
 *   docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE sunbnb_scale;"
 *   POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/sunbnb_scale npx prisma migrate deploy
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { assertSafeTarget, maskDbUrl } from './scale-fixture-guard'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  RESERVATION_HELD,
  RESERVATION_CANCELED,
  OP_EXPECTED,
  OP_CHECKED_IN,
  OP_WALKED_IN,
  OP_DEPARTED,
} from '../src/reservation-status'
// 'blocked' is an operational status but lives in the state machine, not the
// status constants — import it rather than hardcoding, so a rename can't leave
// the fixture silently seeding an unrecognised state.
import { OP_BLOCKED } from '../src/reservation-machine'

// ─── Guards ─────────────────────────────────────────────────────────────────
// Logic lives in `scale-fixture-guard.ts` (pure, unit-tested) — this file only
// wires it up, because a guard that cannot be tested is not a guard.

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const RESET_ONLY = args.includes('--reset')

function flag(name: string, fallback: number): number {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const value = Number(hit.split('=')[1])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number, got "${hit.split('=')[1]}"`)
  }
  return Math.floor(value)
}

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────────
//
// Math.random() would make two runs incomparable — a timing difference could
// be the change under test or could be a different data shape. A fixed seed
// removes that ambiguity entirely.

function makeRng(seed: number) {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RNG_SEED = 20260814

// ─── Fixture shape ──────────────────────────────────────────────────────────

const PARCELS = flag('parcels', 40)
const SEATS_PER_PARCEL = flag('seats', 75)
const CONTROL_SITES = flag('control-sites', 20)
const CONTROL_SEATS = flag('control-seats', 100)
const HISTORY_MONTHS = flag('history-months', 12)
/** Share of the big site's seats booked for today. */
const TODAY_OCCUPANCY = 0.6
/**
 * Reservations created per month of history, per site.
 *
 * This is the knob that matters most. Index benefit is a function of TOTAL
 * table size, not of the big venue's seat count: at 5 000 InventoryItem rows
 * Postgres correctly prefers a sequential scan no matter what indexes exist,
 * because the whole table is ~125 pages. `Reservation` is the table that
 * actually accumulates — every booking at every venue, forever — so it is the
 * one where an index earns its keep.
 */
const HISTORY_RESERVATIONS_PER_MONTH = flag('history-per-month', 140)

const BIG_SITE_NAME = 'SCALE FIXTURE — Big Beach'
const CONTROL_SITE_PREFIX = 'SCALE FIXTURE — Control'
const FIXTURE_EMAIL = 'scale-fixture@local.invalid'

// Anchor coordinates (Malaga-ish) — real enough for PostGIS distance queries.
const BASE_LAT = 36.7213
const BASE_LNG = -4.4214

// ─── Client ─────────────────────────────────────────────────────────────────

// Validated before the client is constructed, and before any statement runs.
// A guard failure exits cleanly rather than dumping a stack trace — the
// operator needs to read WHY it refused, not where the throw was.
let url: URL
try {
  ;({ url } = assertSafeTarget(process.env.POSTGRES_URL, { force: FORCE }))
} catch (e) {
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.POSTGRES_URL! }),
})

// ─── Wipe ───────────────────────────────────────────────────────────────────

/**
 * TRUNCATE ... CASCADE over the tables this fixture touches. Mirrors
 * `src/test/setup.ts:cleanDatabase()`; kept separate because that helper is
 * bound to the test client and this script must not import test wiring.
 */
async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "_InventoryItemToReservation",
      "reservation_day",
      "Reservation",
      "InventoryItem",
      "ItemGroup",
      "SunbedGroup",
      "Site",
      "PartnerAccount",
      "User"
    RESTART IDENTITY CASCADE
  `)
}

// ─── Seed ───────────────────────────────────────────────────────────────────

interface SeededSite {
  id: string
  itemIds: string[]
}

async function seedSite(
  userId: string,
  name: string,
  parcels: number,
  seatsPerParcel: number,
  latOffset: number,
  lngOffset: number
): Promise<SeededSite> {
  const site = await prisma.site.create({
    data: {
      userId,
      name,
      locationLat: String(BASE_LAT + latOffset),
      locationLng: String(BASE_LNG + lngOffset),
      price: 12.0,
      vat: 21.0,
      status: 'active',
      timeZone: 'Europe/Madrid',
      features: ['sunbeds'],
    },
  })

  // PostGIS `coords` is Unsupported() in Prisma — set it directly so the
  // GiST-indexed consumer search (`searchSites`) can actually find this site.
  await prisma.$executeRawUnsafe(
    `UPDATE "Site" SET coords = ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) WHERE id = $3`,
    BASE_LNG + lngOffset,
    BASE_LAT + latOffset,
    site.id
  )

  const itemIds: string[] = []

  for (let p = 0; p < parcels; p++) {
    const rows = 5
    const seatsPerRow = Math.ceil(seatsPerParcel / rows)
    const group = await prisma.itemGroup.create({
      data: {
        number: p + 1,
        label: `Parcel ${p + 1}`,
        rows,
        seatsPerRow,
        locationLat: String(BASE_LAT + latOffset + p * 0.0004),
        locationLng: String(BASE_LNG + lngOffset),
        horizontalGap: 0.5,
        verticalGap: 0.8,
        pairGap: 0.2,
        status: 'active',
        price: 12.0,
      },
    })

    // createMany, not N creates — seeding 3 000 seats one statement at a time
    // is exactly the P4 anti-pattern this track is about; no reason to
    // reproduce it in the harness.
    const seats = Array.from({ length: seatsPerParcel }, (_, s) => {
      const row = Math.floor(s / seatsPerRow)
      const col = s % seatsPerRow
      return {
        userId,
        siteId: site.id,
        // Parcels have TWO representations in this schema — the relational
        // `itemGroupId` and the legacy integer `group`. The app dual-writes
        // both and different call sites read different ones (`moveParcel` and
        // `deleteItemsByGroup` filter on `group`), so the fixture must carry
        // both or those queries would all match `group = 0`.
        itemGroupId: group.id,
        group: p + 1,
        // Composite encoding the app relies on: group + 2-digit row + 2-digit seat.
        number: Number(
          `${p + 1}${String(row + 1).padStart(2, '0')}${String(col + 1).padStart(2, '0')}`
        ),
        locationLat: String(BASE_LAT + latOffset + p * 0.0004 + row * 0.00002),
        locationLng: String(BASE_LNG + lngOffset + col * 0.00003),
        status: 'active',
        category: 'standard',
        price: 12.0,
        seatLabel: `P${p + 1}-${row + 1}${col + 1}`,
      }
    })

    await prisma.inventoryItem.createMany({ data: seats })

    const created = await prisma.inventoryItem.findMany({
      where: { itemGroupId: group.id },
      select: { id: true },
      orderBy: { number: 'asc' },
    })
    itemIds.push(...created.map((i) => i.id))
  }

  return { id: site.id, itemIds }
}

/**
 * Bulk-insert reservations plus their m2m join rows.
 *
 * Prisma cannot `createMany` an implicit many-to-many, so the join rows go in
 * via raw INSERT against `_InventoryItemToReservation` ("A" = item, "B" =
 * reservation). Doing it row-by-row through `connect` would make seeding a
 * 20 000-reservation history take minutes.
 */
async function createReservations(
  userId: string,
  siteId: string,
  specs: Array<{
    itemIds: string[]
    from: Date
    to: Date
    status: string
    operationalStatus: string
    paymentAmount: number
  }>
): Promise<number> {
  if (specs.length === 0) return 0

  // Explicit ids so the join-row insert below can reference them without a
  // read-back. `siteId` is a cuid and unique, so `${siteId}-${i}` is too.
  const rows = specs.map((s, i) => ({
    id: `scale-res-${siteId}-${i}`,
    userId,
    siteId,
    from: s.from,
    to: s.to,
    status: s.status,
    operationalStatus: s.operationalStatus,
    paymentAmount: s.paymentAmount,
    type: 'days',
  }))

  await prisma.reservation.createMany({ data: rows })

  const links: Array<[string, string]> = []
  specs.forEach((spec, i) => {
    for (const itemId of spec.itemIds) links.push([itemId, rows[i]!.id])
  })

  // Chunked to stay under Postgres' 65 535 bind-parameter ceiling (2 params
  // per row → 5 000 rows is a comfortable 10 000).
  const CHUNK = 5000
  for (let i = 0; i < links.length; i += CHUNK) {
    const chunk = links.slice(i, i + CHUNK)
    let k = 1
    const placeholders = chunk.map(() => `($${k++}, $${k++})`).join(',')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_InventoryItemToReservation" ("A", "B") VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      ...chunk.flat()
    )
  }

  return rows.length
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function seedBookings(
  userId: string,
  site: SeededSite,
  occupancy: number,
  rng: () => number,
  label: string
): Promise<number> {
  const today = startOfToday()
  const todayEnd = new Date(today.getTime() + 23 * 60 * 60 * 1000)

  const specs: Parameters<typeof createReservations>[2] = []

  // ── Today's floor: parties of 1-4 seats until the occupancy target is met.
  const targetSeats = Math.floor(site.itemIds.length * occupancy)
  const shuffled = [...site.itemIds]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }

  let cursor = 0
  while (cursor < targetSeats) {
    const partySize = Math.min(1 + Math.floor(rng() * 4), targetSeats - cursor)
    const itemIds = shuffled.slice(cursor, cursor + partySize)
    cursor += partySize

    const roll = rng()
    // Mix of online / cash / held, and multiday stays — the multiday rows are
    // what make the `from <= todayEnd && to >= todayStart` window non-trivial.
    const multiday = roll > 0.75
    const status =
      roll < 0.5 ? RESERVATION_COMPLETE : roll < 0.85 ? RESERVATION_PAID_IN_CASH : RESERVATION_HELD
    const op = roll < 0.35 ? OP_CHECKED_IN : roll < 0.7 ? OP_WALKED_IN : OP_EXPECTED

    specs.push({
      itemIds,
      from: multiday ? new Date(today.getTime() - 2 * 86400000) : today,
      to: multiday ? new Date(today.getTime() + 3 * 86400000) : todayEnd,
      status,
      operationalStatus: op,
      paymentAmount: 12 * itemIds.length,
    })
  }

  // ── One sticky out-of-service block (to = 2999-12-31).
  //    This single row is why `getOccupancyByDay` re-walks a seat list once per
  //    day of a trend window (track 020 P5) — a fixture without it hides that.
  specs.push({
    itemIds: site.itemIds.slice(0, 8),
    from: new Date(today.getTime() - 30 * 86400000),
    to: new Date('2999-12-31T00:00:00.000Z'),
    status: RESERVATION_HELD,
    operationalStatus: OP_BLOCKED,
    paymentAmount: 0,
  })

  // ── History: what makes the partner inventory tab's unfiltered
  //    `reservations` include grow with site lifetime rather than screen content.
  for (let m = 1; m <= HISTORY_MONTHS; m++) {
    for (let r = 0; r < HISTORY_RESERVATIONS_PER_MONTH; r++) {
      const daysAgo = m * 30 + Math.floor(rng() * 28)
      const from = new Date(today.getTime() - daysAgo * 86400000)
      const partySize = 1 + Math.floor(rng() * 4)
      const start = Math.floor(rng() * (site.itemIds.length - partySize))
      specs.push({
        itemIds: site.itemIds.slice(start, start + partySize),
        from,
        to: new Date(from.getTime() + 23 * 60 * 60 * 1000),
        status: rng() < 0.92 ? RESERVATION_COMPLETE : RESERVATION_CANCELED,
        operationalStatus: OP_DEPARTED,
        paymentAmount: 12 * partySize,
      })
    }
  }

  const count = await createReservations(userId, site.id, specs)
  const joinRows = specs.reduce((sum, s) => sum + s.itemIds.length, 0)
  console.log(
    `   ${label}: ${count.toLocaleString()} reservations, ${joinRows.toLocaleString()} seat-links`
  )
  return count
}

async function main() {
  console.log(`\n▶ Scale fixture — target ${maskDbUrl(url)}`)

  if (RESET_ONLY) {
    await wipe()
    console.log('✔ Fixture data removed (schema left intact).\n')
    return
  }

  const totalSeats = PARCELS * SEATS_PER_PARCEL
  console.log(
    `  Big site:      ${PARCELS} parcels × ${SEATS_PER_PARCEL} seats = ${totalSeats.toLocaleString()}`
  )
  console.log(
    `  Control sites: ${CONTROL_SITES} × ${CONTROL_SEATS} seats = ${(CONTROL_SITES * CONTROL_SEATS).toLocaleString()}`
  )
  console.log(`  History:       ${HISTORY_MONTHS} months\n`)

  const started = Date.now()
  const rng = makeRng(RNG_SEED)

  console.log('  Wiping…')
  await wipe()

  const user = await prisma.user.create({
    data: { email: FIXTURE_EMAIL, name: 'Scale Fixture Partner' },
  })
  await prisma.partnerAccount.create({
    data: {
      userId: user.id,
      firstName: 'Scale',
      lastName: 'Fixture',
      email: FIXTURE_EMAIL,
      phoneNumber: '+34600000000',
      company: 'Scale Fixture SL',
      address: 'Paseo Maritimo 1, Malaga',
      businessId: 'ES00000000',
    },
  })

  console.log('  Seeding big site…')
  const big = await seedSite(user.id, BIG_SITE_NAME, PARCELS, SEATS_PER_PARCEL, 0, 0)
  await seedBookings(user.id, big, TODAY_OCCUPANCY, rng, 'big site')

  console.log('  Seeding control sites…')
  for (let c = 0; c < CONTROL_SITES; c++) {
    const control = await seedSite(
      user.id,
      `${CONTROL_SITE_PREFIX} ${c + 1}`,
      2,
      Math.ceil(CONTROL_SEATS / 2),
      0.02 * (c + 1),
      0.02 * (c + 1)
    )
    await seedBookings(user.id, control, 0.5, rng, `control ${c + 1}`)
  }

  // ANALYZE so the planner has fresh statistics — without it, EXPLAIN output
  // reflects an empty table and every benchmark below is meaningless.
  console.log('\n  Running ANALYZE…')
  await prisma.$executeRawUnsafe('ANALYZE')

  const [items, reservations, links, sites] = await Promise.all([
    prisma.inventoryItem.count(),
    prisma.reservation.count(),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*)::bigint AS count FROM "_InventoryItemToReservation"'
    ),
    prisma.site.count(),
  ])

  console.log('\n✔ Seeded:')
  console.log(`   Sites            ${sites.toLocaleString()}`)
  console.log(`   InventoryItems   ${items.toLocaleString()}`)
  console.log(`   Reservations     ${reservations.toLocaleString()}`)
  console.log(`   Seat-links       ${Number(links[0]!.count).toLocaleString()}`)
  console.log(`   Elapsed          ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
}

main()
  .catch((e) => {
    console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

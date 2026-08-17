/**
 * Unit ADDRESSES against a real database (track 021).
 *
 * The pure rules are covered in `unit-address.test.ts`. These cover what only
 * Postgres can answer: that `recomputeSeatLabels` is a faithful single writer of
 * `SunbedGroup.parcel`/`.row`, that an address follows its unit when the layout
 * genuinely changes and is surrendered when the unit stops standing anywhere,
 * and that UNIQUE(site, parcel, row, seq) actually refuses a second unit on one
 * spot rather than merely being declared.
 *
 * The oracle is raw SQL — deriving the address the way the app resolved it
 * BEFORE these columns existed (parcel from `InventoryItem.group`, row decoded
 * out of `InventoryItem.number`). Checking the writer with the writer's own
 * logic would only prove self-consistency; the risk being guarded is the stored
 * address drifting away from what the seats actually say.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestSunbedGroup,
  resetCounter,
} from './test/fixtures'
import { recomputeSeatLabels } from './seat-label-db'

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

const encodeNumber = (parcel: number, row: number, seatIdx: number) =>
  parcel * 10000 + row * 100 + seatIdx

/** The address the app resolved before these columns existed. */
async function derivedAddresses(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; parcel: number | null; row_: number | null; seq: number | null }>
  >(`
    SELECT g.id, g.seq,
           min(i."group") FILTER (WHERE i.status <> 'pool') AS parcel,
           min((i.number/100)%100) FILTER (WHERE i.status <> 'pool') AS row_
      FROM "SunbedGroup" g
      LEFT JOIN "InventoryItem" i ON i.sunbed_group_id = g.id
     GROUP BY g.id, g.seq
    HAVING count(*) FILTER (WHERE i.status <> 'pool') > 0
       AND count(DISTINCT i."group") FILTER (WHERE i.status <> 'pool') = 1
       AND count(DISTINCT ((i.number/100)%100)) FILTER (WHERE i.status <> 'pool') = 1
  `)
  return new Map(rows.map((r) => [r.id, `${r.parcel}-${r.row_}-${r.seq}`]))
}

async function storedAddresses(): Promise<Map<string, string>> {
  const units = await prisma.sunbedGroup.findMany({
    select: { id: true, parcel: true, row: true, seq: true },
  })
  return new Map(
    units
      .filter((u) => u.parcel != null && u.row != null)
      .map((u) => [u.id, `${u.parcel}-${u.row}-${u.seq}`]),
  )
}

/** Two seats standing at (parcel, row), as one unit. */
async function placeUnit(parcel: number, row: number, firstSeatIdx: number) {
  const unit = await createTestSunbedGroup(site.id)
  await createTestInventoryItem(user.id, site.id, {
    number: encodeNumber(parcel, row, firstSeatIdx),
    group: parcel,
    sunbedGroupId: unit.id,
  })
  await createTestInventoryItem(user.id, site.id, {
    number: encodeNumber(parcel, row, firstSeatIdx + 1),
    group: parcel,
    sunbedGroupId: unit.id,
  })
  return unit
}

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  user = await createTestUser()
  await createTestPartnerAccount(user.id)
  site = await createTestSite(user.id)
})

afterAll(async () => {
  await disconnectDatabase()
})

describe('recomputeSeatLabels writes the address', () => {
  it('records what the seats say, for every unit', async () => {
    await placeUnit(1, 1, 1)
    await placeUnit(1, 1, 3)
    await placeUnit(1, 2, 1)
    await placeUnit(2, 1, 1)

    await recomputeSeatLabels(site.id)

    const stored = await storedAddresses()
    const derived = await derivedAddresses()
    expect(stored.size).toBe(4)
    expect(Object.fromEntries(stored)).toEqual(Object.fromEntries(derived))
  })

  it('is idempotent — a second run writes nothing new', async () => {
    await placeUnit(1, 1, 1)
    await placeUnit(1, 1, 3)
    await recomputeSeatLabels(site.id)
    const first = await storedAddresses()

    await recomputeSeatLabels(site.id)

    expect(Object.fromEntries(await storedAddresses())).toEqual(Object.fromEntries(first))
  })

  it('does not move a seq that was already assigned', async () => {
    // The P3 guarantee, restated where it can actually be violated: the number
    // is painted on the bed, so persisting an address must never renumber one.
    await placeUnit(1, 1, 1)
    await placeUnit(1, 1, 3)
    await recomputeSeatLabels(site.id)
    const before = await prisma.sunbedGroup.findMany({
      select: { id: true, seq: true },
      orderBy: { id: 'asc' },
    })

    await recomputeSeatLabels(site.id)

    const after = await prisma.sunbedGroup.findMany({
      select: { id: true, seq: true },
      orderBy: { id: 'asc' },
    })
    expect(after).toEqual(before)
  })

  it('leaves a unit holding only a pool extra with no address', async () => {
    const unit = await createTestSunbedGroup(site.id)
    await createTestInventoryItem(user.id, site.id, {
      number: encodeNumber(1, 90, 1),
      group: 1,
      status: 'pool',
      sunbedGroupId: unit.id,
    })

    await recomputeSeatLabels(site.id)

    const row = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
    expect(row?.parcel).toBeNull()
    expect(row?.row).toBeNull()
  })

  it('keeps the unit put when a pool extra is added to it', async () => {
    // The extra's number decodes to row 90; the unit must stay in row 1.
    const unit = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)

    await createTestInventoryItem(user.id, site.id, {
      number: encodeNumber(1, 90, 1),
      group: 1,
      status: 'pool',
      sunbedGroupId: unit.id,
    })
    await recomputeSeatLabels(site.id)

    const row = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
    expect({ parcel: row?.parcel, row: row?.row }).toEqual({ parcel: 1, row: 1 })
  })
})

describe('the address follows the unit', () => {
  it('updates when the layout genuinely moves the unit', async () => {
    // A parcel re-dimensioned on the ground: the seats are renumbered into
    // another row, so the unit's address must change with them. Per the track's
    // paradigm this is normal work, not a failure — devices get re-attached.
    const unit = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)
    expect((await prisma.sunbedGroup.findUnique({ where: { id: unit.id } }))?.row).toBe(1)

    const seats = await prisma.inventoryItem.findMany({
      where: { sunbedGroupId: unit.id },
      orderBy: { number: 'asc' },
    })
    for (const [i, seat] of seats.entries()) {
      await prisma.inventoryItem.update({
        where: { id: seat.id },
        data: { number: encodeNumber(1, 5, i + 1) },
      })
    }
    await recomputeSeatLabels(site.id)

    const moved = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
    expect({ parcel: moved?.parcel, row: moved?.row }).toEqual({ parcel: 1, row: 5 })
    expect(Object.fromEntries(await storedAddresses())).toEqual(
      Object.fromEntries(await derivedAddresses()),
    )
  })

  it('surrenders the address when the unit stops standing anywhere', async () => {
    // Every placed seat gone but the unit row still present: it names no spot,
    // and holding the address would block a real unit built there later.
    const unit = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)
    expect((await prisma.sunbedGroup.findUnique({ where: { id: unit.id } }))?.parcel).toBe(1)

    await prisma.inventoryItem.updateMany({
      where: { sunbedGroupId: unit.id },
      data: { status: 'pool' },
    })
    await recomputeSeatLabels(site.id)

    const emptied = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
    expect(emptied?.parcel).toBeNull()
    expect(emptied?.row).toBeNull()
  })

  it('does not clobber a good address while the unit straddles two rows', async () => {
    // Mid-rearrange the seats can momentarily disagree. Guessing here would
    // re-point whatever device is bound to the unit, so the stored address is
    // left exactly as it was.
    const unit = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)

    const [first] = await prisma.inventoryItem.findMany({
      where: { sunbedGroupId: unit.id },
      orderBy: { number: 'asc' },
      take: 1,
    })
    await prisma.inventoryItem.update({
      where: { id: first!.id },
      data: { number: encodeNumber(1, 7, 1) },
    })
    await recomputeSeatLabels(site.id)

    const held = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
    expect({ parcel: held?.parcel, row: held?.row }).toEqual({ parcel: 1, row: 1 })
  })
})

describe('one spot, one unit', () => {
  it('refuses a second unit at the same address', async () => {
    const a = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)
    const addr = await prisma.sunbedGroup.findUnique({ where: { id: a.id } })

    const intruder = await createTestSunbedGroup(site.id)
    await expect(
      prisma.sunbedGroup.update({
        where: { id: intruder.id },
        data: { parcel: addr!.parcel, row: addr!.row, seq: addr!.seq },
      }),
    ).rejects.toThrow()
  })

  it('allows the same address at a different site', async () => {
    // The constraint is per-site: every venue numbers its own parcels from 1.
    const other = await createTestSite(user.id)
    const a = await placeUnit(1, 1, 1)
    await recomputeSeatLabels(site.id)
    const addr = await prisma.sunbedGroup.findUnique({ where: { id: a.id } })

    const twin = await createTestSunbedGroup(other.id)
    await expect(
      prisma.sunbedGroup.update({
        where: { id: twin.id },
        data: { parcel: addr!.parcel, row: addr!.row, seq: addr!.seq },
      }),
    ).resolves.toBeTruthy()
  })

  it('allows many units to have no address at all', async () => {
    // NULLs are distinct in Postgres — units awaiting an address, or holding
    // only extras, must not collide with each other.
    const a = await createTestSunbedGroup(site.id)
    const b = await createTestSunbedGroup(site.id)
    const c = await createTestSunbedGroup(site.id)

    const rows = await prisma.sunbedGroup.findMany({ where: { id: { in: [a.id, b.id, c.id] } } })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.parcel === null && r.row === null)).toBe(true)
  })
})

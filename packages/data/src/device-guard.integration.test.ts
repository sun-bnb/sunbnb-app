/**
 * `devicesBlockingSeatRemoval` — the guard that refuses to delete the seats
 * under a mounted device (track 021 Q5).
 *
 * Deleting every placed seat of a unit IS dismounting the parasol. If a device
 * is assigned to that spot the deletion must be refused, because the alternative
 * is a device on a pole polling an address that resolves to nothing, sitting
 * amber, with nothing in any UI explaining why — a failure discovered by walking
 * out to it.
 *
 * Integration rather than unit tests: the guard is three queries joined by the
 * unit's stored ADDRESS, and the property at risk is that its notion of an
 * address matches the resolver's. Mocks would let both drift together.
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
import { devicesBlockingSeatRemoval, deviceRemovalError } from './unit'

let user: Awaited<ReturnType<typeof createTestUser>>
let site: Awaited<ReturnType<typeof createTestSite>>

const encodeNumber = (parcel: number, row: number, seatIdx: number) =>
  parcel * 10000 + row * 100 + seatIdx

/** A two-seat unit standing at (parcel, row), addressed by a recompute. */
async function placeUnit(siteId: string, parcel: number, row: number, firstSeatIdx: number) {
  const unit = await createTestSunbedGroup(siteId)
  const seats = []
  for (const idx of [firstSeatIdx, firstSeatIdx + 1]) {
    seats.push(
      await createTestInventoryItem(user.id, siteId, {
        number: encodeNumber(parcel, row, idx),
        group: parcel,
        sunbedGroupId: unit.id,
      }),
    )
  }
  await recomputeSeatLabels(siteId)
  const addressed = await prisma.sunbedGroup.findUnique({ where: { id: unit.id } })
  return { unit: addressed!, seats }
}

async function mountDevice(code: string, siteId: string, address: { parcel: number | null; row: number | null; seq: number | null }) {
  return prisma.device.create({
    data: {
      code,
      status: 'active',
      assignedSiteId: siteId,
      assignedParcel: address.parcel,
      assignedRow: address.row,
      assignedSeq: address.seq,
    },
  })
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

describe('a device blocks the dismounting of its spot', () => {
  it('refuses when the unit loses its last placed seat', async () => {
    const { unit, seats } = await placeUnit(site.id, 1, 4, 1)
    await mountDevice('AAAAAA', site.id, unit)

    const blocking = await devicesBlockingSeatRemoval(
      site.id,
      seats.map((s) => s.id),
    )

    expect(blocking).toHaveLength(1)
    expect(blocking[0]!.code).toBe('AAAAAA')
    expect(blocking[0]!.location).toBe('1-4-1')
  })

  it('allows it while a sibling seat survives — the spot is still standing', async () => {
    const { unit, seats } = await placeUnit(site.id, 1, 4, 1)
    await mountDevice('AAAAAA', site.id, unit)

    const blocking = await devicesBlockingSeatRemoval(site.id, [seats[0]!.id])

    expect(blocking).toEqual([])
  })

  it('still refuses when only a pool SPARE would be left', async () => {
    // A spare parked at a unit is not a bed under that parasol, so it does not
    // keep the spot alive — the device would resolve the address and find
    // nothing to light.
    const { unit, seats } = await placeUnit(site.id, 1, 4, 1)
    await createTestInventoryItem(user.id, site.id, {
      number: encodeNumber(1, 90, 1),
      group: 1,
      status: 'pool',
      sunbedGroupId: unit.id,
    })
    await mountDevice('AAAAAA', site.id, unit)

    const blocking = await devicesBlockingSeatRemoval(
      site.id,
      seats.map((s) => s.id),
    )

    expect(blocking).toHaveLength(1)
  })

  it('allows it when no device points at the spot', async () => {
    const { seats } = await placeUnit(site.id, 1, 4, 1)

    expect(
      await devicesBlockingSeatRemoval(
        site.id,
        seats.map((s) => s.id),
      ),
    ).toEqual([])
  })
})

describe('the guard resolves the same address the device does', () => {
  it('ignores a device at the same address on ANOTHER site', async () => {
    // Every venue numbers its parcels from 1, so 1-4-1 exists at most of them.
    const other = await createTestSite(user.id)
    const { unit, seats } = await placeUnit(site.id, 1, 4, 1)
    await mountDevice('BBBBBB', other.id, unit)

    expect(
      await devicesBlockingSeatRemoval(
        site.id,
        seats.map((s) => s.id),
      ),
    ).toEqual([])
  })

  it('ignores a device in the same parcel but a DIFFERENT row', async () => {
    // `seq` repeats in every row, so a guard that dropped the row would block
    // deletions across the whole parcel — and, worse, would report the wrong
    // device to the operator.
    const { seats } = await placeUnit(site.id, 1, 4, 1)
    const neighbour = await placeUnit(site.id, 1, 5, 1)
    await mountDevice('CCCCCC', site.id, neighbour.unit)

    expect(
      await devicesBlockingSeatRemoval(
        site.id,
        seats.map((s) => s.id),
      ),
    ).toEqual([])
  })

  it('names every blocking device in one refusal', async () => {
    const a = await placeUnit(site.id, 1, 4, 1)
    const b = await placeUnit(site.id, 1, 4, 3)
    await mountDevice('AAAAAA', site.id, a.unit)
    await mountDevice('DDDDDD', site.id, b.unit)

    const blocking = await devicesBlockingSeatRemoval(site.id, [
      ...a.seats.map((s) => s.id),
      ...b.seats.map((s) => s.id),
    ])

    expect(blocking).toHaveLength(2)
    const message = deviceRemovalError(blocking)
    expect(message).toContain('AAAAAA')
    expect(message).toContain('DDDDDD')
    expect(message).toContain('Unassign')
  })

  it('says nothing about an unaddressed unit — nothing can be assigned to it', async () => {
    // A unit that never got an address cannot have been assigned to: the assign
    // action resolves through the same column this guard reads.
    const unit = await createTestSunbedGroup(site.id)
    const seat = await createTestInventoryItem(user.id, site.id, {
      number: encodeNumber(2, 1, 1),
      group: 2,
      sunbedGroupId: unit.id,
    })
    await mountDevice('EEEEEE', site.id, { parcel: null, row: null, seq: null })

    expect(await devicesBlockingSeatRemoval(site.id, [seat.id])).toEqual([])
  })
})

/**
 * QR entry resolution against a real database (track 022).
 *
 * The unit tests mock Prisma, so they prove the SHAPE of the query. These prove
 * it actually selects the right unit — through the real
 * `UNIQUE(site_id, parcel, row_idx, seq)` index, with real rows.
 *
 * The case that earns this file is the neighbouring-row trap: `seq` restarts in
 * every row, so `1-1-1` and `1-2-1` are different physical units that a key
 * missing `row` cannot tell apart. Against mocks that mistake is invisible —
 * the assertion just describes whatever the code passed. Against real rows it
 * returns someone else's beds.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import prisma from '@repo/data/PrismaCient'
import { resolveQrTarget } from './resolve'
import { cleanDatabase } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestSunbedGroup,
} from '@/app/test/fixtures'

/** A unit standing at `address`, holding the seats described by `seats`. */
async function unitAt(
  userId: string,
  siteId: string,
  address: { parcel: number; row: number; seq: number },
  seats: { number: number; status?: string }[],
) {
  const items = []
  for (const seat of seats) {
    items.push(
      await createTestInventoryItem(userId, siteId, {
        number: seat.number,
        status: seat.status ?? 'active',
      }),
    )
  }
  const group = await createTestSunbedGroup(siteId, items.map((i) => i.id))
  await prisma.sunbedGroup.update({ where: { id: group.id }, data: address })
  return { group, items }
}

describe('resolveQrTarget (real DB)', () => {
  let userId: string
  let siteId: string

  beforeEach(async () => {
    await cleanDatabase()
    const user = await createTestUser()
    userId = user.id
    const site = await createTestSite(userId, { code: 'S-K7M2X9' })
    siteId = site.id
  })

  it('resolves a card to the unit standing at that address', async () => {
    const { items } = await unitAt(userId, siteId, { parcel: 1, row: 1, seq: 1 }, [
      { number: 10101 },
      { number: 10102 },
    ])

    const target = await resolveQrTarget('S-K7M2X9', '1-1-1')

    expect(target?.site.id).toBe(siteId)
    expect(target?.items.map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort())
  })

  it('tells two units in DIFFERENT ROWS of one parcel apart', async () => {
    // Same parcel, same seq — only the row differs. This is the pair a key
    // missing `row` silently confuses, sending a guest to the wrong bed.
    const rowOne = await unitAt(userId, siteId, { parcel: 1, row: 1, seq: 1 }, [{ number: 10101 }])
    const rowTwo = await unitAt(userId, siteId, { parcel: 1, row: 2, seq: 1 }, [{ number: 10201 }])

    const first = await resolveQrTarget('S-K7M2X9', '1-1-1')
    const second = await resolveQrTarget('S-K7M2X9', '1-2-1')

    expect(first?.items.map((i) => i.id)).toEqual([rowOne.items[0]!.id])
    expect(second?.items.map((i) => i.id)).toEqual([rowTwo.items[0]!.id])
  })

  it('resolves a lowercase, prefix-less code typed by hand', async () => {
    await unitAt(userId, siteId, { parcel: 1, row: 1, seq: 1 }, [{ number: 10101 }])

    const target = await resolveQrTarget('k7m2x9', '1-1-1')

    expect(target?.site.id).toBe(siteId)
  })

  it('leaves a pool spare parked on the unit out of the beds it serves', async () => {
    // A spare is not a bed under that parasol, and it is never in the
    // availability set — surfacing it made the whole unit read "Reserved".
    const { items } = await unitAt(userId, siteId, { parcel: 2, row: 1, seq: 1 }, [
      { number: 20101 },
      { number: 19901, status: 'pool' },
    ])

    const target = await resolveQrTarget('S-K7M2X9', '2-1-1')

    expect(target?.items.map((i) => i.id)).toEqual([items[0]!.id])
  })

  it('declines a unit whose only member is a pool spare', async () => {
    await unitAt(userId, siteId, { parcel: 3, row: 1, seq: 1 }, [
      { number: 19902, status: 'pool' },
    ])

    await expect(resolveQrTarget('S-K7M2X9', '3-1-1')).resolves.toBeNull()
  })

  it('declines an address with nothing standing on it', async () => {
    await expect(resolveQrTarget('S-K7M2X9', '9-9-9')).resolves.toBeNull()
  })

  it('declines an unknown site code', async () => {
    await unitAt(userId, siteId, { parcel: 1, row: 1, seq: 1 }, [{ number: 10101 }])

    await expect(resolveQrTarget('S-ZZZZZZ', '1-1-1')).resolves.toBeNull()
  })

  it('never crosses site boundaries — one address, two venues', async () => {
    // The address is only unique WITHIN a site; the code is what scopes it.
    const other = await createTestSite(userId, { code: 'S-V2VH1C', name: 'Other Beach' })
    const mine = await unitAt(userId, siteId, { parcel: 1, row: 1, seq: 1 }, [{ number: 10101 }])
    const theirs = await unitAt(userId, other.id, { parcel: 1, row: 1, seq: 1 }, [{ number: 10101 }])

    const first = await resolveQrTarget('S-K7M2X9', '1-1-1')
    const second = await resolveQrTarget('S-V2VH1C', '1-1-1')

    expect(first?.items.map((i) => i.id)).toEqual([mine.items[0]!.id])
    expect(second?.items.map((i) => i.id)).toEqual([theirs.items[0]!.id])
  })
})

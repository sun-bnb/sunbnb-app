/**
 * POS (QR) seat page — availability contract, against a real DB.
 *
 * These tests exist because the POS page used to decide availability client-side
 * from an UNFILTERED `reservations` include: *any* reservation overlapping today
 * blocked the seat, whatever its status. A canceled or refunded booking — or one
 * whose payment failed — made the seat permanently unbookable from its own QR
 * code, which is lost revenue on a seat that is physically empty.
 *
 * Most cases below therefore FAIL on the pre-fix implementation by construction:
 * the old code would report `available: false` wherever a non-blocking
 * reservation row exists. The fix routes the decision through the canonical
 * `getAvailabilityForItems`, so the POS now agrees with the booking action and
 * the site page instead of holding a fourth opinion.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { getPosContext } from './queries'
import { cleanDatabase } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestSunbedGroup,
} from '@/app/test/fixtures'
import {
  RESERVATION_CANCELED,
  RESERVATION_REFUNDED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  OP_DEPARTED,
  OP_NO_SHOW,
} from '@repo/data/reservation-status'

let userId: string
let siteId: string

/** A stay that covers today in any timezone the venue might resolve to. */
function coveringToday() {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

beforeEach(async () => {
  await cleanDatabase()
  const user = await createTestUser()
  userId = user.id
  const site = await createTestSite(userId, { timeZone: 'Europe/Madrid' })
  siteId = site.id
})

describe('non-blocking reservations must NOT block the seat', () => {
  // Each of these is a seat that is physically free but was unbookable before.
  for (const status of [RESERVATION_CANCELED, RESERVATION_REFUNDED, RESERVATION_PAYMENT_FAILED]) {
    it(`a ${status} reservation covering today leaves the seat available`, async () => {
      const item = await createTestInventoryItem(userId, siteId, { number: 1 })
      await createTestReservation(userId, siteId, [item.id], { ...coveringToday(), status })

      const context = await getPosContext(item.id)

      expect(context!.availableItemIds).toEqual([item.id])
    })
  }
})

describe('blocking reservations still block', () => {
  for (const status of [RESERVATION_COMPLETE, RESERVATION_PAID_IN_CASH, 'pending']) {
    it(`a ${status} reservation covering today makes the seat unavailable`, async () => {
      const item = await createTestInventoryItem(userId, siteId, { number: 1 })
      await createTestReservation(userId, siteId, [item.id], { ...coveringToday(), status })

      const context = await getPosContext(item.id)

      expect(context!.availableItemIds).toEqual([])
    })
  }

  it('a reservation that does not overlap today leaves the seat available', async () => {
    const item = await createTestInventoryItem(userId, siteId, { number: 1 })
    const from = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const to = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000)
    await createTestReservation(userId, siteId, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
    })

    const context = await getPosContext(item.id)

    expect(context!.availableItemIds).toEqual([item.id])
  })
})

describe('the release rule (track 012)', () => {
  // A guest who departed or no-showed and whose stay is over releases the seat —
  // the same rule the manage grid and the site page apply.
  for (const op of [OP_DEPARTED, OP_NO_SHOW]) {
    it(`a ${op} stay that is over releases the seat`, async () => {
      const item = await createTestInventoryItem(userId, siteId, { number: 1 })
      await createTestReservation(userId, siteId, [item.id], {
        ...coveringToday(),
        status: RESERVATION_COMPLETE,
        operationalStatus: op,
      })

      const context = await getPosContext(item.id)

      expect(context!.availableItemIds).toEqual([item.id])
    })
  }

  it('a departed guest mid-multiday-stay still holds the seat', async () => {
    const item = await createTestInventoryItem(userId, siteId, { number: 1 })
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    const to = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    await createTestReservation(userId, siteId, [item.id], {
      from,
      to,
      status: RESERVATION_COMPLETE,
      operationalStatus: OP_DEPARTED,
    })

    const context = await getPosContext(item.id)

    expect(context!.availableItemIds).toEqual([])
  })
})

describe('grouped seats', () => {
  it('reports each group member, and drops only the booked one', async () => {
    const a = await createTestInventoryItem(userId, siteId, { number: 1 })
    const b = await createTestInventoryItem(userId, siteId, { number: 2 })
    await createTestSunbedGroup(siteId, [a.id, b.id])
    await createTestReservation(userId, siteId, [b.id], {
      ...coveringToday(),
      status: RESERVATION_COMPLETE,
    })

    const context = await getPosContext(a.id)

    // Both seats are surfaced (the QR opens the whole parasol)…
    expect(context!.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
    // …but only the free one is bookable, so the UI blocks the pair.
    expect(context!.availableItemIds).toEqual([a.id])
  })

  it('a pool spare parked on the unit is not one of its beds', async () => {
    // A `pool` seat carries sentinel coordinates and a synthetic number — it is
    // stock, not a bed under the parasol (track 021 P0). It is never in the
    // availability set, so surfacing it as a unit member made the `every()`
    // check on the POS page unsatisfiable: the QR on a physically free pair
    // read "Reserved" forever. Three real units on the dev site were in this
    // state, which is how it was found.
    const a = await createTestInventoryItem(userId, siteId, { number: 1 })
    const b = await createTestInventoryItem(userId, siteId, { number: 2 })
    const spare = await createTestInventoryItem(userId, siteId, { number: 9901, status: 'pool' })
    await createTestSunbedGroup(siteId, [a.id, b.id, spare.id])

    const context = await getPosContext(a.id)

    expect(context!.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
    expect(context!.availableItemIds.sort()).toEqual([a.id, b.id].sort())
  })

  it('a canceled booking on a group member frees the whole pair', async () => {
    const a = await createTestInventoryItem(userId, siteId, { number: 1 })
    const b = await createTestInventoryItem(userId, siteId, { number: 2 })
    await createTestSunbedGroup(siteId, [a.id, b.id])
    await createTestReservation(userId, siteId, [b.id], {
      ...coveringToday(),
      status: RESERVATION_CANCELED,
    })

    const context = await getPosContext(a.id)

    expect(context!.availableItemIds.sort()).toEqual([a.id, b.id].sort())
  })
})

describe('default-deny', () => {
  it('an inactive seat is absent from availability, never available', async () => {
    const item = await createTestInventoryItem(userId, siteId, { number: 1, status: 'inactive' })

    const context = await getPosContext(item.id)

    // Absence is unbookable — the same contract the booking action relies on.
    expect(context!.availableItemIds).toEqual([])
  })

  it('returns null for an unknown item', async () => {
    expect(await getPosContext('clxdoesnotexist0000000000')).toBeNull()
  })
})

/**
 * ORACLE-equivalence for the track-020 C2 payload cut — REAL Postgres.
 *
 * Three site tabs used to derive their stats by iterating the full item array
 * that the RSC payload shipped (brand: total + available-today; readiness:
 * active > 0). C2 replaced that array with server-computed scalars, so the
 * scalars must answer EXACTLY what the array computations answered — the
 * verbatim pre-C2 expressions run here as referee over a seeded matrix.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
} from '@/app/test/fixtures'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getSiteItemCounts } from './item-counts'
import { todayReservationsWindow } from './item-counts'

beforeAll(async () => { await cleanDatabase() })
beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })

/** The pre-C2 payload shape + the three expressions that read it, verbatim. */
async function oracle(siteId: string) {
  const reservationWindow = await todayReservationsWindow(siteId)
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { siteId },
    orderBy: { number: 'asc' },
    include: { reservations: { where: reservationWindow } },
  })
  return {
    // brand/view.tsx
    itemCount: (inventoryItems || []).length,
    availableTodayCount: (inventoryItems || []).filter(
      (item: any) => item.status === 'active' && (item.reservations || []).length === 0,
    ).length,
    // readiness-checklist.tsx
    activeItemCount: (inventoryItems?.filter((i: any) => i.status === 'active') ?? []).length,
  }
}

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000)

describe('getSiteItemCounts — matches the pre-C2 array computations', () => {
  it('empty site', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    expect(await getSiteItemCounts(site.id)).toEqual(await oracle(site.id))
  })

  it('mixed statuses, pool sentinels, and a seat reserved right now', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)

    const active1 = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    const active2 = await createTestInventoryItem(user.id, site.id, { number: 2, status: 'active' })
    await createTestInventoryItem(user.id, site.id, { number: 3, status: 'inactive' })
    await createTestInventoryItem(user.id, site.id, { number: 4, status: 'new' })
    // Pool sentinel — counts toward itemCount (unchanged semantics), never active.
    await createTestInventoryItem(user.id, site.id, { number: 9901, status: 'pool' })

    // Overlaps now → active1 is NOT available today.
    await createTestReservation(user.id, site.id, [active1.id], {
      from: hoursFromNow(-2), to: hoursFromNow(2), status: 'complete',
    })

    const counts = await getSiteItemCounts(site.id)
    expect(counts).toEqual(await oracle(site.id))
    // Pin the absolute answers too, so an oracle drift cannot hide a bug.
    expect(counts).toEqual({ itemCount: 5, activeItemCount: 2, availableTodayCount: 1 })
    expect(active2.id).toBeTruthy()
  })

  it('a reservation entirely OUTSIDE today does not reduce availability', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const seat = await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })

    await createTestReservation(user.id, site.id, [seat.id], {
      from: hoursFromNow(24 * 30), to: hoursFromNow(24 * 31), status: 'complete',
    })

    const counts = await getSiteItemCounts(site.id)
    expect(counts).toEqual(await oracle(site.id))
    expect(counts.availableTodayCount).toBe(1)
  })

  it('counts are scoped to the site — a neighbour venue never leaks in', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const other = await createTestSite(user.id)
    await createTestInventoryItem(user.id, site.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, other.id, { number: 1, status: 'active' })
    await createTestInventoryItem(user.id, other.id, { number: 2, status: 'active' })

    expect(await getSiteItemCounts(site.id)).toEqual(await oracle(site.id))
    expect((await getSiteItemCounts(site.id)).itemCount).toBe(1)
  })
})

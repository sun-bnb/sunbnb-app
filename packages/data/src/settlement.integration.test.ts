/**
 * Integration tests for the settlement period window (track 017 P1).
 *
 * Regression guard for the "settlement drops its final civil day" bug:
 * previewSettlement / generateSettlement used to filter
 * `invoicedAt: { gte: periodStart, lt: periodEnd }` with the raw admin-picked
 * UTC-midnight dates. For a venue east of UTC (Europe/Madrid, UTC+2 in summer)
 * that excluded every invoice stamped after ~02:00 local on the period's final
 * day. The window is now anchored to the site's civil days.
 *
 * Reference case: Madrid site (UTC+2 summer), settlement period 1–31 Aug 2025.
 * Venue Aug 1 = [Jul 31 22:00Z, Aug 1 21:59:59.999Z]; venue Aug 31 ends at
 * Aug 31 21:59:59.999Z. The query window must therefore be
 * [Jul 31 22:00Z, Sep 1 00:00Z_local = Aug 31 22:00Z).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestReservation,
  createTestInventoryItem,
  resetCounter,
} from './test/fixtures'
import { previewSettlement, generateSettlement } from './settlement'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// Period the admin selects (a <input type="date"> yields UTC-midnight dates).
const PERIOD_START = new Date('2025-08-01')
const PERIOD_END = new Date('2025-08-31')

async function setup() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  // timeZone override makes the venue tz explicit and independent of the
  // fixture's default (Helsinki) coordinates.
  const site = await createTestSite(user.id, { timeZone: 'Europe/Madrid' })
  const item = await createTestInventoryItem(user.id, site.id)
  const reservation = await createTestReservation(user.id, site.id, [item.id])
  return { accountId: user.id, siteId: site.id, reservationId: reservation.id }
}

let seq = 0
async function createInvoice(
  ctx: { accountId: string; reservationId: string },
  invoicedAt: string,
  issuerType: 'PARTNER' | 'PLATFORM',
  amount: number,
) {
  seq += 1
  return prisma.invoice.create({
    data: {
      accountId: ctx.accountId,
      reservationId: ctx.reservationId,
      issuerType,
      invoicedAt: new Date(invoicedAt),
      totalCharge: amount,
      totalAmount: amount,
      totalTax: 0,
      invoiceNumber: `${issuerType}-${Date.now()}-${seq}`,
    },
  })
}

describe('settlement window — venue civil-day anchoring (track 017 P1)', () => {
  it('includes an invoice stamped late on the final civil day (the regression)', async () => {
    const ctx = await setup()
    // Aug 31 20:00Z = Aug 31 22:00 local Madrid — squarely inside venue Aug 31,
    // but AFTER the old `lt: Aug 31 00:00Z` bound, so it used to be dropped.
    await createInvoice(ctx, '2025-08-31T20:00:00Z', 'PARTNER', 100)

    const preview = await previewSettlement({
      accountId: ctx.accountId,
      siteId: ctx.siteId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })

    expect(preview).not.toBeNull()
    expect(preview!.invoiceCount).toBe(1)
    expect(preview!.grossRevenue).toBe(100)
  })

  it('includes an invoice at the front edge (first local hours of the start day)', async () => {
    const ctx = await setup()
    // Jul 31 22:30Z = Aug 1 00:30 local Madrid — inside venue Aug 1, but BEFORE
    // the old `gte: Aug 1 00:00Z` bound.
    await createInvoice(ctx, '2025-07-31T22:30:00Z', 'PARTNER', 50)

    const preview = await previewSettlement({
      accountId: ctx.accountId,
      siteId: ctx.siteId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })

    expect(preview).not.toBeNull()
    expect(preview!.invoiceCount).toBe(1)
    expect(preview!.grossRevenue).toBe(50)
  })

  it('excludes invoices that fall outside the venue civil period', async () => {
    const ctx = await setup()
    // Jul 31 20:00Z = Jul 31 22:00 local → venue Jul 31 (before the period)
    await createInvoice(ctx, '2025-07-31T20:00:00Z', 'PARTNER', 11)
    // Sep 1 00:30Z = Sep 1 02:30 local → venue Sep 1 (after the period)
    await createInvoice(ctx, '2025-09-01T00:30:00Z', 'PARTNER', 22)
    // One inside, to prove the query isn't just empty
    await createInvoice(ctx, '2025-08-15T12:00:00Z', 'PARTNER', 33)

    const preview = await previewSettlement({
      accountId: ctx.accountId,
      siteId: ctx.siteId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })

    expect(preview).not.toBeNull()
    expect(preview!.invoiceCount).toBe(1)
    expect(preview!.grossRevenue).toBe(33)
  })

  it('generateSettlement links the final-day invoice and preserves the civil-date label', async () => {
    const ctx = await setup()
    await createInvoice(ctx, '2025-08-31T20:00:00Z', 'PARTNER', 100)
    await createInvoice(ctx, '2025-08-31T20:00:00Z', 'PLATFORM', 15)

    const result = await generateSettlement({
      accountId: ctx.accountId,
      siteId: ctx.siteId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    })

    expect(result).not.toBeNull()
    expect(result!.invoiceCount).toBe(2)

    const settlement = await prisma.settlement.findUnique({ where: { id: result!.id } })
    expect(settlement!.grossRevenue).toBe(100)
    expect(settlement!.commission).toBe(15)
    expect(settlement!.netPayout).toBe(85)
    // Label is stored as the admin-selected civil dates, untouched by the
    // venue-anchored query window.
    expect(settlement!.periodStart.toISOString()).toBe(PERIOD_START.toISOString())
    expect(settlement!.periodEnd.toISOString()).toBe(PERIOD_END.toISOString())

    // Both invoices are now attached to the batch.
    const linked = await prisma.invoice.count({ where: { settlementBatchId: result!.id } })
    expect(linked).toBe(2)
  })
})

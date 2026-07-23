import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import {
  getOpenTill,
  getOpenTillsByEmployee,
  getOpenTillItemsByEmployee,
  getTillByEmployee,
  getEmployeeShiftItems,
  recordSettlement,
  voidSettlementsForReservation,
  voidSettlementsForRentalBooking,
  closeAllOpenTills,
  closeEmployeeTill,
} from './till'

const HOUR = 3600_000
const DAY = 24 * HOUR

/**
 * A dayStart far enough in the past that every settledAt timestamp used by a
 * "same day" test (all within a few hours of Date.now()) falls strictly after
 * it, and any TillClose created in the test also postdates it. The two-bucket
 * window then collapses to the pre-track-016 since-last-close total: every
 * entry lands in `today`, `carryOver` is empty. Use this for tests that are
 * not exercising the carry-over split itself.
 */
function farPastDayStart(): Date {
  return new Date(Date.now() - 1000 * DAY)
}

/** Expected OpenTill shape for the common "everything is today" case. */
function allToday(total: number, count: number) {
  return { total, count, today: { total, count }, carryOver: { total: 0, count: 0, oldestAt: null } }
}

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

async function setup() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id)
  const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
  const rentalItem = await createTestRentalItem(site.id)
  const mkEmp = (name: string) => prisma.employee.create({ data: { accountId: user.id, name } })
  return { user, site, item, rentalItem, mkEmp }
}

// ─── recordSettlement (reservation) ─────────────────────────────────────────

describe('recordSettlement (reservation)', () => {
  it('creates a TillEntry row with the given fields', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 25, employeeId: alice.id })

    const before = Date.now()
    const entry = await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 25 })
    const after = Date.now()

    expect(entry.siteId).toBe(site.id)
    expect(entry.reservationId).toBe(res.id)
    expect(entry.rentalBookingId).toBeNull()
    expect(entry.employeeId).toBe(alice.id)
    expect(entry.amount).toBe(25)
    expect(entry.voidedAt).toBeNull()
    expect(entry.settledAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(entry.settledAt.getTime()).toBeLessThanOrEqual(after)
  })

  it('accepts a custom settledAt (historical backfill)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id])
    const historical = new Date('2024-03-15T10:00:00Z')

    const entry = await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 15, settledAt: historical })
    expect(entry.settledAt).toEqual(historical)
  })

  it('accepts a null reservationId (unlinked ledger entry)', async () => {
    const { site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const entry = await recordSettlement({ siteId: site.id, employeeId: alice.id, amount: 10 })
    expect(entry.reservationId).toBeNull()
    expect(entry.rentalBookingId).toBeNull()
  })
})

// ─── recordSettlement (rental booking) ──────────────────────────────────────

describe('recordSettlement (rentalBookingId)', () => {
  it('creates a TillEntry row linked to the rental booking', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 30,
      employeeId: alice.id,
    })

    const before = Date.now()
    const entry = await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 30 })
    const after = Date.now()

    expect(entry.siteId).toBe(site.id)
    expect(entry.rentalBookingId).toBe(rb.id)
    expect(entry.reservationId).toBeNull()
    expect(entry.employeeId).toBe(alice.id)
    expect(entry.amount).toBe(30)
    expect(entry.voidedAt).toBeNull()
    expect(entry.settledAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(entry.settledAt.getTime()).toBeLessThanOrEqual(after)
  })

  it('rental booking entry contributes to the open till', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
    })

    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 20 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(20, 1))
  })

  it('accepts a custom settledAt for rental booking (historical backfill)', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    const historical = new Date('2024-06-01T08:00:00Z')

    const entry = await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 15, settledAt: historical })
    expect(entry.settledAt).toEqual(historical)
  })
})

// ─── voidSettlementsForReservation ──────────────────────────────────────────

describe('voidSettlementsForReservation', () => {
  it('voids all non-voided entries for a reservation and returns the count', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 20 })
    expect(await voidSettlementsForReservation(res.id)).toBe(1)

    const entries = await prisma.tillEntry.findMany({ where: { reservationId: res.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].voidedAt).not.toBeNull()
  })

  it('is idempotent — voiding a second time returns 0', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id])

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30 })
    await voidSettlementsForReservation(res.id)
    expect(await voidSettlementsForReservation(res.id)).toBe(0)
  })

  it('returns 0 when no entries exist for the reservation', async () => {
    const { user, site, item } = await setup()
    const res = await createTestReservation(user.id, site.id, [item.id])
    expect(await voidSettlementsForReservation(res.id)).toBe(0)
  })
})

// ─── voidSettlementsForRentalBooking ────────────────────────────────────────

describe('voidSettlementsForRentalBooking', () => {
  it('voids all non-voided entries for a rental booking and returns the count', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 18, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 18 })
    expect(await voidSettlementsForRentalBooking(rb.id)).toBe(1)

    const entries = await prisma.tillEntry.findMany({ where: { rentalBookingId: rb.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].voidedAt).not.toBeNull()
  })

  it('voided rental entry is excluded from the open till', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 25, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 25 })
    await voidSettlementsForRentalBooking(rb.id)

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(0, 0))
  })

  it('is idempotent — voiding a second time returns 0', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 12, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 12 })
    await voidSettlementsForRentalBooking(rb.id)
    expect(await voidSettlementsForRentalBooking(rb.id)).toBe(0)
  })

  it('returns 0 when no entries exist for the rental booking', async () => {
    const { user, site, rentalItem } = await setup()
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 10 })
    expect(await voidSettlementsForRentalBooking(rb.id)).toBe(0)
  })
})

// ─── getOpenTill — ledger-based ──────────────────────────────────────────────

describe('getOpenTill (ledger-based)', () => {
  it('sums reservation + rental TillEntry rows for the employee', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    const res2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 15 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(45, 3))
  })

  it('excludes voided entries', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 50, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 50 })
    await voidSettlementsForReservation(res.id)

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(0, 0))
  })

  it('ignores ledger entries not attributed to the employee', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 99, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: bob.id, amount: 99 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(0, 0))
  })

  it('counts departed reservations — operational status does NOT gate the ledger', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(30, 1))
  })

  it('seat turnover: two settled reservations same seat, one departed — both count', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 20 })

    const res2 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 25,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 25 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(45, 2))
  })

  it('only counts cash taken AFTER the last close', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    await prisma.tillEntry.create({
      data: { siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 10, settledAt: new Date(now - 2 * HOUR) },
    })

    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - HOUR), totalAmount: 10, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })

    const res2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 30, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 30 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(30, 1))
  })

  it('reservation + rental settlements sum together for the same employee', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 40, employeeId: alice.id })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 35, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 40 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 35 })

    expect(await getOpenTill(site.id, alice.id, farPastDayStart())).toEqual(allToday(75, 2))
  })
})

// ─── getTillByEmployee — ledger-based (civil-day report, unchanged by track 016) ──

describe('getTillByEmployee (ledger-based)', () => {
  it('breaks the day down per roster employee, zero-filled and name-sorted', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const carol = await mkEmp('Carol') // no sales → zero row

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    const res2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })
    const res3 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 5, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, reservationId: res3.id, employeeId: bob.id, amount: 5 })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    expect(await getTillByEmployee(site.id, from, to)).toEqual([
      { employeeId: alice.id, name: 'Alice', active: true, total: 30, count: 2 },
      { employeeId: bob.id, name: 'Bob', active: true, total: 5, count: 1 },
      { employeeId: carol.id, name: 'Carol', active: true, total: 0, count: 0 },
    ])
  })

  it('excludes voided entries from the per-employee breakdown', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 40, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 40 })
    await voidSettlementsForReservation(res.id)

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    const result = await getTillByEmployee(site.id, from, to)
    expect(result).toEqual([{ employeeId: alice.id, name: 'Alice', active: true, total: 0, count: 0 }])
  })

  it('counts departed reservations — operational status does not gate the ledger', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed',
      paymentAmount: 35,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 35 })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    const result = await getTillByEmployee(site.id, from, to)
    expect(result).toEqual([{ employeeId: alice.id, name: 'Alice', active: true, total: 35, count: 1 }])
  })

  it('rental settlements contribute via the ledger path (not the old rentalBooking.aggregate)', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 22, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 22 })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    const result = await getTillByEmployee(site.id, from, to)
    expect(result).toEqual([{ employeeId: alice.id, name: 'Alice', active: true, total: 22, count: 1 }])
  })

  it('reservation + rental settlements sum together per employee', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 30, employeeId: alice.id })
    const rb1 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    const rb2 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 50, employeeId: bob.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb1.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb2.id, employeeId: bob.id, amount: 50 })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    const result = await getTillByEmployee(site.id, from, to)
    expect(result).toEqual([
      { employeeId: alice.id, name: 'Alice', active: true, total: 50, count: 2 },
      { employeeId: bob.id, name: 'Bob', active: true, total: 50, count: 1 },
    ])
  })
})

// ─── Backfill correctness ────────────────────────────────────────────────────

describe('backfill — rental booking backfill reproduces the prior rental-till total', () => {
  it('a paid-in-cash rental booking gets a backfilled TillEntry', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 42,
      employeeId: alice.id,
    })

    await prisma.$executeRawUnsafe(`
      INSERT INTO "till_entry" ("id", "site_id", "rental_booking_id", "employee_id", "amount", "settled_at", "created_at")
      SELECT
        concat('te_rb_', rb.id),
        rb."site_id",
        rb."id",
        rb."employee_id",
        rb."payment_amount",
        rb."createdAt",
        NOW()
      FROM "RentalBooking" rb
      WHERE rb."id" = '${rb.id}'
        AND rb."status" = 'paid-in-cash'
        AND rb."payment_amount" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "till_entry" te WHERE te."rental_booking_id" = rb."id"
        )
    `)

    const entries = await prisma.tillEntry.findMany({ where: { rentalBookingId: rb.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(42)
    expect(entries[0].employeeId).toBe(alice.id)
    expect(entries[0].voidedAt).toBeNull()
    expect(entries[0].id).toBe(`te_rb_${rb.id}`)
  })

  it('backfill is idempotent — running again inserts 0 rows', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 18,
      employeeId: alice.id,
    })

    const backfillSql = `
      INSERT INTO "till_entry" ("id", "site_id", "rental_booking_id", "employee_id", "amount", "settled_at", "created_at")
      SELECT
        concat('te_rb_', rb.id),
        rb."site_id",
        rb."id",
        rb."employee_id",
        rb."payment_amount",
        rb."createdAt",
        NOW()
      FROM "RentalBooking" rb
      WHERE rb."id" = '${rb.id}'
        AND rb."status" = 'paid-in-cash'
        AND rb."payment_amount" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "till_entry" te WHERE te."rental_booking_id" = rb."id"
        )
    `
    await prisma.$executeRawUnsafe(backfillSql)
    const countAfterFirst = await prisma.tillEntry.count({ where: { rentalBookingId: rb.id } })

    await prisma.$executeRawUnsafe(backfillSql) // run again
    const countAfterSecond = await prisma.tillEntry.count({ where: { rentalBookingId: rb.id } })

    expect(countAfterFirst).toBe(1)
    expect(countAfterSecond).toBe(1) // idempotent
  })

  it('backfill total == prior rental-till total (sum of paymentAmount for paid-in-cash rentals)', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const rb1 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    const rb2 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 35, employeeId: bob.id })
    const rb3 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'complete', paymentAmount: 50, employeeId: alice.id })

    const priorTotal = 20 + 35 + 15 // 70

    for (const rb of [rb1, rb2, rb3]) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "till_entry" ("id", "site_id", "rental_booking_id", "employee_id", "amount", "settled_at", "created_at")
        SELECT
          concat('te_rb_', rb.id),
          rb."site_id",
          rb."id",
          rb."employee_id",
          rb."payment_amount",
          rb."createdAt",
          NOW()
        FROM "RentalBooking" rb
        WHERE rb."id" = '${rb.id}'
          AND rb."status" = 'paid-in-cash'
          AND rb."payment_amount" > 0
          AND NOT EXISTS (
            SELECT 1 FROM "till_entry" te WHERE te."rental_booking_id" = rb."id"
          )
      `)
    }

    const result = await prisma.tillEntry.aggregate({
      where: { siteId: site.id, rentalBookingId: { not: null }, voidedAt: null },
      _sum: { amount: true },
    })
    expect(result._sum.amount).toBe(priorTotal)
  })

  it('non-paid-in-cash rental bookings are NOT backfilled', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'complete', // not paid-in-cash
      paymentAmount: 40,
      employeeId: alice.id,
    })

    await prisma.$executeRawUnsafe(`
      INSERT INTO "till_entry" ("id", "site_id", "rental_booking_id", "employee_id", "amount", "settled_at", "created_at")
      SELECT concat('te_rb_', rb.id), rb."site_id", rb."id", rb."employee_id", rb."payment_amount", rb."createdAt", NOW()
      FROM "RentalBooking" rb
      WHERE rb."id" = '${rb.id}'
        AND rb."status" = 'paid-in-cash'
        AND rb."payment_amount" > 0
        AND NOT EXISTS (SELECT 1 FROM "till_entry" te WHERE te."rental_booking_id" = rb."id")
    `)

    const entries = await prisma.tillEntry.findMany({ where: { rentalBookingId: rb.id } })
    expect(entries).toHaveLength(0)
  })

  it('pre-existing reservation backfill still works (regression)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 42,
      employeeId: alice.id,
    })

    await prisma.$executeRawUnsafe(`
      INSERT INTO "till_entry" ("id", "site_id", "reservation_id", "employee_id", "amount", "settled_at", "created_at")
      SELECT
        concat('te_', r.id),
        r."site_id",
        r."id",
        r."employee_id",
        r."payment_amount",
        r."createdAt",
        NOW()
      FROM "Reservation" r
      WHERE r."id" = '${res.id}'
        AND r."status" = 'paid-in-cash'
        AND r."operational_status" = 'walked-in'
        AND r."payment_amount" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "till_entry" te WHERE te."reservation_id" = r."id"
        )
    `)

    const entries = await prisma.tillEntry.findMany({ where: { reservationId: res.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(42)
    expect(entries[0].rentalBookingId).toBeNull()
  })
})

// ─── getEmployeeShiftItems (unchanged by track 016) ─────────────────────────

describe('getEmployeeShiftItems', () => {
  const dayRange = {
    from: new Date('2026-07-01T00:00:00Z'),
    to: new Date('2026-07-01T23:59:59Z'),
  }

  it('returns itemized rows per employee with correct seats, amount, channel, and sort order', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'B2' })

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      employeeId: alice.id,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })
    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'complete',
      paymentAmount: 30,
      employeeId: alice.id,
      createdAt: new Date('2026-07-01T11:00:00Z'),
    })

    const res3 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      employeeId: bob.id,
      createdAt: new Date('2026-07-01T10:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)

    expect(result).toHaveLength(2)

    const aliceShift = result.find((s) => s.employeeId === alice.id)!
    expect(aliceShift.name).toBe('Alice')
    expect(aliceShift.active).toBe(true)
    expect(aliceShift.count).toBe(2)
    expect(aliceShift.total).toBe(55)
    expect(aliceShift.items[0]).toMatchObject({
      reservationId: res1.id,
      amount: 25,
      channel: 'cash',
      at: new Date('2026-07-01T09:00:00Z'),
    })
    expect(aliceShift.items[0].seats).toEqual([String(item.number)])
    expect(aliceShift.items[1]).toMatchObject({
      reservationId: res2.id,
      amount: 30,
      channel: 'card',
      at: new Date('2026-07-01T11:00:00Z'),
    })
    expect(aliceShift.items[1].seats).toEqual(['B2'])

    const bobShift = result.find((s) => s.employeeId === bob.id)!
    expect(bobShift.count).toBe(1)
    expect(bobShift.total).toBe(15)
    expect(bobShift.items[0]).toMatchObject({
      reservationId: res3.id,
      amount: 15,
      channel: 'cash',
    })
  })

  it('excludes reservations with null employeeId (self-service guest bookings)', async () => {
    const { user, site, item } = await setup()

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 40,
      employeeId: null,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    expect(result.every((s) => s.count === 0)).toBe(true)
  })

  it('excludes refunded reservations', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 50,
      employeeId: alice.id,
      refundedAt: new Date('2026-07-01T12:00:00Z'),
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    const aliceShift = result.find((s) => s.employeeId === alice.id)!
    expect(aliceShift.count).toBe(0)
    expect(aliceShift.items).toHaveLength(0)
  })

  it('roster employee with no sales in-window returns empty items and zero total', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Alice')

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Alice')
    expect(result[0].count).toBe(0)
    expect(result[0].total).toBe(0)
    expect(result[0].items).toHaveLength(0)
  })

  it('total spans both cash and card channels (not cash-only like getTillByEmployee)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
      createdAt: new Date('2026-07-01T08:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 30,
      employeeId: alice.id,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    const aliceShift = result.find((s) => s.employeeId === alice.id)!
    expect(aliceShift.total).toBe(50) // cash 20 + card 30
    expect(aliceShift.count).toBe(2)
    expect(aliceShift.items.map((i) => i.channel)).toEqual(['cash', 'card'])
  })

  it('employees sorted by name asc, items sorted by at asc', async () => {
    const { user, site, item, mkEmp } = await setup()
    const zara = await mkEmp('Zara')
    const anna = await mkEmp('Anna')

    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 10,
      employeeId: zara.id,
      createdAt: new Date('2026-07-01T08:00:00Z'),
    })
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 5,
      employeeId: anna.id,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    expect(result[0].name).toBe('Anna')
    expect(result[1].name).toBe('Zara')
  })

  it('returns empty array for unknown siteId', async () => {
    const result = await getEmployeeShiftItems('nonexistent-site-id', dayRange.from, dayRange.to)
    expect(result).toEqual([])
  })
})

// ─── getOpenTill — day-anchored two-bucket window (track 016) ───────────────
//
// dayStart is the venue-local start of "today", always caller-supplied. These
// tests exercise the carry-over split explicitly: entries at-or-before
// dayStart bucket into `carryOver`; entries after `floor` (= max(lastClose,
// dayStart)) bucket into `today`. `total`/`count` (the sweepable balance a
// close snapshots) is unchanged: today + carryOver.

describe('getOpenTill — day-anchored two-bucket window (track 016)', () => {
  it('yesterday-unclosed: prior-day cash surfaces as carryOver (with oldestAt), today cash surfaces as today, total = sum of both', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR) // "today" started 6 hours ago

    const resYesterday = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 40, employeeId: alice.id,
    })
    const yesterday = new Date(now - 30 * HOUR)
    await recordSettlement({ siteId: site.id, reservationId: resYesterday.id, employeeId: alice.id, amount: 40, settledAt: yesterday })

    const resToday = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 25, employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: resToday.id, employeeId: alice.id, amount: 25, settledAt: new Date(now - HOUR) })

    const till = await getOpenTill(site.id, alice.id, dayStart)

    expect(till.carryOver).toEqual({ total: 40, count: 1, oldestAt: yesterday })
    expect(till.today).toEqual({ total: 25, count: 1 })
    expect(till.total).toBe(65)
    expect(till.count).toBe(2)
  })

  it('never-closed employee with multiple prior-day entries: all pre-dayStart cash is carryOver, oldestAt is the oldest entry', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 15, employeeId: alice.id })
    const res2 = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 25, employeeId: alice.id })

    const twoDaysAgo = new Date(now - 49 * HOUR)
    const oneDayAgo = new Date(now - 25 * HOUR)
    // Insert newest-first to prove oldestAt isn't just "first recorded"
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 25, settledAt: oneDayAgo })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 15, settledAt: twoDaysAgo })

    const till = await getOpenTill(site.id, alice.id, dayStart)

    expect(till.carryOver).toEqual({ total: 40, count: 2, oldestAt: twoDaysAgo })
    expect(till.today).toEqual({ total: 0, count: 0 })
    expect(till.total).toBe(40)
  })

  it('closed-midday: worker closes today, later entries land in today, carryOver is empty', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const closeTime = new Date(now - 2 * HOUR) // still after dayStart — closed earlier today
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: closeTime, totalAmount: 50, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 22, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 22, settledAt: new Date(now - HOUR) })

    const till = await getOpenTill(site.id, alice.id, dayStart)

    expect(till.today).toEqual({ total: 22, count: 1 })
    expect(till.carryOver).toEqual({ total: 0, count: 0, oldestAt: null })
    expect(till.total).toBe(22)
  })

  it('entry before the last close is excluded; entry after the last close (same day) is included as today', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })
    const res2 = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 35, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - 5 * HOUR) })
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * HOUR), totalAmount: 20, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 35, settledAt: new Date(now - HOUR) })

    const till = await getOpenTill(site.id, alice.id, dayStart)
    expect(till.today).toEqual({ total: 35, count: 1 })
    expect(till.carryOver).toEqual({ total: 0, count: 0, oldestAt: null })
    expect(till.total).toBe(35)
  })

  it('voided prior-day entries are excluded from carryOver even when no close exists', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 30, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30, settledAt: new Date(now - 30 * HOUR) })
    await voidSettlementsForReservation(res.id)

    const till = await getOpenTill(site.id, alice.id, dayStart)
    expect(till.carryOver).toEqual({ total: 0, count: 0, oldestAt: null })
    expect(till.total).toBe(0)
    expect(till.count).toBe(0)
  })

  it('boundary: an entry settled exactly at dayStart belongs to carryOver; one just after belongs to today', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const resAt = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 12, employeeId: alice.id })
    const resAfter = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 18, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: resAt.id, employeeId: alice.id, amount: 12, settledAt: dayStart })
    await recordSettlement({ siteId: site.id, reservationId: resAfter.id, employeeId: alice.id, amount: 18, settledAt: new Date(dayStart.getTime() + 1) })

    const till = await getOpenTill(site.id, alice.id, dayStart)
    expect(till.carryOver).toEqual({ total: 12, count: 1, oldestAt: dayStart })
    expect(till.today).toEqual({ total: 18, count: 1 })
  })
})

// ─── getOpenTillsByEmployee ──────────────────────────────────────────────────
//
// Every roster employee's open till, computed since their own last close
// (all-time carryOver if never closed). `dayStart` is required (venue-local
// start of today, caller-computed). Sorted by name, zero-filled.

describe('getOpenTillsByEmployee', () => {
  it('returns an empty array for an unknown siteId', async () => {
    expect(await getOpenTillsByEmployee('nonexistent-site', farPastDayStart())).toEqual([])
  })

  it('roster employee with no cash entries appears with total 0 and count 0', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Alice')

    const result = await getOpenTillsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Alice',
      active: true,
      total: 0,
      count: 0,
      today: { total: 0, count: 0 },
      carryOver: { total: 0, count: 0, oldestAt: null },
    })
  })

  it('PRIOR-DAY CASH with no close is split into carryOver for each employee (not silently merged into today)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const resAlice = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 40, employeeId: alice.id })
    const resBob = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 60, employeeId: bob.id })

    const yesterday = new Date(now - 25 * HOUR)
    await recordSettlement({ siteId: site.id, reservationId: resAlice.id, employeeId: alice.id, amount: 40, settledAt: yesterday })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 60, settledAt: yesterday })

    const result = await getOpenTillsByEmployee(site.id, dayStart)
    expect(result).toHaveLength(2)

    const aliceRow = result.find((r) => r.name === 'Alice')!
    const bobRow = result.find((r) => r.name === 'Bob')!
    expect(aliceRow.total).toBe(40)
    expect(aliceRow.carryOver).toEqual({ total: 40, count: 1, oldestAt: yesterday })
    expect(aliceRow.today).toEqual({ total: 0, count: 0 })
    expect(bobRow.total).toBe(60)
    expect(bobRow.carryOver).toEqual({ total: 60, count: 1, oldestAt: yesterday })
  })

  it('each employee uses their OWN last-close as the window floor (different close times)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = farPastDayStart()

    const resAlice1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })
    const resAlice2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 30, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resAlice1.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - 3 * HOUR) })
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * HOUR), totalAmount: 20, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })
    await recordSettlement({ siteId: site.id, reservationId: resAlice2.id, employeeId: alice.id, amount: 30, settledAt: new Date(now - HOUR) })

    const resBob = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 55, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 55, settledAt: new Date(now - 25 * HOUR) })

    const result = await getOpenTillsByEmployee(site.id, dayStart)
    expect(result).toHaveLength(2)

    const aliceRow = result.find((r) => r.name === 'Alice')!
    const bobRow = result.find((r) => r.name === 'Bob')!
    // Alice: only her post-close entry
    expect(aliceRow.total).toBe(30)
    expect(aliceRow.today).toEqual({ total: 30, count: 1 })
    // Bob: all-time (never closed) — with a far-past dayStart this collapses to `today`
    expect(bobRow.total).toBe(55)
    expect(bobRow.today).toEqual({ total: 55, count: 1 })
  })

  it('voided entries are excluded from each employee open till', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 45, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 45, settledAt: new Date(Date.now() - 25 * HOUR) })
    await voidSettlementsForReservation(res.id)

    const result = await getOpenTillsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Alice', total: 0, count: 0 })
  })

  it('results are sorted by employee name ascending', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Zara')
    await mkEmp('Anna')
    await mkEmp('Mike')

    const result = await getOpenTillsByEmployee(site.id, farPastDayStart())
    expect(result.map((r) => r.name)).toEqual(['Anna', 'Mike', 'Zara'])
  })

  it('multiple employees: mix of active/inactive, different cash amounts, sorted by name', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const carol = await prisma.employee.create({ data: { accountId: user.id, name: 'Carol', active: false } })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resAlice = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    const resBob = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: bob.id })

    await recordSettlement({ siteId: site.id, reservationId: resAlice.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 20 })
    // Carol has no entries

    const result = await getOpenTillsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(3)
    expect(result).toEqual([
      expect.objectContaining({ employeeId: alice.id, name: 'Alice', active: true, total: 10, count: 1 }),
      expect.objectContaining({ employeeId: bob.id, name: 'Bob', active: true, total: 20, count: 1 }),
      expect.objectContaining({ employeeId: carol.id, name: 'Carol', active: false, total: 0, count: 0 }),
    ])
  })

  it('employees from a different account are not included', async () => {
    const { site } = await setup()

    const user2 = await createTestUser()
    await createTestPartnerAccount(user2.id)
    await prisma.employee.create({ data: { accountId: user2.id, name: 'Outsider' } })

    const result = await getOpenTillsByEmployee(site.id, farPastDayStart())
    expect(result.every((r) => r.name !== 'Outsider')).toBe(true)
  })
})

// ─── getOpenTillItemsByEmployee ───────────────────────────────────────────────
//
// Itemized version of getOpenTillsByEmployee: per roster employee it returns
// { employeeId, name, active, total, count, today, carryOver, items } where
// items: OpenTillItem[] are the individual cash TillEntry rows since that
// employee's own last close, each tagged `carryOver` (settled at-or-before
// dayStart) vs today. A sunbed entry's label is seat labels joined (seatLabel
// else number); a rental entry's label is the RentalItem name. total =
// round(sum); count = items.length; items oldest-first; roster zero-filled;
// sorted by name; cash-only. `dayStart` is required.

describe('getOpenTillItemsByEmployee', () => {
  it('sunbed entry: kind=sunbed, label from seatLabel when set, correct amount and at=settledAt; carryOver=false when settled after dayStart', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item = await createTestInventoryItem(user.id, site.id, { number: 5, seatLabel: 'A1' })
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      employeeId: alice.id,
    })
    const settledAt = new Date(Date.now() - HOUR)
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 25, settledAt })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(1)
    const aliceRow = result[0]
    expect(aliceRow.employeeId).toBe(alice.id)
    expect(aliceRow.name).toBe('Alice')
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(25)
    expect(aliceRow.items).toHaveLength(1)

    const it0 = aliceRow.items[0]
    expect(it0.kind).toBe('sunbed')
    expect(it0.label).toBe('A1')
    expect(it0.amount).toBe(25)
    expect(it0.at).toEqual(settledAt)
    expect(it0.carryOver).toBe(false)
  })

  it('sunbed entry: label falls back to String(number) when seatLabel is null', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item = await createTestInventoryItem(user.id, site.id, { number: 7, seatLabel: null })
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 15 })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    expect(result[0].items[0].label).toBe('7')
  })

  it('sunbed entry: multiple seats joined by ", " in label', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const itemA = await createTestInventoryItem(user.id, site.id, { number: 1, seatLabel: 'A1' })
    const itemB = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'B3' })
    const res = await createTestReservation(user.id, site.id, [itemA.id, itemB.id], {
      status: 'paid-in-cash',
      paymentAmount: 40,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 40 })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    const label = result[0].items[0].label
    expect(label).toContain('A1')
    expect(label).toContain('B3')
    expect(label).toContain(', ')
  })

  it('rental entry: kind=rental, label=rentalItem name, correct amount and at=settledAt', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    const settledAt = new Date(Date.now() - 1800_000)
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 30, settledAt })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(1)
    const aliceRow = result[0]
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(30)
    expect(aliceRow.items).toHaveLength(1)

    const it0 = aliceRow.items[0]
    expect(it0.kind).toBe('rental')
    expect(it0.label).toBe('Test Surfboard')
    expect(it0.amount).toBe(30)
    expect(it0.at).toEqual(settledAt)
  })

  it('items sum to total, total equals getOpenTill(siteId, employeeId, dayStart), count equals items.length', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 35,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 35 })

    const dayStart = farPastDayStart()
    const [itemsResult, openTill] = await Promise.all([
      getOpenTillItemsByEmployee(site.id, dayStart),
      getOpenTill(site.id, alice.id, dayStart),
    ])

    const aliceRow = itemsResult.find((r) => r.employeeId === alice.id)!
    const itemsSum = aliceRow.items.reduce((sum, it) => sum + it.amount, 0)
    expect(Math.round(itemsSum * 100) / 100).toBe(aliceRow.total)
    expect(aliceRow.total).toBe(openTill.total)
    expect(aliceRow.count).toBe(aliceRow.items.length)
    expect(aliceRow.count).toBe(2)
  })

  it("entries before the employee's last TillClose are excluded; only post-close items appear", async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'B2' })
    const now = Date.now()
    const dayStart = farPastDayStart()

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 50,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 50, settledAt: new Date(now - 3 * HOUR) })

    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * HOUR), totalAmount: 50, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })

    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 30, settledAt: new Date(now - HOUR) })

    const result = await getOpenTillItemsByEmployee(site.id, dayStart)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(30)
    expect(aliceRow.items).toHaveLength(1)
    expect(aliceRow.items[0].label).toBe('B2')
    expect(aliceRow.items[0].amount).toBe(30)
  })

  it('voided TillEntry rows are excluded from items', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 45,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 45 })
    await voidSettlementsForReservation(res.id)

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.count).toBe(0)
    expect(aliceRow.total).toBe(0)
    expect(aliceRow.items).toHaveLength(0)
  })

  it('voided rental entry is excluded from items', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 20 })
    await voidSettlementsForRentalBooking(rb.id)

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(0)
    expect(aliceRow.total).toBe(0)
  })

  it('items are returned oldest-first by settledAt', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1, seatLabel: 'First' })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'Second' })
    const now = Date.now()

    const resEarlier = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      paymentAmount: 10,
      employeeId: alice.id,
    })
    const resLater = await createTestReservation(user.id, site.id, [item1.id], {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: resEarlier.id, employeeId: alice.id, amount: 10, settledAt: new Date(now - 2 * HOUR) })
    await recordSettlement({ siteId: site.id, reservationId: resLater.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - HOUR) })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(2)
    expect(aliceRow.items[0].label).toBe('Second')
    expect(aliceRow.items[1].label).toBe('First')
    expect(aliceRow.items[0].at.getTime()).toBeLessThan(aliceRow.items[1].at.getTime())
  })

  it('roster employee with no entries appears with items=[], total=0, count=0; results sorted by name', async () => {
    const { user, site, item, mkEmp } = await setup()
    await mkEmp('Zara')
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 15 })

    const result = await getOpenTillItemsByEmployee(site.id, farPastDayStart())
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Alice')
    expect(result[1].name).toBe('Zara')

    const zaraRow = result.find((r) => r.name === 'Zara')!
    expect(zaraRow.items).toEqual([])
    expect(zaraRow.total).toBe(0)
    expect(zaraRow.count).toBe(0)

    const aliceRow = result.find((r) => r.name === 'Alice')!
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(15)
  })

  it('returns empty array for an unknown siteId', async () => {
    const result = await getOpenTillItemsByEmployee('nonexistent-site-id', farPastDayStart())
    expect(result).toEqual([])
  })

  it('entries at another site under the same account do not appear', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const siteA = await createTestSite(user.id)
    const siteB = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, siteA.id, { number: 1, seatLabel: 'SiteA-Seat' })
    const itemB = await createTestInventoryItem(user.id, siteB.id, { number: 1, seatLabel: 'SiteB-Seat' })
    const emp = await prisma.employee.create({ data: { accountId: user.id, name: 'Alice' } })

    const resA = await createTestReservation(user.id, siteA.id, [itemA.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      employeeId: emp.id,
    })
    await recordSettlement({ siteId: siteA.id, reservationId: resA.id, employeeId: emp.id, amount: 25 })

    const resB = await createTestReservation(user.id, siteB.id, [itemB.id], {
      status: 'paid-in-cash',
      paymentAmount: 50,
      employeeId: emp.id,
    })
    await recordSettlement({ siteId: siteB.id, reservationId: resB.id, employeeId: emp.id, amount: 50 })

    const resultA = await getOpenTillItemsByEmployee(siteA.id, farPastDayStart())
    expect(resultA).toHaveLength(1)
    const empRow = resultA[0]
    expect(empRow.total).toBe(25)
    expect(empRow.count).toBe(1)
    expect(empRow.items).toHaveLength(1)
    expect(empRow.items[0].label).toBe('SiteA-Seat')
    expect(empRow.items.some((i) => i.label === 'SiteB-Seat')).toBe(false)
  })

  // ── carryOver flag (track 016) ────────────────────────────────────────────

  it('items are tagged carryOver: true when settled at-or-before dayStart, false when after', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const itemYesterday = await createTestInventoryItem(user.id, site.id, { number: 1, seatLabel: 'Yesterday' })
    const itemToday = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'Today' })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const resYesterday = await createTestReservation(user.id, site.id, [itemYesterday.id], { status: 'paid-in-cash', paymentAmount: 40, employeeId: alice.id })
    const resToday = await createTestReservation(user.id, site.id, [itemToday.id], { status: 'paid-in-cash', paymentAmount: 25, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resYesterday.id, employeeId: alice.id, amount: 40, settledAt: new Date(now - 30 * HOUR) })
    await recordSettlement({ siteId: site.id, reservationId: resToday.id, employeeId: alice.id, amount: 25, settledAt: new Date(now - HOUR) })

    const result = await getOpenTillItemsByEmployee(site.id, dayStart)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(2)

    const yesterdayItem = aliceRow.items.find((i) => i.label === 'Yesterday')!
    const todayItem = aliceRow.items.find((i) => i.label === 'Today')!
    expect(yesterdayItem.carryOver).toBe(true)
    expect(todayItem.carryOver).toBe(false)

    expect(aliceRow.carryOver).toEqual({ total: 40, count: 1, oldestAt: yesterdayItem.at })
    expect(aliceRow.today).toEqual({ total: 25, count: 1 })
  })

  it('boundary: an item settled exactly at dayStart is tagged carryOver: true', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item = await createTestInventoryItem(user.id, site.id, { number: 1, seatLabel: 'AtBoundary' })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 12, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 12, settledAt: dayStart })

    const result = await getOpenTillItemsByEmployee(site.id, dayStart)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(1)
    expect(aliceRow.items[0].carryOver).toBe(true)
  })
})

// ─── closeEmployeeTill ────────────────────────────────────────────────────────
//
// The single TillClose snapshot writer both the per-worker close and the
// manager close-all route through (track 016). Sweeps today + carryOver
// together (no partial close) and records the carry-over portion on the
// TillClose row for audit.

describe('closeEmployeeTill', () => {
  it('no-ops when the sweepable total is zero — returns closed: false, no TillClose row written', async () => {
    const { site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const result = await closeEmployeeTill(site.id, alice.id, farPastDayStart())

    expect(result.closed).toBe(false)
    expect(result.totalAmount).toBe(0)
    expect(result.txnCount).toBe(0)
    expect(result.carryOverAmount).toBe(0)
    expect(result.carryOverCount).toBe(0)

    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(closes).toHaveLength(0)
  })

  it('sweeps today + carryOver together: totalAmount/txnCount = sum of both, carryOverAmount/carryOverCount = the carry-over bucket only', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const itemYesterday = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const itemToday = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const resYesterday = await createTestReservation(user.id, site.id, [itemYesterday.id], { status: 'paid-in-cash', paymentAmount: 40, employeeId: alice.id })
    const resToday = await createTestReservation(user.id, site.id, [itemToday.id], { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resYesterday.id, employeeId: alice.id, amount: 40, settledAt: new Date(now - 30 * HOUR) })
    await recordSettlement({ siteId: site.id, reservationId: resToday.id, employeeId: alice.id, amount: 15, settledAt: new Date(now - HOUR) })

    const result = await closeEmployeeTill(site.id, alice.id, dayStart)

    expect(result.closed).toBe(true)
    expect(result.totalAmount).toBe(55)
    expect(result.txnCount).toBe(2)
    expect(result.carryOverAmount).toBe(40)
    expect(result.carryOverCount).toBe(1)

    const close = await prisma.tillClose.findFirst({ where: { siteId: site.id, employeeId: alice.id } })
    expect(close!.totalAmount).toBe(55)
    expect(close!.txnCount).toBe(2)
    expect(close!.carryOverAmount).toBe(40)
    expect(close!.carryOverCount).toBe(1)

    const till = await getOpenTill(site.id, alice.id, dayStart)
    expect(till).toEqual({ total: 0, count: 0, today: { total: 0, count: 0 }, carryOver: { total: 0, count: 0, oldestAt: null } })
  })

  it('is idempotent — a second call after closing finds a zero balance and no-ops', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 20 })

    const dayStart = farPastDayStart()
    const first = await closeEmployeeTill(site.id, alice.id, dayStart)
    expect(first.closed).toBe(true)

    const second = await closeEmployeeTill(site.id, alice.id, dayStart)
    expect(second.closed).toBe(false)

    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(closes).toHaveLength(1)
  })
})

// ─── closeAllOpenTills ────────────────────────────────────────────────────────
//
// Manager end-of-day "cierre de caja": snapshots every roster employee's open
// (unclosed) balance in one shot, via closeEmployeeTill. Each non-zero
// employee gets exactly one TillClose row. Zero-balance employees are
// skipped. Idempotent: a TillClose advances the window floor so subsequent
// reads return zero. Returns the combined carry-over portion swept
// (carryOverClosed) alongside closedCount/totalClosed.

describe('closeAllOpenTills', () => {
  it('creates one TillClose per non-zero employee with correct totalAmount + txnCount, returns { closedCount, totalClosed, carryOverClosed }', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resA1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 10, employeeId: alice.id })
    const resA2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA1.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: resA2.id, employeeId: alice.id, amount: 20 })

    const resB = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', paymentAmount: 45, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resB.id, employeeId: bob.id, amount: 45 })

    const result = await closeAllOpenTills(site.id, farPastDayStart())

    expect(result.closedCount).toBe(2)
    expect(result.totalClosed).toBe(75)
    expect(result.carryOverClosed).toBe(0)

    const aliceClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(aliceClose).toHaveLength(1)
    expect(aliceClose[0].totalAmount).toBe(30)
    expect(aliceClose[0].txnCount).toBe(2)
    expect(aliceClose[0].carryOverAmount).toBe(0)
    expect(aliceClose[0].carryOverCount).toBe(0)

    const bobClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: bob.id } })
    expect(bobClose).toHaveLength(1)
    expect(bobClose[0].totalAmount).toBe(45)
    expect(bobClose[0].txnCount).toBe(1)
  })

  it('skips employees whose open balance is zero — no TillClose row created, they are excluded from return counts', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob') // zero balance — no entries

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 15 })

    const result = await closeAllOpenTills(site.id, farPastDayStart())

    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(15)

    const aliceClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(aliceClose).toHaveLength(1)

    const bobClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: bob.id } })
    expect(bobClose).toHaveLength(0)
  })

  it('employee with a voided entry is treated as zero-balance and skipped', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 25, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 25 })
    await voidSettlementsForReservation(resA.id) // voids the entry → count falls to 0

    const result = await closeAllOpenTills(site.id, farPastDayStart())

    expect(result).toEqual({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  it('idempotent: second call immediately after returns zeros and creates no new TillClose rows', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    const resB = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', paymentAmount: 30, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, reservationId: resB.id, employeeId: bob.id, amount: 30 })

    const dayStart = farPastDayStart()
    const first = await closeAllOpenTills(site.id, dayStart)
    expect(first.closedCount).toBe(2)

    const second = await closeAllOpenTills(site.id, dayStart)
    expect(second).toEqual({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })

    const allCloses = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(allCloses).toHaveLength(2)

    const opens = await getOpenTillsByEmployee(site.id, dayStart)
    expect(opens.every((o) => o.total === 0 && o.count === 0)).toBe(true)
  })

  it('an employee with a prior TillClose only has their post-close entries snapshotted', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()
    const dayStart = farPastDayStart()

    const resA1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 50, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA1.id, employeeId: alice.id, amount: 50, settledAt: new Date(now - 3 * HOUR) })

    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * HOUR), totalAmount: 50, txnCount: 1, carryOverAmount: 0, carryOverCount: 0 } })

    const resA2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 35, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA2.id, employeeId: alice.id, amount: 35, settledAt: new Date(now - HOUR) })

    const result = await closeAllOpenTills(site.id, dayStart)

    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(35) // only the post-close entry, NOT 50 + 35

    const closes = await prisma.tillClose.findMany({
      where: { siteId: site.id, employeeId: alice.id },
      orderBy: { closedAt: 'asc' },
    })
    expect(closes).toHaveLength(2) // prior manual close + new manager close
    expect(closes[1].totalAmount).toBe(35)
    expect(closes[1].txnCount).toBe(1)

    expect((await getOpenTill(site.id, alice.id, dayStart)).total).toBe(0)
  })

  it('returns zeros and creates no rows when no employees are registered at the site', async () => {
    const { site } = await setup()
    const result = await closeAllOpenTills(site.id, farPastDayStart())
    expect(result).toEqual({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  it('returns zeros when all roster employees have zero open balance', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Alice')
    await mkEmp('Bob')

    const result = await closeAllOpenTills(site.id, farPastDayStart())
    expect(result).toEqual({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  it('returns zeros for an unknown siteId', async () => {
    const result = await closeAllOpenTills('nonexistent-site-id', farPastDayStart())
    expect(result).toEqual({ closedCount: 0, totalClosed: 0, carryOverClosed: 0 })
  })

  it('totalClosed is the rounded sum of per-employee totals', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 10.5, employeeId: alice.id })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 10.5, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 10.5 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: bob.id, amount: 10.5 })

    const result = await closeAllOpenTills(site.id, farPastDayStart())
    expect(result.closedCount).toBe(2)
    expect(result.totalClosed).toBe(21)
  })

  it('only closes tills for the specified site — other sites are not affected', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const siteA = await createTestSite(user.id)
    const siteB = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, siteA.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, siteB.id, { number: 1 })
    const emp = await prisma.employee.create({ data: { accountId: user.id, name: 'Alice' } })

    const resA = await createTestReservation(user.id, siteA.id, [itemA.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: emp.id })
    await recordSettlement({ siteId: siteA.id, reservationId: resA.id, employeeId: emp.id, amount: 20 })

    const resB = await createTestReservation(user.id, siteB.id, [itemB.id], { status: 'paid-in-cash', paymentAmount: 50, employeeId: emp.id })
    await recordSettlement({ siteId: siteB.id, reservationId: resB.id, employeeId: emp.id, amount: 50 })

    const result = await closeAllOpenTills(siteA.id, farPastDayStart())
    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(20)

    const siteBCloses = await prisma.tillClose.findMany({ where: { siteId: siteB.id } })
    expect(siteBCloses).toHaveLength(0)

    const siteACloses = await prisma.tillClose.findMany({ where: { siteId: siteA.id } })
    expect(siteACloses).toHaveLength(1)
    expect(siteACloses[0].totalAmount).toBe(20)
  })

  // ── carry-over sweep (track 016) ──────────────────────────────────────────

  it('sweeps carry-over cash together with today and returns carryOverClosed', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()
    const dayStart = new Date(now - 6 * HOUR)

    const resYesterday = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 40, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resYesterday.id, employeeId: alice.id, amount: 40, settledAt: new Date(now - 30 * HOUR) })

    const resToday = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resToday.id, employeeId: alice.id, amount: 15, settledAt: new Date(now - HOUR) })

    const result = await closeAllOpenTills(site.id, dayStart)

    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(55)
    expect(result.carryOverClosed).toBe(40)

    const close = await prisma.tillClose.findFirst({ where: { siteId: site.id, employeeId: alice.id } })
    expect(close!.totalAmount).toBe(55)
    expect(close!.txnCount).toBe(2)
    expect(close!.carryOverAmount).toBe(40)
    expect(close!.carryOverCount).toBe(1)

    const till = await getOpenTill(site.id, alice.id, dayStart)
    expect(till).toEqual({ total: 0, count: 0, today: { total: 0, count: 0 }, carryOver: { total: 0, count: 0, oldestAt: null } })
  })
})

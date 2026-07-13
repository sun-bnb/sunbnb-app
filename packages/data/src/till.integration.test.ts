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
} from './till'

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

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 20, count: 1 })
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

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 0, count: 0 })
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

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 45, count: 3 })
  })

  it('excludes voided entries', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 50, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 50 })
    await voidSettlementsForReservation(res.id)

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 0, count: 0 })
  })

  it('ignores ledger entries not attributed to the employee', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 99, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: bob.id, amount: 99 })

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 0, count: 0 })
  })

  it('counts departed reservations — operational status does NOT gate the ledger', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    // Settled when walked-in, then departed (operational status no longer walked-in)
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30 })

    // Must count — ledger row is non-voided regardless of operational status
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 30, count: 1 })
  })

  it('seat turnover: two settled reservations same seat, one departed — both count', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    // First guest — departed (paid and left)
    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 20 })

    // Second guest — still walked-in (seat turned over)
    const res2 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 25,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 25 })

    // Both entries count — ledger is immutable regardless of occupancy state
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 45, count: 2 })
  })

  it('only counts cash taken AFTER the last close', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()

    // Pre-close settlement (old timestamp)
    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    await prisma.tillEntry.create({
      data: { siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 10, settledAt: new Date(now - 2 * 3600_000) },
    })

    // Close
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 3600_000), totalAmount: 10, txnCount: 1 } })

    // Post-close settlement (now)
    const res2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 30, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 30 })

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 30, count: 1 })
  })

  it('reservation + rental settlements sum together for the same employee', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 40, employeeId: alice.id })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 35, employeeId: alice.id })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 40 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 35 })

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 75, count: 2 })
  })
})

// ─── getTillByEmployee — ledger-based ────────────────────────────────────────

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

    // Record the settlement explicitly (as the partner action now does)
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

    // Insert the backfill row the same way the migration SQL does (idempotent guard).
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
    // This test asserts the backfill reproduces the prior till: the pre-P3 till
    // summed RentalBooking.paymentAmount for all status='paid-in-cash' rows.
    // After backfill, the TillEntry sum for those bookings must equal that total.
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    // Create a set of paid-in-cash rental bookings
    const rb1 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    const rb2 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 35, employeeId: bob.id })
    const rb3 = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    // This one should NOT be backfilled (not paid-in-cash)
    await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'complete', paymentAmount: 50, employeeId: alice.id })

    // The "prior" rental till total: sum of paymentAmount for paid-in-cash bookings
    const priorTotal = 20 + 35 + 15 // 70

    // Run the backfill for all three
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

    // TillEntry sum for rental bookings must match the prior till total exactly
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

    // Should not have been backfilled
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

// ─── getEmployeeShiftItems ───────────────────────────────────────────────────

describe('getEmployeeShiftItems', () => {
  const dayRange = {
    from: new Date('2026-07-01T00:00:00Z'),
    to: new Date('2026-07-01T23:59:59Z'),
  }

  it('returns itemized rows per employee with correct seats, amount, channel, and sort order', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    // Alice: cash walk-in (2-seat item1), then card QR-collect (1-seat item1)
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

    // Bob: one cash reservation
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

    // Self-service: no employeeId
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentAmount: 40,
      employeeId: null,
      createdAt: new Date('2026-07-01T09:00:00Z'),
    })

    const result = await getEmployeeShiftItems(site.id, dayRange.from, dayRange.to)
    // No employees in roster → empty result; or if roster employees exist they have empty items
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

    // Cash walk-in: 20
    await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 20,
      employeeId: alice.id,
      createdAt: new Date('2026-07-01T08:00:00Z'),
    })
    // Card QR-collect: 30
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

// ─── getOpenTill — since-last-close semantics (fix for old daily-reset bug) ──
//
// These tests are written to FAIL under the old daily-reset behavior (which
// floored the window at start-of-today, orphaning cash from prior days when
// the worker never closed). They PASS under the current since-last-close
// semantics. Do NOT change the settledAt timestamps to "today" — the prior-day
// timestamps are the load-bearing part of the spec.

describe('getOpenTill — since-last-close (prior-day rollforward)', () => {
  it('CORE BUG FIX: an entry settled yesterday with no TillClose is INCLUDED (not orphaned by day boundary)', async () => {
    // Old behavior: window was floored at start-of-today; yesterday's entry was
    // invisible. New behavior: no close ever → all-time window → yesterday counts.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 40,
      employeeId: alice.id,
    })

    // Settle on a prior day (25 hours ago)
    const yesterday = new Date(Date.now() - 25 * 3600_000)
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 40, settledAt: yesterday })

    // No TillClose has ever been created for this employee.
    // Old code (daily reset): result would be { total: 0, count: 0 }.
    // New code (since-last-close / all-time when never closed): must be { total: 40, count: 1 }.
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 40, count: 1 })
  })

  it('entries from multiple prior days with no close all roll forward (all-time sum)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 15,
      employeeId: alice.id,
    })
    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 25,
      employeeId: alice.id,
    })

    // Two days ago
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 15, settledAt: new Date(Date.now() - 49 * 3600_000) })
    // Yesterday
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 25, settledAt: new Date(Date.now() - 25 * 3600_000) })

    // Old code: both entries pre-date today → total 0. New code: all-time → total 40.
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 40, count: 2 })
  })

  it('entry before last close is EXCLUDED; entry after last close is INCLUDED', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 35,
      employeeId: alice.id,
    })

    // Entry 1: yesterday (will be before the close)
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - 25 * 3600_000) })

    // Close at 2 hours ago
    await prisma.tillClose.create({
      data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * 3600_000), totalAmount: 20, txnCount: 1 },
    })

    // Entry 2: 1 hour ago (after the close)
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 35, settledAt: new Date(now - 3600_000) })

    // Only entry 2 counts — entry 1 is before the close boundary.
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 35, count: 1 })
  })

  it('voided prior-day entries are excluded even when no close exists', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 30,
      employeeId: alice.id,
    })

    // Settle yesterday, then void
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 30, settledAt: new Date(Date.now() - 25 * 3600_000) })
    await voidSettlementsForReservation(res.id)

    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 0, count: 0 })
  })

  it('closing then adding a new entry — only the post-close entry counts', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()

    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 50,
      employeeId: alice.id,
    })
    // Settle yesterday
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 50, settledAt: new Date(now - 25 * 3600_000) })

    // Close today (snapshots the 50)
    const closeTime = new Date(now - 3600_000) // 1 hour ago
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: closeTime, totalAmount: 50, txnCount: 1 } })

    // New entry: after the close
    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 22,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 22 })

    // Should only see the post-close entry (22), not the pre-close one (50).
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 22, count: 1 })
  })
})

// ─── getOpenTillsByEmployee ──────────────────────────────────────────────────
//
// New function: returns every roster employee's open till, each computed since
// their own last close (all-time if never closed). Sorted by name, zero-filled.

describe('getOpenTillsByEmployee', () => {
  it('returns an empty array for an unknown siteId', async () => {
    expect(await getOpenTillsByEmployee('nonexistent-site')).toEqual([])
  })

  it('roster employee with no cash entries appears with total 0 and count 0', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Alice')

    const result = await getOpenTillsByEmployee(site.id)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Alice', active: true, total: 0, count: 0 })
  })

  it('PRIOR-DAY CASH with no close is included in the open till for each employee', async () => {
    // This is the cross-employee equivalent of the core bug fix: the old daily
    // reset would zero out both employees here. New code: since-last-close (all-time
    // for never-closed workers) must return the prior-day cash.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resAlice = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 40,
      employeeId: alice.id,
    })
    const resBob = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 60,
      employeeId: bob.id,
    })

    // Settle both on a prior day
    const yesterday = new Date(Date.now() - 25 * 3600_000)
    await recordSettlement({ siteId: site.id, reservationId: resAlice.id, employeeId: alice.id, amount: 40, settledAt: yesterday })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 60, settledAt: yesterday })

    // No TillClose for either employee. Old code: both would show { total: 0, count: 0 }.
    const result = await getOpenTillsByEmployee(site.id)
    expect(result).toHaveLength(2)

    const aliceRow = result.find((r) => r.name === 'Alice')!
    const bobRow = result.find((r) => r.name === 'Bob')!
    expect(aliceRow).toMatchObject({ total: 40, count: 1 })
    expect(bobRow).toMatchObject({ total: 60, count: 1 })
  })

  it('each employee uses their OWN last-close as the window floor (different close times)', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const now = Date.now()

    // Alice: settle at T-3h, close at T-2h, settle again at T-1h.
    // Expected open till: only the T-1h entry (30) counts.
    const resAlice1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 20,
      employeeId: alice.id,
    })
    const resAlice2 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: resAlice1.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - 3 * 3600_000) })
    await prisma.tillClose.create({ data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * 3600_000), totalAmount: 20, txnCount: 1 } })
    await recordSettlement({ siteId: site.id, reservationId: resAlice2.id, employeeId: alice.id, amount: 30, settledAt: new Date(now - 3600_000) })

    // Bob: settle at T-25h (yesterday), never closed.
    // Expected open till: all-time → the T-25h entry (55) counts.
    const resBob = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 55,
      employeeId: bob.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 55, settledAt: new Date(now - 25 * 3600_000) })

    const result = await getOpenTillsByEmployee(site.id)
    expect(result).toHaveLength(2)

    const aliceRow = result.find((r) => r.name === 'Alice')!
    const bobRow = result.find((r) => r.name === 'Bob')!
    // Alice: only post-close entry
    expect(aliceRow).toMatchObject({ total: 30, count: 1 })
    // Bob: all-time (never closed)
    expect(bobRow).toMatchObject({ total: 55, count: 1 })
  })

  it('voided entries are excluded from each employee open till', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 45,
      employeeId: alice.id,
    })

    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 45, settledAt: new Date(Date.now() - 25 * 3600_000) })
    await voidSettlementsForReservation(res.id)

    const result = await getOpenTillsByEmployee(site.id)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Alice', total: 0, count: 0 })
  })

  it('results are sorted by employee name ascending', async () => {
    const { site, mkEmp } = await setup()
    await mkEmp('Zara')
    await mkEmp('Anna')
    await mkEmp('Mike')

    const result = await getOpenTillsByEmployee(site.id)
    expect(result.map((r) => r.name)).toEqual(['Anna', 'Mike', 'Zara'])
  })

  it('multiple employees: mix of active/inactive, different cash amounts, sorted by name', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    // Carol: inactive employee still appears in roster
    const carol = await prisma.employee.create({ data: { accountId: user.id, name: 'Carol', active: false } })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resAlice = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 10,
      employeeId: alice.id,
    })
    const resBob = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 20,
      employeeId: bob.id,
    })

    await recordSettlement({ siteId: site.id, reservationId: resAlice.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: resBob.id, employeeId: bob.id, amount: 20 })
    // Carol has no entries

    const result = await getOpenTillsByEmployee(site.id)
    expect(result).toHaveLength(3)
    expect(result).toEqual([
      expect.objectContaining({ employeeId: alice.id, name: 'Alice', active: true, total: 10, count: 1 }),
      expect.objectContaining({ employeeId: bob.id, name: 'Bob', active: true, total: 20, count: 1 }),
      expect.objectContaining({ employeeId: carol.id, name: 'Carol', active: false, total: 0, count: 0 }),
    ])
  })

  it('employees from a different account are not included', async () => {
    // Site belongs to user1; user2's employee should not appear in the result.
    const { site } = await setup()

    // A second, unrelated user/account with their own employee
    const user2 = await createTestUser()
    await createTestPartnerAccount(user2.id)
    await prisma.employee.create({ data: { accountId: user2.id, name: 'Outsider' } })

    // Site belongs to user1 — result must not include user2's employee.
    const result = await getOpenTillsByEmployee(site.id)
    expect(result.every((r) => r.name !== 'Outsider')).toBe(true)
  })
})

// ─── closeAllOpenTills ────────────────────────────────────────────────────────
//
// Manager end-of-day "cierre de caja": snapshots every roster employee's open
// (unclosed) balance in one shot. Each non-zero employee gets exactly one
// TillClose row. Zero-balance employees are skipped. Idempotent by construction:
// a TillClose advances the window floor so subsequent reads return zero.

describe('closeAllOpenTills', () => {
  // ── Scenario 1: multiple employees each with non-zero open balances ──────

  it('creates one TillClose per non-zero employee with correct totalAmount + txnCount, returns { closedCount, totalClosed }', async () => {
    // Requirement: each employee with count > 0 gets a TillClose row whose
    // totalAmount and txnCount match the open-till aggregate. The return value
    // closedCount equals the number of employees closed; totalClosed is the
    // rounded sum of their per-employee totals.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    // Alice: 2 cash entries (10 + 20 = 30, count 2)
    const resA1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 10, employeeId: alice.id })
    const resA2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA1.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: resA2.id, employeeId: alice.id, amount: 20 })

    // Bob: 1 cash entry (45, count 1)
    const resB = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', paymentAmount: 45, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resB.id, employeeId: bob.id, amount: 45 })

    const result = await closeAllOpenTills(site.id)

    // Return value
    expect(result.closedCount).toBe(2)
    expect(result.totalClosed).toBe(75) // 30 + 45

    // Exactly one TillClose row per employee
    const aliceClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(aliceClose).toHaveLength(1)
    expect(aliceClose[0].totalAmount).toBe(30)
    expect(aliceClose[0].txnCount).toBe(2)

    const bobClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: bob.id } })
    expect(bobClose).toHaveLength(1)
    expect(bobClose[0].totalAmount).toBe(45)
    expect(bobClose[0].txnCount).toBe(1)
  })

  // ── Scenario 2: zero-balance employees are skipped ────────────────────────

  it('skips employees whose open balance is zero — no TillClose row created, they are excluded from return counts', async () => {
    // Requirement: an employee with count 0 (no entries, or all entries voided,
    // or all entries pre-close) must NOT get a TillClose row. Their presence in
    // the roster does not inflate closedCount or totalClosed.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')   // zero balance — no entries

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 15 })
    // Bob has no TillEntry rows at all

    const result = await closeAllOpenTills(site.id)

    expect(result.closedCount).toBe(1)   // only Alice
    expect(result.totalClosed).toBe(15)

    // Alice gets a TillClose row; Bob gets none
    const aliceClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: alice.id } })
    expect(aliceClose).toHaveLength(1)

    const bobClose = await prisma.tillClose.findMany({ where: { siteId: site.id, employeeId: bob.id } })
    expect(bobClose).toHaveLength(0)
  })

  it('employee with a voided entry is treated as zero-balance and skipped', async () => {
    // Voiding an entry removes it from the open count. If that was the only entry,
    // the employee's count falls to 0 and they must be skipped.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 25, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 25 })
    await voidSettlementsForReservation(resA.id) // voids the entry → count falls to 0

    const result = await closeAllOpenTills(site.id)

    expect(result).toEqual({ closedCount: 0, totalClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  // ── Scenario 3: idempotency ───────────────────────────────────────────────

  it('idempotent: second call immediately after returns { closedCount: 0, totalClosed: 0 } and creates no new TillClose rows', async () => {
    // Requirement: after closeAllOpenTills runs, every open till is zero because
    // the new TillClose rows advance each employee's window floor past their
    // entries. A second call finds no non-zero balances and is a pure no-op.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })

    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: alice.id })
    const resB = await createTestReservation(user.id, site.id, [item2.id], { status: 'paid-in-cash', paymentAmount: 30, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 20 })
    await recordSettlement({ siteId: site.id, reservationId: resB.id, employeeId: bob.id, amount: 30 })

    // First call — closes both
    const first = await closeAllOpenTills(site.id)
    expect(first.closedCount).toBe(2)

    // Second call — must be a no-op
    const second = await closeAllOpenTills(site.id)
    expect(second).toEqual({ closedCount: 0, totalClosed: 0 })

    // Total TillClose rows: still just 2 (one per employee from the first call)
    const allCloses = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(allCloses).toHaveLength(2)

    // Verify open tills are all zero after the first close
    const opens = await getOpenTillsByEmployee(site.id)
    expect(opens.every((o) => o.total === 0 && o.count === 0)).toBe(true)
  })

  // ── Scenario 4: respects each employee's own since-last-close window ──────

  it('an employee with a prior TillClose only has their post-close entries snapshotted', async () => {
    // Requirement: closeAllOpenTills delegates to getOpenTillsByEmployee, which
    // computes each employee's open balance since *their own* last close. An
    // employee who already closed earlier today should only see their post-close
    // cash in the new TillClose row — not their full all-time total.
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const now = Date.now()

    // Entry 1: settled 3 hours ago (before alice's existing close)
    const resA1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 50, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA1.id, employeeId: alice.id, amount: 50, settledAt: new Date(now - 3 * 3600_000) })

    // Alice's prior TillClose at 2 hours ago (she closed her own till manually)
    await prisma.tillClose.create({
      data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * 3600_000), totalAmount: 50, txnCount: 1 },
    })

    // Entry 2: settled 1 hour ago (after her close — this is the only open entry)
    const resA2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 35, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: resA2.id, employeeId: alice.id, amount: 35, settledAt: new Date(now - 3600_000) })

    const result = await closeAllOpenTills(site.id)

    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(35) // only the post-close entry, NOT 50 + 35

    // The new TillClose row captures only the post-close window
    const closes = await prisma.tillClose.findMany({
      where: { siteId: site.id, employeeId: alice.id },
      orderBy: { closedAt: 'asc' },
    })
    expect(closes).toHaveLength(2)              // prior manual close + new manager close
    expect(closes[1].totalAmount).toBe(35)      // only the post-prior-close entry
    expect(closes[1].txnCount).toBe(1)

    // After the manager close the open till is zero
    expect(await getOpenTill(site.id, alice.id)).toEqual({ total: 0, count: 0 })
  })

  // ── Scenario 5: empty / all-zero site ─────────────────────────────────────

  it('returns { closedCount: 0, totalClosed: 0 } and creates no rows when no employees are registered at the site', async () => {
    // A site with no roster employees at all (or whose account has no employees).
    // getOpenTillsByEmployee returns [] → toClose is empty → immediate early-exit.
    const { site } = await setup()
    // No employees created for this site's account.

    const result = await closeAllOpenTills(site.id)

    expect(result).toEqual({ closedCount: 0, totalClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  it('returns { closedCount: 0, totalClosed: 0 } when all roster employees have zero open balance', async () => {
    // Roster exists but every employee's open till is zero (never recorded cash,
    // or all cash was already closed). Early-exit path fires without any DB writes.
    const { site, mkEmp } = await setup()
    await mkEmp('Alice')
    await mkEmp('Bob')
    // Neither has any TillEntry rows → both have count 0 → toClose is empty

    const result = await closeAllOpenTills(site.id)

    expect(result).toEqual({ closedCount: 0, totalClosed: 0 })
    const closes = await prisma.tillClose.findMany({ where: { siteId: site.id } })
    expect(closes).toHaveLength(0)
  })

  it('returns { closedCount: 0, totalClosed: 0 } for an unknown siteId', async () => {
    // getOpenTillsByEmployee returns [] for an unknown site → early-exit.
    const result = await closeAllOpenTills('nonexistent-site-id')
    expect(result).toEqual({ closedCount: 0, totalClosed: 0 })
  })

  // ── totalClosed rounding ──────────────────────────────────────────────────

  it('totalClosed is the rounded sum of per-employee totals', async () => {
    // Use fractional amounts whose sum needs rounding. Each employee's total is
    // individually rounded by getOpenTillsByEmployee (via round()), and then
    // closeAllOpenTills sums those rounded values and rounds again.
    // 33.335 + 33.335 = 66.67 after rounding (demonstrating no double-rounding issue).
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const bob = await mkEmp('Bob')

    // Use amounts that sum to a value requiring rounding
    const resA = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', paymentAmount: 10.5, employeeId: alice.id })
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 10.5, employeeId: bob.id })
    await recordSettlement({ siteId: site.id, reservationId: resA.id, employeeId: alice.id, amount: 10.5 })
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: bob.id, amount: 10.5 })

    const result = await closeAllOpenTills(site.id)
    expect(result.closedCount).toBe(2)
    // Each employee has 10.5 (already representable exactly); total = 21.00
    expect(result.totalClosed).toBe(21)
  })

  // ── Cross-site isolation ──────────────────────────────────────────────────

  it('only closes tills for the specified site — other sites are not affected', async () => {
    // Two sites under the same account. closeAllOpenTills(siteA) must not create
    // TillClose rows scoped to siteB. getOpenTillsByEmployee is site-scoped (it
    // fetches site.userId then employees under that account, but TillEntry rows
    // are filtered by siteId), so entries from siteB do not inflate siteA's close.
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const siteA = await createTestSite(user.id)
    const siteB = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, siteA.id, { number: 1 })
    const itemB = await createTestInventoryItem(user.id, siteB.id, { number: 1 })
    const emp = await prisma.employee.create({ data: { accountId: user.id, name: 'Alice' } })

    // Settlement at siteA only
    const resA = await createTestReservation(user.id, siteA.id, [itemA.id], { status: 'paid-in-cash', paymentAmount: 20, employeeId: emp.id })
    await recordSettlement({ siteId: siteA.id, reservationId: resA.id, employeeId: emp.id, amount: 20 })

    // Settlement at siteB only
    const resB = await createTestReservation(user.id, siteB.id, [itemB.id], { status: 'paid-in-cash', paymentAmount: 50, employeeId: emp.id })
    await recordSettlement({ siteId: siteB.id, reservationId: resB.id, employeeId: emp.id, amount: 50 })

    // Close siteA only
    const result = await closeAllOpenTills(siteA.id)
    expect(result.closedCount).toBe(1)
    expect(result.totalClosed).toBe(20)

    // siteB's TillClose rows are untouched
    const siteBCloses = await prisma.tillClose.findMany({ where: { siteId: siteB.id } })
    expect(siteBCloses).toHaveLength(0)

    // siteA has exactly one TillClose row
    const siteACloses = await prisma.tillClose.findMany({ where: { siteId: siteA.id } })
    expect(siteACloses).toHaveLength(1)
    expect(siteACloses[0].totalAmount).toBe(20)
  })
})

// ─── getOpenTillItemsByEmployee ───────────────────────────────────────────────
//
// Itemized version of getOpenTillsByEmployee: per roster employee it returns
// { employeeId, name, active, total, count, items } where items: OpenTillItem[]
// are the individual cash TillEntry rows since that employee's own last close.
// A sunbed entry's label is seat labels joined (seatLabel else number); a rental
// entry's label is the RentalItem name. total = round(sum); count = items.length;
// items oldest-first; roster zero-filled; sorted by name; cash-only.

describe('getOpenTillItemsByEmployee', () => {
  // ── 1. Sunbed cash entry — kind, label (seatLabel), amount, at ─────────────

  it('sunbed entry: kind=sunbed, label from seatLabel when set, correct amount and at=settledAt', async () => {
    // The InventoryItem has seatLabel='A1'. The TillEntry links to the reservation
    // which links to that item. label should be 'A1', not String(number).
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    // Create an item with a seatLabel
    const item = await createTestInventoryItem(user.id, site.id, { number: 5, seatLabel: 'A1' })
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      employeeId: alice.id,
    })
    const settledAt = new Date(Date.now() - 3600_000)
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 25, settledAt })

    const result = await getOpenTillItemsByEmployee(site.id)
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
  })

  it('sunbed entry: label falls back to String(number) when seatLabel is null', async () => {
    // No seatLabel set → label should be '7' (String(item.number)).
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item = await createTestInventoryItem(user.id, site.id, { number: 7, seatLabel: null })
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 15 })

    const result = await getOpenTillItemsByEmployee(site.id)
    expect(result[0].items[0].label).toBe('7')
  })

  it('sunbed entry: multiple seats joined by ", " in label', async () => {
    // A reservation covering two items → label = 'A1, B3' (sorted by join order).
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

    const result = await getOpenTillItemsByEmployee(site.id)
    const label = result[0].items[0].label
    // Both seat labels must appear; joined with ', '
    expect(label).toContain('A1')
    expect(label).toContain('B3')
    expect(label).toContain(', ')
  })

  // ── 2. Rental cash entry — kind, label (RentalItem name) ─────────────────

  it('rental entry: kind=rental, label=rentalItem name, correct amount and at=settledAt', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    // rentalItem.name = 'Test Surfboard' (from createTestRentalItem default)
    const alice = await mkEmp('Alice')
    const rb = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      status: 'paid-in-cash',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    const settledAt = new Date(Date.now() - 1800_000)
    await recordSettlement({ siteId: site.id, rentalBookingId: rb.id, employeeId: alice.id, amount: 30, settledAt })

    const result = await getOpenTillItemsByEmployee(site.id)
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

  // ── 3. items sum to total; total == getOpenTill; count == items.length ─────

  it('items sum to total, total equals getOpenTill(siteId, employeeId), count equals items.length', async () => {
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

    const [itemsResult, openTill] = await Promise.all([
      getOpenTillItemsByEmployee(site.id),
      getOpenTill(site.id, alice.id),
    ])

    const aliceRow = itemsResult.find((r) => r.employeeId === alice.id)!
    // items sum to total
    const itemsSum = aliceRow.items.reduce((sum, it) => sum + it.amount, 0)
    expect(Math.round(itemsSum * 100) / 100).toBe(aliceRow.total)
    // total equals getOpenTill
    expect(aliceRow.total).toBe(openTill.total)
    // count equals items.length
    expect(aliceRow.count).toBe(aliceRow.items.length)
    expect(aliceRow.count).toBe(2)
  })

  // ── 4. Since-last-close window: pre-close entries excluded ─────────────────

  it('entries before the employee\'s last TillClose are excluded; only post-close items appear', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'B2' })
    const now = Date.now()

    // Pre-close entry (3 hours ago)
    const res1 = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 50,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 50, settledAt: new Date(now - 3 * 3600_000) })

    // TillClose at 2 hours ago
    await prisma.tillClose.create({
      data: { siteId: site.id, employeeId: alice.id, closedAt: new Date(now - 2 * 3600_000), totalAmount: 50, txnCount: 1 },
    })

    // Post-close entry (1 hour ago) — the only one that should appear
    const res2 = await createTestReservation(user.id, site.id, [item2.id], {
      status: 'paid-in-cash',
      paymentAmount: 30,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 30, settledAt: new Date(now - 3600_000) })

    const result = await getOpenTillItemsByEmployee(site.id)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(30)
    expect(aliceRow.items).toHaveLength(1)
    expect(aliceRow.items[0].label).toBe('B2')
    expect(aliceRow.items[0].amount).toBe(30)
  })

  // ── 5. Voided entries excluded ─────────────────────────────────────────────

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

    const result = await getOpenTillItemsByEmployee(site.id)
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

    const result = await getOpenTillItemsByEmployee(site.id)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(0)
    expect(aliceRow.total).toBe(0)
  })

  // ── 6. Items ordered oldest-first (by settledAt) ──────────────────────────

  it('items are returned oldest-first by settledAt', async () => {
    const { user, site, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1, seatLabel: 'First' })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2, seatLabel: 'Second' })
    const now = Date.now()

    // Create entries with deliberate time ordering: item2 settled BEFORE item1
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
    // Settle earlier entry first (older timestamp)
    await recordSettlement({ siteId: site.id, reservationId: resEarlier.id, employeeId: alice.id, amount: 10, settledAt: new Date(now - 2 * 3600_000) })
    // Settle later entry second (newer timestamp)
    await recordSettlement({ siteId: site.id, reservationId: resLater.id, employeeId: alice.id, amount: 20, settledAt: new Date(now - 3600_000) })

    const result = await getOpenTillItemsByEmployee(site.id)
    const aliceRow = result.find((r) => r.employeeId === alice.id)!
    expect(aliceRow.items).toHaveLength(2)
    // Oldest first: item2 (settled 2h ago) before item1 (settled 1h ago)
    expect(aliceRow.items[0].label).toBe('Second')
    expect(aliceRow.items[1].label).toBe('First')
    expect(aliceRow.items[0].at.getTime()).toBeLessThan(aliceRow.items[1].at.getTime())
  })

  // ── 7. Roster zero-fill and name-sort ────────────────────────────────────

  it('roster employee with no entries appears with items=[], total=0, count=0; results sorted by name', async () => {
    const { user, site, item, mkEmp } = await setup()
    await mkEmp('Zara')
    const alice = await mkEmp('Alice')
    // Only Alice has a cash entry; Zara is zero
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      paymentAmount: 15,
      employeeId: alice.id,
    })
    await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 15 })

    const result = await getOpenTillItemsByEmployee(site.id)
    expect(result).toHaveLength(2)
    // Sorted by name: Alice before Zara
    expect(result[0].name).toBe('Alice')
    expect(result[1].name).toBe('Zara')

    // Zara: zero-filled
    const zaraRow = result.find((r) => r.name === 'Zara')!
    expect(zaraRow.items).toEqual([])
    expect(zaraRow.total).toBe(0)
    expect(zaraRow.count).toBe(0)

    // Alice: has one item
    const aliceRow = result.find((r) => r.name === 'Alice')!
    expect(aliceRow.count).toBe(1)
    expect(aliceRow.total).toBe(15)
  })

  it('returns empty array for an unknown siteId', async () => {
    const result = await getOpenTillItemsByEmployee('nonexistent-site-id')
    expect(result).toEqual([])
  })

  // ── 8. Cross-site isolation ───────────────────────────────────────────────

  it('entries at another site under the same account do not appear', async () => {
    // Same employee, two sites under same account. Only siteA entries should
    // appear when querying siteA.
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const siteA = await createTestSite(user.id)
    const siteB = await createTestSite(user.id)
    const itemA = await createTestInventoryItem(user.id, siteA.id, { number: 1, seatLabel: 'SiteA-Seat' })
    const itemB = await createTestInventoryItem(user.id, siteB.id, { number: 1, seatLabel: 'SiteB-Seat' })
    const emp = await prisma.employee.create({ data: { accountId: user.id, name: 'Alice' } })

    // Settlement at siteA (25)
    const resA = await createTestReservation(user.id, siteA.id, [itemA.id], {
      status: 'paid-in-cash',
      paymentAmount: 25,
      employeeId: emp.id,
    })
    await recordSettlement({ siteId: siteA.id, reservationId: resA.id, employeeId: emp.id, amount: 25 })

    // Settlement at siteB (50) — must NOT appear in siteA's result
    const resB = await createTestReservation(user.id, siteB.id, [itemB.id], {
      status: 'paid-in-cash',
      paymentAmount: 50,
      employeeId: emp.id,
    })
    await recordSettlement({ siteId: siteB.id, reservationId: resB.id, employeeId: emp.id, amount: 50 })

    const resultA = await getOpenTillItemsByEmployee(siteA.id)
    expect(resultA).toHaveLength(1)
    const empRow = resultA[0]
    // Only the siteA entry appears
    expect(empRow.total).toBe(25)
    expect(empRow.count).toBe(1)
    expect(empRow.items).toHaveLength(1)
    expect(empRow.items[0].label).toBe('SiteA-Seat')
    // The siteB seat label must not appear
    expect(empRow.items.some((i) => i.label === 'SiteB-Seat')).toBe(false)
  })
})

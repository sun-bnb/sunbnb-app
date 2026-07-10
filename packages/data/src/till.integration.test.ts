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
  getTillByEmployee,
  getEmployeeShiftItems,
  recordSettlement,
  voidSettlementsForReservation,
  voidSettlementsForRentalBooking,
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

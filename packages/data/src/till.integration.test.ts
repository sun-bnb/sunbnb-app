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
import { getOpenTill, getTillByEmployee, recordSettlement, voidSettlementsForReservation } from './till'

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

// ─── recordSettlement ────────────────────────────────────────────────────────

describe('recordSettlement', () => {
  it('creates a TillEntry row with the given fields', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    const res = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 25, employeeId: alice.id })

    const before = Date.now()
    const entry = await recordSettlement({ siteId: site.id, reservationId: res.id, employeeId: alice.id, amount: 25 })
    const after = Date.now()

    expect(entry.siteId).toBe(site.id)
    expect(entry.reservationId).toBe(res.id)
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

// ─── getOpenTill — ledger-based ──────────────────────────────────────────────

describe('getOpenTill (ledger-based)', () => {
  it('sums non-voided TillEntry in the window for the employee', async () => {
    const { user, site, item, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const res1 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 10, employeeId: alice.id })
    const res2 = await createTestReservation(user.id, site.id, [item.id], { status: 'paid-in-cash', operationalStatus: 'walked-in', paymentAmount: 20, employeeId: alice.id })
    await recordSettlement({ siteId: site.id, reservationId: res1.id, employeeId: alice.id, amount: 10 })
    await recordSettlement({ siteId: site.id, reservationId: res2.id, employeeId: alice.id, amount: 20 })
    // Cash rental still contributes via the old path
    await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 15, employeeId: alice.id })

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

  it('rentals still contribute via the rental booking path', async () => {
    const { user, site, rentalItem, mkEmp } = await setup()
    const alice = await mkEmp('Alice')
    await createTestRentalBooking(user.id, site.id, rentalItem.id, { status: 'paid-in-cash', paymentAmount: 22, employeeId: alice.id })

    const n = new Date()
    const from = new Date(n.getFullYear(), n.getMonth(), n.getDate())
    const to = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59)

    const result = await getTillByEmployee(site.id, from, to)
    expect(result).toEqual([{ employeeId: alice.id, name: 'Alice', active: true, total: 22, count: 1 }])
  })
})

// ─── Backfill correctness ────────────────────────────────────────────────────

describe('backfill — idempotent backfill reproduces the prior till exactly', () => {
  it('pre-existing walked-in cash reservations have matching TillEntry rows after migration', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    // Simulate a "pre-existing" cash walk-in reservation by creating it directly
    // (as it would have existed before the backfill migration).
    const res = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'walked-in',
      paymentAmount: 42,
      employeeId: alice.id,
    })

    // Insert the backfill row the same way the migration SQL does (idempotent guard).
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

    // The backfill is idempotent — running again inserts 0 rows
    const countBefore = await prisma.tillEntry.count({ where: { reservationId: res.id } })
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
    const countAfter = await prisma.tillEntry.count({ where: { reservationId: res.id } })
    expect(countAfter).toBe(countBefore) // idempotent

    // The backfilled entry matches the reservation's paymentAmount exactly
    const entries = await prisma.tillEntry.findMany({ where: { reservationId: res.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amount).toBe(42)
    expect(entries[0].employeeId).toBe(alice.id)
    expect(entries[0].voidedAt).toBeNull()
  })

  it('non-walked-in reservations (departed) are NOT backfilled — only walked-in is the prior behavior', async () => {
    const { user, site, item, mkEmp } = await setup()
    const alice = await mkEmp('Alice')

    const departed = await createTestReservation(user.id, site.id, [item.id], {
      status: 'paid-in-cash',
      operationalStatus: 'departed', // was counted when departed, but backfill matches OLD logic
      paymentAmount: 50,
      employeeId: alice.id,
    })

    // Backfill only targets walked-in
    await prisma.$executeRawUnsafe(`
      INSERT INTO "till_entry" ("id", "site_id", "reservation_id", "employee_id", "amount", "settled_at", "created_at")
      SELECT concat('te_', r.id), r."site_id", r."id", r."employee_id", r."payment_amount", r."createdAt", NOW()
      FROM "Reservation" r
      WHERE r."id" = '${departed.id}'
        AND r."status" = 'paid-in-cash'
        AND r."operational_status" = 'walked-in'
        AND r."payment_amount" > 0
        AND NOT EXISTS (SELECT 1 FROM "till_entry" te WHERE te."reservation_id" = r."id")
    `)

    // departed reservation has no TillEntry from backfill
    const entries = await prisma.tillEntry.findMany({ where: { reservationId: departed.id } })
    expect(entries).toHaveLength(0)
  })
})

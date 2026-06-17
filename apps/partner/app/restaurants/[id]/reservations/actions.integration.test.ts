/**
 * Integration tests for restaurant reservation actions.
 *
 * These tests exercise the REAL @repo/data and @repo/table-reservations-core
 * implementations against sunbnb_test — no mocking of the core, no mocking of
 * processChargedTableDeposit. Auth and next/cache are the only mocks.
 *
 * Targets:
 *   1. chargeRestaurantReservationDeposit — HELD→CHARGED + real invoice cascade
 *   2. modifyRestaurantReservation — availability / double-booking rejection
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestRestaurant,
  createTestTable,
  createTestTableReservation,
} from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — only auth, flags, and next/cache; everything else is REAL.
// ---------------------------------------------------------------------------

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

// Mollie refund is an app-level concern that hits an external API —
// stub it to a no-op so the deposit tests don't try to call Mollie.
vi.mock('@/app/api/_lib/mollie', () => ({
  refundDepositPayment: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Import actions AFTER mocks so Next.js module resolution is stable.
// ---------------------------------------------------------------------------

import {
  chargeRestaurantReservationDeposit,
  modifyRestaurantReservation,
} from './actions'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  mockUserId = null
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// chargeRestaurantReservationDeposit — HELD → CHARGED + invoice cascade
// ---------------------------------------------------------------------------

describe('chargeRestaurantReservationDeposit integration', () => {
  /**
   * Set up the full object graph that processChargedTableDeposit requires:
   *   User → PartnerAccount → Site (+ Settings) → Restaurant → Table → TableReservation
   *
   * The restaurant must be site-linked (restaurant.siteId set); the cascade
   * calls loadFeeContext(siteId) which needs Site → PartnerAccount.
   */
  async function buildDepositScenario(depositAmount = 20) {
    const user = await createTestUser()
    // PartnerAccount.userId === user.id; the fee cascade reads partnerAccount off the site.
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, { vat: 14 }) // 14 % VAT for easy assertions
    const restaurant = await createTestRestaurant(user.id, { siteId: site.id })
    const table = await createTestTable(restaurant.id)
    const reservation = await createTestTableReservation(restaurant.id, {
      tableId: table.id,
      depositStatus: 'held',
      depositAmount,
      paymentRef: `pi_demo_${Date.now()}`,
    })
    return { user, site, restaurant, table, reservation }
  }

  it('HELD deposit → CHARGED: creates PARTNER + PLATFORM invoices with correct VAT and amounts', async () => {
    const { user, restaurant, reservation } = await buildDepositScenario(20)
    mockUserId = user.id

    const result = await chargeRestaurantReservationDeposit(restaurant.id, reservation.id)
    expect(result.status).toBe('ok')

    // The deposit must now be CHARGED in the DB.
    const updated = await prisma.tableReservation.findUnique({
      where: { id: reservation.id },
      select: { depositStatus: true },
    })
    expect(updated?.depositStatus).toBe('charged')

    // Invoice cascade: exactly 2 invoices (PARTNER gross + PLATFORM commission).
    const invoices = await prisma.invoice.findMany({
      where: { tableReservationId: reservation.id },
      include: { invoiceLines: true },
      orderBy: { issuerType: 'asc' },
    })
    expect(invoices).toHaveLength(2)

    const partnerInv = invoices.find((i) => i.issuerType === 'PARTNER')
    const platformInv = invoices.find((i) => i.issuerType === 'PLATFORM')
    expect(partnerInv).toBeDefined()

    // PARTNER invoice is booked GROSS: totalAmount === depositAmount (20).
    expect(partnerInv!.totalAmount).toBeCloseTo(20, 2)
    // totalCharge (base excl. VAT) = round(20 / 1.14) ≈ 17.54
    expect(partnerInv!.totalCharge).toBeCloseTo(20 / 1.14, 1)
    // Single line for the kept deposit.
    expect(partnerInv!.invoiceLines).toHaveLength(1)
    expect(partnerInv!.invoiceLines[0].productCode).toBe('no-show-deposit')
    expect(partnerInv!.invoiceLines[0].amount).toBeCloseTo(20, 2)

    // PLATFORM invoice: `loadFeeContext` bootstraps a default €1.00 fixed fee for
    // 'no-show-deposit' when none exists, so there IS a platform commission invoice.
    // This is the correct agent/marketplace model — the platform always takes a cut
    // when the no-show-deposit is charged.
    expect(platformInv).toBeDefined()
    expect(platformInv!.issuerType).toBe('PLATFORM')
    // Bootstrap fee is €1.00 fixed.
    expect(platformInv!.totalAmount).toBeCloseTo(1.0, 2)
    // Platform invoice has exactly one line (the service fee line).
    expect(platformInv!.invoiceLines).toHaveLength(1)
    expect(platformInv!.invoiceLines[0].productCode).toBe('sunbnb-service-fee')

    // Hash chain integrity: both invoices must have non-empty hashes.
    expect(partnerInv!.hash).toBeTruthy()
    expect(partnerInv!.hash.length).toBeGreaterThan(10)
    expect(platformInv!.hash).toBeTruthy()
  })

  it('idempotent: charging twice does NOT create duplicate invoices', async () => {
    const { user, restaurant, reservation } = await buildDepositScenario(15)
    mockUserId = user.id

    // First charge.
    const r1 = await chargeRestaurantReservationDeposit(restaurant.id, reservation.id)
    expect(r1.status).toBe('ok')

    const afterFirst = await prisma.invoice.count({
      where: { tableReservationId: reservation.id },
    })

    // Second charge (idempotency — deposit is now CHARGED, not HELD so chargeNoShowDeposit
    // is a no-op AND processChargedTableDeposit's inner guard prevents re-invoicing).
    const r2 = await chargeRestaurantReservationDeposit(restaurant.id, reservation.id)
    expect(r2.status).toBe('ok')

    const afterSecond = await prisma.invoice.count({
      where: { tableReservationId: reservation.id },
    })

    // Exactly the same number of invoices — no double-invoicing.
    expect(afterSecond).toBe(afterFirst)
  })

  it('rejects when the caller does not own the restaurant', async () => {
    const { restaurant, reservation } = await buildDepositScenario()
    const attacker = await createTestUser()
    mockUserId = attacker.id

    const result = await chargeRestaurantReservationDeposit(restaurant.id, reservation.id)
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/Not authorized/)

    // No invoices should have been created.
    const invoices = await prisma.invoice.count({
      where: { tableReservationId: reservation.id },
    })
    expect(invoices).toBe(0)
  })

  it('no-op when the booking has no held deposit (depositStatus = none)', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const restaurant = await createTestRestaurant(user.id, { siteId: site.id })
    const table = await createTestTable(restaurant.id)
    // No deposit — plain confirmed reservation.
    const reservation = await createTestTableReservation(restaurant.id, {
      tableId: table.id,
      depositStatus: 'none',
      depositAmount: null,
    })
    mockUserId = user.id

    const result = await chargeRestaurantReservationDeposit(restaurant.id, reservation.id)
    expect(result.status).toBe('ok')

    // depositStatus stays 'none' (chargeNoShowDeposit is a no-op when not HELD).
    const tr = await prisma.tableReservation.findUnique({
      where: { id: reservation.id },
      select: { depositStatus: true },
    })
    expect(tr?.depositStatus).toBe('none')

    // No invoices created.
    const invoices = await prisma.invoice.count({ where: { tableReservationId: reservation.id } })
    expect(invoices).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// modifyRestaurantReservation — availability / double-booking
// ---------------------------------------------------------------------------

describe('modifyRestaurantReservation integration', () => {
  /**
   * Build: User → Restaurant → 2 Tables + 1 existing confirmed reservation on table A.
   */
  async function buildModifyScenario() {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const restaurant = await createTestRestaurant(user.id, { siteId: site.id })
    const tableA = await createTestTable(restaurant.id, { number: 1 })
    const tableB = await createTestTable(restaurant.id, { number: 2 })

    // Reservation occupying tableA from 14:00 to 16:00 UTC tomorrow.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const from = new Date(tomorrow)
    from.setUTCHours(14, 0, 0, 0)
    const to = new Date(tomorrow)
    to.setUTCHours(16, 0, 0, 0)

    const existing = await createTestTableReservation(restaurant.id, {
      tableId: tableA.id,
      from,
      to,
      partySize: 2,
      status: 'confirmed',
      operationalStatus: 'expected',
    })

    return { user, restaurant, tableA, tableB, from, to, existing }
  }

  it('a clean modify (different table, non-overlapping time) succeeds', async () => {
    const { user, restaurant, tableB, from, to, existing } = await buildModifyScenario()
    mockUserId = user.id

    // Move the reservation to tableB — no conflicts.
    const newFrom = new Date(from.getTime() + 2 * 60 * 60 * 1000)
    const newTo = new Date(to.getTime() + 2 * 60 * 60 * 1000)

    const result = await modifyRestaurantReservation(restaurant.id, existing.id, {
      fromIso: newFrom.toISOString(),
      toIso: newTo.toISOString(),
      tableId: tableB.id,
    })
    expect(result.status).toBe('ok')

    // Verify the row was actually updated in the DB.
    const updated = await prisma.tableReservation.findUnique({
      where: { id: existing.id },
      select: { tableId: true, from: true, to: true },
    })
    expect(updated?.tableId).toBe(tableB.id)
  })

  it('BUG-REVEALING: modifying onto an occupied table/slot is REJECTED (no double-booking)', async () => {
    const { user, restaurant, tableA, from, to } = await buildModifyScenario()
    mockUserId = user.id

    // Create a SECOND reservation on tableA at the SAME time window.
    const blocker = await createTestTableReservation(restaurant.id, {
      tableId: tableA.id,
      from,
      to,
      partySize: 2,
      status: 'confirmed',
      operationalStatus: 'expected',
    })

    // Try to move a THIRD reservation onto the already-occupied tableA/slot.
    const victim = await createTestTableReservation(restaurant.id, {
      tableId: (await createTestTable(restaurant.id, { number: 3 })).id,
      from: new Date(from.getTime() + 60 * 60 * 1000),  // overlapping
      to: new Date(to.getTime() + 60 * 60 * 1000),
      partySize: 2,
      status: 'confirmed',
      operationalStatus: 'expected',
    })

    const result = await modifyRestaurantReservation(restaurant.id, victim.id, {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      tableId: tableA.id,
    })

    // The core MUST reject this — if it returns 'ok', that is a real double-booking bug.
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/no longer available|slot/i)

    // The victim reservation must still be on its original table.
    const unchanged = await prisma.tableReservation.findUnique({
      where: { id: victim.id },
      select: { tableId: true },
    })
    expect(unchanged?.tableId).not.toBe(tableA.id)
  })

  it('rejects when the caller does not own the restaurant', async () => {
    const { restaurant, from, to, tableB, existing } = await buildModifyScenario()
    const attacker = await createTestUser()
    mockUserId = attacker.id

    const result = await modifyRestaurantReservation(restaurant.id, existing.id, {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      tableId: tableB.id,
    })
    expect(result.status).toBe('error')
    // The restaurant-level gate fires first.
    expect(result.errors?.[0]).toMatch(/Not authorized/)
  })

  it('rejects a move to the past', async () => {
    const { user, restaurant, tableA, existing } = await buildModifyScenario()
    mockUserId = user.id

    const pastFrom = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const pastTo = new Date(Date.now() - 60 * 60 * 1000)

    const result = await modifyRestaurantReservation(restaurant.id, existing.id, {
      fromIso: pastFrom.toISOString(),
      toIso: pastTo.toISOString(),
      tableId: tableA.id,
    })
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/past/i)
  })
})

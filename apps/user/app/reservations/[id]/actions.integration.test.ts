import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// @/app/api/_lib/payment-ids is NOT mocked — isDemoPayment and isValidEntityId are
// pure format helpers with no DB/side-effects; the real module is safe in integration tests.

vi.mock('@/app/api/_lib/payment-provider', () => ({
  issueRefund: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@repo/data/reservation-emails', () => ({
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}))

// processConfirmedOrder is mocked — invoice creation is covered by unit tests.
// Integration focus here is DB state (ownership, status transitions, anonId).
vi.mock('@repo/data/payment', () => ({
  processConfirmedOrder: vi.fn().mockResolvedValue(undefined),
}))

import { createOrder, cancelReservation, completeUnpaidOrder } from './actions'
import { auth } from '@/app/auth'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import { processConfirmedOrder } from '@repo/data/payment'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestProduct,
  createTestReservation,
  createTestInventoryItem,
} from '@/app/test/fixtures'
import { ORDER_PENDING } from '@repo/data/reservation-status'

const mockAuth = vi.mocked(auth)
const mockIssueRefund = vi.mocked(issueRefund)
const mockProcessConfirmedOrder = vi.mocked(processConfirmedOrder)

beforeEach(async () => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── createOrder ──────────────────────────────────────────────────────────

describe('createOrder', () => {
  it('creates order and order items in DB with prices from DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { appSalesEnabled: true })
    // DB price is 8.00 / totalPrice 9.12 — client cannot override this
    const product = await createTestProduct(site.id, { price: 8.0, totalPrice: 9.12, tax: 14 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await createOrder({
      siteId: site.id,
      items: [{ product: { id: product.id }, quantity: 3 }],
    })

    expect(res.status).toBe('ok')
    expect(res.id).toBeDefined()

    const order = await prisma.order.findUnique({
      where: { id: res.id! },
      include: { orderItems: true },
    })

    expect(order).not.toBeNull()
    expect(order!.orderItems).toHaveLength(1)
    expect(order!.orderItems[0].quantity).toBe(3)
    // Price must come from DB: 8.00 × 3
    expect(order!.price).toBe(24)
    // totalPrice from DB: 9.12 × 3
    expect(order!.totalPrice).toBeCloseTo(27.36, 2)
    expect(order!.status).toBe('pending')
  })

  it('creates order with multiple distinct products', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { appSalesEnabled: true })
    const beer = await createTestProduct(site.id, { name: 'Beer', price: 5.0, totalPrice: 6.0 })
    const water = await createTestProduct(site.id, { name: 'Water', price: 2.0, totalPrice: 2.4 })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await createOrder({
      siteId: site.id,
      items: [
        { product: { id: beer.id }, quantity: 2 },
        { product: { id: water.id }, quantity: 1 },
      ],
    })

    expect(res.status).toBe('ok')
    const order = await prisma.order.findUnique({
      where: { id: res.id! },
      include: { orderItems: true },
    })
    expect(order!.orderItems).toHaveLength(2)
    // 5.0×2 + 2.0×1 = 12
    expect(order!.price).toBe(12)
  })

  it('rejects sold-out product (verified against real DB soldOut field)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { appSalesEnabled: true })
    const product = await createTestProduct(site.id, { soldOut: true })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await createOrder({
      siteId: site.id,
      items: [{ product: { id: product.id }, quantity: 1 }],
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('sold out')
    // Verify no order was written
    const count = await prisma.order.count({ where: { siteId: site.id } })
    expect(count).toBe(0)
  })

  it('rejects order when site has appSalesEnabled=false', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { appSalesEnabled: false })
    const product = await createTestProduct(site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await createOrder({
      siteId: site.id,
      items: [{ product: { id: product.id }, quantity: 1 }],
    })

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
  })

  it('stores anonId and uses site owner userId for anonymous orders', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { appSalesEnabled: true })
    const product = await createTestProduct(site.id)

    // No session
    const res = await createOrder({
      siteId: site.id,
      anonId: 'anon-xyz',
      items: [{ product: { id: product.id }, quantity: 1 }],
    })

    expect(res.status).toBe('ok')
    const order = await prisma.order.findUnique({ where: { id: res.id! } })
    expect(order!.anonId).toBe('anon-xyz')
    expect(order!.userId).toBe(owner.id)
  })
})

// ─── completeUnpaidOrder ──────────────────────────────────────────────────

describe('completeUnpaidOrder', () => {
  async function createPendingOrder(
    userId: string,
    siteId: string,
    overrides: Record<string, any> = {}
  ) {
    return prisma.order.create({
      data: {
        userId,
        siteId,
        status: ORDER_PENDING,
        price: 10,
        tax: 1,
        totalPrice: 11,
        paymentAmount: 11,
        ...overrides,
      },
    })
  }

  it('sets paymentRef and processes invoice for authenticated user', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'unpaid' })
    const order = await createPendingOrder(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await completeUnpaidOrder(order.id)

    expect(res.status).toBe('ok')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated!.paymentRef).toBe(`offplatform_${order.id}`)
    expect(mockProcessConfirmedOrder).toHaveBeenCalledWith(order.id)
  })

  it('allows anonymous user to complete their unpaid order via anonId', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { type: 'unpaid' })
    // Anonymous order: userId is site owner (FK constraint), anonId identifies customer
    const order = await createPendingOrder(owner.id, site.id, { anonId: 'anon-cust-1' })

    // No session — anonymous user provides their anonId
    const res = await completeUnpaidOrder(order.id, 'anon-cust-1')

    expect(res.status).toBe('ok')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated!.paymentRef).toBe(`offplatform_${order.id}`)
  })

  it('rejects anonymous user when anonId does not match order', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { type: 'unpaid' })
    const order = await createPendingOrder(owner.id, site.id, { anonId: 'anon-real' })

    const res = await completeUnpaidOrder(order.id, 'anon-wrong')

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    // Order must remain unchanged
    const unchanged = await prisma.order.findUnique({ where: { id: order.id } })
    expect(unchanged!.paymentRef).toBeNull()
    expect(unchanged!.status).toBe(ORDER_PENDING)
  })

  it('rejects unauthenticated user with no anonId', async () => {
    const owner = await createTestUser()
    const site = await createTestSite(owner.id, { type: 'unpaid' })
    const order = await createPendingOrder(owner.id, site.id, { anonId: 'anon-123' })

    // No session, no anonId passed
    const res = await completeUnpaidOrder(order.id)

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('rejects when site requires payment', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'paid' })
    const order = await createPendingOrder(user.id, site.id)

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await completeUnpaidOrder(order.id)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Payment is required')
    const unchanged = await prisma.order.findUnique({ where: { id: order.id } })
    expect(unchanged!.paymentRef).toBeNull()
  })

  it('rejects when order is not in pending state', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { type: 'unpaid' })
    const order = await createPendingOrder(user.id, site.id, { status: 'complete' })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await completeUnpaidOrder(order.id)

    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not in pending state')
  })
})

// ─── cancelReservation ────────────────────────────────────────────────────

describe('cancelReservation', () => {
  it('updates reservation status to canceled in DB', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'pending',
      paymentRef: null,
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelReservation(reservation.id)

    expect(res.status).toBe('ok')
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(updated!.status).toBe('canceled')
  })

  it('does not issue refund for demo payment', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentRef: 'pi_demo_1234567890',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelReservation(reservation.id)

    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(updated!.status).toBe('canceled')
  })

  it('issues refund and cancels for a real paid reservation', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'complete',
      paymentRef: 'pi_real_stripe_ref',
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelReservation(reservation.id)

    expect(res.status).toBe('ok')
    expect(mockIssueRefund).toHaveBeenCalledWith('pi_real_stripe_ref')
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(updated!.status).toBe('canceled')
  })

  it('returns ok without a DB update when already canceled', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    const item = await createTestInventoryItem(user.id, site.id)
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      status: 'canceled',
      paymentRef: null,
    })

    mockAuth.mockResolvedValue({ user: { id: user.id } } as any)

    const res = await cancelReservation(reservation.id)

    expect(res.status).toBe('ok')
    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.status).toBe('canceled')
  })

  it('does not cancel a reservation owned by a different user', async () => {
    const owner = await createTestUser()
    const attacker = await createTestUser()
    const site = await createTestSite(owner.id)
    const item = await createTestInventoryItem(owner.id, site.id)
    const reservation = await createTestReservation(owner.id, site.id, [item.id], {
      status: 'pending',
      paymentRef: null,
    })

    // Attacker tries to cancel owner's reservation
    mockAuth.mockResolvedValue({ user: { id: attacker.id } } as any)

    const res = await cancelReservation(reservation.id)

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.status).toBe('pending')
  })
})

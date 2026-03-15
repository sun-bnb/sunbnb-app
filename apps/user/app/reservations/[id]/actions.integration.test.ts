import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/api/_lib/stripe', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  issueRefund: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@repo/data/reservation-emails', () => ({
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { createOrder, cancelReservation } from './actions'
import { auth } from '@/app/auth'
import { issueRefund } from '@/app/api/_lib/payment-provider'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import {
  createTestUser,
  createTestSite,
  createTestProduct,
  createTestReservation,
  createTestInventoryItem,
} from '@/app/test/fixtures'

const mockAuth = vi.mocked(auth)
const mockIssueRefund = vi.mocked(issueRefund)

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
    // Status unchanged
    const unchanged = await prisma.reservation.findUnique({ where: { id: reservation.id } })
    expect(unchanged!.status).toBe('canceled')
  })
})

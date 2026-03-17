import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/api/_lib/stripe', () => ({
  isDemoPayment: (ref: string | null) => ref?.startsWith('pi_demo_') ?? false,
  isValidEntityId: () => true,
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  issueRefund: vi.fn().mockResolvedValue(undefined),
}))

import {
  cancelReservation,
  getProducts,
  createOrder,
  completeUnpaidOrder,
  getOrderByPaymentRef,
  getOrders,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { processConfirmedOrder } from '@repo/data/payment'
import { issueRefund } from '@/app/api/_lib/payment-provider'

const mockAuth = vi.mocked(auth)
const mockIssueRefund = vi.mocked(issueRefund)
const mockProcessOrder = vi.mocked(processConfirmedOrder)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── cancelReservation ─────────────────────────────────────────────────────

describe('cancelReservation', () => {
  it('returns error when not authenticated', async () => {
    const res = await cancelReservation('res-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('returns error when reservation not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(null)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
  })

  it('returns error when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-2',
      status: 'complete',
      paymentRef: null,
    } as any)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns ok immediately when already canceled', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
      status: 'canceled',
      paymentRef: null,
    } as any)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('ok')
    expect(prisma.reservation.update).not.toHaveBeenCalled()
  })

  it('issues refund for real paid reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
      status: 'complete',
      paymentRef: 'pi_real_123',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('ok')
    expect(mockIssueRefund).toHaveBeenCalledWith('pi_real_123')
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      data: { status: 'canceled' },
      where: { id: 'res-1' },
    })
  })

  it('does not refund demo payments', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
      status: 'complete',
      paymentRef: 'pi_demo_123',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
  })

  it('does not refund pending reservations', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
      status: 'pending',
      paymentRef: 'pi_real_123',
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('ok')
    expect(mockIssueRefund).not.toHaveBeenCalled()
  })

  it('returns error when refund fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
      status: 'complete',
      paymentRef: 'pi_real_123',
    } as any)
    mockIssueRefund.mockRejectedValue(new Error('Stripe error'))

    const res = await cancelReservation('res-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Refund failed')
    expect(prisma.reservation.update).not.toHaveBeenCalled()
  })
})

// ─── getProducts ───────────────────────────────────────────────────────────

describe('getProducts', () => {
  it('returns active products for site', async () => {
    const products = [{ id: 'p-1', name: 'Beer', active: true }]
    vi.mocked(prisma.product.findMany).mockResolvedValue(products as any)

    const result = await getProducts('site-1')
    expect(result).toEqual(products)
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { siteId: 'site-1', active: true },
    })
  })
})

// ─── createOrder ───────────────────────────────────────────────────────────

describe('createOrder', () => {
  it('returns error when siteId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await createOrder({
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('siteId')
  })

  it('returns error when items is empty', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await createOrder({ siteId: 'site-1', items: [] })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('At least one item')
  })

  it('returns error when too many distinct items', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const items = Array.from({ length: 51 }, (_, i) => ({
      product: { id: `p-${i}` },
      quantity: 1,
    }))
    const res = await createOrder({ siteId: 'site-1', items })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Too many')
  })

  it('returns error for invalid quantity (zero)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 0 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid item quantity')
  })

  it('returns error for non-integer quantity', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1.5 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Invalid item quantity')
  })

  it('returns error when total quantity exceeds 200', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 201 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('exceeds limit')
  })

  it('returns error when site not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(null)

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Site not found')
  })

  it('returns error when site has sales disabled', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: false,
    } as any)

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not available')
  })

  it('returns error when not authenticated and no anonId', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('returns error when product is sold out', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 'p-1', name: 'Beer', price: 5, totalPrice: 6, tax: 24, soldOut: true } as any,
    ])

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('sold out')
  })

  it('returns error when product not found or inactive', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([]) // no products found

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not found or not active')
  })

  it('creates order with DB prices (ignores client prices)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      {
        id: 'p-1',
        name: 'Beer',
        price: 5,
        totalPrice: 6.2,
        tax: 24,
        category: 'drinks',
        soldOut: false,
      } as any,
    ])
    vi.mocked(prisma.order.create).mockResolvedValue({ id: 'order-1' } as any)

    const res = await createOrder({
      siteId: 'site-1',
      items: [{ product: { id: 'p-1' }, quantity: 3 }],
    })

    expect(res.status).toBe('ok')
    expect(res.id).toBe('order-1')
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 15, // 5 × 3
          totalPrice: 18.6, // 6.2 × 3
          paymentAmount: 18.6,
          status: 'pending',
        }),
      })
    )
  })

  it('verifies reservation ownership when reservationId provided', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-2', // different user
      anonId: null,
      siteId: 'site-1',
    } as any)

    const res = await createOrder({
      siteId: 'site-1',
      reservationId: 'res-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('supports anonymous orders with anonId', async () => {
    // No session
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: 'owner-1',
      appSalesEnabled: true,
    } as any)
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 'p-1', name: 'Beer', price: 5, totalPrice: 6, tax: 24, soldOut: false } as any,
    ])
    vi.mocked(prisma.order.create).mockResolvedValue({ id: 'order-1' } as any)

    const res = await createOrder({
      siteId: 'site-1',
      anonId: 'anon-1',
      items: [{ product: { id: 'p-1' }, quantity: 1 }],
    })

    expect(res.status).toBe('ok')
    // Should use site owner's userId for FK
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          anonId: 'anon-1',
          user: { connect: { id: 'owner-1' } },
        }),
      })
    )
  })
})

// ─── completeUnpaidOrder ───────────────────────────────────────────────────

describe('completeUnpaidOrder', () => {
  it('returns error when order not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Order not found')
  })

  it('returns error when site requires payment', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'pending',
      site: { type: 'paid', orderPaymentType: null },
    } as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Payment is required')
  })

  it('returns error when not authenticated', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'pending',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Authentication required')
  })

  it('returns error when user does not own order', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-2',
      status: 'pending',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns error when order is not pending', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'complete',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('not in pending state')
  })

  it('completes unpaid order and processes invoices', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'pending',
      reservationId: 'res-1',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('ok')
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentRef: 'offplatform_order-1' },
    })
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
  })

  it('falls back to setting complete status when invoice creation fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'pending',
      reservationId: 'res-1',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)
    mockProcessOrder.mockRejectedValue(new Error('DB error'))

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('ok')
    // First call: set paymentRef, second call: fallback to complete
    expect(prisma.order.update).toHaveBeenCalledTimes(2)
    expect(prisma.order.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1' },
      data: { status: 'complete' },
    })
  })

  // BUG: completeUnpaidOrder doesn't accept anonId, so anonymous orders created via
  // createOrder (which supports anonId) can never be completed without payment.
  // The function should accept anonId and check order.anonId like createOrder does.
  it('allows anonymous user to complete their unpaid order via anonId', async () => {
    // No session — anonymous user
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'owner-1', // site owner's userId (FK constraint from createOrder)
      anonId: 'anon-1',
      status: 'pending',
      reservationId: 'res-1',
      site: { type: 'unpaid', orderPaymentType: null },
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    // This should succeed when anonId matches order.anonId
    // Bug: completeUnpaidOrder didn't accept anonId — always returned "Authentication required"
    const res = await completeUnpaidOrder('order-1', 'anon-1')
    expect(res.status).not.toBe('error')
  })

  it('uses orderPaymentType over site.type', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      status: 'pending',
      reservationId: null,
      site: { type: 'paid', orderPaymentType: 'unpaid' }, // orderPaymentType overrides
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await completeUnpaidOrder('order-1')
    expect(res.status).toBe('ok')
  })
})

// ─── getOrderByPaymentRef ──────────────────────────────────────────────────

describe('getOrderByPaymentRef', () => {
  it('returns error when not authenticated', async () => {
    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
  })

  it('returns error when user does not own order', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findFirst).mockResolvedValue({
      id: 'order-1',
      userId: 'user-2',
    } as any)

    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ status: 'error', errors: ['Not authorized'] })
  })

  it('returns order when user owns it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const order = { id: 'order-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.order.findFirst).mockResolvedValue(order as any)

    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ order })
  })

  // BUG: Returns bare entity on success but { status, errors } on error — inconsistent
  // Should wrap in { order } or { status: 'ok', order } like getReservationById wraps in { reservation }
  it('wraps successful result consistently (not bare entity)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const order = { id: 'order-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.order.findFirst).mockResolvedValue(order as any)

    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    // Should have a wrapper property, not be a bare entity
    expect(res).toHaveProperty('order')
  })
})

// ─── getOrders ─────────────────────────────────────────────────────────────

describe('getOrders', () => {
  it('returns error when not authenticated', async () => {
    const res = await getOrders({ reservationId: 'res-1' })
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
  })

  it('returns error when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-2',
    } as any)

    const res = await getOrders({ reservationId: 'res-1' })
    expect(res).toEqual({ status: 'error', errors: ['Not authorized'] })
  })

  it('returns orders with items and invoices', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
    } as any)
    const orders = [{ id: 'order-1', orderItems: [], invoices: [] }]
    vi.mocked(prisma.order.findMany).mockResolvedValue(orders as any)

    const res = await getOrders({ reservationId: 'res-1' })
    expect(res).toEqual({ orders })
  })

  // BUG: Returns bare array on success but { status, errors } on error — inconsistent
  // Should wrap in { orders } or { status: 'ok', orders } for consistent return type
  it('wraps successful result consistently (not bare array)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      userId: 'user-1',
    } as any)
    const orders = [{ id: 'order-1', orderItems: [], invoices: [] }]
    vi.mocked(prisma.order.findMany).mockResolvedValue(orders as any)

    const res = await getOrders({ reservationId: 'res-1' })
    // Should have a wrapper property, not be a bare array
    expect(res).toHaveProperty('orders')
  })
})

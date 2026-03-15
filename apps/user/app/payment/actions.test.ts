import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  // Must set before module import — DEMO_MODE_ENABLED is captured at load time
  process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
})

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

import {
  initiateDemoReservationPayment,
  initiateDemoOrderPayment,
  initiateDemoRentalPayment,
  getReservationById,
  getReservationByPaymentRef,
  getOrderByPaymentRef,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
} from '@repo/data/payment'

const mockAuth = vi.mocked(auth)
const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)
const mockProcessRentalBooking = vi.mocked(processConfirmedRentalBooking)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── initiateDemoReservationPayment ────────────────────────────────────────

describe('initiateDemoReservationPayment', () => {

  it('returns error when reservation not found', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue(null)

    const res = await initiateDemoReservationPayment('res-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Reservation not found')
  })

  it('returns error when session user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'user-2',
      anonId: null,
      paymentRef: null,
    } as any)

    const res = await initiateDemoReservationPayment('res-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns error when anonId does not match', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'user-1',
      anonId: 'anon-1',
      paymentRef: null,
    } as any)

    const res = await initiateDemoReservationPayment('res-1', 'wrong-anon')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns existing paymentRef when already set (idempotent)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'user-1',
      anonId: null,
      paymentRef: 'pi_demo_existing',
    } as any)

    const res = await initiateDemoReservationPayment('res-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toBe('pi_demo_existing')
    expect(prisma.reservation.update).not.toHaveBeenCalled()
  })

  it('creates demo payment and processes reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'user-1',
      anonId: null,
      paymentRef: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await initiateDemoReservationPayment('res-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toMatch(/^pi_demo_/)
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: expect.objectContaining({
        status: 'processing',
        paymentRef: expect.stringMatching(/^pi_demo_/),
      }),
    })
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('allows anonymous user with matching anonId', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'owner-1',
      anonId: 'anon-1',
      paymentRef: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)

    const res = await initiateDemoReservationPayment('res-1', 'anon-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toMatch(/^pi_demo_/)
  })

  it('still returns ok when processConfirmedReservation fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
      id: 'res-1',
      userId: 'user-1',
      anonId: null,
      paymentRef: null,
    } as any)
    vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
    mockProcessReservation.mockRejectedValue(new Error('DB error'))

    const res = await initiateDemoReservationPayment('res-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toMatch(/^pi_demo_/)
  })
})

// ─── initiateDemoOrderPayment ──────────────────────────────────────────────

describe('initiateDemoOrderPayment', () => {
  it('returns error when order not found', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)

    const res = await initiateDemoOrderPayment('order-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Order not found')
  })

  it('returns error when session user does not own order', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-2',
      anonId: null,
      paymentRef: null,
    } as any)

    const res = await initiateDemoOrderPayment('order-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns existing paymentRef when already set', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      anonId: null,
      paymentRef: 'pi_demo_existing',
    } as any)

    const res = await initiateDemoOrderPayment('order-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toBe('pi_demo_existing')
  })

  it('creates demo payment and processes order', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      anonId: null,
      paymentRef: null,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await initiateDemoOrderPayment('order-1')
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toMatch(/^pi_demo_/)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
  })

  it('allows anonymous user with matching anonId', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      userId: 'owner-1',
      anonId: 'anon-1',
      paymentRef: null,
    } as any)
    vi.mocked(prisma.order.update).mockResolvedValue({} as any)

    const res = await initiateDemoOrderPayment('order-1', 'anon-1')
    expect(res.status).toBe('ok')
  })
})

// ─── initiateDemoRentalPayment ─────────────────────────────────────────────

describe('initiateDemoRentalPayment', () => {
  it('returns error when no booking IDs provided', async () => {
    const res = await initiateDemoRentalPayment([])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('No booking IDs')
  })

  it('returns error when some bookings not found', async () => {
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1' } as any,
    ]) // only 1 of 2 found

    const res = await initiateDemoRentalPayment(['rb-1', 'rb-2'])
    expect(res.status).toBe('error')
    expect(res.errors?.[0]).toContain('Some bookings not found')
  })

  it('returns error when not authenticated', async () => {
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', userId: 'user-1', paymentRef: null } as any,
    ])

    const res = await initiateDemoRentalPayment(['rb-1'])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('returns error when user does not own all bookings', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', userId: 'user-1', paymentRef: null } as any,
      { id: 'rb-2', userId: 'user-2', paymentRef: null } as any,
    ])

    const res = await initiateDemoRentalPayment(['rb-1', 'rb-2'])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('returns existing paymentRef when already set', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', userId: 'user-1', paymentRef: 'pi_demo_existing' } as any,
    ])

    const res = await initiateDemoRentalPayment(['rb-1'])
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toBe('pi_demo_existing')
  })

  it('creates demo payment and processes rental bookings', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', userId: 'user-1', paymentRef: null } as any,
      { id: 'rb-2', userId: 'user-1', paymentRef: null } as any,
    ])
    vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 2 } as any)

    const res = await initiateDemoRentalPayment(['rb-1', 'rb-2'])
    expect(res.status).toBe('ok')
    expect(res.paymentRef).toMatch(/^pi_demo_/)
    expect(prisma.rentalBooking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['rb-1', 'rb-2'] } },
      data: expect.objectContaining({
        status: 'processing',
        paymentRef: expect.stringMatching(/^pi_demo_/),
      }),
    })
    expect(mockProcessRentalBooking).toHaveBeenCalled()
  })
})

// ─── Query Actions ─────────────────────────────────────────────────────────

describe('getReservationById', () => {
  it('returns error when not authenticated', async () => {
    const res = await getReservationById({ id: 'res-1' })
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
  })

  it('returns error when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: 'res-1',
      userId: 'user-2',
    } as any)

    const res = await getReservationById({ id: 'res-1' })
    expect(res).toEqual({ status: 'error', errors: ['Not authorized'] })
  })

  it('returns reservation when user owns it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const reservation = { id: 'res-1', userId: 'user-1' }
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any)

    const res = await getReservationById({ id: 'res-1' })
    expect(res).toEqual({ reservation })
  })

  it('returns null reservation when not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)

    const res = await getReservationById({ id: 'res-1' })
    expect(res).toEqual({ reservation: null })
  })
})

describe('getReservationByPaymentRef', () => {
  it('returns error when not authenticated', async () => {
    const res = await getReservationByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
  })

  it('returns error when user does not own reservation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
      id: 'res-1',
      userId: 'user-2',
    } as any)

    const res = await getReservationByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ status: 'error', errors: ['Not authorized'] })
  })

  it('returns reservation when user owns it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const reservation = { id: 'res-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any)

    const res = await getReservationByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ reservation })
  })

  // BUG: Returns bare entity on success but { status, errors } on error.
  // getReservationById wraps in { reservation } — this should too for consistency.
  it('wraps successful result in { reservation } like getReservationById', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const reservation = { id: 'res-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(reservation as any)

    const res = await getReservationByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toHaveProperty('reservation')
  })
})

describe('getOrderByPaymentRef (payment actions)', () => {
  it('returns error when not authenticated', async () => {
    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ status: 'error', errors: ['Not authenticated'] })
  })

  it('returns order when user owns it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const order = { id: 'order-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.order.findFirst).mockResolvedValue(order as any)

    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toEqual({ order })
  })

  // BUG: Returns bare entity on success but { status, errors } on error.
  // Should wrap in { order } like getReservationById wraps in { reservation }.
  it('wraps successful result in { order } for consistency', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    const order = { id: 'order-1', userId: 'user-1', paymentRef: 'pi_test' }
    vi.mocked(prisma.order.findFirst).mockResolvedValue(order as any)

    const res = await getOrderByPaymentRef({ paymentRef: 'pi_test' })
    expect(res).toHaveProperty('order')
  })
})

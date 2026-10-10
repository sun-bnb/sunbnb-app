import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/payment-provider', () => ({
  getPaymentStatus: vi.fn(),
  isPaymentSucceeded: (s: string) => s === 'paid' || s === 'succeeded',
  isPaymentFailed: (s: string) => ['canceled', 'expired', 'failed'].includes(s),
}))

vi.mock('@/app/api/_lib/payment-events', () => ({
  findPaymentEntity: vi.fn(),
  onPaymentState: vi.fn().mockResolvedValue(undefined),
}))

import { POST, GET } from './route'
import prisma from '@repo/data/PrismaCient'
import { applyTransition } from '@repo/data/reservation-machine-apply'
import { processConfirmedReservation, processConfirmedOrder } from '@repo/data/payment'
import { getPaymentStatus } from '@/app/api/_lib/payment-provider'
import { findPaymentEntity, onPaymentState } from '@/app/api/_lib/payment-events'

const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)
const mockGetPaymentStatus = vi.mocked(getPaymentStatus)
const mockFindEntity = vi.mocked(findPaymentEntity)
const mockOnState = vi.mocked(onPaymentState)

function makeRequest(secret?: string, method = 'POST') {
  const headers: Record<string, string> = {}
  if (secret) {
    headers['authorization'] = `Bearer ${secret}`
  }
  return new NextRequest('http://localhost:3002/api/reconcile', {
    method,
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RECONCILIATION_SECRET = 'test-secret'
  delete process.env.CRON_SECRET
  vi.mocked(prisma.reservation.findMany).mockResolvedValue([])
  vi.mocked(prisma.order.findMany).mockResolvedValue([])
  vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableTab.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableReservation.findMany).mockResolvedValue([])
  mockGetPaymentStatus.mockResolvedValue('paid')
})

describe('POST /api/reconcile', () => {
  it('returns 503 when RECONCILIATION_SECRET is not configured', async () => {
    delete process.env.RECONCILIATION_SECRET
    const res = await POST(makeRequest('anything'))
    expect(res.status).toBe(503)
  })

  it('returns 401 when authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header has wrong secret', async () => {
    const res = await POST(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns ok with empty results when no stuck payments', async () => {
    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checked.reservations).toBe(0)
    expect(body.checked.orders).toBe(0)
  })

  it('processes a stuck reservation whose payment succeeded (incl. demo)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'pi_demo_123', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('succeeded')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
    const body = await res.json()
    expect(body.results.reservations.processed).toBe(1)
  })

  it('marks a stuck reservation as failed when the payment failed', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'tr_abc', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('canceled')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    // Machine pay.fail (track 018): the revert (online → payment_failed,
    // collect → unsettled cash) is state-derived inside the interpreter.
    expect(vi.mocked(applyTransition)).toHaveBeenCalledWith('res-1', 'pay.fail')
  })

  it('leaves a still-pending reservation untouched', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'tr_abc', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('pending')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(prisma.reservation.update).not.toHaveBeenCalled()
  })

  it('processes a stuck order whose payment succeeded', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      { id: 'order-1', paymentRef: 'tr_def', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('paid')

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
    const body = await res.json()
    expect(body.results.orders.processed).toBe(1)
  })

  it('counts errors when processing fails', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'pi_demo_123', status: 'processing' } as any,
    ])
    mockGetPaymentStatus.mockResolvedValue('succeeded')
    mockProcessReservation.mockRejectedValue(new Error('DB error'))

    const res = await POST(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results.reservations.errors).toBe(1)
  })
})

describe('reconcile auth (cron)', () => {
  it('accepts CRON_SECRET when RECONCILIATION_SECRET is unset', async () => {
    delete process.env.RECONCILIATION_SECRET
    process.env.CRON_SECRET = 'cron-secret'
    const res = await POST(makeRequest('cron-secret'))
    expect(res.status).toBe(200)
  })

  it('accepts either secret when both are set, rejects others', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await POST(makeRequest('cron-secret'))).status).toBe(200)
    expect((await POST(makeRequest('test-secret'))).status).toBe(200)
    expect((await POST(makeRequest('nope'))).status).toBe(401)
  })

  it('returns 503 only when neither secret is configured', async () => {
    delete process.env.RECONCILIATION_SECRET
    expect((await POST(makeRequest('x'))).status).toBe(503)
  })

  it('GET behaves like POST (Vercel cron issues GET)', async () => {
    vi.mocked(prisma.reservation.findMany).mockResolvedValue([
      { id: 'res-1', paymentRef: 'tr_abc', status: 'processing' } as any,
    ])
    const res = await GET(makeRequest('test-secret', 'GET'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
    expect((await GET(makeRequest(undefined, 'GET'))).status).toBe(401)
  })
})

describe('reconcile — rentals, tabs, deposits', () => {
  const cases = [
    {
      key: 'rentals' as const,
      model: () => prisma.rentalBooking,
      row: { id: 'rb-1', paymentRef: 'tr_rb', status: 'processing' },
      meta: { type: 'rental-booking', entityId: 'rb-1', bookingIds: ['rb-1', 'rb-2'] },
    },
    {
      key: 'tabs' as const,
      model: () => prisma.tableTab,
      row: { id: 'tab-1', paymentRef: 'tr_tab', status: 'pending_payment' },
      meta: { type: 'tab', entityId: 'tab-1' },
    },
    {
      key: 'deposits' as const,
      model: () => prisma.tableReservation,
      row: { id: 'td-1', paymentRef: 'tr_td', depositStatus: 'pending' },
      meta: { type: 'table-deposit', entityId: 'td-1' },
    },
  ]

  for (const c of cases) {
    it(`${c.key}: confirms a paid stuck entity via onPaymentState`, async () => {
      vi.mocked(c.model().findMany as any).mockResolvedValue([c.row])
      mockFindEntity.mockResolvedValue(c.meta as any)
      mockGetPaymentStatus.mockResolvedValue('paid')

      const body = await (await POST(makeRequest('test-secret'))).json()
      expect(mockOnState).toHaveBeenCalledWith(c.meta, c.row.paymentRef, 'paid')
      expect(body.results[c.key].processed).toBe(1)
      expect(body.checked[c.key]).toBe(1)
    })

    // Rentals are deliberately paid-only: see the dedicated test below.
    it.skipIf(c.key === 'rentals')(`${c.key}: fails an expired stuck entity`, async () => {
      vi.mocked(c.model().findMany as any).mockResolvedValue([c.row])
      mockFindEntity.mockResolvedValue(c.meta as any)
      mockGetPaymentStatus.mockResolvedValue('expired')

      const body = await (await POST(makeRequest('test-secret'))).json()
      expect(mockOnState).toHaveBeenCalledWith(c.meta, c.row.paymentRef, 'failed')
      expect(body.results[c.key].failed).toBe(1)
    })

    it(`${c.key}: leaves a pending one alone`, async () => {
      vi.mocked(c.model().findMany as any).mockResolvedValue([c.row])
      mockGetPaymentStatus.mockResolvedValue('open')

      const body = await (await POST(makeRequest('test-secret'))).json()
      expect(mockOnState).not.toHaveBeenCalled()
      expect(body.results[c.key]).toEqual({ processed: 0, failed: 0, errors: 0 })
    })

    it(`${c.key}: skips demo and viva_ refs`, async () => {
      vi.mocked(c.model().findMany as any).mockResolvedValue([
        { ...c.row, paymentRef: 'pi_demo_1' },
        { ...c.row, paymentRef: 'viva_abc' },
      ])
      await POST(makeRequest('test-secret'))
      expect(mockGetPaymentStatus).not.toHaveBeenCalled()
    })
  }

  it('leaves a failed/expired rental untouched (collect-vs-online context lives in webhook/poll)', async () => {
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', paymentRef: 'tr_rb', status: 'processing' } as any,
    ])
    mockFindEntity.mockResolvedValue({ type: 'rental-booking', entityId: 'rb-1', bookingIds: ['rb-1'] })
    for (const st of ['expired', 'failed', 'canceled']) {
      mockGetPaymentStatus.mockResolvedValue(st)
      const body = await (await POST(makeRequest('test-secret'))).json()
      expect(body.results.rentals).toEqual({ processed: 0, failed: 0, errors: 0 })
    }
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('sweeps a rental payment group once, not once per booking', async () => {
    vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
      { id: 'rb-1', paymentRef: 'tr_grp' } as any,
      { id: 'rb-2', paymentRef: 'tr_grp' } as any,
    ])
    mockFindEntity.mockResolvedValue({ type: 'rental-booking', entityId: 'rb-1', bookingIds: ['rb-1', 'rb-2'] })
    await POST(makeRequest('test-secret'))
    expect(mockOnState).toHaveBeenCalledTimes(1)
  })

  it('an error in one item does not stop the rest of the sweep', async () => {
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([
      { id: 'tab-1', paymentRef: 'tr_a' } as any,
      { id: 'tab-2', paymentRef: 'tr_b' } as any,
    ])
    vi.mocked(prisma.tableReservation.findMany).mockResolvedValue([
      { id: 'td-1', paymentRef: 'tr_c' } as any,
    ])
    mockFindEntity.mockImplementation(async (ref) => (({
      type: ref === 'tr_c' ? 'table-deposit' : 'tab',
      entityId: ref
    }) as any))
    mockOnState.mockRejectedValueOnce(new Error('boom'))

    const body = await (await POST(makeRequest('test-secret'))).json()
    expect(body.results.tabs).toEqual({ processed: 1, failed: 0, errors: 1 })
    expect(body.results.deposits.processed).toBe(1)
  })

  it('counts an error when no entity owns the ref', async () => {
    vi.mocked(prisma.tableTab.findMany).mockResolvedValue([{ id: 'tab-1', paymentRef: 'tr_a' } as any])
    mockFindEntity.mockResolvedValue(null)
    const body = await (await POST(makeRequest('test-secret'))).json()
    expect(body.results.tabs.errors).toBe(1)
    expect(mockOnState).not.toHaveBeenCalled()
  })
})

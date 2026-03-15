import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

const mockMollieGet = vi.fn()
vi.mock('@/app/api/_lib/mollie', () => ({
  getMollieClientForPartner: () => ({
    payments: { get: mockMollieGet },
  }),
  isMolliePayment: (ref: string | null) => ref?.startsWith('tr_') ?? false,
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
} from '@repo/data/payment'

const mockProcessReservation = vi.mocked(processConfirmedReservation)
const mockProcessOrder = vi.mocked(processConfirmedOrder)
const mockProcessRentalBooking = vi.mocked(processConfirmedRentalBooking)

function makeWebhookRequest(paymentId?: string) {
  const formBody = paymentId ? `id=${paymentId}` : ''
  return new NextRequest('http://localhost:3002/api/webhooks/mollie', {
    method: 'POST',
    body: formBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()

  // Default: reservation lookup returns partner token
  vi.mocked(prisma.reservation.findFirst).mockResolvedValue({
    site: {
      user: {
        partnerAccount: { mollieAccessToken: 'access_test' },
      },
    },
  } as any)
  vi.mocked(prisma.order.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.rentalBooking.findFirst).mockResolvedValue(null)
})

describe('POST /api/webhooks/mollie', () => {
  it('returns 400 when payment id is missing', async () => {
    const req = new NextRequest('http://localhost:3002/api/webhooks/mollie', {
      method: 'POST',
      body: '',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid payment id format', async () => {
    const res = await POST(makeWebhookRequest('invalid_id'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('format')
  })

  it('returns 400 for SQL injection attempt in payment id', async () => {
    const res = await POST(makeWebhookRequest("tr_'; DROP TABLE--"))
    expect(res.status).toBe(400)
  })

  it('returns 200 when partner access token not found', async () => {
    vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  it('processes paid reservation', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).toHaveBeenCalledWith('res-1')
  })

  it('processes paid order', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'order',
        entityId: 'order-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessOrder).toHaveBeenCalledWith('order-1')
  })

  it('processes paid rental-booking', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: JSON.stringify({
        type: 'rental-booking',
        entityId: 'booking-1',
        siteId: 'site-1',
        bookingIds: ['booking-1', 'booking-2'],
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessRentalBooking).toHaveBeenCalledWith('tr_abc123')
  })

  it('marks reservation as payment_failed on failed status', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'failed',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('marks reservation as payment_failed on expired status', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'expired',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'payment_failed' },
    })
  })

  it('marks reservation as refunded', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'refunded',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })
    vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { status: 'refunded' },
    })
  })

  it('ignores non-terminal statuses (open, pending)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'open',
      metadata: JSON.stringify({
        type: 'reservation',
        entityId: 'res-1',
        siteId: 'site-1',
      }),
    })

    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled()
  })

  it('returns 500 when Mollie payment fetch fails (triggers retry)', async () => {
    mockMollieGet.mockRejectedValue(new Error('Mollie API error'))
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(500)
  })

  it('returns 200 when metadata is missing (nothing to do)', async () => {
    mockMollieGet.mockResolvedValue({
      status: 'paid',
      metadata: null,
    })
    const res = await POST(makeWebhookRequest('tr_abc123'))
    expect(res.status).toBe(200)
    expect(mockProcessReservation).not.toHaveBeenCalled()
  })
})

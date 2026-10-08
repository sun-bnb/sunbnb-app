import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockFind, mockOnState, mockGetTx } = vi.hoisted(() => ({
  mockFind: vi.fn(),
  mockOnState: vi.fn(),
  mockGetTx: vi.fn(),
}))
vi.mock('@/app/api/_lib/payment-events', () => ({ findPaymentEntity: mockFind, onPaymentState: mockOnState }))
vi.mock('@repo/data/viva', () => ({ getVivaCheckoutClient: () => ({ getTransaction: mockGetTx }) }))

import prisma from '@repo/data/PrismaCient'
import { GET } from './route'

const CODE = '1234567890123456'
const req = (qs: string) => new NextRequest(`http://localhost:3002/api/payment/viva/return?${qs}`)
const loc = (r: Response) => {
  const u = new URL(r.headers.get('location')!)
  return u.pathname + u.search
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOnState.mockResolvedValue(undefined)
})

describe('GET /api/payment/viva/return', () => {
  it.each(['abc', '123', '1'.repeat(21), ''])('rejects bad s=%s without lookups', async (s) => {
    const res = await GET(req(`s=${s}&t=tx1`))
    expect(res.status).toBe(302)
    expect(loc(res)).toBe('/?payment=unknown')
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockGetTx).not.toHaveBeenCalled()
  })

  it('rejects a malformed t without lookups', async () => {
    const res = await GET(req(`s=${CODE}&t=${encodeURIComponent('a/b')}`))
    expect(loc(res)).toBe('/?payment=unknown')
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('unknown entity -> /?payment=unknown, no state change', async () => {
    mockFind.mockResolvedValue(null)
    const res = await GET(req(`s=${CODE}&t=tx1`))
    expect(loc(res)).toBe('/?payment=unknown')
    expect(mockFind).toHaveBeenCalledWith(`vso_${CODE}`)
    expect(mockGetTx).not.toHaveBeenCalled()
  })

  it('reservation -> /payment/complete with anonId', async () => {
    mockFind.mockResolvedValue({ type: 'reservation', entityId: 'r1' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ anonId: 'anon-1' } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/payment/complete?reservationId=r1&anonId=anon-1')
  })

  it('reservation without anonId omits it', async () => {
    mockFind.mockResolvedValue({ type: 'reservation', entityId: 'r1' })
    vi.mocked(prisma.reservation.findUnique).mockResolvedValue({ anonId: null } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/payment/complete?reservationId=r1')
  })

  it('rental-booking -> /payment/complete/rental', async () => {
    mockFind.mockResolvedValue({ type: 'rental-booking', entityId: 'b1' })
    vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({ anonId: 'a' } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/payment/complete/rental?rentalBookingId=b1&anonId=a')
  })

  it('order with a reservation -> /reservations/<id>?anonId&orderId', async () => {
    mockFind.mockResolvedValue({ type: 'order', entityId: 'o1' })
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ reservationId: 'r9', anonId: 'a' } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/reservations/r9?anonId=a&orderId=o1')
  })

  it('order without a reservation -> /payment/complete?orderId', async () => {
    mockFind.mockResolvedValue({ type: 'order', entityId: 'o1' })
    vi.mocked(prisma.order.findUnique).mockResolvedValue({ reservationId: null, anonId: null } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/payment/complete?orderId=o1')
  })

  it('tab -> /tables/<tableId>?tabReturn', async () => {
    mockFind.mockResolvedValue({ type: 'tab', entityId: 'tab1' })
    vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({ tableId: 't7' } as never)
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/tables/t7?tabReturn=tab1')
  })

  it('table-deposit -> /table-reservations/<id>', async () => {
    mockFind.mockResolvedValue({ type: 'table-deposit', entityId: 'tr1' })
    expect(loc(await GET(req(`s=${CODE}`)))).toBe('/table-reservations/tr1')
  })

  describe('confirmation', () => {
    const meta = { type: 'table-deposit', entityId: 'tr1' }
    beforeEach(() => mockFind.mockResolvedValue(meta))

    it('matching paid transaction -> onPaymentState paid', async () => {
      mockGetTx.mockResolvedValue({ state: 'paid', orderCode: CODE })
      await GET(req(`s=${CODE}&t=tx1`))
      expect(mockGetTx).toHaveBeenCalledWith('tx1')
      expect(mockOnState).toHaveBeenCalledWith(meta, `vso_${CODE}`, 'paid')
    })

    it('mismatched orderCode -> no state change', async () => {
      mockGetTx.mockResolvedValue({ state: 'paid', orderCode: '9999999999999999' })
      const res = await GET(req(`s=${CODE}&t=tx1`))
      expect(mockOnState).not.toHaveBeenCalled()
      expect(loc(res)).toBe('/table-reservations/tr1')
    })

    it('non-paid transaction -> no state change', async () => {
      mockGetTx.mockResolvedValue({ state: 'pending', orderCode: CODE })
      await GET(req(`s=${CODE}&t=tx1`))
      expect(mockOnState).not.toHaveBeenCalled()
    })

    it('transaction fetch error still redirects', async () => {
      mockGetTx.mockRejectedValue(new Error('boom'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = await GET(req(`s=${CODE}&t=tx1`))
      expect(loc(res)).toBe('/table-reservations/tr1')
      expect(mockOnState).not.toHaveBeenCalled()
    })

    it('no t -> no fetch', async () => {
      await GET(req(`s=${CODE}`))
      expect(mockGetTx).not.toHaveBeenCalled()
    })
  })
})

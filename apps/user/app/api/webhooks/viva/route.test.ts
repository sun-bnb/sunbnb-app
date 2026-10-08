import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockFind, mockOnState, mockGetTx } = vi.hoisted(() => ({
  mockFind: vi.fn(),
  mockOnState: vi.fn(),
  mockGetTx: vi.fn(),
}))
vi.mock('@/app/api/_lib/payment-events', () => ({ findPaymentEntity: mockFind, onPaymentState: mockOnState }))
vi.mock('@repo/data/viva', () => ({ getVivaCheckoutClient: () => ({ getTransaction: mockGetTx }) }))

import { GET, POST } from './route'

const CODE = '1234567890123456'
const META = { type: 'reservation', entityId: 'r1' }
const post = (body: unknown) =>
  new NextRequest('http://localhost:3002/api/webhooks/viva', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const event = (id: number, orderCode: number | string = Number(CODE)) => ({
  EventTypeId: id,
  EventData: { TransactionId: 'tx-1', OrderCode: orderCode, StatusId: 'F' },
})

beforeEach(() => {
  vi.clearAllMocks()
  mockFind.mockResolvedValue(META)
  mockOnState.mockResolvedValue(undefined)
})
afterEach(() => {
  delete process.env.VIVA_WEBHOOK_VERIFICATION_KEY
})

describe('GET /api/webhooks/viva', () => {
  it('returns the verification key', async () => {
    process.env.VIVA_WEBHOOK_VERIFICATION_KEY = 'k-1'
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ Key: 'k-1' })
  })
  it('503 when unset', async () => {
    expect((await GET()).status).toBe(503)
  })
})

describe('POST /api/webhooks/viva', () => {
  it('acts only after re-fetch, using the re-fetched state', async () => {
    const order: string[] = []
    mockGetTx.mockImplementation(async () => {
      order.push('fetch')
      return { state: 'paid', orderCode: CODE }
    })
    mockOnState.mockImplementation(async () => {
      order.push('state')
    })
    const res = await POST(post(event(1796)))
    expect(res.status).toBe(200)
    expect(order).toEqual(['fetch', 'state'])
    expect(mockGetTx).toHaveBeenCalledWith('tx-1')
    expect(mockOnState).toHaveBeenCalledWith(META, `vso_${CODE}`, 'paid')
  })

  it('body says paid but re-fetch is pending -> no call', async () => {
    mockGetTx.mockResolvedValue({ state: 'pending', orderCode: CODE })
    expect((await POST(post(event(1796)))).status).toBe(200)
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('re-fetched state wins over the event type (1798 but actually paid -> paid)', async () => {
    mockGetTx.mockResolvedValue({ state: 'paid', orderCode: CODE })
    await POST(post(event(1798)))
    expect(mockOnState).toHaveBeenCalledWith(META, `vso_${CODE}`, 'paid')
  })

  it('orderCode mismatch -> no call', async () => {
    mockGetTx.mockResolvedValue({ state: 'paid', orderCode: '9999999999999999' })
    await POST(post(event(1796)))
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('1798 -> failed', async () => {
    mockGetTx.mockResolvedValue({ state: 'failed', orderCode: CODE })
    await POST(post(event(1798)))
    expect(mockOnState).toHaveBeenCalledWith(META, `vso_${CODE}`, 'failed')
  })

  it('1797 -> refunded', async () => {
    mockGetTx.mockResolvedValue({ state: 'refunded', orderCode: CODE })
    await POST(post(event(1797)))
    expect(mockOnState).toHaveBeenCalledWith(META, `vso_${CODE}`, 'refunded')
  })

  it('unknown event type -> 200 without fetching', async () => {
    const res = await POST(post(event(1234)))
    expect(res.status).toBe(200)
    expect(mockGetTx).not.toHaveBeenCalled()
  })

  it('unknown entity -> 200 ignore', async () => {
    mockGetTx.mockResolvedValue({ state: 'paid', orderCode: CODE })
    mockFind.mockResolvedValue(null)
    expect((await POST(post(event(1796)))).status).toBe(200)
    expect(mockOnState).not.toHaveBeenCalled()
  })

  it('malformed bodies -> 400', async () => {
    expect((await POST(post('not json'))).status).toBe(400)
    expect((await POST(post({}))).status).toBe(400)
    expect((await POST(post({ EventTypeId: 1796, EventData: { TransactionId: 'a/b', OrderCode: 1 } }))).status).toBe(400)
    expect((await POST(post({ EventTypeId: 1796, EventData: { TransactionId: 'ok', OrderCode: 'x' } }))).status).toBe(400)
    expect(mockGetTx).not.toHaveBeenCalled()
  })

  it('handler error -> 500 (Viva retries)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetTx.mockResolvedValue({ state: 'paid', orderCode: CODE })
    mockOnState.mockRejectedValue(new Error('db'))
    expect((await POST(post(event(1796)))).status).toBe(500)
  })
})

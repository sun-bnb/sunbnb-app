import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the OAuth token authority and env probe so the module never touches the DB.
vi.mock('./mollie-tokens', () => ({
  getValidMollieToken: vi.fn().mockResolvedValue('test-token'),
}))
vi.mock('./env', () => ({
  isTestMode: vi.fn().mockReturnValue(false),
}))

import { issueReservationRefund } from './refund'
import { getValidMollieToken } from './mollie-tokens'

const PA = 'partner-account-1'

function mockFetchSequence(...responses: Array<{ ok: boolean; status?: number; body?: any; text?: string }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 422),
      json: async () => r.body ?? {},
      text: async () => r.text ?? '',
    })
  }
  global.fetch = fn as any
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getValidMollieToken).mockResolvedValue('test-token')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('issueReservationRefund — non-network branches', () => {
  it('errors when paymentRef is missing', async () => {
    const fetchSpy = mockFetchSequence()
    const res = await issueReservationRefund(null, PA)
    expect(res).toEqual({ status: 'error', error: 'No payment to refund' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is a no-op success for demo payments (no token, no fetch)', async () => {
    const fetchSpy = mockFetchSequence()
    const res = await issueReservationRefund('pi_demo_123', PA)
    expect(res).toEqual({ status: 'ok', provider: 'demo' })
    expect(getValidMollieToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('errors for an unrecognized provider ref', async () => {
    const res = await issueReservationRefund('xyz_999', PA)
    expect(res.status).toBe('error')
    expect((res as any).error).toMatch(/unknown payment provider/i)
  })

  it('errors when no partner account is resolved for a Mollie payment', async () => {
    const res = await issueReservationRefund('tr_abc', null)
    expect(res).toEqual({ status: 'error', error: 'Cannot find partner account for payment' })
    expect(getValidMollieToken).not.toHaveBeenCalled()
  })

  it('surfaces a token-refresh failure as an error', async () => {
    vi.mocked(getValidMollieToken).mockRejectedValueOnce(new Error('Mollie must be reconnected'))
    const res = await issueReservationRefund('tr_abc', PA)
    expect(res).toEqual({ status: 'error', error: 'Mollie must be reconnected' })
  })
})

describe('issueReservationRefund — Mollie path', () => {
  it('looks up the payment then creates a full refund', async () => {
    const fetchSpy = mockFetchSequence(
      { ok: true, body: { amount: { value: '25.00', currency: 'EUR' } } }, // GET payment
      { ok: true, body: { id: 're_1', status: 'pending' } }, // POST refund
    )

    const res = await issueReservationRefund('tr_abc', PA)

    expect(res).toEqual({ status: 'ok', provider: 'mollie' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    // GET payment with bearer token
    expect(fetchSpy.mock.calls[0][0]).toContain('/payments/tr_abc')
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token')
    // POST refund echoes the payment amount
    expect(fetchSpy.mock.calls[1][0]).toContain('/payments/tr_abc/refunds')
    expect(fetchSpy.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
      amount: { value: '25.00', currency: 'EUR' },
    })
  })

  it('errors when the payment lookup fails', async () => {
    mockFetchSequence({ ok: false })
    const res = await issueReservationRefund('tr_abc', PA)
    expect(res.status).toBe('error')
    expect((res as any).error).toMatch(/payment lookup failed/i)
  })

  it('errors when the payment has no refundable amount', async () => {
    mockFetchSequence({ ok: true, body: { amount: null } })
    const res = await issueReservationRefund('tr_abc', PA)
    expect(res.status).toBe('error')
    expect((res as any).error).toMatch(/no refundable amount/i)
  })

  it('errors when the refund creation fails', async () => {
    mockFetchSequence(
      { ok: true, body: { amount: { value: '25.00', currency: 'EUR' } } },
      { ok: false, text: 'rejected' },
    )
    const res = await issueReservationRefund('tr_abc', PA)
    expect(res.status).toBe('error')
    expect((res as any).error).toMatch(/refund failed/i)
  })

  it('returns an actionable reconnect message on 403 (missing refunds.write scope)', async () => {
    mockFetchSequence(
      { ok: true, body: { amount: { value: '25.00', currency: 'EUR' } } },
      { ok: false, status: 403, text: '{"detail":"Not all required permissions (refunds.write) ..."}' },
    )
    const res = await issueReservationRefund('tr_abc', PA)
    expect(res.status).toBe('error')
    expect((res as any).error).toMatch(/reconnect mollie/i)
    expect((res as any).error).not.toMatch(/403/)
    expect((res as any).reason).toBe('permission')
  })
})

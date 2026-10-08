/**
 * Tests for POST /api/payment/create (track 028 P1e) — the neutral dispatcher for
 * non-Mollie providers. Provider is resolved server-side from the entity's site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAuth, mockCreate, mockClaim, mockRelease, mockFlag } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockClaim: vi.fn(),
  mockRelease: vi.fn(),
  mockFlag: vi.fn(),
}))

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: mockFlag }))
vi.mock('@repo/data/checkout', () => ({
  createOnlineCheckout: mockCreate,
  claimTabForPayment: mockClaim,
  releaseTabClaim: mockRelease,
}))

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'

const RES_ID = 'clxk0000000000000000000001'
const TAB_ID = 'clxk0000000000000000000002'
const ANON = '11111111-1111-4111-8111-111111111111'
const REDIRECT = 'https://app.sunbnb.app/payment/complete'
process.env.APP_URL = 'https://app.sunbnb.app'
process.env.NEXT_PUBLIC_BASE_URL = 'https://app.sunbnb.app'

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3002/api/payment/create', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const resBody = { kind: 'reservation', reservationId: RES_ID, anonId: ANON, redirectUrl: REDIRECT }
const tabBody = { kind: 'tab', tabId: TAB_ID, redirectUrl: REDIRECT }

function site(provider: string) {
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ paymentProvider: provider } as any)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAuth.mockResolvedValue(null)
  mockFlag.mockResolvedValue(true)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    id: RES_ID, userId: 'u1', anonId: ANON, siteId: 'site-1',
  } as any)
  vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({ siteId: 'site-1', restaurant: null } as any)
  site('viva')
  mockClaim.mockResolvedValue('claimed')
  mockCreate.mockResolvedValue({ status: 'ok', checkoutUrl: 'https://pay.test/x', paymentRef: 'viva_1' })
})

describe('POST /api/payment/create', () => {
  it('rejects an unknown kind', async () => {
    expect((await POST(req({ ...resBody, kind: 'bogus' }))).status).toBe(400)
  })
  it('rejects an invalid entity id', async () => {
    expect((await POST(req({ ...resBody, reservationId: 'nope!!' }))).status).toBe(400)
  })
  it('rejects a foreign redirect origin', async () => {
    const res = await POST(req({ ...resBody, redirectUrl: 'https://evil.example.com/x' }))
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
  it('401 without identity', async () => {
    expect((await POST(req({ ...resBody, anonId: undefined }))).status).toBe(401)
  })
  it('403 when not the owner', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    const res = await POST(req({ ...resBody, anonId: other }))
    expect(res.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
  it('400 "Use the Mollie endpoint" for a Mollie site, checkout not called', async () => {
    site('mollie')
    const res = await POST(req(resBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Use the Mollie endpoint')
    expect(mockCreate).not.toHaveBeenCalled()
  })
  it('ignores a provider supplied in the body', async () => {
    site('mollie')
    const res = await POST(req({ ...resBody, provider: 'stripe' }))
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
  it('maps provider_unavailable to 503', async () => {
    mockCreate.mockResolvedValue({ status: 'error', reason: 'provider_unavailable', error: 'internal detail' })
    const res = await POST(req(resBody))
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('internal detail')
  })
  it.each([
    ['invalid_amount', 400], ['not_found', 404], ['bad_state', 409],
    ['provider_not_ready', 400], ['provider_error', 502], ['no_checkout', 502],
  ])('maps %s to %i', async (reason, status) => {
    mockCreate.mockResolvedValue({ status: 'error', reason, error: 'x' })
    expect((await POST(req(resBody))).status).toBe(status)
  })
  it('200 with checkoutUrl and paymentRef', async () => {
    const res = await POST(req(resBody))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checkoutUrl: 'https://pay.test/x', paymentRef: 'viva_1' })
  })
  it.each([['viva', '/api/webhooks/viva'], ['stripe', '/api/webhooks/stripe-connect']])(
    'uses the %s webhook path',
    async (provider, path) => {
      site(provider)
      await POST(req(resBody))
      const input = mockCreate.mock.calls[0]![0]
      expect(input.provider).toBe(provider)
      expect(new URL(input.webhookUrl).pathname).toBe(path)
    },
  )

  describe('tab', () => {
    it('409 when a payment is already in progress; checkout not called', async () => {
      mockClaim.mockResolvedValue('in_progress')
      const res = await POST(req(tabBody))
      expect(res.status).toBe(409)
      expect(mockCreate).not.toHaveBeenCalled()
    })
    it.each([['not_found', 404], ['closed', 409], ['invalid', 409]])('claim %s -> %i', async (c, s) => {
      mockClaim.mockResolvedValue(c)
      expect((await POST(req(tabBody))).status).toBe(s)
    })
    it('needs no identity (QR credential) and succeeds', async () => {
      const res = await POST(req(tabBody))
      expect(res.status).toBe(200)
      expect(mockClaim).toHaveBeenCalledWith(TAB_ID)
    })
    it('releases the claim when the venue is on Mollie', async () => {
      site('mollie')
      const res = await POST(req(tabBody))
      expect(res.status).toBe(400)
      expect(mockRelease).toHaveBeenCalledWith(TAB_ID)
      expect(mockCreate).not.toHaveBeenCalled()
    })
    it('standalone restaurant tab uses the PartnerAccount provider (viva)', async () => {
      vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
        siteId: null,
        restaurant: { siteId: null, partnerAccount: { paymentProvider: 'viva' } },
      } as any)
      const res = await POST(req(tabBody))
      expect(res.status).toBe(200)
      expect(mockCreate.mock.calls[0]![0].provider).toBe('viva')
      expect(prisma.site.findUnique).not.toHaveBeenCalled()
    })
    it('standalone restaurant with no selection falls back to Mollie (400, claim released)', async () => {
      vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
        siteId: null,
        restaurant: { siteId: null, partnerAccount: { paymentProvider: null } },
      } as any)
      const res = await POST(req(tabBody))
      expect(res.status).toBe(400)
      expect(mockRelease).toHaveBeenCalledWith(TAB_ID)
    })
    it('standalone restaurant table-deposit uses the PartnerAccount provider (stripe)', async () => {
      vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
        userId: null,
        anonId: ANON,
        restaurant: { siteId: null, partnerAccount: { paymentProvider: 'stripe' } },
      } as any)
      const res = await POST(req({ kind: 'table-deposit', tableReservationId: RES_ID, anonId: ANON, redirectUrl: REDIRECT }))
      expect(res.status).toBe(200)
      expect(mockCreate.mock.calls[0]![0].provider).toBe('stripe')
    })
    it('releases the claim on a non-provider_error failure', async () => {
      mockCreate.mockResolvedValue({ status: 'error', reason: 'provider_unavailable', error: 'x' })
      await POST(req(tabBody))
      expect(mockRelease).toHaveBeenCalledWith(TAB_ID)
    })
    it('does not double-release on provider_error (createOnlineCheckout already did)', async () => {
      mockCreate.mockResolvedValue({ status: 'error', reason: 'provider_error', error: 'x' })
      await POST(req(tabBody))
      expect(mockRelease).not.toHaveBeenCalled()
    })
    it('does not claim when redirect origin is invalid', async () => {
      await POST(req({ ...tabBody, redirectUrl: 'https://evil.example.com' }))
      expect(mockClaim).not.toHaveBeenCalled()
    })
  })

  it('table-deposit is gated by the restaurants flag', async () => {
    mockFlag.mockResolvedValue(false)
    const res = await POST(req({ kind: 'table-deposit', tableReservationId: RES_ID, anonId: ANON, redirectUrl: REDIRECT }))
    expect(res.status).toBe(404)
  })
})

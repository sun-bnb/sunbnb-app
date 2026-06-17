/**
 * Tests for POST /api/subscription/portal
 *
 * Covers: auth gate, no billing account, scope isolation, happy path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/app/api/_lib/stripe', () => ({
  getStripeClient: vi.fn(),
}))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { NextRequest } from 'next/server'

const mockAuth = vi.mocked(auth)
const mockGetStripeClient = vi.mocked(getStripeClient)
const mockSubscriptionFindUnique = vi.mocked(prisma.subscription.findUnique)

const USER_ID = 'user-1'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/subscription/portal', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
  })
}

function makePortalStripe(portalUrl: string = 'https://billing.stripe.com/portal/ses_test') {
  const mockCreate = vi.fn().mockResolvedValue({ url: portalUrl })
  return {
    stripe: {
      billingPortal: { sessions: { create: mockCreate } },
    } as any,
    mockCreate,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  const { stripe } = makePortalStripe()
  mockGetStripeClient.mockReturnValue(stripe)
})

describe('POST /api/subscription/portal', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
  })

  // ── No billing account ────────────────────────────────────────────────────────

  it('returns 400 when no subscription record exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue(null)

    const response = await POST(makeRequest())
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('No billing account found')
  })

  it('returns 400 when subscription exists but stripeCustomerId is null', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: null } as any)

    const response = await POST(makeRequest())
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('No billing account found')
  })

  // ── Scope isolation ───────────────────────────────────────────────────────────

  it('scopes the subscription query to session.user.id — cannot open another user\'s portal', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue(null)

    await POST(makeRequest())

    expect(mockSubscriptionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerAccountId: USER_ID } }),
    )
  })

  // ── Happy path ────────────────────────────────────────────────────────────────

  it('creates a Stripe billing portal session for the partner\'s Stripe customer', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_test_456' } as any)
    const { stripe, mockCreate } = makePortalStripe('https://billing.stripe.com/portal/ses_live')
    mockGetStripeClient.mockReturnValue(stripe)

    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toContain('billing.stripe.com/portal/ses_live')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_test_456' }),
    )
  })

  it('includes a return_url pointing back to the subscription management page', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' } as any)
    const { stripe, mockCreate } = makePortalStripe()
    mockGetStripeClient.mockReturnValue(stripe)

    await POST(makeRequest())

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        return_url: expect.stringContaining('/account/subscription'),
      }),
    )
  })
})

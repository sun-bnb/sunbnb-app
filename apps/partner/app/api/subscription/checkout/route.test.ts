/**
 * Tests for POST /api/subscription/checkout
 *
 * Covers: auth gate, planId validation, plan existence, STARTER guard,
 * new customer + checkout session, existing subscription → portal redirect,
 * existing customer without a subscription → checkout session.
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
const mockSubscriptionPlanFindUnique = vi.mocked(prisma.subscriptionPlan.findUnique)
const mockPartnerAccountFindUnique = vi.mocked(prisma.partnerAccount.findUnique)
const mockSubscriptionUpdate = vi.mocked(prisma.subscription.update)

const USER_ID = 'user-1'

const PRO_PLAN = {
  id: 'plan-pro',
  tier: 'PRO',
  stripePriceId: 'price_pro_monthly',
}

const STARTER_PLAN = {
  id: 'plan-starter',
  tier: 'STARTER',
  stripePriceId: 'price_free',
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/subscription/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** Build a full Stripe mock with controllable methods. */
function makeStripeClient(overrides: {
  customersCreate?: ReturnType<typeof vi.fn>
  checkoutCreate?: ReturnType<typeof vi.fn>
  portalCreate?: ReturnType<typeof vi.fn>
} = {}) {
  return {
    customers: {
      create:
        overrides.customersCreate ??
        vi.fn().mockResolvedValue({ id: 'cus_new_123' }),
    },
    checkout: {
      sessions: {
        create:
          overrides.checkoutCreate ??
          vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' }),
      },
    },
    billingPortal: {
      sessions: {
        create:
          overrides.portalCreate ??
          vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/portal/ses_test' }),
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockGetStripeClient.mockReturnValue(makeStripeClient() as any)
  mockSubscriptionPlanFindUnique.mockResolvedValue(PRO_PLAN as any)
  mockSubscriptionFindUnique.mockResolvedValue(null)
  mockPartnerAccountFindUnique.mockResolvedValue({
    email: 'partner@example.com',
    firstName: 'Jan',
    lastName: 'Jansen',
  } as any)
  mockSubscriptionUpdate.mockResolvedValue({} as any)
})

describe('POST /api/subscription/checkout', () => {
  // ── Auth gate ────────────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    const response = await POST(makeRequest({ planId: 'plan-pro' }))
    expect(response.status).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Not authenticated')
  })

  // ── Input validation ──────────────────────────────────────────────────────────

  it('returns 400 when planId is absent from the request body', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('planId is required')
  })

  it('returns 400 when plan does not exist in DB', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionPlanFindUnique.mockResolvedValue(null)
    const response = await POST(makeRequest({ planId: 'nonexistent-plan' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Plan not available for purchase')
  })

  it('returns 400 when plan exists but has no stripePriceId', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionPlanFindUnique.mockResolvedValue({
      id: 'plan-pro',
      tier: 'PRO',
      stripePriceId: null,
    } as any)
    const response = await POST(makeRequest({ planId: 'plan-pro' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Plan not available for purchase')
  })

  it('returns 400 when plan tier is STARTER (free tier cannot be purchased via checkout)', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionPlanFindUnique.mockResolvedValue(STARTER_PLAN as any)
    const response = await POST(makeRequest({ planId: 'plan-starter' }))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Cannot purchase the free plan')
  })

  // ── Happy path: new customer, no existing subscription ───────────────────────

  it('creates a new Stripe customer when no existing subscription exists', async () => {
    mockAuth.mockResolvedValue({
      user: { id: USER_ID, email: 'user@example.com', name: 'Jan Jansen' },
    } as any)
    mockSubscriptionFindUnique.mockResolvedValue(null)
    const stripe = makeStripeClient()
    mockGetStripeClient.mockReturnValue(stripe as any)

    await POST(makeRequest({ planId: 'plan-pro' }))

    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { partnerAccountId: USER_ID } }),
    )
  })

  it('creates a Stripe Checkout Session in subscription mode for a new customer', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID, email: 'u@e.com' } } as any)
    mockSubscriptionFindUnique.mockResolvedValue(null)
    const stripe = makeStripeClient()
    mockGetStripeClient.mockReturnValue(stripe as any)

    const response = await POST(makeRequest({ planId: 'plan-pro' }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toContain('checkout.stripe.com')

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_pro_monthly', quantity: 1 }],
        metadata: expect.objectContaining({ partnerAccountId: USER_ID, planId: 'plan-pro' }),
      }),
    )
  })

  // ── Existing subscription with active Stripe subscription ID ─────────────────

  it('returns the billing portal URL when partner already has an active Stripe subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_existing_active',
    } as any)
    const stripe = makeStripeClient()
    mockGetStripeClient.mockReturnValue(stripe as any)

    const response = await POST(makeRequest({ planId: 'plan-pro' }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toContain('billing.stripe.com')

    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    )
    // Must not create a new checkout session
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  // ── Existing subscription record but no Stripe subscription yet ──────────────

  it('uses existing stripeCustomerId and creates checkout session when no active subscription', async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID } } as any)
    mockSubscriptionFindUnique.mockResolvedValue({
      stripeCustomerId: 'cus_existing_no_sub',
      stripeSubscriptionId: null, // customer exists but no subscription yet
    } as any)
    const stripe = makeStripeClient()
    mockGetStripeClient.mockReturnValue(stripe as any)

    const response = await POST(makeRequest({ planId: 'plan-pro' }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.url).toContain('checkout.stripe.com')

    // Must NOT create another customer
    expect(stripe.customers.create).not.toHaveBeenCalled()
    // Checkout session uses the existing customer
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing_no_sub' }),
    )
  })
})

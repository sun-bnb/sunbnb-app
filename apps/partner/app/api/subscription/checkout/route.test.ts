/**
 * Tests for POST /api/subscription/checkout (retired by CR-002).
 *
 * No tier bills monthly: the route must refuse every plan and never touch
 * Stripe, even when a plan row still carries a stripePriceId.
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
const mockPlanFindUnique = vi.mocked(prisma.subscriptionPlan.findUnique)

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/subscription/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

describe('POST /api/subscription/checkout', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await POST(makeRequest({ planId: 'plan-x' }))
    expect(response.status).toBe(401)
  })

  it('returns 400 when planId is absent', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } } as any)
    const response = await POST(makeRequest({}))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('planId is required')
  })

  it('returns 400 when the plan does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } } as any)
    mockPlanFindUnique.mockResolvedValue(null)
    const response = await POST(makeRequest({ planId: 'nope' }))
    expect(response.status).toBe(400)
  })

  it.each(['GRATIS', 'TEMPORADA', 'GRUPO'])(
    'refuses %s with a 400 even when the plan row has a stripePriceId, and never calls Stripe',
    async (tier) => {
      mockAuth.mockResolvedValue({ user: { id: 'u1', email: 'u@e.com' } } as any)
      mockPlanFindUnique.mockResolvedValue({ id: `plan-${tier}`, tier, stripePriceId: 'price_leftover' } as any)
      const response = await POST(makeRequest({ planId: `plan-${tier}` }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('no monthly subscription')
      expect(getStripeClient).not.toHaveBeenCalled()
    },
  )
})

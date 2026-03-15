import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/_lib/stripe', () => ({
  getStripeClient: vi.fn(),
}))

vi.hoisted(() => {
  process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET = 'whsec_test'
})

import { POST } from './route'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { syncStripeSubscription, handleSubscriptionCanceled } from '@repo/data/subscription'
import { NextRequest } from 'next/server'

const mockGetStripeClient = vi.mocked(getStripeClient)
const mockSyncSubscription = vi.mocked(syncStripeSubscription)
const mockHandleCanceled = vi.mocked(handleSubscriptionCanceled)

function makeRequest(body: string, signature?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'text/plain' }
  if (signature) headers['stripe-signature'] = signature
  return new NextRequest('http://localhost/api/subscription/webhook', {
    method: 'POST',
    body,
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/subscription/webhook', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const request = makeRequest('{}')
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Missing stripe-signature header')
  })

  it('returns 400 when signature verification fails', async () => {
    mockGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error('Invalid signature')
        }),
      },
    } as any)

    const request = makeRequest('{}', 'sig_bad')
    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Invalid signature')
  })

  it('handles subscription.created event', async () => {
    const subscription = {
      id: 'sub_123',
      status: 'active',
      metadata: { partnerAccountId: 'partner-1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
      customer: 'cus_123',
      current_period_start: 1700000000,
      current_period_end: 1702592000,
    }

    mockGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'customer.subscription.created',
          data: { object: subscription },
        }),
      },
    } as any)

    const request = makeRequest('{}', 'sig_valid')
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(mockSyncSubscription).toHaveBeenCalledWith(
      'sub_123',
      'cus_123',
      'price_pro',
      'ACTIVE',
      expect.any(Date),
      expect.any(Date),
      'partner-1',
    )
  })

  it('handles subscription.deleted event (downgrade)', async () => {
    mockGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: 'sub_123',
              metadata: { partnerAccountId: 'partner-1' },
            },
          },
        }),
      },
    } as any)

    const request = makeRequest('{}', 'sig_valid')
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(mockHandleCanceled).toHaveBeenCalledWith('partner-1')
  })

  it('skips subscription.deleted when missing partnerAccountId', async () => {
    mockGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_123', metadata: {} } },
        }),
      },
    } as any)

    const request = makeRequest('{}', 'sig_valid')
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(mockHandleCanceled).not.toHaveBeenCalled()
  })

  it('maps stripe statuses correctly', async () => {
    const testCases = [
      { stripeStatus: 'active', expected: 'ACTIVE' },
      { stripeStatus: 'trialing', expected: 'ACTIVE' },
      { stripeStatus: 'past_due', expected: 'PAST_DUE' },
      { stripeStatus: 'unpaid', expected: 'PAST_DUE' },
      { stripeStatus: 'canceled', expected: 'CANCELED' },
      { stripeStatus: 'incomplete_expired', expected: 'CANCELED' },
    ]

    for (const { stripeStatus, expected } of testCases) {
      vi.clearAllMocks()

      mockGetStripeClient.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn().mockReturnValue({
            type: 'customer.subscription.updated',
            data: {
              object: {
                id: 'sub_test',
                status: stripeStatus,
                metadata: { partnerAccountId: 'partner-1' },
                items: { data: [{ price: { id: 'price_1' } }] },
                customer: 'cus_1',
                current_period_start: 1700000000,
                current_period_end: 1702592000,
              },
            },
          }),
        },
      } as any)

      const request = makeRequest('{}', 'sig_valid')
      await POST(request)

      expect(mockSyncSubscription).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expected,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
    }
  })

  it('returns 500 when handler throws', async () => {
    mockGetStripeClient.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_err',
              status: 'active',
              metadata: { partnerAccountId: 'partner-1' },
              items: { data: [{ price: { id: 'price_1' } }] },
              customer: 'cus_1',
              current_period_start: 1700000000,
              current_period_end: 1702592000,
            },
          },
        }),
      },
    } as any)

    mockSyncSubscription.mockRejectedValue(new Error('DB error'))

    const request = makeRequest('{}', 'sig_valid')
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})

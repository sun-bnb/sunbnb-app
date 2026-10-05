import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_lib/stripe', () => ({ getStripeClient: vi.fn() }))

import { GET } from './route'
import { getStripeClient } from '@/app/api/_lib/stripe'
import { listPromotionsForPlanSync } from '@repo/data/promotion-db'

const endsAt = new Date('2027-07-10T10:00:00Z')
const wanted = Math.floor(endsAt.getTime() / 1000)
const req = (auth = 'Bearer s3cret') => new Request('http://x/api/cron/sync-promotion-trials', { headers: { authorization: auth } })

function stripeWith(subs: Record<string, { status: string; trial_end: number | null } | Error>) {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        const v = subs[id]
        if (v instanceof Error) throw v
        return v
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 's3cret'
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/sync-promotion-trials', () => {
  it('fails closed without CRON_SECRET and rejects a wrong secret', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req())).status).toBe(503)
    process.env.CRON_SECRET = 's3cret'
    expect((await GET(req('Bearer nope'))).status).toBe(401)
  })

  it('extends a trial that ends before the promotion; leaves aligned and cancelled ones alone', async () => {
    vi.mocked(listPromotionsForPlanSync).mockResolvedValue([
      { partnerAccountId: 'p1', endsAt, stripeSubscriptionId: 'sub_short' },
      { partnerAccountId: 'p2', endsAt, stripeSubscriptionId: 'sub_aligned' },
      { partnerAccountId: 'p3', endsAt, stripeSubscriptionId: 'sub_cancelled' },
      { partnerAccountId: 'p4', endsAt, stripeSubscriptionId: 'sub_active_paid' },
    ])
    const stripe = stripeWith({
      sub_short: { status: 'trialing', trial_end: wanted - 86_400 },
      sub_aligned: { status: 'trialing', trial_end: wanted },
      sub_cancelled: { status: 'canceled', trial_end: null },
      sub_active_paid: { status: 'active', trial_end: null }, // paying already: put back into a free period
    })
    vi.mocked(getStripeClient).mockReturnValue(stripe as any)

    const body = await (await GET(req())).json()

    expect(body).toEqual({ checked: 4, extended: 2, failures: 0 })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_short', { trial_end: wanted, proration_behavior: 'none' })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_active_paid', { trial_end: wanted, proration_behavior: 'none' })
    expect(stripe.subscriptions.update).not.toHaveBeenCalledWith('sub_aligned', expect.anything())
  })

  it("one partner's Stripe error doesn't stop the rest", async () => {
    vi.mocked(listPromotionsForPlanSync).mockResolvedValue([
      { partnerAccountId: 'p1', endsAt, stripeSubscriptionId: 'sub_err' },
      { partnerAccountId: 'p2', endsAt, stripeSubscriptionId: 'sub_short' },
    ])
    const stripe = stripeWith({ sub_err: new Error('stripe down'), sub_short: { status: 'trialing', trial_end: null } })
    vi.mocked(getStripeClient).mockReturnValue(stripe as any)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await (await GET(req())).json()).toEqual({ checked: 2, extended: 1, failures: 1 })
  })
})

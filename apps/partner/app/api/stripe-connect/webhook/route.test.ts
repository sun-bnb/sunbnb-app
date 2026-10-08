import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'
import { getStripeConnectClient } from '@repo/data/stripe'
import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'

const constructEvent = vi.fn()
const retrieve = vi.fn()
const findUnique = vi.mocked(prisma.partnerAccount.findUnique)
const update = vi.mocked(prisma.partnerAccount.update)

function req(sig: string | null = 'sig') {
  const headers: Record<string, string> = {}
  if (sig) headers['stripe-signature'] = sig
  return new NextRequest('http://localhost/api/stripe-connect/webhook', { method: 'POST', body: '{}', headers })
}

const account = {
  id: 'acct_1',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  business_type: 'company',
  requirements: { currently_due: [], eventually_due: [], past_due: [], errors: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET = 'whsec_x'
  vi.mocked(getStripeConnectClient).mockReturnValue({
    webhooks: { constructEvent },
    accounts: { retrieve },
  } as any)
  update.mockResolvedValue({} as any)
})
afterEach(() => {
  delete process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET
})

describe('POST /api/stripe-connect/webhook', () => {
  it('503 when the secret is not configured', async () => {
    delete process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET
    expect((await POST(req())).status).toBe(503)
  })

  it('400 on missing or invalid signature', async () => {
    expect((await POST(req(null))).status).toBe(400)
    constructEvent.mockImplementation(() => {
      throw new Error('bad')
    })
    expect((await POST(req())).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('account.updated persists the snapshot columns and syncs the provider', async () => {
    constructEvent.mockReturnValue({ type: 'account.updated', account: 'acct_1', data: { object: account } })
    findUnique.mockResolvedValue({ userId: 'u1' } as any)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(findUnique.mock.calls[0][0].where).toEqual({ stripeConnectAccountId: 'acct_1' })
    expect(update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: expect.objectContaining({
        stripeConnectChargesEnabled: true,
        stripeConnectPayoutsEnabled: true,
        stripeConnectOnboardingStatus: 'complete',
      }),
    })
    expect(syncEffectiveProvider).toHaveBeenCalledWith('u1')
  })

  it('capability.updated re-retrieves the account', async () => {
    constructEvent.mockReturnValue({ type: 'capability.updated', account: 'acct_1', data: { object: { id: 'card_payments' } } })
    findUnique.mockResolvedValue({ userId: 'u1' } as any)
    retrieve.mockResolvedValue(account)
    expect((await POST(req())).status).toBe(200)
    expect(retrieve).toHaveBeenCalledWith('acct_1')
    expect(update).toHaveBeenCalled()
  })

  it('200 and no write for an unknown account', async () => {
    constructEvent.mockReturnValue({ type: 'account.updated', data: { object: account } })
    findUnique.mockResolvedValue(null)
    expect((await POST(req())).status).toBe(200)
    expect(update).not.toHaveBeenCalled()
  })

  it('200 for other event types without touching the DB', async () => {
    constructEvent.mockReturnValue({ type: 'charge.succeeded', data: { object: {} } })
    expect((await POST(req())).status).toBe(200)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('500 when the handler fails so Stripe retries', async () => {
    constructEvent.mockReturnValue({ type: 'account.updated', account: 'acct_1', data: { object: account } })
    findUnique.mockResolvedValue({ userId: 'u1' } as any)
    update.mockRejectedValue(new Error('db'))
    expect((await POST(req())).status).toBe(500)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { createAccountSession } from '@repo/data/stripe'

const findUnique = vi.mocked(prisma.partnerAccount.findUnique)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue(null)
})

describe('POST /api/stripe-connect/account-session', () => {
  it('401 without a session', async () => {
    expect((await POST()).status).toBe(401)
    expect(createAccountSession).not.toHaveBeenCalled()
  })

  it('400 when onboarding not started or details not submitted', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as any)
    findUnique.mockResolvedValue({ stripeConnectAccountId: null, stripeConnectDetailsSubmitted: false } as any)
    expect((await POST()).status).toBe(400)
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', stripeConnectDetailsSubmitted: false } as any)
    expect((await POST()).status).toBe(400)
    expect(createAccountSession).not.toHaveBeenCalled()
  })

  it('200 with the client secret for the session user\'s own account', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as any)
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', stripeConnectDetailsSubmitted: true } as any)
    vi.mocked(createAccountSession).mockResolvedValue({ clientSecret: 'cs_1' })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clientSecret: 'cs_1' })
    expect(findUnique.mock.calls[0][0].where).toEqual({ userId: 'u1' })
    expect(createAccountSession).toHaveBeenCalledWith('acct_1')
  })

  it('500 generic on Stripe failure', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1' } } as any)
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', stripeConnectDetailsSubmitted: true } as any)
    vi.mocked(createAccountSession).mockRejectedValue(new Error('boom sk_live'))
    const res = await POST()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('sk_live')
  })
})

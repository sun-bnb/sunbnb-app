import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { updatePaymentProvider } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

describe('updatePaymentProvider', () => {
  it('throws when not authenticated', async () => {
    await expect(updatePaymentProvider('site-1', 'stripe')).rejects.toThrow('Not authenticated')
  })

  it('rejects invalid provider', async () => {
    authenticateAsSudo()
    const res = await updatePaymentProvider('site-1', 'paypal')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Invalid payment provider')
  })

  it('updates to stripe without checking Mollie token', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await updatePaymentProvider('site-1', 'stripe')
    expect(res.status).toBe('ok')
    // site.findUnique should NOT be called — Mollie check only applies to Mollie
    expect(vi.mocked(prisma.site.findUnique)).not.toHaveBeenCalled()
  })

  it('checks Mollie token when switching to mollie', async () => {
    authenticateAsSudo()
    // requireSudo uses user.findUnique (handled by authenticateAsSudo)
    // Mollie check uses site.findUnique
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      user: { partnerAccount: { mollieAccessToken: 'tok-123' } },
    } as any)
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await updatePaymentProvider('site-1', 'mollie')
    expect(res.status).toBe('ok')
  })

  it('rejects Mollie when partner has no token', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      user: { partnerAccount: { mollieAccessToken: null } },
    } as any)

    const res = await updatePaymentProvider('site-1', 'mollie')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Partner has not connected Mollie')
  })

  it('rejects Mollie when partner has no account at all', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      user: { partnerAccount: null },
    } as any)

    const res = await updatePaymentProvider('site-1', 'mollie')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Partner has not connected Mollie')
  })

  // BUG: uses { error: string } (singular) — should use { errors: string[] } (plural) for consistency
  it('returns errors array (plural) consistent with other admin actions', async () => {
    authenticateAsSudo()
    const res = await updatePaymentProvider('site-1', 'invalid')
    expect(res).toHaveProperty('errors')
    expect(res).not.toHaveProperty('error')
  })

  // BUG: no validation of siteId parameter — empty string should be rejected
  it('rejects empty siteId', async () => {
    authenticateAsSudo()
    const res = await updatePaymentProvider('', 'stripe')
    expect(res.status).toBe('error')
  })
})

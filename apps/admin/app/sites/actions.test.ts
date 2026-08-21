import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { setCustomBrand, updatePaymentProvider } from './actions'
import { auth } from '@/app/auth'
import { revalidatePath } from 'next/cache'
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

/**
 * Track 023 — the LIVE half of the custom-brand gate.
 *
 * This action can change what a guest sees on a customer's storefront, from an
 * app the customer cannot reach, so the two things worth pinning are that only a
 * sudo admin can call it and that the value it writes is the value it was given
 * — not something coerced out of a truthy string.
 */
describe('setCustomBrand', () => {
  it('throws when not authenticated', async () => {
    await expect(setCustomBrand('site-1', true)).rejects.toThrow('Not authenticated')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('throws for a signed-in NON-sudo user, and writes nothing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)

    await expect(setCustomBrand('site-1', true)).rejects.toThrow('sudo required')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('enables the custom brand page', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await setCustomBrand('site-1', true)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: 'site-1' },
      data: { customBrandEnabled: true },
    })
  })

  it('disables it again', async () => {
    // The kill switch: pulling a broken bespoke page must not need a revert and
    // a deploy, so `false` has to travel as faithfully as `true`.
    authenticateAsSudo()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    const res = await setCustomBrand('site-1', false)

    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.site.update)).toHaveBeenCalledWith({
      where: { id: 'site-1' },
      data: { customBrandEnabled: false },
    })
  })

  it.each([
    ['the string "false"', 'false'],
    ['a checkbox value', 'on'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 1],
  ])('refuses %s rather than coercing it', async (_label, value) => {
    // Every one of these is truthy or falsy by accident. Coercing would flip a
    // customer's storefront the wrong way and report success.
    authenticateAsSudo()

    const res = await setCustomBrand('site-1', value as never)

    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Enabled must be a boolean')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('rejects a blank site id without touching the database', async () => {
    authenticateAsSudo()

    const res = await setCustomBrand('   ', true)

    expect(res.status).toBe('error')
    expect(res.errors![0]).toBe('Site ID is required')
    expect(vi.mocked(prisma.site.update)).not.toHaveBeenCalled()
  })

  it('revalidates the sites page so the switch reflects the write', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.update).mockResolvedValue({} as any)

    await setCustomBrand('site-1', true)

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/sites')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { selectPaymentProvider } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const mockSync = vi.mocked(syncEffectiveProvider)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function signIn(country: string | null) {
  mockAuth.mockResolvedValue({ user: { id: 'u1' } } as any)
  vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ country } as any)
}

describe('selectPaymentProvider', () => {
  it('rejects when not authenticated', async () => {
    const res = await selectPaymentProvider('mollie')
    expect(res.status).toBe('error')
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })

  it('rejects an invalid provider without writing', async () => {
    signIn('NL')
    expect(await selectPaymentProvider('paypal')).toEqual({ status: 'error', errors: ['Invalid payment provider'] })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it.each([['US'], [null]])('rejects a provider not online in country %s', async (country) => {
    signIn(country)
    expect(await selectPaymentProvider('viva')).toEqual({ status: 'error', errors: ['Not available in your country'] })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('writes the selection, syncs sites with the user id and returns the sync result', async () => {
    signIn('NL')
    mockSync.mockResolvedValueOnce({ selected: 'viva', effective: 'mollie', changed: 0 })
    const res = await selectPaymentProvider('viva')
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { paymentProvider: 'viva' },
    })
    expect(mockSync).toHaveBeenCalledWith('u1')
    expect(res).toEqual({ status: 'ok', selected: 'viva', effective: 'mollie' })
    expect(revalidatePath).toHaveBeenCalledWith('/account/payments')
    expect(revalidatePath).toHaveBeenCalledWith('/sites')
  })
})

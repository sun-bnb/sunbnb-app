/**
 * Account field rules shared by the Account form and the field-level patch (track 030 S3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'
import { updateAccountFields, submitForm } from '@/app/account/actions'
import { ACCOUNT_PATCH_FIELDS, applyAccountPatch, restoreAccountFields, validatePatch } from './account-fields'

const account = {
  company: 'Old SL', businessId: 'B12345674', address: 'Calle 1', city: 'Malaga', postalCode: '29000', country: 'ES',
  phoneNumber: '+34 600', email: 'a@b.es', websiteUrl: null, vatIdStatus: 'valid', vatIdCheckedAt: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue(null)
  vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(account as never)
  vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as never)
})

describe('the patch whitelist', () => {
  it('never includes bank account, payment provider, Stripe, KYC, Verifactu or identity fields', () => {
    expect([...ACCOUNT_PATCH_FIELDS].sort()).toEqual(['address', 'businessId', 'city', 'company', 'country', 'email', 'phoneNumber', 'postalCode', 'websiteUrl'])
  })

  it.each(['bankAccount', 'iban', 'paymentProvider', 'stripeConnectAccountId', 'verifactuEnabled', 'userId', 'vatIdStatus', 'invoiceSeriesPrefix'])(
    'validatePatch rejects %s',
    (field) => {
      expect(validatePatch({ [field]: 'x' })).toEqual([`Field not allowed: ${field}`])
    },
  )

  it('rejects an empty patch, non-text values, blanked required fields, bad email / URL, over-long values', () => {
    expect(validatePatch({})).toEqual(['Nothing to update'])
    expect(validatePatch({ city: 5 })[0]).toMatch(/must be text/)
    expect(validatePatch({ company: '  ' })).toEqual(['Company name is required'])
    expect(validatePatch({ email: 'nope' })).toEqual(['Invalid email format'])
    expect(validatePatch({ websiteUrl: 'not a url' })).toEqual(['Invalid website URL'])
    expect(validatePatch({ address: 'x'.repeat(301) })[0]).toMatch(/too long \(max 300/)
  })

  it('may clear the optional website', () => {
    expect(validatePatch({ websiteUrl: '' })).toEqual([])
  })
})

describe('applyAccountPatch', () => {
  it('writes ONLY the patched columns (not the 10-field replace) and returns the prior values', async () => {
    const r = await applyAccountPatch('owner-1', { city: 'Marbella' })
    expect(r).toEqual({ status: 'ok', snapshot: { values: { city: 'Malaga' } } })
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({ where: { userId: 'owner-1' }, data: { city: 'Marbella' } })
  })

  it('a tax id change re-records the verdict (normalised id, status, timestamp) and snapshots the old identity', async () => {
    const r = await applyAccountPatch('owner-1', { businessId: 'es b-12345674' })
    const data = vi.mocked(prisma.partnerAccount.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data.businessId).toBe('ESB12345674')
    expect(data.vatIdStatus).toBeDefined()
    expect(data.vatIdCheckedAt).toBeInstanceOf(Date)
    expect(r).toMatchObject({ status: 'ok', snapshot: { values: { businessId: 'B12345674' }, taxIdentity: { businessId: 'B12345674', vatIdStatus: 'valid', vatIdCheckedAt: '2026-01-01T00:00:00.000Z' } } })
  })

  it('a country change alone also re-validates the existing tax id against the new country', async () => {
    await applyAccountPatch('owner-1', { country: 'FI' })
    const data = vi.mocked(prisma.partnerAccount.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data).toMatchObject({ country: 'FI' })
    expect(data.vatIdCheckedAt).toBeInstanceOf(Date)
  })

  it('an invalid tax id is RECORDED, never rejected (onboarding must not be blocked by a checksum)', async () => {
    const r = await applyAccountPatch('owner-1', { businessId: 'not-a-vat-id' })
    expect(r.status).toBe('ok')
    expect(vi.mocked(prisma.partnerAccount.update).mock.calls[0]![0].data).toMatchObject({ vatIdStatus: 'invalid' })
  })

  it('refuses when the account does not exist yet, and when the patch is invalid, writing nothing', async () => {
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    expect(await applyAccountPatch('owner-1', { city: 'X' })).toMatchObject({ status: 'error', errors: [expect.stringMatching(/Account page/)] })
    expect(await applyAccountPatch('owner-1', { bankAccount: 'ES91' })).toMatchObject({ status: 'error' })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })

  it('restoreAccountFields puts back exactly the snapshot, including the tax identity, ignoring non-whitelisted keys', async () => {
    await restoreAccountFields('owner-1', {
      values: { city: 'Malaga', bankAccount: 'ES91' } as never,
      taxIdentity: { businessId: 'B1', vatIdStatus: 'valid', vatIdCheckedAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({
      where: { userId: 'owner-1' },
      data: { city: 'Malaga', businessId: 'B1', vatIdStatus: 'valid', vatIdCheckedAt: new Date('2026-01-01T00:00:00.000Z') },
    })
  })
})

describe('updateAccountFields (server action)', () => {
  it('rejects unauthenticated callers', async () => {
    expect(await updateAccountFields({ city: 'X' })).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })

  it('patches the SESSION user\'s own account only and refreshes the Account page', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'me' } } as never)
    expect(await updateAccountFields({ city: 'Marbella' })).toEqual({ status: 'ok' })
    expect(prisma.partnerAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'me' } }))
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'me' } }))
    expect(revalidatePath).toHaveBeenCalledWith('/account')
  })

  it('a smuggled bank account is refused and nothing is written', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'me' } } as never)
    const r = await updateAccountFields({ city: 'X', bankAccount: 'ES9121000418450200051332' } as never)
    expect(r).toEqual({ status: 'error', errors: ['Field not allowed: bankAccount'] })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })
})

describe('submitForm still enforces the shared rules (refactor parity)', () => {
  function form(over: Record<string, string> = {}) {
    const fd = new FormData()
    const base: Record<string, string> = {
      firstName: 'A', lastName: 'B', email: 'a@b.es', phoneNumber: '1', company: 'C', address: 'D', city: 'E', postalCode: '1', country: 'ES', businessId: 'B12345674',
    }
    for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v)
    return fd
  }
  beforeEach(() => vi.mocked(auth).mockResolvedValue({ user: { id: 'me' } } as never))

  it('required, length, email and URL checks keep their messages and order', async () => {
    expect(await submitForm({ status: 'ok' }, form({ company: '' }))).toEqual({ status: 'error', errors: ['Company name is required'] })
    expect((await submitForm({ status: 'ok' }, form({ city: 'x'.repeat(101) }))).errors).toEqual(['City is too long (max 100 characters)'])
    expect((await submitForm({ status: 'ok' }, form({ email: 'nope' }))).errors).toEqual(['Invalid email format'])
    expect((await submitForm({ status: 'ok' }, form({ websiteUrl: 'zzz' }))).errors).toEqual(['Invalid website URL'])
  })

  it('still records the normalised tax identity when saving the form', async () => {
    await submitForm({ status: 'ok' }, form({ businessId: 'es b-12345674' }))
    expect(vi.mocked(prisma.partnerAccount.update).mock.calls[0]![0].data).toMatchObject({ businessId: 'ESB12345674', vatIdStatus: expect.any(String) })
  })
})

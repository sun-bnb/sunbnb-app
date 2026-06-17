import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { submitForm } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const defaults: Record<string, string> = {
    firstName: 'Maria',
    lastName: 'Garcia',
    email: 'maria@example.com',
    phoneNumber: '+34 123 456 789',
    company: 'Beach Corp SL',
    businessId: 'B12345678',
    address: 'Calle Mayor 1',
    city: 'Marbella',
    postalCode: '29600',
    country: 'ES',
    bankAccount: 'ES91 2100 0418 4502 0005 1332',
  }
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value)
  }
  return fd
}

function authenticateAsOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
}

// ─── submitForm ───────────────────────────────────────────────────────────────

describe('submitForm', () => {

  // ── Authentication ──────────────────────────────────────────────────────────

  it('returns error when not authenticated', async () => {
    const result = await submitForm({ status: 'ok' }, makeFormData())
    expect(result.status).toBe('error')
    expect(result.errors).toContain('Not authenticated')
    expect(vi.mocked(prisma.partnerAccount.findUnique)).not.toHaveBeenCalled()
  })

  // ── Required field validation ───────────────────────────────────────────────

  it.each([
    ['firstName', 'First name is required'],
    ['lastName', 'Last name is required'],
    ['email', 'Email is required'],
    ['phoneNumber', 'Phone number is required'],
    ['company', 'Company name is required'],
    ['address', 'Address is required'],
    ['city', 'City is required'],
    ['postalCode', 'Postal code is required'],
    ['country', 'Country is required'],
    ['businessId', 'Business ID is required'],
  ])('rejects missing required field: %s', async (field, expectedError) => {
    authenticateAsOwner()
    const result = await submitForm({ status: 'ok' }, makeFormData({ [field]: '' }))
    expect(result.status).toBe('error')
    expect(result.errors).toContain(expectedError)
  })

  // ── Format validation ───────────────────────────────────────────────────────

  it('rejects an email without a domain (no dot after @)', async () => {
    authenticateAsOwner()
    const result = await submitForm({ status: 'ok' }, makeFormData({ email: 'bad@nodot' }))
    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid email format')
  })

  it('rejects an email with no @ symbol', async () => {
    authenticateAsOwner()
    const result = await submitForm({ status: 'ok' }, makeFormData({ email: 'notanemail' }))
    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid email format')
  })

  it('rejects a malformed website URL', async () => {
    authenticateAsOwner()
    const fd = makeFormData()
    fd.set('websiteUrl', 'not-a-url')
    const result = await submitForm({ status: 'ok' }, fd)
    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid website URL')
  })

  it('accepts a valid website URL', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)
    const fd = makeFormData()
    fd.set('websiteUrl', 'https://beachcorp.example.com')
    const result = await submitForm({ status: 'ok' }, fd)
    expect(result.status).toBe('ok')
  })

  it('accepts a missing (optional) website URL', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)
    // No websiteUrl field
    const result = await submitForm({ status: 'ok' }, makeFormData())
    expect(result.status).toBe('ok')
  })

  // ── Length caps ─────────────────────────────────────────────────────────────

  it('rejects firstName exceeding 100 characters', async () => {
    authenticateAsOwner()
    const result = await submitForm({ status: 'ok' }, makeFormData({ firstName: 'A'.repeat(101) }))
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/too long/)
  })

  it('rejects email exceeding 320 characters', async () => {
    authenticateAsOwner()
    // 315 'a's + '@x.com' = 321 chars, which is > the 320-char cap
    const longEmail = 'a'.repeat(315) + '@x.com'
    expect(longEmail.length).toBe(321) // sanity: must be over the 320 cap
    const result = await submitForm({ status: 'ok' }, makeFormData({ email: longEmail }))
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/too long/)
  })

  it('rejects bankAccount exceeding 50 characters', async () => {
    authenticateAsOwner()
    const result = await submitForm({ status: 'ok' }, makeFormData({ bankAccount: 'X'.repeat(51) }))
    expect(result.status).toBe('error')
    expect(result.errors?.[0]).toMatch(/too long/)
  })

  // ── Scoping: new account ─────────────────────────────────────────────────────

  /**
   * BUG-REVEALING: The accountData always sets userId = session.user.id.
   * No client-supplied userId can change what account is written.
   */
  it('creates new account scoped to session.user.id when no account exists', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.partnerAccount.create).mockResolvedValue({} as any)
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue(null)

    const result = await submitForm({ status: 'ok' }, makeFormData())

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.partnerAccount.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: OWNER_ID }),
    })
    // Existing account lookup must be scoped to session user
    expect(vi.mocked(prisma.partnerAccount.findUnique)).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
    })
  })

  it('auto-assigns STARTER subscription when a new account is created and the plan exists', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.partnerAccount.create).mockResolvedValue({} as any)
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue({
      id: 'plan-starter',
      tier: 'STARTER',
    } as any)
    vi.mocked(prisma.subscription.create).mockResolvedValue({} as any)

    const result = await submitForm({ status: 'ok' }, makeFormData())

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.subscription.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerAccountId: OWNER_ID,
        planId: 'plan-starter',
        status: 'ACTIVE',
      }),
    })
  })

  it('does not assign subscription when no STARTER plan exists', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.partnerAccount.create).mockResolvedValue({} as any)
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue(null)

    const result = await submitForm({ status: 'ok' }, makeFormData())

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.subscription.create)).not.toHaveBeenCalled()
  })

  // ── Scoping: existing account ─────────────────────────────────────────────────

  it('updates existing account and scopes the where clause to account.userId', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await submitForm({ status: 'ok' }, makeFormData())

    expect(result.status).toBe('ok')
    expect(vi.mocked(prisma.partnerAccount.update)).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: OWNER_ID }),
      where: { userId: OWNER_ID },
    })
    // create must NOT be called on the update path
    expect(vi.mocked(prisma.partnerAccount.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.subscription.create)).not.toHaveBeenCalled()
  })

  it('revalidates /account path on success (update)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ userId: OWNER_ID } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await submitForm({ status: 'ok' }, makeFormData())

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/account')
  })

  it('revalidates /account path on success (create)', async () => {
    authenticateAsOwner()
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.partnerAccount.create).mockResolvedValue({} as any)
    vi.mocked(prisma.subscriptionPlan.findUnique).mockResolvedValue(null)

    await submitForm({ status: 'ok' }, makeFormData())

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/account')
  })
})

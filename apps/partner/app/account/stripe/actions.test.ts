import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const headerMap = new Map<string, string>()
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (k: string) => headerMap.get(k) ?? null })),
}))

import {
  startStripeOnboarding,
  submitStripeBusinessProfile,
  submitStripeBankAccount,
  acceptStripeTerms,
  refreshStripeStatus,
  disconnectStripe,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  acceptTos,
  attachExternalAccount,
  createConnectedAccount,
  retrieveAccountSnapshot,
  updateBusinessProfile,
} from '@repo/data/stripe'
import { syncEffectiveProvider } from '@repo/data/payment-providers/selection'

const mockAuth = vi.mocked(auth)
const findUnique = vi.mocked(prisma.partnerAccount.findUnique)
const update = vi.mocked(prisma.partnerAccount.update)

const SNAP = {
  accountId: 'acct_1',
  chargesEnabled: true,
  payoutsEnabled: false,
  detailsSubmitted: true,
  currentlyDue: ['a'],
  eventuallyDue: [],
  pastDue: ['b'],
  disabledReason: null,
  errors: [],
  status: 'in_progress' as const,
}
const EXPECTED_COLUMNS = {
  stripeConnectChargesEnabled: true,
  stripeConnectPayoutsEnabled: false,
  stripeConnectDetailsSubmitted: true,
  stripeConnectOnboardingStatus: 'in_progress',
  stripeConnectRequirementsDue: ['a', 'b'],
}

const address = { line1: 'x 1', city: 'Palma', postal_code: '07001', country: 'ES' }
const person = {
  first_name: 'A',
  last_name: 'B',
  email: 'a@b.co',
  phone: '+34 600 111 222',
  dob: { day: 1, month: 2, year: 1980 },
  address,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  headerMap.clear()
  update.mockResolvedValue({} as any)
  vi.mocked(retrieveAccountSnapshot).mockResolvedValue(SNAP)
})

function signIn() {
  mockAuth.mockResolvedValue({ user: { id: 'u1', email: 's@x.co' } } as any)
}

describe('no session', () => {
  it('every action refuses and touches nothing', async () => {
    const results = await Promise.all([
      startStripeOnboarding('company'),
      submitStripeBusinessProfile({ businessType: 'individual', individual: person }),
      submitStripeBankAccount({ token: 't' }),
      acceptStripeTerms(),
      refreshStripeStatus(),
      disconnectStripe(),
    ])
    for (const r of results) expect(r).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(update).not.toHaveBeenCalled()
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('startStripeOnboarding', () => {
  it('creates the account, stores id + connectedAt, persists columns and syncs', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: null, country: 'ES', email: 'p@x.co' } as any)
    vi.mocked(createConnectedAccount).mockResolvedValue({ accountId: 'acct_1' })
    const res = await startStripeOnboarding('company')
    expect(res.status).toBe('ok')
    expect(createConnectedAccount).toHaveBeenCalledWith({
      partnerAccountId: 'u1',
      country: 'ES',
      email: 'p@x.co',
      businessType: 'company',
    })
    const data = update.mock.calls[0][0].data as any
    expect(data).toMatchObject({ ...EXPECTED_COLUMNS, stripeConnectAccountId: 'acct_1' })
    expect(data.stripeConnectConnectedAt).toBeInstanceOf(Date)
    expect(syncEffectiveProvider).toHaveBeenCalledWith('u1')
  })

  it('is idempotent: existing account is re-read, never re-created', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', country: 'ES', email: 'p@x.co' } as any)
    const res = await startStripeOnboarding('company')
    expect(res.status).toBe('ok')
    expect(createConnectedAccount).not.toHaveBeenCalled()
    expect(retrieveAccountSnapshot).toHaveBeenCalledWith('acct_1')
  })

  it('requires a business country', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: null, country: null, email: 'p@x.co' } as any)
    const res = await startStripeOnboarding('individual')
    expect(res).toEqual({ status: 'error', errors: ['Set your business country in Account first'] })
    expect(createConnectedAccount).not.toHaveBeenCalled()
  })

  it('returns a generic error and hides Stripe details', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    vi.mocked(retrieveAccountSnapshot).mockRejectedValue(new Error('sk_live_secret leaked'))
    const res = await startStripeOnboarding('company')
    expect(res.status).toBe('error')
    expect(JSON.stringify(res)).not.toContain('sk_live')
  })
})

describe('submitStripeBusinessProfile', () => {
  it('rejects an out-of-range date of birth without calling Stripe', async () => {
    signIn()
    const res = await submitStripeBusinessProfile({
      businessType: 'individual',
      individual: { ...person, dob: { day: 40, month: 13, year: 1980 } },
    })
    expect(res.status).toBe('error')
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('rejects empty names', async () => {
    signIn()
    const res = await submitStripeBusinessProfile({
      businessType: 'individual',
      individual: { ...person, first_name: ' ' },
    })
    expect(res.status).toBe('error')
  })

  it('requires a valid phone for an individual', async () => {
    signIn()
    for (const phone of ['', 'abc', '12']) {
      const res = await submitStripeBusinessProfile({
        businessType: 'individual',
        individual: { ...person, phone },
      })
      expect(res.status).toBe('error')
    }
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  const company = { name: 'Acme SL', tax_id: 'B123', phone: '+34 971 000 000', address }
  const rep = { ...person, title: 'Director', owner: true, percent_ownership: 100 }

  it('requires representative title and company phone', async () => {
    signIn()
    expect(
      (await submitStripeBusinessProfile({ businessType: 'company', company, representative: { ...rep, title: ' ' } }))
        .status,
    ).toBe('error')
    expect(
      (await submitStripeBusinessProfile({ businessType: 'company', company: { ...company, phone: '' }, representative: rep }))
        .status,
    ).toBe('error')
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('uppercases nationality and passes owners through; rejects more than 4 owners', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    vi.mocked(updateBusinessProfile).mockResolvedValue(SNAP)
    const { phone: _p, ...ownerPerson } = person
    const res = await submitStripeBusinessProfile({
      businessType: 'company',
      company,
      representative: { ...rep, nationality: 'es' },
      owners: [{ ...ownerPerson, nationality: 'fi', percent_ownership: 30 }],
    })
    expect(res.status).toBe('ok')
    const sent = vi.mocked(updateBusinessProfile).mock.calls[0][1]
    expect(sent.representative?.nationality).toBe('ES')
    expect(sent.owners?.[0]).toMatchObject({ nationality: 'FI', percent_ownership: 30 })

    vi.mocked(updateBusinessProfile).mockClear()
    const tooMany = await submitStripeBusinessProfile({
      businessType: 'company',
      company,
      representative: rep,
      owners: Array.from({ length: 5 }, () => ownerPerson),
    })
    expect(tooMany.status).toBe('error')
    expect(updateBusinessProfile).not.toHaveBeenCalled()
  })

  it('requires an existing account', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: null } as any)
    const res = await submitStripeBusinessProfile({ businessType: 'individual', individual: person })
    expect(res).toEqual({ status: 'error', errors: ['Start Stripe onboarding first'] })
  })

  it('defaults productDescription when no url, persists and syncs', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    vi.mocked(updateBusinessProfile).mockResolvedValue(SNAP)
    const res = await submitStripeBusinessProfile({ businessType: 'individual', individual: person })
    expect(res.status).toBe('ok')
    expect(vi.mocked(updateBusinessProfile).mock.calls[0][1].productDescription).toContain('Sunbnb')
    expect(update.mock.calls[0][0].data).toMatchObject(EXPECTED_COLUMNS)
    expect(syncEffectiveProvider).toHaveBeenCalled()
  })
})

describe('submitStripeBankAccount', () => {
  it('normalises the IBAN (strip spaces, uppercase) and uses the account country', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', country: 'ES' } as any)
    vi.mocked(attachExternalAccount).mockResolvedValue(SNAP)
    const res = await submitStripeBankAccount({ iban: 'es91 2100 0418 4502 0005 1332', accountHolderName: 'Acme' })
    expect(res.status).toBe('ok')
    expect(attachExternalAccount).toHaveBeenCalledWith('acct_1', {
      iban: 'ES9121000418450200051332',
      accountHolderName: 'Acme',
      country: 'ES',
      currency: 'eur',
    })
    expect(update).toHaveBeenCalled()
  })

  it('rejects a malformed IBAN', async () => {
    signIn()
    const res = await submitStripeBankAccount({ iban: '12', accountHolderName: 'Acme' })
    expect(res.status).toBe('error')
    expect(attachExternalAccount).not.toHaveBeenCalled()
  })

  it('passes a token through', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1', country: 'ES' } as any)
    vi.mocked(attachExternalAccount).mockResolvedValue(SNAP)
    await submitStripeBankAccount({ token: 'btok_1' })
    expect(attachExternalAccount).toHaveBeenCalledWith('acct_1', { token: 'btok_1' })
  })
})

describe('acceptStripeTerms', () => {
  it('records the first x-forwarded-for IP and user agent, stores acceptance time', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    vi.mocked(acceptTos).mockResolvedValue(SNAP)
    headerMap.set('x-forwarded-for', '1.2.3.4, 10.0.0.1')
    headerMap.set('user-agent', 'UA/1')
    const res = await acceptStripeTerms()
    expect(res.status).toBe('ok')
    expect(acceptTos).toHaveBeenCalledWith('acct_1', {
      date: expect.any(Number),
      ip: '1.2.3.4',
      userAgent: 'UA/1',
    })
    const data = update.mock.calls[0][0].data as any
    expect(data.stripeConnectTosAcceptedAt).toBeInstanceOf(Date)
    expect(syncEffectiveProvider).toHaveBeenCalled()
  })

  it('falls back to 0.0.0.0 without proxy headers', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    vi.mocked(acceptTos).mockResolvedValue(SNAP)
    await acceptStripeTerms()
    expect(vi.mocked(acceptTos).mock.calls[0][1].ip).toBe('0.0.0.0')
  })
})

describe('refreshStripeStatus', () => {
  it('errors when not started', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: null } as any)
    expect((await refreshStripeStatus()).status).toBe('error')
  })

  it('persists columns and syncs', async () => {
    signIn()
    findUnique.mockResolvedValue({ stripeConnectAccountId: 'acct_1' } as any)
    await refreshStripeStatus()
    expect(update.mock.calls[0][0].data).toMatchObject(EXPECTED_COLUMNS)
    expect(syncEffectiveProvider).toHaveBeenCalledWith('u1')
  })
})

describe('disconnectStripe', () => {
  it('clears every stripeConnect column and syncs, without calling Stripe', async () => {
    signIn()
    const res = await disconnectStripe()
    expect(res).toEqual({ status: 'ok' })
    expect(update.mock.calls[0][0].data).toEqual({
      stripeConnectAccountId: null,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      stripeConnectDetailsSubmitted: false,
      stripeConnectOnboardingStatus: null,
      stripeConnectRequirementsDue: [],
      stripeConnectTosAcceptedAt: null,
      stripeConnectConnectedAt: null,
    })
    expect(syncEffectiveProvider).toHaveBeenCalledWith('u1')
    expect(retrieveAccountSnapshot).not.toHaveBeenCalled()
  })
})

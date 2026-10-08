import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

const stripe = vi.hoisted(() => ({
  accounts: {
    create: vi.fn(),
    update: vi.fn(),
    retrieve: vi.fn(),
    listPersons: vi.fn(),
    updatePerson: vi.fn(),
    createPerson: vi.fn(),
  },
  accountSessions: { create: vi.fn() },
}))
vi.mock('./client', () => ({ getStripeConnectClient: () => stripe, getStripeClient: () => { throw new Error('Connect code must not use the subscription client') } }))

import {
  CONNECT_CONTROLLER,
  createConnectedAccount,
  updateBusinessProfile,
  attachExternalAccount,
  acceptTos,
  createAccountSession,
  snapshotFromAccount,
  snapshotToColumns,
} from './connect'

const acct = (over: Record<string, unknown> = {}, req: Record<string, unknown> = {}): Stripe.Account =>
  ({
    id: 'acct_1',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    business_type: null,
    requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null, errors: [], ...req },
    ...over,
  }) as unknown as Stripe.Account

const ADDR = { line1: 'a', city: 'c', postal_code: '1', country: 'ES' }
const PERSON = { first_name: 'A', last_name: 'B', email: 'a@b.c', phone: '+34600000000', dob: { day: 1, month: 2, year: 1990 }, address: ADDR }

beforeEach(() => {
  vi.clearAllMocks()
  stripe.accounts.retrieve.mockResolvedValue(acct())
})

describe('createConnectedAccount', () => {
  it('uses the exact controller block and capabilities (platform owns onboarding, losses and fees)', async () => {
    stripe.accounts.create.mockResolvedValue({ id: 'acct_new' })
    const r = await createConnectedAccount({ partnerAccountId: 'pa-1', country: 'ES', email: 'p@x.es', businessType: 'company' })
    expect(r).toEqual({ accountId: 'acct_new' })
    expect(stripe.accounts.create).toHaveBeenCalledWith({
      country: 'ES',
      email: 'p@x.es',
      business_type: 'company',
      controller: {
        requirement_collection: 'application',
        losses: { payments: 'application' },
        fees: { payer: 'application' },
        stripe_dashboard: { type: 'none' },
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { partnerAccountId: 'pa-1' },
    })
    expect(CONNECT_CONTROLLER.fees.payer).toBe('application')
  })
})

describe('snapshotFromAccount truth table', () => {
  it('complete: charges + payouts + nothing currently due', () => {
    expect(snapshotFromAccount(acct({ charges_enabled: true, payouts_enabled: true, details_submitted: true })).status).toBe('complete')
  })
  it('not complete when charges+payouts are on but a requirement is currently due', () => {
    const s = snapshotFromAccount(acct({ charges_enabled: true, payouts_enabled: true, details_submitted: true }, { currently_due: ['x'] }))
    expect(s.status).toBe('in_progress')
  })
  it('restricted: disabled reason and charges off', () => {
    expect(snapshotFromAccount(acct({ details_submitted: true }, { disabled_reason: 'rejected.fraud' })).status).toBe('restricted')
  })
  it('restricted: anything past due, even with charges on', () => {
    const s = snapshotFromAccount(acct({ charges_enabled: true, payouts_enabled: true, details_submitted: true }, { past_due: ['individual.id_number'], currently_due: ['individual.id_number'] }))
    expect(s.status).toBe('restricted')
  })
  it('a disabled reason with charges ON is not restricted by itself', () => {
    const s = snapshotFromAccount(acct({ charges_enabled: true, payouts_enabled: false, details_submitted: true }, { disabled_reason: 'requirements.pending_verification' }))
    expect(s.status).not.toBe('restricted')
  })
  it('pending_verification: submitted, nothing due, charges not yet on', () => {
    expect(snapshotFromAccount(acct({ details_submitted: true })).status).toBe('pending_verification')
  })
  it('not_started: nothing submitted and no business type', () => {
    expect(snapshotFromAccount(acct()).status).toBe('not_started')
  })
  it('in_progress: business type chosen but details not submitted', () => {
    expect(snapshotFromAccount(acct({ business_type: 'company' }, { currently_due: ['company.name'] })).status).toBe('in_progress')
  })
  it('copies requirement lists, disabled reason and errors', () => {
    const s = snapshotFromAccount(
      acct({}, { currently_due: ['a'], eventually_due: ['a', 'b'], past_due: [], disabled_reason: 'requirements.past_due', errors: [{ requirement: 'a', reason: 'bad', code: 'x' }] }),
    )
    expect(s).toMatchObject({ accountId: 'acct_1', currentlyDue: ['a'], eventuallyDue: ['a', 'b'], disabledReason: 'requirements.past_due', errors: [{ requirement: 'a', reason: 'bad' }] })
  })
  it('tolerates a missing requirements object', () => {
    expect(snapshotFromAccount({ id: 'a' } as Stripe.Account).currentlyDue).toEqual([])
  })
})

describe('snapshotToColumns', () => {
  it('maps flags and status; requirementsDue is the de-duplicated union of currentlyDue and pastDue', () => {
    const cols = snapshotToColumns({
      accountId: 'a', chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true,
      currentlyDue: ['x', 'y'], eventuallyDue: ['z'], pastDue: ['y', 'w'], disabledReason: null, errors: [], status: 'restricted',
    })
    expect(cols).toEqual({
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: false,
      stripeConnectDetailsSubmitted: true,
      stripeConnectOnboardingStatus: 'restricted',
      stripeConnectRequirementsDue: ['x', 'y', 'w'],
    })
  })
})

describe('updateBusinessProfile', () => {
  it('company: updates the account with default MCC 7999 and creates the representative when none exists', async () => {
    stripe.accounts.listPersons.mockResolvedValue({ data: [] })
    await updateBusinessProfile('acct_1', {
      businessType: 'company',
      company: { name: 'Co', address: ADDR },
      representative: { ...PERSON, nationality: 'ES', title: 'CEO', owner: true, percent_ownership: 100 },
      url: 'https://co.es',
    })
    expect(stripe.accounts.update).toHaveBeenCalledWith('acct_1', {
      business_type: 'company',
      company: { name: 'Co', address: ADDR },
      business_profile: { mcc: '7999', url: 'https://co.es' },
    })
    expect(stripe.accounts.createPerson).toHaveBeenCalledWith('acct_1', {
      ...PERSON,
      nationality: 'ES',
      relationship: { representative: true, executive: true, title: 'CEO', owner: true, percent_ownership: 100 },
    })
    expect(stripe.accounts.updatePerson).not.toHaveBeenCalled()
  })

  it('company: updates the existing representative instead of creating a second one', async () => {
    stripe.accounts.listPersons.mockResolvedValue({ data: [{ id: 'person_1' }] })
    await updateBusinessProfile('acct_1', { businessType: 'company', company: { name: 'Co', address: ADDR }, representative: { ...PERSON, title: 'CEO' } })
    expect(stripe.accounts.updatePerson).toHaveBeenCalledWith('acct_1', 'person_1', expect.objectContaining({ first_name: 'A' }))
    expect(stripe.accounts.createPerson).not.toHaveBeenCalled()
  })

  it('individual: sends individual, no person calls, honours a custom mcc', async () => {
    await updateBusinessProfile('acct_1', { businessType: 'individual', individual: PERSON, mcc: '5812', productDescription: 'Sunbeds' })
    expect(stripe.accounts.update).toHaveBeenCalledWith('acct_1', {
      business_type: 'individual',
      individual: PERSON,
      business_profile: { mcc: '5812', product_description: 'Sunbeds' },
    })
    expect(stripe.accounts.listPersons).not.toHaveBeenCalled()
  })

  it('individual: passes nationality and phone through and never sets owners_provided', async () => {
    await updateBusinessProfile('acct_1', { businessType: 'individual', individual: { ...PERSON, nationality: 'ES' } })
    expect(stripe.accounts.update).toHaveBeenCalledTimes(1)
    expect(stripe.accounts.update.mock.calls[0]![1].individual).toMatchObject({ nationality: 'ES', phone: '+34600000000' })
    expect(JSON.stringify(stripe.accounts.update.mock.calls)).not.toContain('owners_provided')
  })

  it('company: representative.owner marks the person as owner+representative+executive with percent', async () => {
    stripe.accounts.listPersons.mockResolvedValue({ data: [] })
    await updateBusinessProfile('acct_1', {
      businessType: 'company',
      company: { name: 'Co', address: ADDR },
      representative: { ...PERSON, title: 'CEO', owner: true, percent_ownership: 60 },
    })
    expect(stripe.accounts.createPerson.mock.calls[0]![1].relationship).toEqual({
      representative: true, executive: true, title: 'CEO', owner: true, percent_ownership: 60,
    })
  })

  it('company: extra owners are created when no person matches their email, updated (case-insensitive) when one does', async () => {
    stripe.accounts.listPersons.mockImplementation(async (_id: string, params: { relationship?: unknown }) =>
      params.relationship ? { data: [{ id: 'rep_1', email: 'a@b.c' }] } : { data: [{ id: 'rep_1', email: 'a@b.c' }, { id: 'own_1', email: 'Owner1@x.es' }] },
    )
    const base = { last_name: 'L', dob: PERSON.dob, address: ADDR }
    await updateBusinessProfile('acct_1', {
      businessType: 'company',
      company: { name: 'Co', address: ADDR },
      representative: { ...PERSON, title: 'CEO' },
      owners: [
        { ...base, first_name: 'Upd', email: 'owner1@x.es', nationality: 'ES', percent_ownership: 30 },
        { ...base, first_name: 'New', email: 'owner2@x.es', percent_ownership: 10 },
      ],
    })
    expect(stripe.accounts.updatePerson).toHaveBeenCalledWith('acct_1', 'own_1', expect.objectContaining({
      first_name: 'Upd', nationality: 'ES', relationship: { owner: true, percent_ownership: 30 },
    }))
    expect(stripe.accounts.createPerson).toHaveBeenCalledWith('acct_1', expect.objectContaining({
      first_name: 'New', relationship: { owner: true, percent_ownership: 10 },
    }))
    expect(stripe.accounts.createPerson).toHaveBeenCalledTimes(1)
  })

  it('company: flags owners/directors/executives provided AFTER the persons are written', async () => {
    stripe.accounts.listPersons.mockResolvedValue({ data: [] })
    const order: string[] = []
    stripe.accounts.createPerson.mockImplementation(async () => { order.push('person') })
    stripe.accounts.update.mockImplementation(async (_i: string, body: Record<string, any>) => { order.push(body.company?.owners_provided ? 'provided' : 'update') })
    await updateBusinessProfile('acct_1', {
      businessType: 'company', company: { name: 'Co', address: ADDR }, representative: { ...PERSON, title: 'CEO' },
    })
    expect(stripe.accounts.update).toHaveBeenLastCalledWith('acct_1', {
      company: { owners_provided: true, directors_provided: true, executives_provided: true },
    })
    expect(order).toEqual(['update', 'person', 'provided'])
  })

  it('returns a fresh snapshot', async () => {
    stripe.accounts.retrieve.mockResolvedValue(acct({ charges_enabled: true, payouts_enabled: true, details_submitted: true }))
    stripe.accounts.listPersons.mockResolvedValue({ data: [] })
    expect((await updateBusinessProfile('acct_1', { businessType: 'individual', individual: PERSON })).status).toBe('complete')
  })
})

describe('attachExternalAccount / acceptTos', () => {
  it('passes a bank token straight through', async () => {
    await attachExternalAccount('acct_1', { token: 'btok_1' })
    expect(stripe.accounts.update).toHaveBeenCalledWith('acct_1', { external_account: 'btok_1' })
  })
  it('builds a bank_account object from an IBAN', async () => {
    await attachExternalAccount('acct_1', { iban: 'ES9121000418450200051332', accountHolderName: 'Co SL', country: 'ES', currency: 'eur' })
    expect(stripe.accounts.update).toHaveBeenCalledWith('acct_1', {
      external_account: { object: 'bank_account', country: 'ES', currency: 'eur', account_number: 'ES9121000418450200051332', account_holder_name: 'Co SL' },
    })
  })
  it('records ToS acceptance with snake_case user_agent', async () => {
    await acceptTos('acct_1', { date: 1700000000, ip: '1.2.3.4', userAgent: 'UA' })
    expect(stripe.accounts.update).toHaveBeenCalledWith('acct_1', { tos_acceptance: { date: 1700000000, ip: '1.2.3.4', user_agent: 'UA' } })
  })
})

describe('createAccountSession', () => {
  it('enables the embedded components with the agreed features and returns the client secret', async () => {
    stripe.accountSessions.create.mockResolvedValue({ client_secret: 'secret_1' })
    expect(await createAccountSession('acct_1')).toEqual({ clientSecret: 'secret_1' })
    const body = stripe.accountSessions.create.mock.calls[0]![0]
    expect(body.account).toBe('acct_1')
    expect(Object.keys(body.components).sort()).toEqual(['account_management', 'balances', 'notification_banner', 'payments', 'payouts'])
    expect(body.components.payments).toEqual({ enabled: true, features: { refund_management: false, dispute_management: true, capture_payments: false } })
    expect(body.components.payouts.features).toMatchObject({ instant_payouts: false, standard_payouts: true, edit_payout_schedule: true })
    expect(body.components.account_management.features).toEqual({ external_account_collection: true, disable_stripe_user_authentication: true })
  })
})

describe('client selection', () => {
  it('every Connect call goes through getStripeConnectClient, never the subscription client', async () => {
    // The ./client mock throws from getStripeClient; reaching here without error proves it.
    stripe.accounts.create.mockResolvedValue({ id: 'a' })
    stripe.accountSessions.create.mockResolvedValue({ client_secret: 's' })
    await createConnectedAccount({ partnerAccountId: 'p', country: 'ES', email: 'e@x.es', businessType: 'individual' })
    await attachExternalAccount('acct_1', { token: 't' })
    await acceptTos('acct_1', { date: 1, ip: 'i', userAgent: 'u' })
    await createAccountSession('acct_1')
    expect(stripe.accounts.create).toHaveBeenCalled()
  })
})

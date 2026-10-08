import { describe, it, expect } from 'vitest'
import {
  effectiveProviderFor,
  isSelectableProvider,
  providerReadiness,
  selectedProvider,
  toReadinessAccount,
  type ReadinessAccount,
} from './readiness'

const base: ReadinessAccount = {
  country: 'ES',
  paymentProvider: null,
  hasMollieToken: false,
  mollieOnboardingStatus: null,
  vivaAccountId: null,
  vivaMerchantId: null,
  vivaVerificationStatus: null,
  stripeConnectAccountId: null,
  stripeConnectChargesEnabled: false,
  stripeConnectPayoutsEnabled: false,
  stripeConnectDetailsSubmitted: false,
  stripeConnectOnboardingStatus: null,
  stripeConnectRequirementsDue: [],
}
const acc = (o: Partial<ReadinessAccount>): ReadinessAccount => ({ ...base, ...o })

describe('mollie readiness', () => {
  const r = (o: Partial<ReadinessAccount>) => providerReadiness(acc(o), 'mollie')
  it.each([
    [{ hasMollieToken: false, mollieOnboardingStatus: 'completed' }, 'not_connected', 'connect', false],
    [{ hasMollieToken: true, mollieOnboardingStatus: 'completed' }, 'ready', null, true],
    [{ hasMollieToken: true, mollieOnboardingStatus: 'needs-data' }, 'needs_data', 'complete_onboarding', false],
    [{ hasMollieToken: true, mollieOnboardingStatus: 'in-review' }, 'in_review', 'wait_review', false],
    [{ hasMollieToken: true, mollieOnboardingStatus: null }, 'in_progress', 'complete_onboarding', false],
    [{ hasMollieToken: true, mollieOnboardingStatus: 'weird' }, 'in_progress', 'complete_onboarding', false],
  ] as const)('%j → %s', (o, status, nextStep, ready) => {
    const out = r(o)
    expect(out).toMatchObject({ status, nextStep, ready, connectPath: '/account/mollie' })
    expect(out.connected).toBe(o.hasMollieToken)
  })
})

describe('viva readiness', () => {
  const r = (o: Partial<ReadinessAccount>) => providerReadiness(acc(o), 'viva')
  it.each([
    [{}, 'not_connected', 'connect', false],
    [{ vivaMerchantId: 'm', vivaVerificationStatus: 'verified' }, 'not_connected', 'connect', false], // no account id
    [{ vivaAccountId: 'a', vivaMerchantId: 'm', vivaVerificationStatus: 'verified' }, 'ready', null, true],
    [{ vivaAccountId: 'a', vivaVerificationStatus: 'verified' }, 'in_review', 'wait_review', false],
    [{ vivaAccountId: 'a', vivaMerchantId: 'm', vivaVerificationStatus: 'pending' }, 'in_review', 'wait_review', false],
    [{ vivaAccountId: 'a', vivaVerificationStatus: 'unknown' }, 'in_review', 'wait_review', false],
    [{ vivaAccountId: 'a', vivaVerificationStatus: null }, 'in_review', 'wait_review', false],
    [{ vivaAccountId: 'a', vivaVerificationStatus: 'rejected' }, 'restricted', 'fix_requirements', false],
  ] as const)('%j → %s', (o, status, nextStep, ready) => {
    expect(r(o)).toMatchObject({ status, nextStep, ready, connectPath: '/account/viva' })
  })
})

describe('stripe readiness', () => {
  const r = (o: Partial<ReadinessAccount>) => providerReadiness(acc(o), 'stripe')
  it.each([
    [{}, 'not_connected', 'connect', false],
    [{ stripeConnectChargesEnabled: true }, 'not_connected', 'connect', false], // no account id
    [{ stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: true }, 'ready', null, true],
    [
      { stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: true, stripeConnectOnboardingStatus: 'restricted' },
      'ready',
      null,
      true,
    ],
    [{ stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: 'restricted' }, 'restricted', 'fix_requirements', false],
    [{ stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: 'pending_verification' }, 'in_review', 'wait_review', false],
    [{ stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: 'in_progress' }, 'in_progress', 'complete_onboarding', false],
    [{ stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: null }, 'in_progress', 'complete_onboarding', false],
    [{ stripeConnectAccountId: 'acct_1', stripeConnectOnboardingStatus: 'complete' }, 'in_progress', 'complete_onboarding', false],
  ] as const)('%j → %s', (o, status, nextStep, ready) => {
    expect(r(o)).toMatchObject({ status, nextStep, ready, connectPath: '/account/stripe' })
  })
})

describe('selection + effective provider', () => {
  const mollieReady = { hasMollieToken: true, mollieOnboardingStatus: 'completed' }
  const stripeReady = { stripeConnectAccountId: 'acct_1', stripeConnectChargesEnabled: true }

  it('isSelectableProvider / selectedProvider', () => {
    expect(isSelectableProvider('stripe')).toBe(true)
    expect(isSelectableProvider('demo')).toBe(false)
    expect(isSelectableProvider(null)).toBe(false)
    expect(selectedProvider({ paymentProvider: null })).toBe('mollie')
    expect(selectedProvider({ paymentProvider: 'bogus' })).toBe('mollie')
    expect(selectedProvider({ paymentProvider: 'viva' })).toBe('viva')
  })

  it('selected provider ready → it wins over previous', () => {
    expect(effectiveProviderFor(acc({ paymentProvider: 'stripe', ...stripeReady, ...mollieReady }), 'mollie')).toBe('stripe')
  })
  it('selected not ready, previous ready → keep previous', () => {
    expect(effectiveProviderFor(acc({ paymentProvider: 'stripe', ...mollieReady }), 'mollie')).toBe('mollie')
  })
  it('neither ready → selected', () => {
    expect(effectiveProviderFor(acc({ paymentProvider: 'stripe' }), 'mollie')).toBe('stripe')
  })
  it('previous not selectable → selected', () => {
    expect(effectiveProviderFor(acc({ paymentProvider: 'stripe', ...mollieReady }), 'demo')).toBe('stripe')
    expect(effectiveProviderFor(acc({ paymentProvider: 'stripe', ...mollieReady }), null)).toBe('stripe')
  })
  it('legacy null selection → mollie', () => {
    expect(effectiveProviderFor(acc({ paymentProvider: null }), null)).toBe('mollie')
    expect(effectiveProviderFor(acc({ paymentProvider: null, ...stripeReady }), 'stripe')).toBe('stripe') // mollie not ready, previous ready
  })
})

describe('toReadinessAccount', () => {
  it('never copies the Mollie token', () => {
    const out = toReadinessAccount({ mollieAccessToken: 'access_SECRET_TOKEN_123', mollieOnboardingStatus: 'completed' })
    expect(out.hasMollieToken).toBe(true)
    expect(JSON.stringify(out)).not.toContain('SECRET_TOKEN')
    expect(Object.keys(out)).not.toContain('mollieAccessToken')
  })
  it('missing / empty token → false; partial row gets safe defaults', () => {
    expect(toReadinessAccount({ mollieAccessToken: '' }).hasMollieToken).toBe(false)
    expect(toReadinessAccount({})).toEqual({ ...base, country: null })
  })
})

/**
 * Provider readiness + effective-provider resolution (track 028, packet P2a).
 *
 * PURE and client-safe — no prisma, no fetch, no env. Operates on a token-free
 * `ReadinessAccount` projection so it can cross the server/client boundary:
 * `toReadinessAccount` converts the Mollie access token into a boolean and NEVER
 * copies the token itself.
 */
import type { SelectableProvider } from '../payment-refs'

export interface ReadinessAccount {
  country: string | null
  paymentProvider: string | null
  hasMollieToken: boolean
  mollieOnboardingStatus: string | null
  vivaAccountId: string | null
  vivaMerchantId: string | null
  vivaVerificationStatus: string | null
  stripeConnectAccountId: string | null
  stripeConnectChargesEnabled: boolean
  stripeConnectPayoutsEnabled: boolean
  stripeConnectDetailsSubmitted: boolean
  stripeConnectOnboardingStatus: string | null
  stripeConnectRequirementsDue: string[]
}

export type ReadinessStatus =
  | 'not_connected'
  | 'in_progress'
  | 'in_review'
  | 'needs_data'
  | 'ready'
  | 'restricted'

export interface ProviderReadiness {
  provider: SelectableProvider
  connected: boolean
  ready: boolean
  status: ReadinessStatus
  nextStep: 'connect' | 'complete_onboarding' | 'wait_review' | 'fix_requirements' | null
  connectPath: '/account/mollie' | '/account/viva' | '/account/stripe'
}

/** Prisma `select` for a PartnerAccount row feeding `toReadinessAccount`. */
export const READINESS_SELECT = {
  country: true,
  paymentProvider: true,
  mollieAccessToken: true,
  mollieOnboardingStatus: true,
  vivaAccountId: true,
  vivaMerchantId: true,
  vivaVerificationStatus: true,
  stripeConnectAccountId: true,
  stripeConnectChargesEnabled: true,
  stripeConnectPayoutsEnabled: true,
  stripeConnectDetailsSubmitted: true,
  stripeConnectOnboardingStatus: true,
  stripeConnectRequirementsDue: true,
} as const

type ReadinessRow = { mollieAccessToken?: string | null } & Partial<
  Omit<ReadinessAccount, 'hasMollieToken'>
>

export function toReadinessAccount(row: ReadinessRow): ReadinessAccount {
  return {
    country: row.country ?? null,
    paymentProvider: row.paymentProvider ?? null,
    hasMollieToken: Boolean(row.mollieAccessToken),
    mollieOnboardingStatus: row.mollieOnboardingStatus ?? null,
    vivaAccountId: row.vivaAccountId ?? null,
    vivaMerchantId: row.vivaMerchantId ?? null,
    vivaVerificationStatus: row.vivaVerificationStatus ?? null,
    stripeConnectAccountId: row.stripeConnectAccountId ?? null,
    stripeConnectChargesEnabled: row.stripeConnectChargesEnabled ?? false,
    stripeConnectPayoutsEnabled: row.stripeConnectPayoutsEnabled ?? false,
    stripeConnectDetailsSubmitted: row.stripeConnectDetailsSubmitted ?? false,
    stripeConnectOnboardingStatus: row.stripeConnectOnboardingStatus ?? null,
    stripeConnectRequirementsDue: row.stripeConnectRequirementsDue ?? [],
  }
}

export function isSelectableProvider(v: unknown): v is SelectableProvider {
  return v === 'mollie' || v === 'viva' || v === 'stripe'
}

/** The partner's SELECTED provider; null/invalid (legacy) → mollie. */
export function selectedProvider(account: Pick<ReadinessAccount, 'paymentProvider'>): SelectableProvider {
  return isSelectableProvider(account.paymentProvider) ? account.paymentProvider : 'mollie'
}

type Outcome = Pick<ProviderReadiness, 'connected' | 'ready' | 'status' | 'nextStep'>

const NOT_CONNECTED: Outcome = { connected: false, ready: false, status: 'not_connected', nextStep: 'connect' }

function mollie(a: ReadinessAccount): Outcome {
  if (!a.hasMollieToken) return NOT_CONNECTED
  // Must match the discovery gate exactly: token present AND onboarding 'completed'.
  switch (a.mollieOnboardingStatus) {
    case 'completed':
      return { connected: true, ready: true, status: 'ready', nextStep: null }
    case 'needs-data':
      return { connected: true, ready: false, status: 'needs_data', nextStep: 'complete_onboarding' }
    case 'in-review':
      return { connected: true, ready: false, status: 'in_review', nextStep: 'wait_review' }
    default:
      return { connected: true, ready: false, status: 'in_progress', nextStep: 'complete_onboarding' }
  }
}

function viva(a: ReadinessAccount): Outcome {
  if (!a.vivaAccountId) return NOT_CONNECTED
  if (a.vivaMerchantId && a.vivaVerificationStatus === 'verified') {
    return { connected: true, ready: true, status: 'ready', nextStep: null }
  }
  if (a.vivaVerificationStatus === 'rejected') {
    return { connected: true, ready: false, status: 'restricted', nextStep: 'fix_requirements' }
  }
  // 'pending' | 'unknown' | null, or verified-but-no-merchant-id-yet: Viva is still reviewing.
  return { connected: true, ready: false, status: 'in_review', nextStep: 'wait_review' }
}

function stripe(a: ReadinessAccount): Outcome {
  if (!a.stripeConnectAccountId) return NOT_CONNECTED
  if (a.stripeConnectChargesEnabled) return { connected: true, ready: true, status: 'ready', nextStep: null }
  if (a.stripeConnectOnboardingStatus === 'restricted') {
    return { connected: true, ready: false, status: 'restricted', nextStep: 'fix_requirements' }
  }
  if (a.stripeConnectOnboardingStatus === 'pending_verification') {
    return { connected: true, ready: false, status: 'in_review', nextStep: 'wait_review' }
  }
  return { connected: true, ready: false, status: 'in_progress', nextStep: 'complete_onboarding' }
}

const CONNECT_PATH: Record<SelectableProvider, ProviderReadiness['connectPath']> = {
  mollie: '/account/mollie',
  viva: '/account/viva',
  stripe: '/account/stripe',
}

export function providerReadiness(account: ReadinessAccount, provider: SelectableProvider): ProviderReadiness {
  const o = provider === 'mollie' ? mollie(account) : provider === 'viva' ? viva(account) : stripe(account)
  return { provider, ...o, connectPath: CONNECT_PATH[provider] }
}

/**
 * Which provider a venue's sites should currently charge through. The selected one
 * once it is ready; until then keep the previous effective one if it still works
 * (so switching never strands a venue mid-onboarding); else the selection.
 */
export function effectiveProviderFor(
  account: ReadinessAccount,
  previousEffective: string | null
): SelectableProvider {
  const sel = selectedProvider(account)
  if (providerReadiness(account, sel).ready) return sel
  if (isSelectableProvider(previousEffective) && providerReadiness(account, previousEffective).ready) {
    return previousEffective
  }
  return sel
}

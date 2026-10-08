/**
 * Stripe Connect account lifecycle (track 028, P3a). SERVER-ONLY.
 *
 * Accounts are created with `controller` properties (not a legacy account `type`):
 * the platform owns requirement collection (we embed onboarding), loss liability and
 * the fee payer, and the connected account has NO Stripe dashboard. Consumer charges
 * are DIRECT charges on the connected account (track 003) — see `checkout.ts`.
 */
import type Stripe from 'stripe'
import { getStripeConnectClient } from './client'

export const CONNECT_CONTROLLER = {
  requirement_collection: 'application',
  losses: { payments: 'application' },
  fees: { payer: 'application' },
  stripe_dashboard: { type: 'none' },
} as const

export type ConnectOnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_verification'
  | 'complete'
  | 'restricted'

export interface AccountSnapshot {
  accountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  currentlyDue: string[]
  eventuallyDue: string[]
  pastDue: string[]
  disabledReason: string | null
  errors: { requirement: string; reason: string }[]
  status: ConnectOnboardingStatus
}

export interface CreateConnectedAccountInput {
  partnerAccountId: string
  country: string
  email: string
  businessType: 'company' | 'individual'
}

export interface AddressInput {
  line1: string
  city: string
  postal_code: string
  country: string
}

export interface DobInput {
  day: number
  month: number
  year: number
}

export interface PersonBaseInput {
  first_name: string
  last_name: string
  email: string
  phone: string
  dob: DobInput
  address: AddressInput
  /** ISO-3166 alpha-2 nationality (required by Stripe for ES and other EU accounts). */
  nationality?: string
  id_number?: string
}

export interface BusinessProfileInput {
  businessType: 'company' | 'individual'
  company?: { name: string; tax_id?: string; phone?: string; address: AddressInput }
  individual?: PersonBaseInput
  representative?: PersonBaseInput & {
    title: string
    /** When true the representative is also a beneficial owner (relationship.owner). */
    owner?: boolean
    percent_ownership?: number
  }
  /** Additional beneficial owners (company only); matched to existing persons by email. */
  owners?: Array<{
    first_name: string
    last_name: string
    email: string
    dob: DobInput
    address: AddressInput
    nationality?: string
    percent_ownership?: number
  }>
  mcc?: string
  url?: string
  productDescription?: string
}

/** Merchant category code default: 7999 = recreation services (sunbed / equipment hire). */
const DEFAULT_MCC = '7999'

export function snapshotFromAccount(a: Stripe.Account): AccountSnapshot {
  const req = a.requirements
  const currentlyDue = req?.currently_due ?? []
  const eventuallyDue = req?.eventually_due ?? []
  const pastDue = req?.past_due ?? []
  const chargesEnabled = !!a.charges_enabled
  const payoutsEnabled = !!a.payouts_enabled
  const detailsSubmitted = !!a.details_submitted
  const disabledReason = req?.disabled_reason ?? null

  let status: ConnectOnboardingStatus
  if (chargesEnabled && payoutsEnabled && currentlyDue.length === 0) status = 'complete'
  else if ((disabledReason && !chargesEnabled) || pastDue.length > 0) status = 'restricted'
  else if (detailsSubmitted && currentlyDue.length === 0 && !chargesEnabled) status = 'pending_verification'
  else if (!detailsSubmitted && !a.business_type) status = 'not_started'
  else status = 'in_progress'

  return {
    accountId: a.id,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDue,
    eventuallyDue,
    pastDue,
    disabledReason,
    errors: (req?.errors ?? []).map((e) => ({ requirement: e.requirement, reason: e.reason })),
    status,
  }
}

export function snapshotToColumns(s: AccountSnapshot) {
  return {
    stripeConnectChargesEnabled: s.chargesEnabled,
    stripeConnectPayoutsEnabled: s.payoutsEnabled,
    stripeConnectDetailsSubmitted: s.detailsSubmitted,
    stripeConnectOnboardingStatus: s.status,
    stripeConnectRequirementsDue: Array.from(new Set([...s.currentlyDue, ...s.pastDue])),
  }
}

export async function retrieveAccountSnapshot(accountId: string): Promise<AccountSnapshot> {
  const account = await getStripeConnectClient().accounts.retrieve(accountId)
  return snapshotFromAccount(account)
}

export async function createConnectedAccount(
  input: CreateConnectedAccountInput,
): Promise<{ accountId: string }> {
  const account = await getStripeConnectClient().accounts.create({
    country: input.country,
    email: input.email,
    business_type: input.businessType,
    controller: CONNECT_CONTROLLER,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { partnerAccountId: input.partnerAccountId },
  })
  return { accountId: account.id }
}

export async function updateBusinessProfile(
  accountId: string,
  input: BusinessProfileInput,
): Promise<AccountSnapshot> {
  const stripe = getStripeConnectClient()
  await stripe.accounts.update(accountId, {
    business_type: input.businessType,
    ...(input.businessType === 'company' && input.company ? { company: input.company } : {}),
    ...(input.businessType === 'individual' && input.individual ? { individual: input.individual } : {}),
    business_profile: {
      mcc: input.mcc ?? DEFAULT_MCC,
      ...(input.url ? { url: input.url } : {}),
      ...(input.productDescription ? { product_description: input.productDescription } : {}),
    },
  })

  if (input.businessType === 'company') {
    if (input.representative) {
      const { title, owner, percent_ownership, ...person } = input.representative
      const existing = await stripe.accounts.listPersons(accountId, {
        relationship: { representative: true },
        limit: 1,
      })
      const first = existing.data[0]
      const rel = {
        ...(title ? { title } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(percent_ownership !== undefined ? { percent_ownership } : {}),
      }
      if (first) {
        await stripe.accounts.updatePerson(accountId, first.id, { ...person, relationship: rel })
      } else {
        await stripe.accounts.createPerson(accountId, {
          ...person,
          relationship: { representative: true, executive: true, ...rel },
        })
      }
    }

    for (const o of input.owners ?? []) {
      const { percent_ownership, ...person } = o
      const relationship = {
        owner: true,
        ...(percent_ownership !== undefined ? { percent_ownership } : {}),
      }
      const list = await stripe.accounts.listPersons(accountId, { limit: 100 })
      const match = list.data.find((p) => p.email && p.email.toLowerCase() === o.email.toLowerCase())
      if (match) await stripe.accounts.updatePerson(accountId, match.id, { ...person, relationship })
      else await stripe.accounts.createPerson(accountId, { ...person, relationship })
    }

    if (input.representative) {
      await stripe.accounts.update(accountId, {
        company: { owners_provided: true, directors_provided: true, executives_provided: true },
      })
    }
  }

  return retrieveAccountSnapshot(accountId)
}

export async function attachExternalAccount(
  accountId: string,
  ext: { token: string } | { iban: string; accountHolderName: string; country: string; currency: 'eur' },
): Promise<AccountSnapshot> {
  const external_account =
    'token' in ext
      ? ext.token
      : {
          object: 'bank_account' as const,
          country: ext.country,
          currency: ext.currency,
          account_number: ext.iban,
          account_holder_name: ext.accountHolderName,
        }
  await getStripeConnectClient().accounts.update(accountId, { external_account })
  return retrieveAccountSnapshot(accountId)
}

export async function acceptTos(
  accountId: string,
  tos: { date: number; ip: string; userAgent: string },
): Promise<AccountSnapshot> {
  await getStripeConnectClient().accounts.update(accountId, {
    tos_acceptance: { date: tos.date, ip: tos.ip, user_agent: tos.userAgent },
  })
  return retrieveAccountSnapshot(accountId)
}

/** Embedded-component session for the partner's onboarding / payouts UI. */
export async function createAccountSession(accountId: string): Promise<{ clientSecret: string }> {
  const session = await getStripeConnectClient().accountSessions.create({
    account: accountId,
    components: {
      account_management: {
        enabled: true,
        features: { external_account_collection: true, disable_stripe_user_authentication: true },
      },
      payouts: {
        enabled: true,
        features: {
          disable_stripe_user_authentication: true,
          instant_payouts: false,
          standard_payouts: true,
          edit_payout_schedule: true,
          external_account_collection: true,
        },
      },
      payments: {
        enabled: true,
        features: { refund_management: false, dispute_management: true, capture_payments: false },
      },
      balances: {
        enabled: true,
        features: {
          disable_stripe_user_authentication: true,
          instant_payouts: false,
          standard_payouts: true,
          edit_payout_schedule: true,
          external_account_collection: true,
        },
      },
      notification_banner: {
        enabled: true,
        features: { disable_stripe_user_authentication: true, external_account_collection: true },
      },
    },
  })
  return { clientSecret: session.client_secret }
}

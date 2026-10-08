/**
 * Online-checkout adapter contract (track 028). PURE — no prisma, no fetch, no env —
 * so client code and tests can import the shapes without dragging in a driver.
 */
import type { PaymentState } from '../payment-refs'

export type PaymentEntityType = 'reservation' | 'order' | 'rental-booking' | 'table-deposit' | 'tab'

/** What the Mollie paths put in Mollie `metadata`; the webhook keys on it. */
export interface PaymentMeta {
  type: PaymentEntityType
  entityId: string
  siteId?: string
  restaurantId?: string
  bookingIds?: string[]
  collect?: boolean
}

export interface ProviderAccount {
  partnerAccountId: string
  stripeConnectAccountId?: string | null
  /** Mirrors `PartnerAccount.stripeConnectChargesEnabled`; gates Stripe checkout. */
  stripeConnectChargesEnabled?: boolean
  vivaMerchantId?: string | null
  vivaSourceCode?: string | null
  /** Mirrors `PartnerAccount.vivaVerificationStatus`; Viva online requires 'verified'. */
  vivaVerificationStatus?: string | null
}

export interface CheckoutIntent {
  amount: number
  currency: 'EUR'
  serviceCode: 'sunbed-rental' | 'food-and-beverage' | 'equipment-rental' | null
  applicationFee: number
  description: string
  meta: PaymentMeta
  partnerAccountId: string
  createdAt: Date
}

export interface OnlineCheckoutAdapter {
  id: 'stripe' | 'viva'
  createCheckout(
    intent: CheckoutIntent,
    urls: { redirectUrl: string; webhookUrl: string },
    acct: ProviderAccount,
  ): Promise<{ checkoutUrl: string; paymentRef: string }>
  fetchState(paymentRef: string, acct: ProviderAccount): Promise<PaymentState>
  refund(paymentRef: string, acct: ProviderAccount, amount?: number): Promise<void>
  cancel?(paymentRef: string, acct: ProviderAccount): Promise<'canceled' | 'paid' | 'error'>
}

export class ProviderNotWiredError extends Error {
  constructor(provider: string) {
    super(`Payment provider ${provider} is not wired yet (track 028)`)
    this.name = 'ProviderNotWiredError'
  }
}

/** The venue has not finished connecting this provider (e.g. no Stripe connected account). */
export class ProviderNotReadyError extends Error {
  constructor(provider: string) {
    super(`Venue is not ready to accept ${provider} payments`)
    this.name = 'ProviderNotReadyError'
  }
}

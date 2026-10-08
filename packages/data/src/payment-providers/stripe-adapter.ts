/**
 * Stripe `OnlineCheckoutAdapter` (track 028, P3a): direct charges on the venue's Connect
 * account. SERVER-ONLY (pulls the Stripe SDK) — hence a separate file from `index.ts`'s
 * pure types; `index.ts` registers it.
 */
import { stripeCheckoutRef, stripeIdFromRef, isStripeCheckoutRef, type PaymentState } from '../payment-refs'
import {
  createCheckoutSession,
  expireCheckoutSession,
  fetchCheckoutState,
  fetchPaymentIntentState,
  refundPaymentIntent,
} from '../stripe/checkout'
import { stripeApplicationFee } from './fee-policy'
import { ProviderNotReadyError, type OnlineCheckoutAdapter, type ProviderAccount } from './types'

function requireAccount(acct: ProviderAccount): string {
  if (!acct.stripeConnectAccountId) throw new ProviderNotReadyError('Stripe')
  return acct.stripeConnectAccountId
}

export const stripeAdapter: OnlineCheckoutAdapter = {
  id: 'stripe',

  async createCheckout(intent, urls, acct) {
    const account = requireAccount(acct)
    // Deposits have no commission (applicationFee 0) but still carry the processing pass-through.
    const fee = stripeApplicationFee(intent.applicationFee, intent.amount)
    const { checkoutUrl, sessionId } = await createCheckoutSession(intent, urls, account, fee)
    return { checkoutUrl, paymentRef: stripeCheckoutRef(sessionId) }
  },

  async fetchState(ref, acct): Promise<PaymentState> {
    const account = requireAccount(acct)
    const id = stripeIdFromRef(ref)
    if (isStripeCheckoutRef(ref)) return (await fetchCheckoutState(id, account)).state
    return (await fetchPaymentIntentState(id, account)).state
  },

  async refund(ref, acct, amount) {
    const account = requireAccount(acct)
    const id = stripeIdFromRef(ref)
    let piId = id
    if (isStripeCheckoutRef(ref)) {
      const s = await fetchCheckoutState(id, account)
      if (!s.paymentIntentId) throw new Error('Checkout session has no payment to refund')
      piId = s.paymentIntentId
    }
    await refundPaymentIntent(piId, account, amount === undefined ? undefined : Math.round(amount * 100))
  },

  async cancel(ref, acct) {
    const account = requireAccount(acct)
    if (!isStripeCheckoutRef(ref)) return 'error'
    return expireCheckoutSession(stripeIdFromRef(ref), account)
  },
}

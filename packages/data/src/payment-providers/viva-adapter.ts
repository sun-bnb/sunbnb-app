/**
 * Viva Smart Checkout `OnlineCheckoutAdapter` (track 028, P4a). SERVER-ONLY.
 * Viva's ISV fee is withheld by Viva and credited monthly, so there is no Stripe-style
 * processing pass-through: the ISV amount is the commission only.
 */
import { orderCodeFromVivaCheckoutRef, vivaCheckoutRefFromOrder, type PaymentState } from '../payment-refs'
import { toCents } from '../payment-math'
import { getVivaCheckoutClient } from '../viva'
import { assertValidIsvFee } from '../viva/types'
import { ProviderNotReadyError, type OnlineCheckoutAdapter, type ProviderAccount } from './types'

function requireMerchant(acct: ProviderAccount): string {
  if (!acct.vivaMerchantId) throw new ProviderNotReadyError('Viva')
  return acct.vivaMerchantId
}

export const vivaAdapter: OnlineCheckoutAdapter = {
  id: 'viva',

  async createCheckout(intent, _urls, acct) {
    const merchantId = requireMerchant(acct)
    const fee = intent.applicationFee
    const amountCents = toCents(intent.amount)
    let isvAmountCents = 0
    if (intent.serviceCode !== null) {
      if (fee <= 0) {
        // Mirrors the card-present refusal in reservation-machine-apply.ts (launch promotion).
        throw new ProviderNotReadyError('Viva online requires a positive ISV fee (launch promotion waives commission)')
      }
      isvAmountCents = toCents(fee)
      assertValidIsvFee(amountCents, isvAmountCents)
    }
    // else deposit: isvAmount 0. VERIFY: does Viva accept isvAmount 0 for ISV orders?
    const client = getVivaCheckoutClient()
    const { orderCode } = await client.createOrder({
      amountCents,
      isvAmountCents,
      customerTrns: intent.description,
      merchantTrns: `${intent.meta.type}:${intent.meta.entityId}`,
      merchantId,
      tags: ['sunbnb', intent.meta.type],
    })
    return { checkoutUrl: client.checkoutUrl(orderCode), paymentRef: vivaCheckoutRefFromOrder(orderCode) }
  },

  async fetchState(ref): Promise<PaymentState> {
    return (await getVivaCheckoutClient().getOrder(orderCodeFromVivaCheckoutRef(ref))).state
  },

  async refund(ref, _acct, amount) {
    const client = getVivaCheckoutClient()
    const order = await client.getOrder(orderCodeFromVivaCheckoutRef(ref))
    if (!order.transactionId) throw new Error('Viva order has no transaction to refund')
    let cents = amount === undefined ? undefined : toCents(amount)
    if (cents === undefined) {
      const tx = await client.getTransaction(order.transactionId)
      if (tx.amountCents === null) throw new Error('Viva transaction has no amount to refund')
      cents = tx.amountCents
    }
    await client.refund(order.transactionId, cents)
  },

  // Smart Checkout orders can't be cancelled from our side; callers poll until they expire.
  async cancel() {
    return 'error'
  },
}

/** Status in the `getReservationPaymentStatus` / `getRentalBookingPaymentStatus` shape (cf. `getStripeRefStatus`). */
export type VivaRefStatus =
  | { status: 'ok'; providerStatus: string; succeeded: boolean; failed: boolean }
  | { status: 'error'; error: string }

export async function getVivaCheckoutRefStatus(ref: string): Promise<VivaRefStatus> {
  try {
    const state = await vivaAdapter.fetchState(ref, { partnerAccountId: '' })
    return {
      status: 'ok',
      providerStatus: state,
      succeeded: state === 'paid' || state === 'refunded',
      failed: state === 'failed',
    }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'Viva lookup failed' }
  }
}

/**
 * Viva Smart Checkout (ONLINE) client contract (track 028, P4a). PURE: no fetch/env/prisma.
 * Separate from the Cloud Terminal `VivaClient` (card-present, `viva_` refs).
 */
import type { PaymentState } from '../payment-refs'

export interface VivaOrderRequest {
  amountCents: number
  /** ISV fee in cents (withheld by Viva, credited monthly). */
  isvAmountCents: number
  customerTrns: string
  merchantTrns: string
  /** The connected (venue) merchant the order is created for. */
  merchantId: string
  sourceCode?: string
  tags?: string[]
  paymentTimeoutSec?: number
}

export interface VivaOrderState {
  state: PaymentState
  transactionId?: string
  raw?: unknown
}

export interface VivaTransactionState {
  state: PaymentState
  statusId: string
  orderCode: string | null
  amountCents: number | null
  raw?: unknown
}

export interface VivaCheckoutClient {
  createOrder(req: VivaOrderRequest): Promise<{ orderCode: string }>
  getOrder(orderCode: string): Promise<VivaOrderState>
  getTransaction(transactionId: string): Promise<VivaTransactionState>
  refund(transactionId: string, amountCents: number): Promise<void>
  checkoutUrl(orderCode: string): string
}

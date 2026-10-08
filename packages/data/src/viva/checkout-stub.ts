/**
 * In-process Viva Smart Checkout stub (track 028, P4a). Module-level store (mirrors `stub-client.ts`):
 * call `checkoutStubState.reset()` in `beforeEach`.
 */
import type { PaymentState } from '../payment-refs'
import { DEFAULT_RESOLVE_AFTER_MS } from './stub-client'
import type { VivaCheckoutClient, VivaOrderState, VivaTransactionState } from './checkout-types'

interface StubOrder {
  createdAt: number
  amountCents: number
  merchantTrns: string
  transactionId: string
  paidAt?: number
  outcome?: 'paid' | 'failed' | 'refunded'
}

// Held on globalThis, not module scope: Next dev compiles API routes and RSC pages into
// separate module graphs, so a module-level Map minted by the create route was invisible to
// the `/payment/viva/stub` page ("Unknown stub order", browser-verified 2026-10-07).
const STORE_KEY = '__sunbnbVivaCheckoutStub'
const g = globalThis as unknown as Record<string, Map<string, StubOrder> | undefined>
const store: Map<string, StubOrder> = (g[STORE_KEY] ??= new Map<string, StubOrder>())
const TX_PREFIX = 'stubtx_'

function mintOrderCode(): string {
  let code = String(1 + Math.floor(Math.random() * 9))
  while (code.length < 16) code += Math.floor(Math.random() * 10)
  return code
}

function stateOf(o: StubOrder, resolveAfterMs: number): PaymentState {
  if (o.outcome === 'refunded') return 'refunded'
  if (o.outcome === 'failed') return 'failed'
  if (o.outcome === 'paid') return 'paid'
  const lower = o.merchantTrns.toLowerCase()
  if (lower.includes('decline') || lower.includes('expire')) return 'failed'
  if (process.env.VIVA_STUB_AUTO_PAY !== 'false' && Date.now() - o.createdAt >= resolveAfterMs) return 'paid'
  return 'pending'
}

export function createStubVivaCheckoutClient(opts?: { resolveAfterMs?: number; appUrl?: string }): VivaCheckoutClient {
  const resolveAfterMs = opts?.resolveAfterMs ?? DEFAULT_RESOLVE_AFTER_MS
  const orderFor = (transactionId: string) => {
    const code = transactionId.startsWith(TX_PREFIX) ? transactionId.slice(TX_PREFIX.length) : transactionId
    return { code, order: store.get(code) }
  }
  return {
    async createOrder(req) {
      let orderCode = mintOrderCode()
      while (store.has(orderCode)) orderCode = mintOrderCode()
      store.set(orderCode, {
        createdAt: Date.now(),
        amountCents: req.amountCents,
        merchantTrns: req.merchantTrns,
        transactionId: TX_PREFIX + orderCode,
      })
      return { orderCode }
    },
    async getOrder(orderCode): Promise<VivaOrderState> {
      const o = store.get(orderCode)
      if (!o) return { state: 'pending', raw: null }
      const state = stateOf(o, resolveAfterMs)
      return {
        state,
        transactionId: state === 'paid' || state === 'refunded' ? o.transactionId : undefined,
        raw: { stub: true },
      }
    },
    async getTransaction(transactionId): Promise<VivaTransactionState> {
      const { code, order } = orderFor(transactionId)
      if (!order) return { state: 'pending', statusId: '', orderCode: null, amountCents: null, raw: null }
      const state = stateOf(order, resolveAfterMs)
      const statusId = state === 'paid' ? 'F' : state === 'refunded' ? 'R' : state === 'failed' ? 'E' : 'A'
      return { state, statusId, orderCode: code, amountCents: order.amountCents, raw: { stub: true } }
    },
    async refund(transactionId) {
      const { order } = orderFor(transactionId)
      if (!order || stateOf(order, resolveAfterMs) !== 'paid') {
        throw new Error(`Stub Viva refund: transaction ${transactionId} is not a paid sale`)
      }
      order.outcome = 'refunded'
    },
    checkoutUrl(orderCode) {
      return `${opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? ''}/payment/viva/stub?ref=${orderCode}`
    },
  }
}

export const checkoutStubState = {
  pay(orderCode: string): void {
    const o = store.get(orderCode)
    if (!o) throw new Error(`Stub Viva order not found: ${orderCode}`)
    o.outcome = 'paid'
    o.paidAt = Date.now()
  },
  fail(orderCode: string): void {
    const o = store.get(orderCode)
    if (!o) throw new Error(`Stub Viva order not found: ${orderCode}`)
    o.outcome = 'failed'
  },
  get(orderCode: string): Readonly<StubOrder> | undefined {
    return store.get(orderCode)
  },
  reset(): void {
    store.clear()
  },
}

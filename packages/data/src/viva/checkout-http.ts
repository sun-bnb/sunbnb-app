/**
 * Real Viva Smart Checkout HTTP client (track 028, P4a). Server-only.
 * Reuses the ISV OAuth token cache and error plumbing from `http-client.ts`.
 */
import type { PaymentState } from '../payment-refs'
import { apiBase, getAccessToken, parseErrorBody, requireOk, VivaApiError } from './http-client'
import type { VivaEnv, VivaIsvConfig } from './types'
import type {
  VivaCheckoutClient,
  VivaOrderRequest,
} from './checkout-types'

/** EVERY unverified Viva Smart Checkout detail lives here (track 028 P4, 2026-10-07: developer.viva.com unreachable). Correct here only. */
export const vivaOnlineHttp = {
  scope: 'urn:viva:payments:core:api:isv', // VERIFY: ISV e-commerce scope
  orderPath: '/checkout/v2/isv/orders', // VERIFY: ISV variant vs '/checkout/v2/orders'
  orderStatusPath: (orderCode: string) => `/checkout/v2/orders/${orderCode}`, // VERIFY
  transactionPath: (id: string) => `/checkout/v2/transactions/${id}`,
  refundPath: (id: string, amountCents: number) => `/acquiring/v1/transactions/${id}?amount=${amountCents}`, // VERIFY (DELETE)
  refundMethod: 'DELETE' as const,
  orderBody: (req: VivaOrderRequest, sourceCode: string) => ({
    amount: req.amountCents,
    isvAmount: req.isvAmountCents,
    customerTrns: req.customerTrns,
    merchantTrns: req.merchantTrns,
    sourceCode: req.sourceCode ?? sourceCode,
    tags: req.tags,
    paymentTimeout: req.paymentTimeoutSec ?? 1800,
  }),
  merchantQuery: (merchantId: string) => `merchantId=${encodeURIComponent(merchantId)}`, // VERIFY: how the ISV names the connected merchant (query param / header / body field)
  statusMap: { F: 'paid', A: 'pending', C: 'pending', E: 'failed', X: 'failed', M: 'failed', R: 'refunded' } as Record<
    string,
    PaymentState
  >,
  checkoutHost: (env: VivaEnv) => (env === 'production' ? 'https://www.vivapayments.com' : 'https://demo.vivapayments.com'),
}

function mapStatus(statusId: unknown): PaymentState {
  return (typeof statusId === 'string' && vivaOnlineHttp.statusMap[statusId]) || 'pending'
}

export function createVivaCheckoutHttpClient(config: VivaIsvConfig, opts?: { color?: string }): VivaCheckoutClient {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getAccessToken(config, vivaOnlineHttp.scope)
    return fetch(`${apiBase(config)}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })
  }

  return {
    async createOrder(req) {
      const res = await call(`${vivaOnlineHttp.orderPath}?${vivaOnlineHttp.merchantQuery(req.merchantId)}`, {
        method: 'POST',
        body: JSON.stringify(vivaOnlineHttp.orderBody(req, config.sourceCode)),
      })
      await requireOk(res)
      const body = (await res.json()) as { orderCode?: number | string }
      if (body.orderCode === undefined || body.orderCode === null) {
        throw new VivaApiError(res.status, body, 'Viva order response had no orderCode')
      }
      return { orderCode: String(body.orderCode) }
    },

    async getOrder(orderCode) {
      const res = await call(vivaOnlineHttp.orderStatusPath(orderCode), { method: 'GET' })
      if (res.status === 404) return { state: 'pending', raw: null }
      await requireOk(res)
      const raw = (await res.json()) as Record<string, unknown>
      const transactionId = typeof raw.transactionId === 'string' ? raw.transactionId : undefined
      // VERIFY: the order lookup may not expose statusId; if there's a transaction, confirm via it.
      if (raw.statusId !== undefined) return { state: mapStatus(raw.statusId), transactionId, raw }
      if (transactionId) return { state: (await this.getTransaction(transactionId)).state, transactionId, raw }
      return { state: 'pending', raw }
    },

    async getTransaction(transactionId) {
      const res = await call(vivaOnlineHttp.transactionPath(transactionId), { method: 'GET' })
      await requireOk(res)
      const raw = (await res.json()) as Record<string, unknown>
      const statusId = typeof raw.statusId === 'string' ? raw.statusId : ''
      const amountCents = typeof raw.amount === 'number' ? Math.round(raw.amount * 100) : null // VERIFY: amount is in euros on this endpoint
      const orderCode = raw.orderCode === undefined || raw.orderCode === null ? null : String(raw.orderCode)
      return { state: mapStatus(statusId), statusId, orderCode, amountCents, raw }
    },

    async refund(transactionId, amountCents) {
      const res = await call(vivaOnlineHttp.refundPath(transactionId, amountCents), {
        method: vivaOnlineHttp.refundMethod,
      })
      if (!res.ok) throw new VivaApiError(res.status, await parseErrorBody(res))
    },

    checkoutUrl(orderCode) {
      const color = opts?.color ? `&color=${encodeURIComponent(opts.color.replace(/^#/, ''))}` : ''
      return `${vivaOnlineHttp.checkoutHost(config.env)}/web/checkout?ref=${encodeURIComponent(orderCode)}${color}`
    },
  }
}

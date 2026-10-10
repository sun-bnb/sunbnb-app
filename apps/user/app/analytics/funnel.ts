/**
 * Pure GA4 funnel helpers (no React, no gtag import) so the param shapes and the
 * once-per-transaction guard are unit-testable. The thin client wrappers that actually
 * call `gaEvent` live in ./track.ts.
 *
 * Privacy: params carry only site id/name, a category, an amount and the entity id used as
 * transaction_id. Never add email, name, phone, anonId or user ids here.
 */

export type FunnelKind = 'sunbed' | 'fnb' | 'rental'

export const CURRENCY = 'EUR'

export interface FunnelItem {
  item_id: string
  item_name?: string
  item_category: FunnelKind
  quantity?: number
}

export interface FunnelInput {
  kind: FunnelKind
  siteId: string
  siteName?: string | null
  /** Amount in EUR exactly as the server/UI states it (never computed here). */
  value: number
  /** Units booked (sunbeds, rental units, order lines); omitted when unknown. */
  quantity?: number
}

function buildItems({ kind, siteId, siteName, quantity }: FunnelInput): FunnelItem[] {
  return [{
    item_id: siteId,
    ...(siteName ? { item_name: siteName } : {}),
    item_category: kind,
    ...(quantity && quantity > 0 ? { quantity } : {}),
  }]
}

const validValue = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** `begin_checkout` params, or null when there is no positive amount to report. */
export function buildBeginCheckoutParams(input: FunnelInput) {
  if (!input.siteId || !validValue(input.value)) return null
  return { currency: CURRENCY, value: input.value, items: buildItems(input) }
}

/** `purchase` params, or null without a transaction id / positive paid amount. */
export function buildPurchaseParams(input: FunnelInput & { transactionId: string }) {
  if (!input.transactionId || !input.siteId || !validValue(input.value)) return null
  return {
    transaction_id: input.transactionId,
    currency: CURRENCY,
    value: input.value,
    items: buildItems(input),
  }
}

/** `view_item` params for a site page (item_id = site id). */
export function buildViewItemParams(site: { id?: string | null; name?: string | null }, kind: FunnelKind) {
  if (!site.id) return null
  return {
    items: [{
      item_id: site.id,
      ...(site.name ? { item_name: site.name } : {}),
      item_category: kind,
    }],
  }
}

/** Which funnel category a site page represents (sunbeds win, then rentals, else F&B). */
export function siteCategory(features: string[] | undefined): FunnelKind {
  const f = features ?? ['sunbeds']
  if (f.includes('sunbeds')) return 'sunbed'
  if (f.includes('rentals')) return 'rental'
  return 'fnb'
}

export type AuthMethod = 'google' | 'facebook' | 'credentials'

/** GA4 recommended `sign_up` for the sign-in that created the account, else `login`. */
export function authEvent(method: string, isNewUser: boolean | undefined) {
  return { name: isNewUser ? 'sign_up' : 'login', params: { method } }
}

/**
 * Whether a payment-return screen may report `purchase`: the entity must be in its terminal
 * paid/complete status AND carry a paymentRef (default-deny - failed, expired, processing and
 * unpaid pay-later states never qualify). Pass the app's own constants for `completeStatus`.
 */
export function isPaidPurchase(entity: { status?: string | null; paymentRef?: string | null }, completeStatus: string): boolean {
  return entity.status === completeStatus && !!entity.paymentRef
}

/** Minimal Storage surface (Pick-style to satisfy apps/user's type-position lint). */
export type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>

const SENT_PREFIX = 'ga:sent:'

/**
 * Run `send` at most once per `key` across re-renders, revisits and tabs. The marker is only
 * written when `canSend()` is true, so a visit before consent / before gtag is ready does not
 * burn the one chance. Storage failures (private mode) fall back to an in-memory set.
 * Returns whether `send` ran.
 */
const memorySent = new Set<string>()

export function sendOnce(
  key: string,
  send: () => void,
  opts: { storage?: GuardStorage | null; canSend?: () => boolean } = {},
): boolean {
  const storageKey = SENT_PREFIX + key
  if (opts.canSend && !opts.canSend()) return false
  if (memorySent.has(storageKey)) return false
  try {
    if (opts.storage?.getItem(storageKey)) {
      memorySent.add(storageKey)
      return false
    }
  } catch { /* fall through to memory guard */ }
  memorySent.add(storageKey)
  try { opts.storage?.setItem(storageKey, '1') } catch { /* memory guard still holds */ }
  send()
  return true
}

/** Test seam: forget the in-memory guard. */
export function resetSentGuard() {
  memorySent.clear()
}

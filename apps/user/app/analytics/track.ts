'use client'

/**
 * Client-side GA4 funnel tracking. Wraps `gaEvent` (a no-op before cookie consent / on the
 * server) with the param builders and the once-per-transaction guard from ./funnel.
 * Server actions can't call gtag, so every call site is a client component that fires after
 * the action/endpoint reported success, or on the payment-return/confirmation screen.
 */
import { gaEvent } from '@repo/ui/google-analytics'
import {
  buildBeginCheckoutParams,
  buildPurchaseParams,
  buildViewItemParams,
  authEvent,
  sendOnce,
  type AuthMethod,
  type FunnelInput,
  type FunnelKind,
} from './funnel'

const gtagReady = () => typeof window !== 'undefined' && typeof window.gtag === 'function'

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

function consented() {
  return typeof document !== 'undefined' && /(?:^|; )cookie_consent=accepted(?:;|$)/.test(document.cookie)
}

/**
 * The payment-return page can render before the consented gtag snippet has initialised
 * (afterInteractive). Retry briefly instead of silently dropping the purchase.
 */
function whenReady(fn: () => void, tries = 40) {
  if (gtagReady()) return fn()
  if (!consented() || tries <= 0) return
  setTimeout(() => whenReady(fn, tries - 1), 250)
}

export function trackSearch(searchTerm: string) {
  if (searchTerm) gaEvent('search', { search_term: searchTerm })
}

export function trackViewItem(site: { id?: string | null; name?: string | null }, kind: FunnelKind) {
  const params = buildViewItemParams(site, kind)
  if (params) gaEvent('view_item', params)
}

export function trackBeginCheckout(input: FunnelInput) {
  const params = buildBeginCheckoutParams(input)
  if (params) gaEvent('begin_checkout', params)
}

/** Fire `purchase` once per transaction id, even across revisits of the confirmation screen. */
export function trackPurchase(input: FunnelInput & { transactionId: string }) {
  const params = buildPurchaseParams(input)
  if (!params) return
  whenReady(() =>
    sendOnce(`purchase:${input.transactionId}`, () => gaEvent('purchase', params), { storage: storage(), canSend: gtagReady }),
  )
}

/** Booking confirmed without online payment (pay at the venue). Once per reservation id. */
export function trackReservationCreated(input: { kind: FunnelKind; siteId: string; transactionId: string }) {
  whenReady(() =>
    sendOnce(
      `created:${input.transactionId}`,
      () => gaEvent('reservation_created', { payment: 'later', item_category: input.kind, item_id: input.siteId }),
      { storage: storage(), canSend: gtagReady },
    ),
  )
}

const PENDING_LOGIN_KEY = 'ga:pending-login'

/** Remember the auth method before the redirect-based sign-in leaves the page. */
export function markPendingLogin(method: AuthMethod) {
  try { sessionStorage.setItem(PENDING_LOGIN_KEY, method) } catch { /* ignore */ }
}

/**
 * After the session is established, emit `sign_up` (the sign-in created the account) or `login`
 * for a sign-in this tab started. The pending marker is removed first, so it is one-shot.
 */
export function flushPendingLogin(isNewUser?: boolean) {
  let method: string | null = null
  try {
    method = sessionStorage.getItem(PENDING_LOGIN_KEY)
    if (method) sessionStorage.removeItem(PENDING_LOGIN_KEY)
  } catch { /* ignore */ }
  if (method) {
    const { name, params } = authEvent(method, isNewUser)
    whenReady(() => gaEvent(name, params))
  }
}

import { API_URL } from './config'
import type { InventoryItem, RentalBookingProps, RentalItemProps } from '@repo/floor-core/types'

/** The server-action response contract, unchanged over HTTP. */
export interface ActionResult {
  status: 'ok' | 'error'
  errors?: string[]
  [k: string]: unknown
}

export type PaymentProvider = 'mollie' | 'viva' | 'stripe'
/** How the venue's staff take a card in person (Viva Terminal app vs Stripe Tap to Pay). */
export type CardPresent = 'none' | 'terminal-app' | 'tap-to-pay'

export interface ManageContext {
  status: 'ok'
  site: { id: string; name: string }
  isAdmin: boolean
  /** Effective provider (legacy null → mollie). Optional: older servers omit it. */
  paymentProvider?: PaymentProvider
  cardPresent?: CardPresent
}

/**
 * Grid payload from GET /api/manage/grid. Dates arrive as ISO strings over
 * JSON; the floor logic (@repo/floor-core/bed-state) only reads statuses and
 * server-computed booleans, so string dates are safe there — format on render.
 */
export interface GridPayload {
  status: 'ok'
  site: {
    id: string
    name: string
    type?: string | null
    features?: string[] | null
    inventoryItems: InventoryItem[]
    rentalItems?: RentalItemProps[]
    rentalBookings?: RentalBookingProps[]
    [k: string]: unknown
  }
  employees: { id: string; name: string }[]
  isAdmin: boolean
  /** Venue-local civil day (YYYY-MM-DD) — never derive from the device clock. */
  todayIso?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  const body = (await res.json().catch(() => null)) as T | null
  if (body === null) throw new Error(`Bad response (${res.status})`)
  return body
}

export function isManageContext(r: ManageContext | ActionResult): r is ManageContext {
  return r.status === 'ok' && typeof (r as ManageContext).site?.id === 'string'
}

export function getManageContext(siteId: string, key: string) {
  return request<ManageContext | ActionResult>(
    `/api/manage/context?siteId=${encodeURIComponent(siteId)}&key=${encodeURIComponent(key)}`,
  )
}

export function getGrid(siteId: string, key: string) {
  return request<GridPayload | ActionResult>(
    `/api/manage/grid?siteId=${encodeURIComponent(siteId)}&key=${encodeURIComponent(key)}`,
  )
}

/**
 * Invoke a gated manage action through POST /api/manage/rpc. The action name
 * must be in the partner-side allowlist (rpc/registry.ts); every action
 * verifies the accessKey itself — pass it exactly where the action's
 * signature expects it.
 */
export function rpc<T extends ActionResult = ActionResult>(action: string, args: unknown[]) {
  return request<T>('/api/manage/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
}

/** A Viva cloud terminal (a staff phone running the viva.com Terminal app) registered on the site. */
export interface VivaTerminal {
  id: string
  terminalId: string
  label: string
  lastSeenAt: string | null
}

/** How a collect is taken: the guest's own phone (QR), a tap on a Viva terminal, or Stripe Tap to Pay on this phone. */
export type CollectChoice = { method: 'qr' } | { method: 'card'; terminalId: string } | { method: 'tap-to-pay' }

/** What the Stripe Terminal SDK needs to take the tap — no secret keys. */
export interface TapToPayIntent {
  paymentIntentId: string
  clientSecret: string
  stripeAccount: string
  locationId: string
  currency: string
}

/** collectReservationPayment's ok payload across all rails. */
export type CollectStartResult = ActionResult & {
  amount?: number
  demo?: boolean
  checkoutUrl?: string
  card?: boolean
  tapToPay?: TapToPayIntent
}

/** The reservation collect triple (beds: single-bed sheet + bulk sheet). Rentals stay QR-only. */
export function reservationCollectActions(siteId: string, reservationId: string, accessKey: string) {
  return {
    create: (choice: CollectChoice) =>
      rpc<CollectStartResult>('collectReservationPayment', [
        siteId, reservationId, accessKey,
        ...(choice.method === 'card'
          ? [{ method: 'card', terminalId: choice.terminalId }]
          : choice.method === 'tap-to-pay'
            ? [{ method: 'tap-to-pay' }]
            : []),
      ]),
    poll: () => rpc<ActionResult & { paymentStatus?: string }>('getCollectStatus', [siteId, reservationId, accessKey]),
    cancel: (opts?: { terminalId?: string }) =>
      rpc<ActionResult & { paymentStatus?: string }>('cancelCollection', [
        siteId, reservationId, accessKey,
        ...(opts?.terminalId ? [{ terminalId: opts.terminalId }] : []),
      ]),
  }
}

export function listVivaTerminals(siteId: string, accessKey: string) {
  return rpc<ActionResult & { terminals?: VivaTerminal[] }>('listVivaTerminals', [siteId, accessKey])
}

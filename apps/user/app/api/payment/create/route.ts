/**
 * POST /api/payment/create
 *
 * Provider-neutral online checkout dispatcher (track 028 P1e) for NON-Mollie providers
 * (Stripe Connect, Viva). Mollie keeps its dedicated create-payment routes; this route
 * answers 400 "Use the Mollie endpoint" when the entity's venue is on Mollie.
 *
 * The provider is ALWAYS resolved server-side from the entity's site — never from the body.
 * Amounts, fees and state checks live in `createOnlineCheckout` (@repo/data/checkout).
 *
 * Auth mirrors the Mollie routes: reservation / order / rental / table-deposit require an
 * owner (session or anonId); a tab is a QR credential (no ownership) and is atomically
 * claimed first — every early return after a successful claim releases it.
 */

import prisma from '@repo/data/PrismaCient'
import {
  createOnlineCheckout,
  claimTabForPayment,
  releaseTabClaim,
  type CheckoutInput,
  type CheckoutKind,
} from '@repo/data/checkout'
import { NextRequest } from 'next/server'
import { getRequestIdentity, verifyOwnership } from '@/app/api/_lib/auth'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import { isFlagEnabled } from '@/app/flags'

const KINDS: readonly CheckoutKind[] = ['reservation', 'order', 'rental', 'tab', 'table-deposit']

type Provider = 'mollie' | 'stripe' | 'viva'

const err = (error: string, status: number) => Response.json({ error }, { status })

async function providerForSite(siteId: string | null | undefined): Promise<string> {
  if (!siteId) return 'mollie'
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { paymentProvider: true } })
  return site?.paymentProvider ?? 'mollie'
}

/** Linked site's effective provider; standalone restaurant (no site) -> its PartnerAccount's selection. */
async function providerForRestaurant(
  directSiteId: string | null | undefined,
  restaurant: { siteId: string | null; partnerAccount: { paymentProvider: string | null } | null } | null | undefined,
): Promise<string> {
  const siteId = directSiteId ?? restaurant?.siteId
  if (siteId) return providerForSite(siteId)
  return restaurant?.partnerAccount?.paymentProvider ?? 'mollie'
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return err('Invalid request body', 400)
  }
  const { kind, reservationId, orderId, rentalBookingIds, tabId, tableReservationId, anonId, redirectUrl } =
    body as {
      kind?: string
      reservationId?: string
      orderId?: string
      rentalBookingIds?: string[]
      tabId?: string
      tableReservationId?: string
      anonId?: string
      redirectUrl?: string
    }

  if (!kind || !(KINDS as readonly string[]).includes(kind)) return err('Invalid kind', 400)

  // ── Validate ids for the kind ────────────────────────────────────────────
  const ids: Pick<CheckoutInput, 'reservationId' | 'orderId' | 'rentalBookingIds' | 'tabId' | 'tableReservationId'> = {}
  switch (kind as CheckoutKind) {
    case 'reservation':
      if (typeof reservationId !== 'string' || !isValidEntityId(reservationId)) return err('Invalid reservationId', 400)
      ids.reservationId = reservationId
      break
    case 'order':
      if (typeof orderId !== 'string' || !isValidEntityId(orderId)) return err('Invalid orderId', 400)
      ids.orderId = orderId
      break
    case 'rental':
      if (!Array.isArray(rentalBookingIds) || rentalBookingIds.length === 0) return err('rentalBookingIds is required', 400)
      if (rentalBookingIds.length > 20) return err('Too many booking IDs', 400)
      if (!rentalBookingIds.every((id) => typeof id === 'string' && isValidEntityId(id))) {
        return err('Invalid booking ID format', 400)
      }
      ids.rentalBookingIds = rentalBookingIds
      break
    case 'tab':
      if (typeof tabId !== 'string' || !isValidEntityId(tabId)) return err('Invalid tabId', 400)
      ids.tabId = tabId
      break
    case 'table-deposit':
      if (typeof tableReservationId !== 'string' || !isValidEntityId(tableReservationId)) {
        return err('Invalid tableReservationId', 400)
      }
      ids.tableReservationId = tableReservationId
      break
  }

  if (!redirectUrl || typeof redirectUrl !== 'string') return err('redirectUrl is required', 400)

  // Validate redirectUrl — must be on our own domain to prevent open redirect
  const allowedOrigin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  try {
    const parsed = new URL(redirectUrl)
    const expected = new URL(allowedOrigin)
    if (parsed.origin !== expected.origin) return err('Invalid redirectUrl', 400)
  } catch {
    return err('Invalid redirectUrl', 400)
  }

  // ── Identity / ownership / provider resolution ───────────────────────────
  let provider: string
  let claimedTabId: string | null = null

  if (kind === 'tab') {
    // QR-URL-as-credential: no ownership. Claim first (freezes ordering), release on any bail-out.
    const claim = await claimTabForPayment(ids.tabId!)
    if (claim === 'not_found') return err('Tab not found', 404)
    if (claim === 'in_progress') return err('Payment already in progress', 409)
    if (claim === 'closed') return err('Tab is already closed', 409)
    if (claim === 'invalid') return err('Tab cannot be paid in its current state', 409)
    claimedTabId = ids.tabId!
  }

  const bail = async (error: string, status: number) => {
    if (claimedTabId) await releaseTabClaim(claimedTabId)
    return err(error, status)
  }

  try {
    if (kind === 'tab') {
      const tab = await prisma.tableTab.findUnique({
        where: { id: ids.tabId! },
        select: {
          siteId: true,
          restaurant: { select: { siteId: true, partnerAccount: { select: { paymentProvider: true } } } },
        },
      })
      if (!tab) return bail('Tab not found', 404)
      provider = await providerForRestaurant(tab.siteId, tab.restaurant)
    } else {
      if (kind === 'table-deposit' && !(await isFlagEnabled('restaurants'))) {
        return err('Not found', 404)
      }

      const identity = await getRequestIdentity(request, anonId)
      if (!identity) return err('Authentication required', 401)

      if (kind === 'reservation') {
        const reservation = await prisma.reservation.findUnique({ where: { id: ids.reservationId! } })
        if (!reservation) return err('Reservation not found', 404)
        if (!verifyOwnership(identity, reservation)) return err('Not authorized', 403)
        provider = await providerForSite(reservation.siteId)
      } else if (kind === 'order') {
        const order = await prisma.order.findUnique({ where: { id: ids.orderId! } })
        if (!order) return err('Order not found', 404)
        if (!verifyOwnership(identity, order)) return err('Not authorized', 403)
        provider = await providerForSite(order.siteId)
      } else if (kind === 'rental') {
        const bookings = await prisma.rentalBooking.findMany({ where: { id: { in: ids.rentalBookingIds! } } })
        if (bookings.length !== ids.rentalBookingIds!.length) return err('Some bookings not found', 404)
        if (!bookings.every((b) => verifyOwnership(identity, b))) return err('Not authorized', 403)
        if (new Set(bookings.map((b) => b.siteId)).size > 1) return err('All bookings must be for the same site', 400)
        provider = await providerForSite(bookings[0]!.siteId)
      } else {
        const tr = await prisma.tableReservation.findUnique({
          where: { id: ids.tableReservationId! },
          select: {
            userId: true,
            anonId: true,
            restaurant: { select: { siteId: true, partnerAccount: { select: { paymentProvider: true } } } },
          },
        })
        if (!tr) return err('Reservation not found', 404)
        const isOwner =
          (identity.userId && tr.userId && identity.userId === tr.userId) ||
          (identity.anonId && tr.anonId && identity.anonId === tr.anonId)
        if (!isOwner) return err('Not authorized', 403)
        provider = await providerForRestaurant(null, tr.restaurant)
      }
    }

    if (provider !== 'stripe' && provider !== 'viva') {
      return bail('Use the Mollie endpoint', 400)
    }
    const resolved: Provider = provider

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002'}`
    const webhookUrl = new URL(
      resolved === 'stripe' ? '/api/webhooks/stripe-connect' : '/api/webhooks/viva',
      baseUrl,
    ).toString()

    const result = await createOnlineCheckout({
      kind: kind as CheckoutKind,
      ...ids,
      provider: resolved,
      redirectUrl,
      webhookUrl,
    })

    if (result.status === 'ok') {
      return Response.json({ checkoutUrl: result.checkoutUrl, paymentRef: result.paymentRef })
    }

    // createOnlineCheckout releases the tab claim itself on provider_error; release on every
    // other failure (idempotent: only reverts a TAB_PENDING_PAYMENT tab).
    if (claimedTabId && result.reason !== 'provider_error') await releaseTabClaim(claimedTabId)

    switch (result.reason) {
      case 'invalid_amount':
        return err('Invalid payment amount', 400)
      case 'not_found':
        return err('Not found', 404)
      case 'bad_state':
        return err('This item cannot be paid in its current state', 409)
      case 'provider_not_ready':
        return err('This venue has not finished setting up payments', 400)
      case 'provider_unavailable':
        return err('Online payments are not available for this venue yet', 503)
      default:
        return err('Failed to create payment', 502)
    }
  } catch (e) {
    console.error('[PaymentCreate] Unexpected error:', e)
    return bail('Failed to create payment', 500)
  }
}

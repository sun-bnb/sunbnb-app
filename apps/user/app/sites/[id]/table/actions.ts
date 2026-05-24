'use server'

import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import prisma from '@repo/data/PrismaCient'
import {
  createTableReservation,
  createCombinationReservation,
  cancelTableReservation,
  modifyTableReservation,
  markDepositHeld,
  joinWaitlist,
  findWaitlistCandidateForFreedReservation,
  markWaitlistNotified,
  confirmationEmailHtml,
  cancellationEmailHtml,
  waitlistNotifyEmailHtml,
  TABLE_RESERVATION_STATUS,
  type CustomerIdentity,
} from '@repo/table-reservations-core'
import { sendEmail } from '@repo/data/email'

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

async function requireFlag(): Promise<{ status: 'error'; errors: string[] } | null> {
  if (!(await isFlagEnabled('restaurants'))) {
    return { status: 'error', errors: ['feature_disabled'] }
  }
  return null
}

/**
 * Resolve the restaurant linked to a Sunbnb site and return its id + name.
 * Public — no auth required; consumers land here from the site page.
 */
async function getSiteRestaurant(
  siteId: string,
): Promise<{ id: string; name: string; slug: string; tagline: string | null } | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { restaurantId: true },
  })
  if (!site?.restaurantId) return null
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: site.restaurantId },
    select: { id: true, name: true, slug: true, tagline: true },
  })
  return restaurant
}

export interface BookTableInput {
  siteId: string
  tableId: string
  fromIso: string
  toIso: string
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  specialRequests?: string | null
  anonId?: string | null
}

type BookResult =
  | { status: 'ok'; reservationId: string; requiresDeposit?: boolean; depositAmount?: number }
  | { status: 'error'; errors: string[] }

async function sendBookingConfirmation(
  restaurant: { name: string; slug: string; tagline: string | null },
  r: { id: string; guestEmail: string; from: Date; to: Date; partySize: number; guestName: string; specialRequests: string | null },
): Promise<void> {
  // Fire-and-forget: a failed send must not block the booking.
  try {
    await sendEmail({
      to: r.guestEmail,
      subject: `Reservation confirmed at ${restaurant.name}`,
      html: confirmationEmailHtml(r, restaurant, null),
    })
  } catch (err) {
    console.error('[table-booking] confirmation email failed', err)
  }
}

export async function bookTableForSite(input: BookTableInput): Promise<BookResult> {
  const gated = await requireFlag()
  if (gated) return gated
  const restaurant = await getSiteRestaurant(input.siteId)
  if (!restaurant) {
    return { status: 'error', errors: ['Restaurant not found for this site'] }
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const anonId = input.anonId?.trim() || null

  const res = await createTableReservation({
    restaurantId: restaurant.id,
    tableId: input.tableId,
    from: new Date(input.fromIso),
    to: new Date(input.toIso),
    partySize: input.partySize,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestPhone: input.guestPhone ?? null,
    specialRequests: input.specialRequests ?? null,
    userId,
    anonId,
  })
  if (res.status === 'error' || !res.reservation) {
    return { status: 'error', errors: res.errors ?? ['Booking failed'] }
  }

  const r = res.reservation

  // Deposit-required booking → created as a PENDING_PAYMENT hold.
  // Both demo and real mode return requiresDeposit so the UI shows the pay
  // step. Demo handles the actual "payment" in initiateDemoTableDeposit
  // (called from the pay step), keeping the flow symmetric.
  if (r.status === TABLE_RESERVATION_STATUS.PENDING_PAYMENT) {
    return { status: 'ok', reservationId: r.id, requiresDeposit: true, depositAmount: r.depositAmount ?? 0 }
  }

  await sendBookingConfirmation(restaurant, r)
  return { status: 'ok', reservationId: r.id }
}

/**
 * Process a demo deposit payment for a table reservation.
 * Only available when NEXT_PUBLIC_DEMO_MODE is enabled.
 * Mirrors initiateDemoReservationPayment in apps/user/app/payment/actions.ts.
 * Verifies ownership (session userId or anonId), generates a pi_demo_… ref,
 * calls markDepositHeld, and sends the booking confirmation email.
 */
export async function initiateDemoTableDeposit(
  reservationId: string,
  anonId?: string | null,
): Promise<{ status: 'ok'; reservationId: string } | { status: 'error'; errors: string[] }> {
  if (!DEMO_MODE) {
    return { status: 'error', errors: ['Demo mode is not enabled'] }
  }

  const gated = await requireFlag()
  if (gated) return gated

  const tr = await prisma.tableReservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      userId: true,
      anonId: true,
      status: true,
      depositStatus: true,
      paymentRef: true,
      guestEmail: true,
      guestName: true,
      from: true,
      to: true,
      partySize: true,
      specialRequests: true,
      depositAmount: true,
      restaurantId: true,
    },
  })

  if (!tr) {
    return { status: 'error', errors: ['Reservation not found'] }
  }

  // Ownership check — session userId or matching anonId
  const session = await auth()
  const sessionUserId = session?.user?.id ?? null
  const trimmedAnonId = anonId?.trim() || null

  const isOwner =
    (sessionUserId && tr.userId && sessionUserId === tr.userId) ||
    (trimmedAnonId && tr.anonId && trimmedAnonId === tr.anonId)

  if (!isOwner) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  // Idempotency: if already held, skip re-processing
  if (tr.depositStatus === TABLE_RESERVATION_STATUS.PENDING_PAYMENT && tr.paymentRef) {
    return { status: 'ok', reservationId: tr.id }
  }

  // Must still be awaiting payment
  if (tr.status !== TABLE_RESERVATION_STATUS.PENDING_PAYMENT) {
    return { status: 'ok', reservationId: tr.id }
  }

  const paymentRef = `pi_demo_${Date.now()}`

  try {
    await markDepositHeld(tr.id, paymentRef)
  } catch (err) {
    console.error('[initiateDemoTableDeposit] markDepositHeld failed', err)
    return { status: 'error', errors: ['Failed to confirm deposit'] }
  }

  // Fetch restaurant for the email
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tr.restaurantId },
    select: { name: true, slug: true, tagline: true },
  })

  if (restaurant) {
    await sendBookingConfirmation(restaurant, tr)
  }

  return { status: 'ok', reservationId: tr.id }
}

export interface BookCombinationInput {
  siteId: string
  combinationId: string
  fromIso: string
  toIso: string
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  specialRequests?: string | null
  anonId?: string | null
}

/** Book a predefined combination (large party) at a site's restaurant. */
export async function bookCombinationForSite(
  input: BookCombinationInput,
): Promise<{ status: 'ok'; reservationId: string } | { status: 'error'; errors: string[] }> {
  const gated = await requireFlag()
  if (gated) return gated
  const restaurant = await getSiteRestaurant(input.siteId)
  if (!restaurant) {
    return { status: 'error', errors: ['Restaurant not found for this site'] }
  }

  const session = await auth()
  const userId = session?.user?.id ?? null
  const anonId = input.anonId?.trim() || null

  const res = await createCombinationReservation({
    restaurantId: restaurant.id,
    combinationId: input.combinationId,
    from: new Date(input.fromIso),
    to: new Date(input.toIso),
    partySize: input.partySize,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestPhone: input.guestPhone ?? null,
    specialRequests: input.specialRequests ?? null,
    userId,
    anonId,
  })
  if (res.status === 'error' || !res.reservation) {
    return { status: 'error', errors: res.errors ?? ['Booking failed'] }
  }

  const r = res.reservation
  try {
    await sendEmail({
      to: r.guestEmail,
      subject: `Reservation confirmed at ${restaurant.name}`,
      html: confirmationEmailHtml(
        r,
        { name: restaurant.name, slug: restaurant.slug, tagline: restaurant.tagline },
        null,
      ),
    })
  } catch (err) {
    console.error('[table-booking] combination confirmation email failed', err)
  }

  return { status: 'ok', reservationId: res.reservation.id }
}

export interface ModifyTableBookingInput {
  reservationId: string
  fromIso?: string
  toIso?: string
  partySize?: number
  tableId?: string
  anonId?: string | null
}

/** Consumer-initiated modify of an existing table booking. */
export async function modifyTableBooking(
  input: ModifyTableBookingInput,
): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  const gated = await requireFlag()
  if (gated) return gated
  const session = await auth()
  const identity: CustomerIdentity = {
    userId: session?.user?.id ?? null,
    anonId: input.anonId?.trim() || null,
  }
  if (!identity.userId && !identity.anonId) {
    return { status: 'error', errors: ['Not authorized'] }
  }
  const res = await modifyTableReservation(
    input.reservationId,
    {
      from: input.fromIso ? new Date(input.fromIso) : undefined,
      to: input.toIso ? new Date(input.toIso) : undefined,
      partySize: input.partySize,
      tableId: input.tableId,
    },
    identity,
  )
  return { status: res.status, errors: res.errors }
}

export async function cancelTableBooking(
  reservationId: string,
  anonId: string | null,
): Promise<{ status: 'ok' | 'error'; errors?: string[] }> {
  const gated = await requireFlag()
  if (gated) return gated
  const session = await auth()
  const identity: CustomerIdentity = {
    userId: session?.user?.id ?? null,
    anonId: anonId?.trim() || null,
  }
  if (!identity.userId && !identity.anonId) {
    return { status: 'error', errors: ['Not authorized'] }
  }

  const res = await cancelTableReservation(reservationId, identity)
  if (res.status === 'error' || !res.reservation) {
    return { status: res.status, errors: res.errors }
  }

  const r = res.reservation
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: r.restaurantId },
    select: { name: true, slug: true, tagline: true },
  })
  if (restaurant) {
    try {
      await sendEmail({
        to: r.guestEmail,
        subject: `Reservation canceled at ${restaurant.name}`,
        html: cancellationEmailHtml(r, restaurant),
      })
    } catch (err) {
      console.error('[table-booking] cancellation email failed', err)
    }

    // Auto-notify the earliest matching waitlist guest that a table opened up.
    try {
      const candidate = await findWaitlistCandidateForFreedReservation(reservationId)
      if (candidate) {
        await sendEmail({
          to: candidate.guestEmail,
          subject: `A table opened up at ${restaurant.name}`,
          html: waitlistNotifyEmailHtml(candidate, restaurant, null),
        })
        await markWaitlistNotified(candidate.id)
      }
    } catch (err) {
      console.error('[table-booking] waitlist auto-notify failed', err)
    }
  }

  return { status: 'ok' }
}

export interface JoinWaitlistInput {
  siteId: string
  dateISO: string
  requestedTime?: string | null
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  anonId?: string | null
}

/** Consumer joins the waitlist for a site's restaurant on a given day. */
export async function joinWaitlistForSite(
  input: JoinWaitlistInput,
): Promise<{ status: 'ok'; entryId: string } | { status: 'error'; errors: string[] }> {
  const gated = await requireFlag()
  if (gated) return gated
  const restaurant = await getSiteRestaurant(input.siteId)
  if (!restaurant) return { status: 'error', errors: ['Restaurant not found for this site'] }

  const session = await auth()
  const res = await joinWaitlist({
    restaurantId: restaurant.id,
    dateISO: input.dateISO,
    requestedTime: input.requestedTime ?? null,
    partySize: input.partySize,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestPhone: input.guestPhone ?? null,
    userId: session?.user?.id ?? null,
    anonId: input.anonId?.trim() || null,
  })
  if (res.status === 'error' || !res.entry) {
    return { status: 'error', errors: res.errors ?? ['Could not join waitlist'] }
  }
  return { status: 'ok', entryId: res.entry.id }
}

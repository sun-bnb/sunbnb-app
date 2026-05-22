'use server'

import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import prisma from '@repo/data/PrismaCient'
import {
  createTableReservation,
  createCombinationReservation,
  cancelTableReservation,
  modifyTableReservation,
  joinWaitlist,
  findWaitlistCandidateForFreedReservation,
  markWaitlistNotified,
  confirmationEmailHtml,
  cancellationEmailHtml,
  waitlistNotifyEmailHtml,
  type CustomerIdentity,
} from '@repo/table-reservations-core'
import { sendEmail } from '@repo/data/email'

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

export async function bookTableForSite(
  input: BookTableInput,
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

  const from = new Date(input.fromIso)
  const to = new Date(input.toIso)

  const res = await createTableReservation({
    restaurantId: restaurant.id,
    tableId: input.tableId,
    from,
    to,
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

  // Fire-and-forget email: a failed send shouldn't block the booking
  // confirmation page render. Log failures via the Resend response.
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
    // Swallow — reservation is created; email is a nice-to-have.
    console.error('[table-booking] confirmation email failed', err)
  }

  return { status: 'ok', reservationId: res.reservation.id }
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

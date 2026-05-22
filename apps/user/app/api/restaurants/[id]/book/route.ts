import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@repo/data/rate-limit'
import {
  createTableReservation,
  createCombinationReservation,
  confirmationEmailHtml,
  getRestaurantById,
} from '@repo/table-reservations-core'
import { sendEmail } from '@repo/data/email'
import { isFlagEnabled } from '@/app/flags'

/**
 * Public, CORS-enabled, restaurant-keyed booking endpoint — the intake point for
 * the embeddable booking widget (a venue drops it on its own site) and future
 * Google/Instagram Reserve integrations. Restaurant-keyed (not site-keyed) so it
 * works for standalone restaurants too, keeping the extraction path clean.
 *
 * All prices/rules are enforced server-side; the caller is rate-limited per IP.
 * Anonymous only — the widget supplies an `anonId` it generated.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isFlagEnabled('restaurants'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })
  }
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const limited = rateLimit(`restaurant-book:${ip}`, { maxAttempts: 10, windowMs: 60 * 1000 })
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: CORS })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: CORS })
  }

  const anonId = typeof body.anonId === 'string' ? body.anonId.trim() : ''
  if (!anonId) {
    return NextResponse.json({ error: 'anonId is required' }, { status: 400, headers: CORS })
  }
  const fromIso = String(body.fromIso ?? '')
  const toIso = String(body.toIso ?? '')
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid times' }, { status: 400, headers: CORS })
  }

  const restaurant = await getRestaurantById(params.id)
  if (!restaurant) {
    return NextResponse.json({ error: 'Restaurant not found' }, { status: 404, headers: CORS })
  }

  const common = {
    restaurantId: restaurant.id,
    from,
    to,
    partySize: Number(body.partySize),
    guestName: String(body.guestName ?? ''),
    guestEmail: String(body.guestEmail ?? ''),
    guestPhone: typeof body.guestPhone === 'string' ? body.guestPhone : null,
    specialRequests: typeof body.specialRequests === 'string' ? body.specialRequests : null,
    anonId,
  }

  const res =
    typeof body.combinationId === 'string' && body.combinationId
      ? await createCombinationReservation({ ...common, combinationId: body.combinationId })
      : await createTableReservation({ ...common, tableId: String(body.tableId ?? '') })

  if (res.status === 'error' || !res.reservation) {
    return NextResponse.json({ error: res.errors ?? ['Booking failed'] }, { status: 400, headers: CORS })
  }

  try {
    await sendEmail({
      to: res.reservation.guestEmail,
      subject: `Reservation confirmed at ${restaurant.name}`,
      html: confirmationEmailHtml(
        res.reservation,
        { name: restaurant.name, slug: restaurant.slug, tagline: restaurant.tagline },
        null,
      ),
    })
  } catch (err) {
    console.error('[restaurant-book] confirmation email failed', err)
  }

  return NextResponse.json({ reservationId: res.reservation.id }, { status: 200, headers: CORS })
}

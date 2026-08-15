'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { resolveSiteFees } from '@repo/data/payment'
import { siteDayBounds } from '@repo/data/site-day'

/**
 * The reservations `include` window for the site-context queries
 * (track 020 P5). The context previously shipped EVERY reservation an item
 * ever had — with the guest's email — to the partner client on every site
 * tab, though the only consumer outside /manage (which runs its own query)
 * is the brand page's availability stat. Windowed to the venue-local today:
 * payload is bounded by floor size instead of site lifetime, and the brand
 * stat becomes "no reservation overlapping today" (previously "never
 * reserved in the site's LIFETIME" — a seat booked once years ago counted
 * as unavailable forever).
 */
export async function todayReservationsWindow(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  const { start, end } = siteDayBounds({
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  })
  return { from: { lte: end }, to: { gte: start } }
}

// ─── Full Site Query ────────────────────────────────────────────────────────

export async function getSite(siteId: string) {
  const session = await auth()
  if (!session?.user) return null

  const reservationWindow = await todayReservationsWindow(siteId)

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    include: {
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        include: {
          reservations: {
            where: reservationWindow,
            include: { user: { select: { id: true, email: true } } },
            orderBy: { from: 'asc' },
          },
          pair: true,
          pairedBy: true,
          sunbedGroup: { include: { items: { select: { id: true } } } },
        },
      },
      layoutElements: true,
      products: {
        where: { active: true },
      },
    },
  })

  if (site?.userId) {
    ;(site as any).serviceFees = await resolveSiteFees(siteId, [
      'sunbed-rental',
      'food-and-beverage',
    ])
  }

  return site
}

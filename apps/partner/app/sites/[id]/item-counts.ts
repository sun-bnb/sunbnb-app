import prisma from '@repo/data/PrismaCient'
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

export interface SiteItemCounts {
  itemCount: number
  activeItemCount: number
  availableTodayCount: number
}

/**
 * The inventory scalars the non-editor site tabs need (track 020 C2).
 *
 * These replace three array computations that between them forced the whole
 * item list — plus every item's reservations, guest emails included — into
 * the RSC payload of every site tab. Semantics are preserved exactly:
 *   itemCount           = all items (pool sentinels included, as before)
 *   activeItemCount     = status 'active'
 *   availableTodayCount = status 'active' AND no reservation overlapping the
 *                         venue-local today (the same window the payload used)
 *
 * A plain module, NOT `'use server'`: it is a server-side helper for the RSC
 * loader, so it must not become a callable server action.
 */
export async function getSiteItemCounts(siteId: string): Promise<SiteItemCounts> {
  const reservationWindow = await todayReservationsWindow(siteId)

  const [itemCount, activeItemCount, availableTodayCount] = await Promise.all([
    prisma.inventoryItem.count({ where: { siteId } }),
    prisma.inventoryItem.count({ where: { siteId, status: 'active' } }),
    prisma.inventoryItem.count({
      where: { siteId, status: 'active', reservations: { none: reservationWindow } },
    }),
  ])

  return { itemCount, activeItemCount, availableTodayCount }
}

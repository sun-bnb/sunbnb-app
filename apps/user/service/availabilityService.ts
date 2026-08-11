import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Reservation } from '@/app/sites/types'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'
import { siteDayBounds } from '@repo/data/site-day'

dayjs.extend(isBetween)

/** Build the `SiteTimezone` shape `siteDayBounds` expects from a site row. */
function siteTz(site: { timeZone?: string | null; locationLat?: string | null; locationLng?: string | null } | null) {
  return {
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

function checkAvailability(
  reservations: Reservation[], 
  itemId: string, 
  from: Date, 
  to: Date
) {

  const periods = reservations.filter(reservation => {
    const idMatch = (reservation.items || []).some(invItem => invItem.id === itemId)
    let overlap = false
    if (idMatch) {
      const first = dayjs(from).isBetween(reservation.from, reservation.to, null, '[]')
      const second = dayjs(to).isBetween(reservation.from, reservation.to, null, '[]')
      const third = (
        dayjs(reservation.from).isBetween(from, to, null, '[]') &&
        dayjs(reservation.to).isBetween(from, to, null, '[]')
      )
      overlap = first || second || third
    }
    return idMatch && overlap
  })

  return {
    itemId,
    available: periods.length === 0,
    periods: periods.map(period => ({
      from: period.from,
      to: period.to,
    })),
  }
}

function getAvailabilityData(
  reservations: Reservation[], 
  itemIds: string[], 
  from: Date, 
  to: Date
) {
  return itemIds.map(itemId => 
    checkAvailability(reservations, itemId, from, to)
  )
}

export async function getAvailability(siteId: string, from: Date, to: Date) {
  // Resolve the venue timezone so "end of today" anchors to the site's civil day,
  // not the server's (UTC on Vercel). (track 017 P2)
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })

  // Find all items for this site
  const items = await prisma.inventoryItem.findMany({
    where: { siteId, status: 'active' },
    select: { id: true },
  })

  // Collect just their ids
  const itemIds = items.map(item => item.id)

  // Find all reservations overlapping [from, to]. A no-show/departed booking frees
  // its bed ONLY once its stay is over (no remaining reserved days, `to` <= end of
  // today); a multiday booking departed mid-stay keeps blocking its future days. A
  // booking with future days is reused via an explicit release. (track 012)
  const endOfToday = siteDayBounds(siteTz(site)).end
  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { in: BLOCKING_STATUSES },
      from: { lte: to },
      to: { gte: from },
      NOT: {
        operationalStatus: { in: [OP_NO_SHOW, OP_DEPARTED] },
        to: { lte: endOfToday },
      },
    },
    include: {
      items: true,
      site: true
    },
  })

  // For each item in the site, check if it's available or not
  const availabilityData = getAvailabilityData(reservations, itemIds, from, to)
  return availabilityData
}

/**
 * Count available sunbeds for a site today using the canonical availability rule.
 * Uses the same BLOCKING_STATUSES + no-show/departed release logic as getAvailability.
 * Returns { availableCount, itemCount } where itemCount is active items only.
 */
export async function countAvailableToday(siteId: string): Promise<{ availableCount: number; itemCount: number }> {
  // Venue-anchored "today" window (not the server's UTC day). (track 017 P2)
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })
  const { start: startOfToday, end: endOfToday } = siteDayBounds(siteTz(site))

  const availabilityData = await getAvailability(siteId, startOfToday, endOfToday)
  const itemCount = availabilityData.length
  const availableCount = availabilityData.filter(a => a.available).length

  return { availableCount, itemCount }
}

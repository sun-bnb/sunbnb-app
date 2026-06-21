import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Reservation } from '@/app/sites/types'
import { BLOCKING_STATUSES, OP_NO_SHOW, OP_DEPARTED } from '@repo/data/reservation-status'

dayjs.extend(isBetween)

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
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
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

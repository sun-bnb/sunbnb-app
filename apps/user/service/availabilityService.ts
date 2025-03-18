import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Reservation } from '@/app/sites/types'
// Import or define the Reservation and InventoryItem types
// type InventoryItem = { id: string; ... }
// type Reservation = {
//   items: InventoryItem[];
//   from: Date;
//   to: Date;
//   // ...
// };

dayjs.extend(isBetween)

function checkAvailability(
  reservations: Reservation[], 
  itemId: string, 
  from: Date, 
  to: Date
) {
  // Filter reservations that BOTH:
  // 1) Contain the given itemId in their items array
  // 2) Overlap the [from, to] time range
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
      console.log('Overlap', first, second, third)        
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
    where: { siteId },
    select: { id: true },
  })

  // Collect just their ids
  const itemIds = items.map(item => item.id)

  // Find all reservations overlapping [from, to]
  // Important: You likely need to include { items: true } so each
  // reservation has its array of items loaded.
  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { not: 'canceled' },
      from: { lte: to },
      to: { gte: from },
    },
    include: {
      items: true, // <--- add this if you haven't already
    },
  })

  console.log('reservations', reservations)

  // For each item in the site, check if it's available or not
  const availabilityData = getAvailabilityData(reservations, itemIds, from, to)
  return availabilityData
}

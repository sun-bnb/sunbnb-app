import prisma from '@repo/data/PrismaCient'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Reservation } from '@/app/sites/types'

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
      status: { in: ['pending', 'processing', 'paid'] },
      from: { lte: to },
      to: { gte: from },
    },
    include: {
      items: true,
      site: true
    },
  })

  console.log('reservations', reservations)

  // For each item in the site, check if it's available or not
  const availabilityData = getAvailabilityData(reservations, itemIds, from, to)
  return availabilityData
}

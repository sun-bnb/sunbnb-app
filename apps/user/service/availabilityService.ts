
import prisma from '@repo/data/PrismaCient'
import { Prisma } from '@prisma/client'
import dayjs, { Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { Reservation } from '@/app/sites/types'

dayjs.extend(isBetween)

function checkAvailability(reservations: Reservation[], itemId: string, from: Date, to: Date) {
  const periods = reservations.filter(reservation => 
    reservation.itemId === itemId && 
    (
      dayjs(from).isBetween(reservation.from, reservation.to, null, '[]') ||
      dayjs(to).isBetween(reservation.from, reservation.to, null, '[]') ||
      (dayjs(reservation.from).isBetween(from, to, null, '[]') && dayjs(reservation.to).isBetween(from, to, null, '[]'))
    )
  )

  return {
    itemId,
    available: periods.length === 0,
    periods: periods.map(period => ({
      from: period.from,
      to: period.to,
    })),
  }
}

function getAvailabilityData(reservations: Reservation[], itemIds: string[], from: Date, to: Date) {
  return itemIds.map(itemId => checkAvailability(reservations, itemId, from, to))
}

export async function getAvailability(siteId: string, from: Date, to: Date) {

  const items: { id: string }[] = await prisma.inventoryItem.findMany({
    select: {
      id: true
    },
    where: {
      siteId
    }
  })

  const itemIds = items.map(item => item.id)

  const reservations = await prisma.reservation.findMany({
    where: {
      siteId,
      status: { not: 'canceled' },
      from: { lte: to },
      to: { gte: from }
    }
  })

  console.log('reservations', reservations)

  const availabilityData = getAvailabilityData(reservations, itemIds, from, to)
  return availabilityData

}
'use client'

import React, { useTransition } from 'react'
import { reserveItem, unreserveItem } from '../actions'
import { InventoryItem, Reservation } from '@/types/shared'

function isReservedToday(item: InventoryItem): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (
    item.reservations?.some((res: Reservation) => {
      const fromDate = new Date(res.from)
      const toDate = new Date(res.to)
      fromDate.setHours(0, 0, 0, 0)
      toDate.setHours(0, 0, 0, 0)
      return today >= fromDate && today <= toDate
    }) ?? false
  )
}

function isReservedTodayByUser(item: InventoryItem, userId: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (
    item.reservations?.some((res: Reservation) => {
      if (res.user.id !== userId) return false
      const fromDate = new Date(res.from)
      const toDate = new Date(res.to)
      fromDate.setHours(0, 0, 0, 0)
      toDate.setHours(0, 0, 0, 0)
      return today >= fromDate && today <= toDate
    }) ?? false
  )
}

export default function SunbedItem({
  siteId,
  item,
  userId,
}: {
  siteId: string
  item: InventoryItem
  userId: string
}) {
  const reservedByAnyone = isReservedToday(item)
  const reservedByMe = isReservedTodayByUser(item, userId)

  const [isPending, startTransition] = useTransition()

  const handleToggle = () => {
    startTransition(async () => {
      if (reservedByMe) {
        await unreserveItem(siteId, item.id)
      } else {
        await reserveItem(siteId, item.id)
      }
    })
  }

  let bgColor = 'bg-green-200'
  if (reservedByAnyone) {
    bgColor = reservedByMe ? 'bg-red-200' : 'bg-gray-200'
  }

  return (
    item.status === 'disabled' ?
    <div className="flex items-center justify-center basis-0 flex-1 p-4"></div> :
    <button
      disabled={(!reservedByMe && reservedByAnyone) || isPending}
      onClick={handleToggle}
      className={`${bgColor} border rounded flex items-center justify-center basis-0 flex-1 p-4`}
    >
      {isPending ? 'Saving...' : item.number}
    </button>
  )
}

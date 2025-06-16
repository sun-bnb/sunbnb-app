'use client'

import React, { useTransition } from 'react'
import { reserveItem, unreserveItem } from './actions'
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

function isReservedTodayByUser(item: InventoryItem): boolean {
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

export default function SunbedItem({
  siteId,
  item
}: {
  siteId: string
  item: InventoryItem
}) {
  const reservedByAnyone = isReservedToday(item)
  const reservedByMe     = isReservedTodayByUser(item)
  const [isPending, startTransition] = useTransition()

  const handleToggle = () => {
    startTransition(async () => {
      if (reservedByMe) await unreserveItem(siteId, item.id)
      else              await reserveItem(siteId, item.id)
    })
  }

  let bgColor = 'bg-green-200'
  if (reservedByAnyone) {
    bgColor = reservedByMe ? 'bg-red-200' : 'bg-gray-200'
  }

  // Render an empty spacer if item is disabled
  if (item.status === 'disabled') {
    return <div className="basis-0 flex-1 p-2" />
  }

  return (
    <button
      disabled={(!reservedByMe && reservedByAnyone) || isPending}
      onClick={handleToggle}
      className={`
        ${bgColor} border rounded 
        basis-0 flex-1 min-w-0  /* allow squeezing below content width */
        p-4 flex items-center justify-center
      `}
    >
      <div style={{
        transform: 'rotate(-90deg)',
      }}>{isPending ? '...' : item.number}</div>
    </button>
  )
}

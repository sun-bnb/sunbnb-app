'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Item from './Item'

import { InventoryItem, Reservation, SiteProps } from '@/types/shared'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
}

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

export default function Management({
  site,
  userId,
  apiKey,
}: {
  site: SiteProps
  userId: string
  apiKey: string
}) {
  const { inventoryItems = [] } = site

  // 1. Group into parcel → row → position
  const grouped = inventoryItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = {}
    if (!acc[parcel][row]) acc[parcel][row] = {}
    acc[parcel][row][position] = item
    return acc
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>)

  return (
    <div className="container mx-auto mt-6 w-full">
      {Object.entries(grouped).map(([parcel, rows]) => (
        <div key={parcel} className="mb-8">
          <h2 className="text-lg font-bold mb-2">Parcel {parcel}</h2>

          {Object.entries(rows).map(([row, positions]) => (
            <div
              key={row}
              className="w-full mb-2 grid grid-cols-[repeat(auto-fit,minmax(80px,1fr))] gap-2"
            >
              {Object.entries(positions).map(([position, item]) => (
                <Item
                  key={item.id}
                  siteId={site.id!}
                  userId={userId}
                  item={item}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

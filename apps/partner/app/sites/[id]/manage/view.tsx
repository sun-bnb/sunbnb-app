'use client'

import React from 'react'
import { InventoryItem, Reservation, SiteProps } from '@/types/shared'
import Item from './Item'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
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

  // Group by parcel → row → position
  const grouped = inventoryItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = {}
    if (!acc[parcel][row]) acc[parcel][row] = {}
    acc[parcel][row][position] = item
    return acc
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>)

  return (
    <div className="p-1 mx-auto mt-6 w-full">
      {Object.entries(grouped).map(([parcel, rows]) => (
        <div key={parcel} className="mb-8">
          <h2 className="text-lg font-bold mb-2">Parcel {parcel}</h2>

          {Object.entries(rows).map(([row, positions]) => (
            <div
              key={row}
              className="
                w-full mb-2
                grid 
                grid-cols-[repeat(auto-fit,minmax(0,1fr))]
                gap-1
              "
            >
              {Object.entries(positions).map(([_, item]) => (
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

'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { InventoryItem, Reservation, SiteProps } from '@/types/shared'
import Item from './Item'
import BedDetail from './BedDetail'

function parseSunbedNumber(num: number) {
  const str = String(num)
  const parcel = parseInt(str[0]!, 10)
  const row = parseInt(str.substring(1, 3), 10)
  const position = parseInt(str.substring(3), 10)
  return { parcel, row, position }
}

type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked'

function getActiveReservation(item: InventoryItem): Reservation | null {
  if (!item.reservations?.length) return null
  return item.reservations.find(r =>
    !['departed', 'no-show'].includes(r.operationalStatus)
  ) || null
}

function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  switch (res.operationalStatus) {
    case 'expected': return 'expected'
    case 'checked-in': return 'checked-in'
    case 'walked-in': return 'walked-in'
    case 'blocked': return 'blocked'
    default: return 'available'
  }
}

export default function ManageView({
  site,
  accessKey,
}: {
  site: SiteProps
  accessKey: string
}) {
  const router = useRouter()
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)

  // Auto-refresh every 30 seconds so Carlos sees new bookings
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(interval)
  }, [router])

  const { inventoryItems = [] } = site
  const activeItems = inventoryItems.filter(i => i.status !== 'disabled')

  // Compute summary counts
  const summary = activeItems.reduce((acc, item) => {
    const state = getBedState(item)
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, {} as Record<BedState, number>)

  const total = activeItems.length
  const occupied = (summary['checked-in'] || 0) + (summary['walked-in'] || 0)

  // Group by parcel → row → position
  const grouped = inventoryItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number)
    if (!acc[parcel]) acc[parcel] = {}
    if (!acc[parcel][row]) acc[parcel][row] = {}
    acc[parcel][row][position] = item
    return acc
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>)

  return (
    <div className="px-2 pt-2 pb-20 mx-auto w-full max-w-screen-lg">
      {/* ── Summary Bar — compact on phone, row on tablet ── */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2 sm:gap-4 mb-3 px-3 py-3 sm:px-4 sm:py-4 bg-white rounded-xl text-sm sm:text-base font-bold sticky top-0 z-10 border-2 shadow-sm">
        <span className="text-gray-900 text-base sm:text-lg col-span-2 sm:col-span-1">{occupied}/{total}</span>
        <span className="flex items-center gap-1.5 text-green-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-green-300 border-2 border-green-500 flex-shrink-0" />
          {summary['available'] || 0} free
        </span>
        <span className="flex items-center gap-1.5 text-yellow-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-yellow-300 border-2 border-yellow-500 flex-shrink-0" />
          {(summary['expected'] || 0)} booked
        </span>
        <span className="flex items-center gap-1.5 text-blue-700">
          <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-blue-400 border-2 border-blue-600 flex-shrink-0" />
          {(summary['checked-in'] || 0) + (summary['walked-in'] || 0)} here
        </span>
        {(summary['blocked'] || 0) > 0 && (
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded bg-gray-400 border-2 border-gray-600 flex-shrink-0" />
            {summary['blocked']} blocked
          </span>
        )}
      </div>

      {/* ── Grid — phone: fixed columns, tablet: auto-fit ── */}
      {Object.entries(grouped).map(([parcel, rows]) => (
        <div key={parcel} className="mb-4">
          <h2 className="text-base sm:text-lg font-bold mb-2 px-1">Parcel {parcel}</h2>

          {Object.entries(rows).map(([row, positions]) => {
            const items = Object.entries(positions).reverse()
            return (
              <div
                key={row}
                className="w-full mb-1 grid gap-1"
                style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
              >
                {items.map(([_, item]) => (
                  <Item
                    key={item.id}
                    siteId={site.id!}
                    item={item}
                    onSelect={() => setSelectedItem(item)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      ))}

      {/* ── Detail Modal ── */}
      {selectedItem && (
        <BedDetail
          siteId={site.id!}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  )
}

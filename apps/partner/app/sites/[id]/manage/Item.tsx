'use client'

import React from 'react'
import { InventoryItem } from '@/types/shared'
import { getCellAppearance } from './bed-state'
import { formatSeat } from '@repo/data/seat-label'

export default function SunbedItem({
  siteId,
  item,
  onSelect,
  hideDetail = false,
  selected = false,
}: {
  siteId: string
  item: InventoryItem
  onSelect: () => void
  /** At small zoom, render the colored block only (no number/icon) for orientation. */
  hideDetail?: boolean
  /** Multiselected — draws a ring. */
  selected?: boolean
}) {
  if (item.status === 'disabled') {
    return <div className="basis-0 flex-1 p-2" />
  }

  const { bg, icon } = getCellAppearance(item)

  // No group margins here — seat cells are a clean full width; group spacing is
  // expressed with dedicated gap columns in the grid (see view.tsx).
  return (
    <button
      data-item-id={item.id}
      onClick={onSelect}
      className={`
        ${bg} border-2 rounded-lg
        min-w-0 min-h-[44px]
        py-2 sm:py-3 px-0.5 flex flex-col items-center justify-center
        active:brightness-90 transition-colors select-none
        ${selected ? 'ring-2 ring-blue-500' : ''}
      `}
    >
      {!hideDetail && (
        <>
          {icon && <span className="text-[10px] leading-none">{icon}</span>}
          <span className="text-[10px] leading-none opacity-70">
            {formatSeat(item, { parcel: false })}
          </span>
        </>
      )}
    </button>
  )
}

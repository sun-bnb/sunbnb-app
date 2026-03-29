'use client'

import React from 'react'
import { InventoryItem, Reservation } from '@/types/shared'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW,
} from '@repo/data/reservation-status'

type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked'

function getActiveReservation(item: InventoryItem): Reservation | null {
  if (!item.reservations?.length) return null
  return item.reservations.find(r =>
    !([OP_DEPARTED, OP_NO_SHOW] as string[]).includes(r.operationalStatus)
  ) || null
}

function getBedState(item: InventoryItem): BedState {
  const res = getActiveReservation(item)
  if (!res) return 'available'
  switch (res.operationalStatus) {
    case OP_EXPECTED: return 'expected'
    case OP_CHECKED_IN: return 'checked-in'
    case OP_WALKED_IN: return 'walked-in'
    case 'blocked': return 'blocked'
    default: return 'available'
  }
}

// High-contrast colors for outdoor sunlight + simple icons
const stateStyles: Record<BedState, { bg: string; icon: string }> = {
  'available':  { bg: 'bg-green-300 border-green-500', icon: '' },
  'expected':   { bg: 'bg-yellow-300 border-yellow-500 animate-pulse-slow', icon: '⏳' },
  'checked-in': { bg: 'bg-blue-400 border-blue-600 text-white', icon: '✓' },
  'walked-in':  { bg: 'bg-orange-400 border-orange-600 text-white', icon: '●' },
  'blocked':    { bg: 'bg-gray-400 border-gray-600 text-white', icon: '✕' },
}

export default function SunbedItem({
  siteId,
  item,
  onSelect,
}: {
  siteId: string
  item: InventoryItem
  onSelect: () => void
}) {
  if (item.status === 'disabled') {
    return <div className="basis-0 flex-1 p-2" />
  }

  const state = getBedState(item)
  const { bg, icon } = stateStyles[state]

  return (
    <button
      onClick={onSelect}
      className={`
        ${bg} border-2 rounded-lg
        min-w-0 min-h-[44px]
        py-2 sm:py-3 px-0.5 flex flex-col items-center justify-center
        ${item.number % 2 !== 0 ? 'mr-[3px] sm:mr-[6px]' : 'ml-[3px] sm:ml-[6px]'}
        active:brightness-90 transition-colors select-none
      `}
    >
      {icon && <span className="text-[9px] sm:text-[10px] leading-none">{icon}</span>}
      <span className="text-[8px] leading-none opacity-70">
        {parseInt(String(item.number).substring(1))}
      </span>
    </button>
  )
}

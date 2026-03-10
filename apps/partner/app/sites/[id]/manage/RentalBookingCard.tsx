'use client'

import React, { useTransition } from 'react'
import { RentalBookingProps } from '@/types/shared'
import { markRentalPickedUp, markRentalReturned } from './actions'

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Card for a single rental booking on the manage page.
 *
 * Design: one enormous button per card — the whole bottom half is tappable.
 * Surf instructor glances → sees color → taps. Done.
 *
 * Yellow = waiting to pick up → big blue "Give 🤝"
 * Blue = out on the water  → big green "Back ✓"
 */
export default function RentalBookingCard({
  siteId,
  booking,
}: {
  siteId: string
  booking: RentalBookingProps
}) {
  const [isPending, startTransition] = useTransition()
  const isReserved = booking.operationalStatus === 'reserved'
  const isOut = booking.operationalStatus === 'picked-up'

  function runAction(fn: () => Promise<{ status: string }>) {
    startTransition(async () => { await fn() })
  }

  // Card border color = instant visual
  const borderColor = isReserved
    ? 'border-yellow-400'
    : 'border-blue-400'

  const bgColor = isReserved
    ? 'bg-yellow-50'
    : 'bg-blue-50'

  return (
    <div className={`rounded-2xl border-3 ${borderColor} ${bgColor} overflow-hidden`}>
      {/* ── Info strip — compact, glanceable ── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-lg font-black truncate">
            {booking.rentalItem.name}
            {booking.quantity > 1 && (
              <span className="text-base font-bold text-gray-500 ml-1">×{booking.quantity}</span>
            )}
          </span>
          {isOut && booking.pickedUpAt && (
            <span className="text-sm font-bold text-blue-600 flex-shrink-0">
              since {formatTime(booking.pickedUpAt)}
            </span>
          )}
        </div>
        {booking.guestName && (
          <div className="text-base font-medium text-gray-600 truncate">{booking.guestName}</div>
        )}
      </div>

      {/* ── Action — the entire bottom is one huge button ── */}
      {isReserved && (
        <button
          disabled={isPending}
          onClick={() => runAction(() => markRentalPickedUp(siteId, booking.id))}
          className="w-full bg-blue-500 text-white font-black text-xl py-5 active:bg-blue-600 disabled:opacity-50 select-none"
        >
          {isPending ? '...' : 'Give 🤝'}
        </button>
      )}

      {isOut && (
        <button
          disabled={isPending}
          onClick={() => runAction(() => markRentalReturned(siteId, booking.id))}
          className="w-full bg-green-600 text-white font-black text-xl py-5 active:bg-green-700 disabled:opacity-50 select-none"
        >
          {isPending ? '...' : 'Back ✓'}
        </button>
      )}
    </div>
  )
}

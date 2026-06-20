'use client'

import React, { useTransition } from 'react'
import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import { RentalBookingProps } from '@/types/shared'
import { markRentalPickedUp, markRentalReturned } from './actions'
import { OP_RESERVED, OP_PICKED_UP } from '@repo/data/reservation-status'

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return ''
  return dayjs(date).format('HH:mm')
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
  accessKey,
}: {
  siteId: string
  booking: RentalBookingProps
  accessKey?: string
}) {
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('RentalBookingCard')
  const isReserved = booking.operationalStatus === OP_RESERVED
  const isOut = booking.operationalStatus === OP_PICKED_UP

  // Walk-ins carry a guestName; online reservations fall back to the
  // booking user's name, then their email.
  const customerLabel = booking.guestName || booking.user?.name || booking.user?.email

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
              {t('since')} {formatTime(booking.pickedUpAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-sm font-semibold text-gray-500">
            {booking.durationType === 'hours'
              ? `${formatTime(booking.from)} – ${formatTime(booking.to)}`
              : t('allDay')}
          </span>
          {isOut && booking.durationType === 'hours' && (
            <span className={`text-xs font-bold flex-shrink-0 ${dayjs().isAfter(dayjs(booking.to)) ? 'text-red-500' : 'text-gray-400'}`}>
              {dayjs().isAfter(dayjs(booking.to)) ? t('overdue') : `${t('due')} ${formatTime(booking.to)}`}
            </span>
          )}
        </div>
        {customerLabel && (
          <div className="text-sm font-medium text-gray-600 truncate">{customerLabel}</div>
        )}
      </div>

      {/* ── Action — the entire bottom is one huge button ── */}
      {isReserved && (
        <button
          disabled={isPending}
          onClick={() => runAction(() => markRentalPickedUp(siteId, booking.id, accessKey))}
          className="w-full bg-blue-500 text-white font-black text-xl py-5 active:bg-blue-600 disabled:opacity-50 select-none"
        >
          {isPending ? '...' : `${t('give')} 🤝`}
        </button>
      )}

      {isOut && (
        <button
          disabled={isPending}
          onClick={() => runAction(() => markRentalReturned(siteId, booking.id, accessKey))}
          className="w-full bg-green-600 text-white font-black text-xl py-5 active:bg-green-700 disabled:opacity-50 select-none"
        >
          {isPending ? '...' : `${t('back')} ✓`}
        </button>
      )}
    </div>
  )
}

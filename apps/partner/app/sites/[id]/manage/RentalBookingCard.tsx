'use client'

import React, { useState, useTransition } from 'react'
import dayjs from 'dayjs'
import { useTranslations } from 'next-intl'
import { RentalBookingProps } from '@/types/shared'
import { markRentalPickedUp, markRentalReturned, collectRentalPayment, getRentalCollectStatus, cancelRentalCollection } from './actions'
import { OP_RESERVED, OP_PICKED_UP, RESERVATION_PAID_IN_CASH } from '@repo/data/reservation-status'
import CollectPaymentModal from './CollectPaymentModal'

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
 *
 * Online-payment indicator: a green chip shown when the booking has a
 * paymentRef (QR-collected or demo paid). Pure cash / free shows nothing.
 *
 * Collect-payment button: shown when status === paid-in-cash (un-collected
 * cash walk-in). Opens the generalized CollectPaymentModal.
 */
export default function RentalBookingCard({
  siteId,
  booking,
  accessKey,
  onChanged,
}: {
  siteId: string
  booking: RentalBookingProps
  accessKey?: string
  /** Called after a collect payment settles so the parent can refresh. */
  onChanged?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('RentalBookingCard')
  const [showCollect, setShowCollect] = useState(false)
  const isReserved = booking.operationalStatus === OP_RESERVED
  const isOut = booking.operationalStatus === OP_PICKED_UP
  const isCashWalkIn = booking.status === RESERVATION_PAID_IN_CASH

  // Walk-ins carry a guestName; online reservations fall back to the
  // booking user's name, then their email.
  const customerLabel = booking.guestName || booking.user?.name || booking.user?.email

  // Show the green payment indicator when the booking has been paid online
  // (QR collect completed, or demo). Pure cash (paymentRef == null) shows nothing.
  const isOnlinePaid = !!booking.paymentRef

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
    <>
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
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Online-payment indicator — only when a paymentRef exists */}
              {isOnlinePaid && (
                <span
                  title={t('paidOnline')}
                  aria-label={t('paidOnline')}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="1" y="4" width="22" height="16" rx="2" />
                    <path d="M1 10h22" />
                  </svg>
                  {t('paid')}
                </span>
              )}
              {isOut && booking.pickedUpAt && (
                <span className="text-sm font-bold text-blue-600">
                  {t('since')} {formatTime(booking.pickedUpAt)}
                </span>
              )}
            </div>
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

          {/* Collect-payment button — only for un-collected cash walk-ins */}
          {isCashWalkIn && !isOnlinePaid && (
            <button
              disabled={isPending}
              onClick={() => setShowCollect(true)}
              className="mt-2 w-full bg-blue-600 text-white font-black text-base py-3 rounded-xl active:bg-blue-700 disabled:opacity-50 select-none"
            >
              💳 {t('collectPayment')}
            </button>
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

      {/* Full-screen Collect payment (QR → Mollie) for the cash walk-in rental */}
      {showCollect && (
        <CollectPaymentModal
          actions={{
            create: () => collectRentalPayment(siteId, [booking.id], accessKey),
            poll:   () => getRentalCollectStatus(siteId, booking.id, accessKey),
            cancel: () => cancelRentalCollection(siteId, booking.id, accessKey),
          }}
          onClose={() => setShowCollect(false)}
          onSettled={() => {
            onChanged?.()
          }}
        />
      )}
    </>
  )
}

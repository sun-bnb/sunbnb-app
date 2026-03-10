'use client'

import React, { useState, useTransition } from 'react'
import { InventoryItem, Reservation } from '@/types/shared'
import {
  reserveItem,
  unreserveItem,
  checkInReservation,
  markDeparted,
  markNoShow,
  updateReservationNotes,
  blockBed,
  unblockBed,
} from './actions'
import {
  OP_EXPECTED, OP_CHECKED_IN, OP_WALKED_IN, OP_DEPARTED, OP_NO_SHOW,
} from '@repo/data/reservation-status'

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// Plain language labels — no jargon
const stateLabels: Record<BedState, string> = {
  'available': 'Free',
  'expected': 'Booked',
  'checked-in': 'Here',
  'walked-in': 'Walk-in',
  'blocked': 'Blocked',
}

const stateBadgeColors: Record<BedState, string> = {
  'available': 'bg-green-200 text-green-900',
  'expected': 'bg-yellow-200 text-yellow-900',
  'checked-in': 'bg-blue-200 text-blue-900',
  'walked-in': 'bg-orange-200 text-orange-900',
  'blocked': 'bg-gray-300 text-gray-800',
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BedDetail({
  siteId,
  item,
  onClose,
}: {
  siteId: string
  item: InventoryItem
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [guestName, setGuestName] = useState('')
  const [showBlock, setShowBlock] = useState(false)
  const [showNoShow, setShowNoShow] = useState(false)

  const reservation = getActiveReservation(item)
  const state = getBedState(item)
  const pairNumber = item.pair?.number || item.pairedBy?.number

  function runAction(fn: () => Promise<{ status: string }>) {
    startTransition(async () => {
      const result = await fn()
      if (result.status === 'ok') onClose()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full max-w-lg rounded-t-2xl p-4 sm:p-5 shadow-xl animate-slide-up"
           style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}>
        {/* Header — big number, plain status */}
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-2xl sm:text-3xl font-black">#{item.number}</span>
            {pairNumber && (
              <span className="text-base sm:text-lg text-gray-400 font-medium">+ #{pairNumber}</span>
            )}
            <span className={`text-xs sm:text-sm font-bold px-2.5 sm:px-3 py-1 rounded-full ${stateBadgeColors[state]}`}>
              {stateLabels[state]}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none p-2">&times;</button>
        </div>

        {/* ── FREE — one big button to seat someone ── */}
        {state === 'available' && !showBlock && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Guest name (optional)"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              className="w-full border-2 rounded-xl px-4 py-3.5 text-base"
              autoFocus
            />
            <button
              disabled={isPending}
              onClick={() => runAction(() => reserveItem(siteId, item.id, guestName || undefined))}
              className="w-full bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
            >
              {isPending ? '...' : 'Seat Customer Here'}
            </button>
            <button
              onClick={() => setShowBlock(true)}
              className="w-full text-gray-400 text-sm py-2 active:text-gray-600"
            >
              Block this bed
            </button>
          </div>
        )}

        {/* Block confirmation (hidden behind tap) */}
        {state === 'available' && showBlock && (
          <div className="space-y-3">
            <p className="text-base text-gray-600">Block bed #{item.number}?</p>
            <div className="flex gap-3">
              <button
                disabled={isPending}
                onClick={() => runAction(() => blockBed(siteId, item.id))}
                className="flex-1 bg-gray-600 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-700 disabled:opacity-50"
              >
                {isPending ? '...' : 'Yes, Block'}
              </button>
              <button
                onClick={() => setShowBlock(false)}
                className="flex-1 bg-gray-100 text-gray-600 font-bold text-lg py-4 rounded-xl active:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── BOOKED — guest is coming, one big check-in button ── */}
        {state === 'expected' && reservation && (
          <div className="space-y-3">
            <div className="bg-yellow-50 rounded-xl p-4 space-y-2 text-base border-2 border-yellow-200">
              {reservation.guestName && (
                <div className="font-bold text-lg">{reservation.guestName}</div>
              )}
              <div className="text-gray-600">{reservation.user.email}</div>
              {reservation.guestContact && (
                <div className="text-gray-600">{reservation.guestContact}</div>
              )}
              {reservation.internalNotes && (
                <div className="text-gray-500 italic">{reservation.internalNotes}</div>
              )}
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => checkInReservation(siteId, reservation.id))}
              className="w-full bg-blue-500 text-white font-bold text-lg py-4 rounded-xl active:bg-blue-600 disabled:opacity-50"
            >
              {isPending ? '...' : 'Guest Arrived ✓'}
            </button>
            {!showNoShow ? (
              <button
                onClick={() => setShowNoShow(true)}
                className="w-full text-gray-400 text-sm py-2 active:text-gray-600"
              >
                Didn&apos;t show up?
              </button>
            ) : (
              <button
                disabled={isPending}
                onClick={() => runAction(() => markNoShow(siteId, reservation.id))}
                className="w-full bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50"
              >
                {isPending ? '...' : 'Mark No-Show'}
              </button>
            )}
          </div>
        )}

        {/* ── HERE — guest checked in, one button to free the bed ── */}
        {state === 'checked-in' && reservation && (
          <div className="space-y-3">
            <div className="bg-blue-50 rounded-xl p-4 space-y-2 text-base border-2 border-blue-200">
              {reservation.guestName && (
                <div className="font-bold text-lg">{reservation.guestName}</div>
              )}
              <div className="text-gray-600">{reservation.user.email}</div>
              <div className="text-gray-500">Arrived at {formatTime(reservation.checkedInAt)}</div>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => markDeparted(siteId, reservation.id))}
              className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? '...' : 'Guest Left \uD83D\uDC4B'}
            </button>
          </div>
        )}

        {/* ── WALK-IN — same as here, one button ── */}
        {state === 'walked-in' && reservation && (
          <div className="space-y-3">
            <div className="bg-orange-50 rounded-xl p-4 space-y-2 text-base border-2 border-orange-200">
              {reservation.guestName && (
                <div className="font-bold text-lg">{reservation.guestName}</div>
              )}
              <div className="text-gray-500">Arrived at {formatTime(reservation.checkedInAt)}</div>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => markDeparted(siteId, reservation.id))}
              className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? '...' : 'Guest Left \uD83D\uDC4B'}
            </button>
            <button
              disabled={isPending}
              onClick={() => runAction(() => unreserveItem(siteId, item.id))}
              className="w-full text-red-500 text-sm py-2 active:text-red-700"
            >
              Remove (added by mistake)
            </button>
          </div>
        )}

        {/* ── BLOCKED — one button to free it ── */}
        {state === 'blocked' && (
          <div className="space-y-3">
            {reservation?.internalNotes && (
              <div className="bg-gray-50 rounded-xl p-4 text-base border-2 border-gray-200">
                {reservation.internalNotes}
              </div>
            )}
            <button
              disabled={isPending}
              onClick={() => runAction(() => unblockBed(siteId, item.id))}
              className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50"
            >
              {isPending ? '...' : 'Unblock ✓'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

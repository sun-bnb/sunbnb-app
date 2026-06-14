'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
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
  deletePoolSeat,
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

// stateLabels built dynamically inside component using translations

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

// States where the pair toggle governs a creation/release action
const TOGGLE_VISIBLE_STATES: BedState[] = ['available', 'blocked', 'walked-in']

// Pool seat numbering: number = parcel*10000 + 9900 + seq
const POOL_BAND_BASE = 9900
function getPoolSeq(item: InventoryItem): number {
  const parcel = parseInt(String(item.number)[0]!, 10)
  return item.number - (parcel * 10000 + POOL_BAND_BASE)
}

export default function BedDetail({
  siteId,
  item,
  pairItem,
  accessKey,
  isPool = false,
  onClose,
  onPoolSeatRemoved,
}: {
  siteId: string
  item: InventoryItem
  pairItem: InventoryItem | null
  accessKey?: string
  isPool?: boolean
  onClose: () => void
  onPoolSeatRemoved?: () => void
}) {
  const t = useTranslations('BedDetail')
  const [isPending, startTransition] = useTransition()
  const [guestName, setGuestName] = useState('')
  const [showBlock, setShowBlock] = useState(false)
  const [showNoShow, setShowNoShow] = useState(false)
  const [until, setUntil] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD')
  const maxUntil = dayjs().add(90, 'day').format('YYYY-MM-DD')
  const days = until ? dayjs(until).startOf('day').diff(dayjs().startOf('day'), 'day') + 1 : 1

  const stateLabels: Record<BedState, string> = {
    'available': t('free'),
    'expected': t('booked'),
    'checked-in': t('here'),
    'walked-in': t('walkIn'),
    'blocked': t('blocked'),
  }

  const reservation = getActiveReservation(item)
  const state = getBedState(item)
  // pairItem is resolved from SunbedGroup membership (manage/view.tsx); no pairId fallback.
  const pairNumber = isPool ? undefined : pairItem?.number
  const poolSeq = isPool ? getPoolSeq(item) : null

  // Sync: both seats share the same reservation (or both are free)
  const inSync = pairItem !== null
    ? (getActiveReservation(item)?.id ?? null) === (getActiveReservation(pairItem)?.id ?? null)
    : false

  // Default: apply to both when in sync; apply to single only when out of sync
  const [applyToPair, setApplyToPair] = useState(inSync)

  // Re-initialize when the selected item changes
  useEffect(() => {
    setApplyToPair(inSync)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  function runAction(fn: () => Promise<{ status: string; errors?: (string | undefined)[] }>) {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (result.status === 'ok') onClose()
      else setError(result.errors?.[0] || 'Something went wrong')
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
            {isPool ? (
              <div className="flex flex-col leading-tight">
                <span className="text-2xl sm:text-3xl font-black">#{poolSeq}</span>
                <span className="text-[10px] text-gray-400 font-normal leading-none">{t('additionalSeat')}</span>
              </div>
            ) : (
              <span className="text-2xl sm:text-3xl font-black">#{item.number}</span>
            )}
            {pairNumber && (
              <span className="text-base sm:text-lg text-gray-400 font-medium">+ #{pairNumber}</span>
            )}
            <span className={`text-xs sm:text-sm font-bold px-2.5 sm:px-3 py-1 rounded-full ${stateBadgeColors[state]}`}>
              {stateLabels[state]}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none p-2">&times;</button>
        </div>

        {/* Pair-scope toggle — visible only when paired AND the current state has a
            creation/release action that the toggle governs */}
        {pairItem !== null && TOGGLE_VISIBLE_STATES.includes(state) && (
          <div className="mb-4">
            <div className="flex rounded-lg overflow-hidden border border-gray-200 font-semibold">
              <button
                onClick={() => setApplyToPair(true)}
                aria-pressed={applyToPair}
                className={`
                  flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                  ${applyToPair
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}
                `}
              >
                {t('bothSeats')}
              </button>
              <button
                onClick={() => setApplyToPair(false)}
                aria-pressed={!applyToPair}
                className={`
                  flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 transition-colors
                  ${!applyToPair
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50'}
                `}
              >
                {t('thisSeatOnly')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 bg-red-50 border-2 border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* ── FREE — one big button to seat someone ── */}
        {state === 'available' && !showBlock && (
          <div className="space-y-3">
            <input
              type="text"
              placeholder={t('guestName')}
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              className="w-full border-2 rounded-xl px-4 py-3.5 text-base"
              autoFocus
            />

            {/* Multi-day stay — hidden for pool seats (today-only, walk-in only) */}
            {!isPool && (until === '' ? (
              <button
                onClick={() => setUntil(tomorrow)}
                className="w-full text-gray-400 text-sm py-1.5 active:text-gray-600"
              >
                {t('multipleDays')}
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-gray-50 border-2 rounded-xl px-3 py-2.5">
                <span className="text-sm font-medium text-gray-500 flex-shrink-0">{t('until')}</span>
                <input
                  type="date"
                  value={until}
                  min={tomorrow}
                  max={maxUntil}
                  onChange={e => setUntil(e.target.value || tomorrow)}
                  className="flex-1 bg-transparent text-base font-medium outline-none"
                />
                <button
                  onClick={() => setUntil('')}
                  className="text-gray-400 text-2xl leading-none px-1 flex-shrink-0"
                  aria-label={t('cancel')}
                >
                  &times;
                </button>
              </div>
            ))}

            <button
              disabled={isPending}
              onClick={() => runAction(() => reserveItem(
                siteId, item.id, guestName || undefined, undefined, accessKey,
                isPool ? undefined : (until || undefined),
                isPool ? false : applyToPair
              ))}
              className="w-full bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
            >
              {isPending ? '...' : (!isPool && days > 1) ? t('reserveDays', { n: days }) : t('reserve')}
            </button>
            <button
              onClick={() => setShowBlock(true)}
              className="w-full text-gray-400 text-sm py-2 active:text-gray-600"
            >
              {t('block')}
            </button>
            {/* Pool seat: "Remove seat" only when free */}
            {isPool && (
              <button
                disabled={isPending}
                onClick={() => {
                  setError(null)
                  startTransition(async () => {
                    const result = await deletePoolSeat(siteId, item.id, accessKey)
                    if (result.status === 'ok') {
                      onPoolSeatRemoved?.()
                    } else {
                      setError(result.errors?.[0] || 'Something went wrong')
                    }
                  })
                }}
                className="w-full text-red-500 text-sm py-2 active:text-red-700 disabled:opacity-50"
              >
                {t('poolRemoveSeat')}
              </button>
            )}
          </div>
        )}

        {/* Block confirmation (hidden behind tap) */}
        {state === 'available' && showBlock && (
          <div className="space-y-3">
            <p className="text-base text-gray-600">{t('sunbedNumber', { n: item.number })}?</p>
            <div className="flex gap-3">
              <button
                disabled={isPending}
                onClick={() => runAction(() => blockBed(siteId, item.id, undefined, accessKey, applyToPair))}
                className="flex-1 bg-gray-600 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-700 disabled:opacity-50"
              >
                {isPending ? '...' : t('confirm')}
              </button>
              <button
                onClick={() => setShowBlock(false)}
                className="flex-1 bg-gray-100 text-gray-600 font-bold text-lg py-4 rounded-xl active:bg-gray-200"
              >
                {t('cancel')}
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
              onClick={() => runAction(() => checkInReservation(siteId, reservation.id, accessKey))}
              className="w-full bg-blue-500 text-white font-bold text-lg py-4 rounded-xl active:bg-blue-600 disabled:opacity-50"
            >
              {isPending ? '...' : t('checkIn')}
            </button>
            {!showNoShow ? (
              <button
                onClick={() => setShowNoShow(true)}
                className="w-full text-gray-400 text-sm py-2 active:text-gray-600"
              >
                {t('markNoShow')}
              </button>
            ) : (
              <button
                disabled={isPending}
                onClick={() => runAction(() => markNoShow(siteId, reservation.id, accessKey))}
                className="w-full bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50"
              >
                {isPending ? '...' : t('confirm')}
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
              <div className="text-gray-500">{formatTime(reservation.checkedInAt)}</div>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => markDeparted(siteId, reservation.id, accessKey))}
              className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? '...' : t('markDeparted')}
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
              <div className="text-gray-500">{formatTime(reservation.checkedInAt)}</div>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => markDeparted(siteId, reservation.id, accessKey))}
              className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? '...' : t('markDeparted')}
            </button>
            <button
              disabled={isPending}
              onClick={() => runAction(() => unreserveItem(siteId, item.id, accessKey, applyToPair))}
              className="w-full text-red-500 text-sm py-2 active:text-red-700"
            >
              {t('unreserve')}
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
              onClick={() => runAction(() => unblockBed(siteId, item.id, accessKey, applyToPair))}
              className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50"
            >
              {isPending ? '...' : t('unblock')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

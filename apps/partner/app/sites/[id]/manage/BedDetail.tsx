'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import { formatSeat } from '@repo/data/seat-label'
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
  holdBed,
  compBed,
  uncompBed,
  cancelReservation,
  releaseHold,
  convertHoldToWalkIn,
  deletePoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  removeFailedReservation,
} from './actions'
import {
  RESERVATION_COMPLETE, RESERVATION_HELD,
} from '@repo/data/reservation-status'
import { groupExtraSeatLabel } from './grid-helpers'
import {
  getActiveReservation,
  getBedState,
  isFailedReservationStatus,
  type BedState,
} from './bed-state'

// stateLabels built dynamically inside component using translations

const stateBadgeColors: Record<BedState, string> = {
  'available': 'bg-green-200 text-green-900',
  'expected': 'bg-yellow-200 text-yellow-900',
  'checked-in': 'bg-blue-200 text-blue-900',
  'walked-in': 'bg-orange-200 text-orange-900',
  'blocked': 'bg-gray-300 text-gray-800',
  'comp': 'bg-purple-200 text-purple-900',
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ─── Component ──────────────────────────────────────────────────────────────

// States where the pair toggle governs a creation/release action
const TOGGLE_VISIBLE_STATES: BedState[] = ['available', 'blocked', 'walked-in', 'comp']

// Pool seat numbering: number = parcel*10000 + 9900 + seq
const POOL_BAND_BASE = 9900
function getPoolSeq(item: InventoryItem): number {
  const parcel = parseInt(String(item.number)[0]!, 10)
  return item.number - (parcel * 10000 + POOL_BAND_BASE)
}

// Shared confirm prompt type across all ⚠ transitions
type PendingConfirm = 'no-show' | 'cancel' | 'depart' | 'unreserve' | 'remove' | null

export default function BedDetail({
  siteId,
  item,
  groupItems,
  accessKey,
  isPool = false,
  isGroupExtra = false,
  onClose,
  onPoolSeatRemoved,
  onGroupSeatAdded,
  onGroupSeatRemoved,
}: {
  siteId: string
  item: InventoryItem
  /** All OTHER members of the item's SunbedGroup (empty array when not in a group). */
  groupItems: InventoryItem[]
  accessKey?: string
  isPool?: boolean
  /** True when this item is a group-attached extra (status='pool' && sunbedGroupId set). */
  isGroupExtra?: boolean
  onClose: () => void
  onPoolSeatRemoved?: () => void
  onGroupSeatAdded?: () => void
  onGroupSeatRemoved?: () => void
}) {
  const t = useTranslations('BedDetail')
  const [isPending, startTransition] = useTransition()
  const [guestName, setGuestName] = useState('')
  /** Shared one-step confirm guard for all ⚠ transitions (no-show, cancel, depart, unreserve). */
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
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
    'comp': t('comp'),
  }

  const reservation = getActiveReservation(item)
  const state = getBedState(item)

  // Sync: all group members share the same reservation (or all are free).
  // Must be computed BEFORE pairNumber — pairNumber is only shown when inSync
  // (out-of-sync: the peer is on a different reservation, so "+#peer" is misleading).
  const thisResId = reservation?.id ?? null
  const inSync = groupItems.length > 0
    ? groupItems.every(gi => (getActiveReservation(gi)?.id ?? null) === thisResId)
    : false

  // For header display: show companion info only when exactly one group peer AND in sync
  const pairItem = groupItems.length === 1 ? groupItems[0]! : null
  const pairNumber = (isPool || isGroupExtra || !inSync) ? undefined : (pairItem ? formatSeat(pairItem, { parcel: true }) : undefined)
  const poolSeq = (isPool || isGroupExtra) ? getPoolSeq(item) : null
  // A group-extra reads as the next member of its group (e.g. "103-3"); a free
  // pool seat keeps the "+N" sequence label.
  const groupExtraLabel = isGroupExtra ? groupExtraSeatLabel(item, groupItems) : null

  // Default: apply to all group members when in sync; single only when out of sync
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

  /** Run the confirmed action determined by `pendingConfirm`. */
  function runPendingConfirm() {
    if (!pendingConfirm) return
    if (pendingConfirm === 'no-show') {
      if (!reservation) return
      runAction(() => markNoShow(siteId, reservation.id, accessKey))
    } else if (pendingConfirm === 'cancel') {
      runAction(() => cancelReservation(siteId, item.id, accessKey))
    } else if (pendingConfirm === 'depart') {
      if (!reservation) return
      // Walk-in + Seat mode on an in-sync group: the pair shares ONE reservation,
      // so departing one seat must disconnect it rather than marking the whole
      // reservation departed. unreserveItem with applyToPair=false disconnects
      // just this item (leaving the partner still walked-in).
      if (state === 'walked-in' && !applyToPair && inSync && groupItems.length > 0) {
        runAction(() => unreserveItem(siteId, item.id, accessKey, false))
      } else {
        runAction(() => markDeparted(siteId, reservation.id, accessKey))
      }
    } else if (pendingConfirm === 'unreserve') {
      runAction(() => unreserveItem(siteId, item.id, accessKey, applyToPair))
    } else if (pendingConfirm === 'remove') {
      if (!reservation) return
      runAction(() => removeFailedReservation(siteId, reservation.id, accessKey))
    }
  }

  /** Shared inline confirm panel — renders instead of normal action buttons. */
  const confirmPanel = (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {pendingConfirm === 'no-show'
          ? t('confirmNoShow')
          : pendingConfirm === 'depart'
          ? t('confirmDepart')
          : pendingConfirm === 'unreserve'
          ? t('confirmUnreserve')
          : pendingConfirm === 'remove'
          ? t('confirmRemove')
          : t('confirmCancel')}
      </p>
      <div className="flex gap-3">
        <button
          disabled={isPending}
          onClick={runPendingConfirm}
          className="flex-1 bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50"
        >
          {isPending ? '...' : t('confirm')}
        </button>
        <button
          onClick={() => setPendingConfirm(null)}
          className="flex-1 bg-gray-100 text-gray-600 font-bold text-lg py-4 rounded-xl active:bg-gray-200"
        >
          {t('back')}
        </button>
      </div>
    </div>
  )

  // Badge label: show "Hold" for staff holds so staff can tell them from paid bookings
  const badgeLabel = (state === 'expected' && reservation?.status === RESERVATION_HELD)
    ? t('held')
    : stateLabels[state]

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
            {(isPool || isGroupExtra) ? (
              <div className="flex flex-col leading-tight">
                <span className="text-2xl sm:text-3xl font-black">
                  {isGroupExtra ? `#${groupExtraLabel}` : `+${poolSeq}`}
                </span>
                <span className="text-[10px] text-gray-400 font-normal leading-none">
                  {isGroupExtra && pairItem
                    ? t('groupExtraSeat', { n: formatSeat(pairItem, { parcel: true }) })
                    : t('additionalSeat')}
                </span>
              </div>
            ) : (
              <span className="text-2xl sm:text-3xl font-black">#{formatSeat(item, { parcel: true })}</span>
            )}
            {pairNumber && !isGroupExtra && (
              <span className="text-base sm:text-lg text-gray-400 font-medium">+ #{pairNumber}</span>
            )}
            <span className={`text-xs sm:text-sm font-bold px-2.5 sm:px-3 py-1 rounded-full ${stateBadgeColors[state]}`}>
              {badgeLabel}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 text-3xl leading-none p-2">&times;</button>
        </div>

        {/* Group-scope toggle — visible only when in a group AND the current state has a
            creation/release action that the toggle governs. Hidden while a confirmation is
            showing (the confirm panel describes the action instead).
            Two cases:
            - inSync (all group members share the same reservation, or all are free):
              show the two-button [Group/Pair | Seat] toggle so staff can choose scope.
            - NOT inSync (e.g. one seat held, one free): the action can only target
              this seat — show a single non-interactive "Seat" indicator so staff see
              the scope is locked to this seat. */}
        {groupItems.length > 0 && TOGGLE_VISIBLE_STATES.includes(state) && !pendingConfirm && (
          <div className="mb-4">
            {inSync ? (
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
                  {groupItems.length >= 2 ? t('group') : t('pair')}
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
                  {t('seat')}
                </button>
              </div>
            ) : (
              /* Out-of-sync group: members are on different reservations (or one is
                 free while the other is occupied). The action scope is locked to this
                 seat — no toggle choice, just a non-interactive "Seat" indicator. */
              <div
                role="img"
                aria-label={t('seat')}
                className="flex rounded-lg overflow-hidden border border-gray-200 font-semibold"
              >
                <div className="flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm bg-gray-900 text-white">
                  {t('seat')}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3 bg-red-50 border-2 border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* ── FREE — creation actions (Rent/Reserve/Comp/Block).
            INVARIANT: these four buttons ONLY render when the seat is available.
            Occupied states (expected/checked-in/walked-in/comp/blocked) never expose them. ── */}
        {state === 'available' && (
          <div className="space-y-3">
            {/* Guest name + multi-day DURATION toggle on one row */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('guestName')}
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                className="flex-1 border-2 rounded-xl px-4 py-3.5 text-base"
                autoFocus
              />
              {/* Calendar toggle — opens the date picker row below. Hidden for pool
                  seats (today-only, walk-in only). Highlighted while active. */}
              {!isPool && (
                <button
                  onClick={() => setUntil(until === '' ? tomorrow : '')}
                  aria-label={t('multipleDays')}
                  aria-pressed={until !== ''}
                  title={t('multipleDays')}
                  className={`w-14 self-stretch flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 transition-colors ${
                    until !== ''
                      ? 'border-orange-400 bg-orange-50 text-orange-600'
                      : 'border-gray-300 text-gray-500 active:bg-gray-50'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  {until !== '' && (
                    <span className="text-[10px] font-bold leading-none tabular-nums">{days}d</span>
                  )}
                </button>
              )}
            </div>

            {/* Date range picker — shown when the multi-day toggle is on */}
            {!isPool && until !== '' && (
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
            )}

            {/* Block (square) + Comp (square) + Reserve (hold, yellow) + Rent (paid walk-in, orange primary) */}
            <div className="flex gap-3">
              <button
                disabled={isPending}
                onClick={() => runAction(() => blockBed(siteId, item.id, undefined, accessKey, applyToPair))}
                aria-label={t('block')}
                title={t('block')}
                className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-gray-300 text-gray-500 rounded-xl active:bg-gray-50 disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M5.6 5.6l12.8 12.8" />
                </svg>
                <span className="text-[10px] font-semibold leading-none">{t('block')}</span>
              </button>
              <button
                disabled={isPending}
                onClick={() => runAction(() => compBed(
                  siteId, item.id, accessKey,
                  groupItems.length > 0 ? applyToPair : false,
                  guestName || undefined,
                  undefined
                ))}
                aria-label={t('comp')}
                title={t('comp')}
                className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-purple-300 text-purple-600 rounded-xl active:bg-purple-50 disabled:opacity-50"
              >
                <span className="text-base leading-none" aria-hidden="true">★</span>
                <span className="text-[10px] font-semibold leading-none">{t('comp')}</span>
              </button>
              {/* Reserve — lightweight today-only hold (no payment, shows as yellow "booked") */}
              <button
                disabled={isPending}
                onClick={() => runAction(() => holdBed(
                  siteId, item.id, accessKey,
                  groupItems.length > 0 ? applyToPair : false,
                  guestName || undefined,
                  undefined
                ))}
                className="flex-1 bg-yellow-400 text-yellow-900 font-bold text-lg py-4 rounded-xl active:bg-yellow-500 disabled:opacity-50"
              >
                {isPending ? '...' : t('reserve')}
              </button>
              {/* Rent — paid walk-in (immediately checked in, cash payment) */}
              <button
                disabled={isPending}
                onClick={() => runAction(() => reserveItem(
                  siteId, item.id, guestName || undefined, undefined, accessKey,
                  (isPool && !isGroupExtra) ? undefined : (until || undefined),
                  groupItems.length > 0 ? applyToPair : false
                ))}
                className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? '...' : (!isPool && days > 1) ? t('rentDays', { n: days }) : t('rent')}
              </button>
            </div>
            {/* ── Seat management — compact link-style actions, divided off from the
                larger reservation controls above. Add + Remove share the row at
                equal width. ── */}
            {(groupItems.length > 0 || (isPool && !isGroupExtra)) && (
              <div className="mt-2 pt-2.5 border-t border-gray-200 flex items-center gap-3">
                {/* Add another seat to the group — works from a regular member OR a
                    group extra. */}
                {groupItems.length > 0 && (
                  <button
                    disabled={isPending}
                    onClick={() => {
                      setError(null)
                      startTransition(async () => {
                        const result = await addSeatToGroup(siteId, item.id, accessKey)
                        if (result.status === 'ok') {
                          onGroupSeatAdded?.()
                          onClose()
                        } else {
                          setError(result.errors?.[0] || 'Something went wrong')
                        }
                      })
                    }}
                    className="flex-1 text-gray-500 text-sm py-2 active:text-gray-700 disabled:opacity-50"
                  >
                    {t('addSeatToGroup')}
                  </button>
                )}

                {/* Remove a group extra seat */}
                {isGroupExtra && (
                  <button
                    disabled={isPending}
                    onClick={() => {
                      setError(null)
                      startTransition(async () => {
                        const result = await removeGroupSeat(siteId, item.id, accessKey)
                        if (result.status === 'ok') {
                          onGroupSeatRemoved?.()
                        } else {
                          setError(result.errors?.[0] || 'Something went wrong')
                        }
                      })
                    }}
                    className="flex-1 text-red-500 text-sm py-2 active:text-red-700 disabled:opacity-50"
                  >
                    {t('groupExtraRemove')}
                  </button>
                )}

                {/* Remove a free pool seat */}
                {isPool && !isGroupExtra && (
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
                    className="flex-1 text-red-500 text-sm py-2 active:text-red-700 disabled:opacity-50"
                  >
                    {t('poolRemoveSeat')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── RESERVED — paid online/QR booking, guest not yet arrived ──
            Lane: status=complete, operationalStatus=expected
            Actions: Check-in · No-show ⚠ · Cancel ⚠ */}
        {state === 'expected' && reservation && reservation.status === RESERVATION_COMPLETE && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
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
                <div className="flex gap-3">
                  <button
                    onClick={() => setPendingConfirm('no-show')}
                    className="flex-1 text-gray-400 text-sm py-2 active:text-gray-600"
                  >
                    {t('markNoShow')}
                  </button>
                  <button
                    onClick={() => setPendingConfirm('cancel')}
                    className="flex-1 text-red-400 text-sm py-2 active:text-red-600"
                  >
                    {t('cancelReservation')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── HELD — staff hold, no payment ──
            Lane: status=held, operationalStatus=expected
            Actions: Rent (convert hold → walk-in) · Release (no confirm — no money at stake)
            No Check-in: a held guest who arrives is Rented (hold converted in place to a paid
            walk-in). This removes the unpaid checked-in+held limbo where Cancel failed.
            Period picker ALWAYS; name input ONLY if the hold has no name yet. */}
        {state === 'expected' && reservation && reservation.status === RESERVATION_HELD && (
          <div className="space-y-3">
            {/* Left: info card (named hold) OR name input (unnamed). The multi-day
                calendar toggle sits on the SAME row, to the right. */}
            <div className="flex gap-2 items-stretch">
              {reservation.guestName ? (
                <div className="flex-1 min-w-0 bg-yellow-50 rounded-xl p-4 border-2 border-dashed border-yellow-300 flex flex-col justify-center">
                  <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                  {reservation.internalNotes && (
                    <div className="text-gray-500 italic text-sm truncate">{reservation.internalNotes}</div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder={t('guestName')}
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  className="flex-1 border-2 rounded-xl px-4 py-3.5 text-base"
                />
              )}
              <button
                onClick={() => setUntil(until === '' ? tomorrow : '')}
                aria-label={t('multipleDays')}
                aria-pressed={until !== ''}
                title={t('multipleDays')}
                className={`w-14 self-stretch flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 transition-colors ${
                  until !== ''
                    ? 'border-orange-400 bg-orange-50 text-orange-600'
                    : 'border-gray-300 text-gray-500 active:bg-gray-50'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                {until !== '' && (
                  <span className="text-[10px] font-bold leading-none tabular-nums">{days}d</span>
                )}
              </button>
            </div>

            {/* Notes on an unnamed hold (rare) — shown below so they aren't lost */}
            {!reservation.guestName && reservation.internalNotes && (
              <div className="text-gray-500 italic text-sm px-1">{reservation.internalNotes}</div>
            )}

            {/* Date range picker — shown when multi-day toggle is on */}
            {until !== '' && (
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
            )}

            {/* Rent — convert hold to paid walk-in, with the chosen period.
                Effective name: existing hold name if set, else the typed name. */}
            <button
              disabled={isPending}
              onClick={() => runAction(() => convertHoldToWalkIn(
                siteId, item.id, accessKey,
                reservation.guestName
                  ? reservation.guestName
                  : (guestName || undefined),
                until || undefined
              ))}
              className="w-full bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
            >
              {isPending ? '...' : days > 1 ? t('rentDays', { n: days }) : t('rent')}
            </button>

            {/* Release — delete the hold with no confirmation (no money at stake) */}
            <button
              disabled={isPending}
              onClick={() => runAction(() => releaseHold(siteId, item.id, accessKey))}
              className="w-full text-gray-400 text-sm py-2 active:text-gray-600 disabled:opacity-50"
            >
              {t('release')}
            </button>
          </div>
        )}

        {/* ── FAILED PAYMENT — payment was never completed; seat is orphaned.
            Remove action deletes the reservation immediately (no refund — never paid).
            Handles both canonical RESERVATION_PAYMENT_FAILED and legacy 'error' status. */}
        {state === 'expected' && reservation && isFailedReservationStatus(reservation.status) && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
                <div className="bg-red-50 rounded-xl p-4 space-y-2 text-base border-2 border-red-200">
                  {reservation.guestName && (
                    <div className="font-bold text-lg">{reservation.guestName}</div>
                  )}
                  <div className="text-gray-600">{reservation.user.email}</div>
                  <div className="text-xs text-red-600 font-semibold">{t('paymentFailed')}</div>
                </div>
                <button
                  disabled={isPending}
                  onClick={() => setPendingConfirm('remove')}
                  className="w-full bg-red-500 text-white font-bold text-lg py-4 rounded-xl active:bg-red-600 disabled:opacity-50"
                >
                  {isPending ? '...' : t('remove')}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── IN-FLIGHT / UNKNOWN — genuinely pending/processing expected reservation
            (rare on floor). Show info card only; the cleanup cron GCs these if stale.
            Excludes failed reservations (handled by the branch above). */}
        {state === 'expected' && reservation
          && reservation.status !== RESERVATION_COMPLETE
          && reservation.status !== RESERVATION_HELD
          && !isFailedReservationStatus(reservation.status) && (
          <div className="space-y-3">
            <div className="bg-yellow-50 rounded-xl p-4 space-y-2 text-base border-2 border-yellow-100">
              {reservation.guestName && (
                <div className="font-bold text-lg">{reservation.guestName}</div>
              )}
              <div className="text-gray-600">{reservation.user.email}</div>
              <div className="text-xs text-yellow-600 font-semibold">{reservation.status}</div>
            </div>
          </div>
        )}

        {/* ── CHECKED-IN — guest present, paid booking ──
            Actions: Depart ⚠ · Cancel ⚠ */}
        {state === 'checked-in' && reservation && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
                <div className="bg-blue-50 rounded-xl p-4 border-2 border-blue-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {reservation.guestName && (
                      <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                    )}
                    <div className="text-gray-600 text-sm truncate">{reservation.user.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 text-blue-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                    </svg>
                    <span className="text-lg font-bold tabular-nums leading-none">{formatTime(reservation.checkedInAt)}</span>
                  </div>
                </div>
                <button
                  disabled={isPending}
                  onClick={() => setPendingConfirm('depart')}
                  className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
                >
                  {isPending ? '...' : t('markDeparted')}
                </button>
                <button
                  onClick={() => setPendingConfirm('cancel')}
                  className="w-full text-red-400 text-sm py-2 active:text-red-600"
                >
                  {t('cancelReservation')}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── WALK-IN — staff rental, cash, present ──
            Both Depart and Unreserve confirm ⚠ (spec updated 2026-06-17). */}
        {state === 'walked-in' && reservation && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
                <div className="bg-orange-50 rounded-xl p-4 border-2 border-orange-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {reservation.guestName
                      ? <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                      : <div className="text-gray-400 text-sm italic">{t('walkIn')}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 text-orange-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                    </svg>
                    <span className="text-lg font-bold tabular-nums leading-none">{formatTime(reservation.checkedInAt)}</span>
                  </div>
                </div>
                <button
                  disabled={isPending}
                  onClick={() => setPendingConfirm('depart')}
                  className="w-full bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
                >
                  {isPending ? '...' : t('markDeparted')}
                </button>
                <button
                  disabled={isPending}
                  onClick={() => setPendingConfirm('unreserve')}
                  className="w-full text-red-500 text-sm py-2 active:text-red-700"
                >
                  {t('unreserve')}
                </button>
              </>
            )}
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

        {/* ── COMP — complimentary guest, end comp action ── */}
        {state === 'comp' && (
          <div className="space-y-3">
            <div className="bg-purple-50 rounded-xl p-4 space-y-2 text-base border-2 border-purple-200">
              {reservation?.guestName && (
                <div className="font-bold text-lg">{reservation.guestName}</div>
              )}
              <div className="text-purple-600 text-sm font-semibold">★ {t('comp')}</div>
              {reservation?.internalNotes && (
                <div className="text-gray-500 italic">{reservation.internalNotes}</div>
              )}
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => uncompBed(siteId, item.id, accessKey, applyToPair))}
              className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50"
            >
              {isPending ? '...' : t('endComp')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

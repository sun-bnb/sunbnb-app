'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import NoteIcon from '@mui/icons-material/Note'
import PaymentIcon from '@mui/icons-material/Payment'
import { formatSeat } from '@repo/data/seat-label'
import { InventoryItem, Reservation } from '@/types/shared'
import {
  reserveItem,
  unreserveItem,
  checkInReservation,
  resumeWalkIn,
  markDeparted,
  markNoShow,
  updateReservationNotes,
  blockBed,
  unblockBed,
  holdBed,
  compBed,
  uncompBed,
  cancelReservation,
  refundReservation,
  releaseHold,
  convertHoldToWalkIn,
  deletePoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  removeFailedReservation,
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
  splitWalkInSeat,
} from './actions'
import {
  RESERVATION_COMPLETE, RESERVATION_HELD, RESERVATION_PAID_IN_CASH,
} from '@repo/data/reservation-status'
import { groupExtraSeatLabel } from './grid-helpers'
import CollectPaymentModal from './CollectPaymentModal'
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
  // Occupied (online checked-in + offline walk-in) share one colour — orange.
  'checked-in': 'bg-orange-200 text-orange-900',
  'walked-in': 'bg-orange-200 text-orange-900',
  'blocked': 'bg-gray-300 text-gray-800',
  'comp': 'bg-purple-200 text-purple-900',
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Extra days a booking runs PAST today: 0 for a same-day booking, 1 for one
// ending tomorrow, N for N days out. Drives the "{n}D" period badge below.
function extraDays(to: Date | string | null | undefined): number {
  if (!to) return 0
  return dayjs(to).startOf('day').diff(dayjs().startOf('day'), 'day')
}

// ─── Component ──────────────────────────────────────────────────────────────

// States where the SunbedGroup pair toggle governs a creation/release action.
// 'walked-in', 'blocked', and 'comp' are intentionally excluded:
//   - 'walked-in' uses the reservation-based applyToGroup toggle.
//   - 'blocked' and 'comp' also use the reservation-based applyToGroup toggle
//     (multiselect block/comp now creates ONE grouped reservation; the tap-dialog
//     unblock/uncomp uses applyToGroup to decide Group vs Seat scope).
const TOGGLE_VISIBLE_STATES: BedState[] = ['available']

// Pool seat numbering: number = parcel*10000 + 9900 + seq
const POOL_BAND_BASE = 9900
function getPoolSeq(item: InventoryItem): number {
  const parcel = parseInt(String(item.number)[0]!, 10)
  return item.number - (parcel * 10000 + POOL_BAND_BASE)
}

// Shared confirm prompt type across all ⚠ transitions
type PendingConfirm = 'no-show' | 'cancel' | 'depart' | 'unreserve' | 'remove' | null

// ─── OccupantInfo ────────────────────────────────────────────────────────────
// Unified single-line info row used by the expected/checked-in/walked-in branches.

function OccupantInfo({
  t,
  reservation,
  tintClass,
  paymentState,
  fallbackName,
}: {
  t: ReturnType<typeof useTranslations<'BedDetail'>>
  reservation: Reservation
  /** Tailwind classes for the card background + border (tint-50 / tint-200). */
  tintClass: string
  paymentState: 'paid' | 'none'
  /** Italic gray fallback when guestName is absent (e.g. t('walkIn')). */
  fallbackName?: string
}) {
  const rd = extraDays(reservation.to)
  const validUntilLabel = t('validUntil', { date: dayjs(reservation.to).format('ddd D MMM') })

  return (
    <div className={`${tintClass} rounded-xl p-4 flex items-center gap-3`}>
      {/* Name — truncates */}
      <div className="flex-1 min-w-0">
        {reservation.guestName
          ? <span className="font-bold text-lg truncate block">{reservation.guestName}</span>
          : fallbackName
            ? <span className="text-gray-400 dark:text-gray-500 text-lg italic">{fallbackName}</span>
            : null}
      </div>

      {/* Cluster — never wraps */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {/* Note indicator */}
        {reservation.internalNotes && (
          <span title={reservation.internalNotes} aria-label={t('note')}>
            <NoteIcon
              sx={{ fontSize: 18 }}
              className="text-gray-400"
            />
          </span>
        )}

        {/* Payment chip — green icon when paid online; nothing when unsettled cash */}
        {paymentState === 'paid' && (
          <span title={t('paid')} aria-label={t('paid')}>
            <PaymentIcon
              sx={{ fontSize: 18 }}
              className="text-green-600 dark:text-green-400"
            />
          </span>
        )}

        {/* Time — prefer today's per-day checkedInAt (accurate for multiday guests);
            fall back to parent's legacy field for walk-ins / same-day bookings. */}
        {(reservation.today?.checkedInAt ?? reservation.checkedInAt) && (
          <span className="rounded-full bg-white/60 dark:bg-black/20 border border-gray-300/60 dark:border-gray-600/60 px-2 py-0.5 text-sm font-bold tabular-nums text-gray-700 dark:text-gray-300">
            {formatTime(reservation.today?.checkedInAt ?? reservation.checkedInAt)}
          </span>
        )}

        {/* Period indicator — plain text, no badge, always last */}
        {rd > 0 && (
          <span
            className="text-s font-bold tabular-nums text-gray-500 dark:text-gray-400"
            title={validUntilLabel}
            aria-label={validUntilLabel}
          >
            {rd}D
          </span>
        )}
      </div>
    </div>
  )
}

export default function BedDetail({
  siteId,
  item,
  groupItems,
  reservationItemIds = [],
  accessKey,
  currentWorkerId,
  isPool = false,
  isGroupExtra = false,
  onClose,
  onPoolSeatRemoved,
  onGroupSeatAdded,
  onGroupSeatRemoved,
  onMove,
  siteIsPaid = false,
  onCollected,
}: {
  siteId: string
  item: InventoryItem
  /** All OTHER members of the item's SunbedGroup (empty array when not in a group). */
  groupItems: InventoryItem[]
  /**
   * Ids of ALL seats (including this one) that share the tapped seat's active
   * reservation. Length > 1 signals a multi-seat hold so the HELD branch can show
   * a Group / Seat scope toggle. Empty when the seat is solo or has no active reservation.
   */
  reservationItemIds?: string[]
  accessKey?: string
  /** Current floor-staff worker id — stamped on every create action. */
  currentWorkerId?: string
  isPool?: boolean
  /** True when this item is a group-attached extra (status='pool' && sunbedGroupId set). */
  isGroupExtra?: boolean
  onClose: () => void
  onPoolSeatRemoved?: () => void
  onGroupSeatAdded?: () => void
  onGroupSeatRemoved?: () => void
  /** Enter move-mode for this seat's reservation (relocate to a free destination). */
  onMove?: (reservationId: string) => void
  /** Whether the site charges for sunbeds — gates the "Collect payment" action. */
  siteIsPaid?: boolean
  /** Refresh the grid after a collection settles. */
  onCollected?: () => void
}) {
  const t = useTranslations('BedDetail')
  const [isPending, startTransition] = useTransition()
  const [guestName, setGuestName] = useState('')
  /** Shared one-step confirm guard for all ⚠ transitions (no-show, cancel, depart, unreserve). */
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
  const [until, setUntil] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Full-screen "Collect payment" QR view for a walk-in. */
  const [showCollect, setShowCollect] = useState(false)
  /**
   * The reservation id that CollectPaymentModal targets. In Group mode (or a
   * single-seat walk-in) this is `reservation.id`. In Seat mode on a
   * multi-seat walk-in, `splitWalkInSeat` creates a NEW single-seat reservation
   * first; this state is set to that new id before the modal opens so the QR
   * charges only this seat's share.
   */
  const [collectTargetId, setCollectTargetId] = useState<string | null>(null)
  /** Set once a refund succeeds in this dialog (drives the "Refunded" badge). */
  const [refunded, setRefunded] = useState(false)
  /** Set when a refund 403s for missing permission → offer Mollie re-consent. */
  const [needsReconnect, setNeedsReconnect] = useState(false)

  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD')
  const maxUntil = dayjs().add(90, 'day').format('YYYY-MM-DD')
  const days = until ? dayjs(until).startOf('day').diff(dayjs().startOf('day'), 'day') + 1 : 1

  const stateLabels: Record<BedState, string> = {
    'available': t('free'),
    'expected': t('reserved'),
    // Occupied — one name for online (checked-in) and offline (walk-in).
    'checked-in': t('occupied'),
    'walked-in': t('occupied'),
    'blocked': t('blocked'),
    'comp': t('comp'),
  }

  const reservation = getActiveReservation(item)
  const state = getBedState(item)
  // A walk-in whose payment has been collected online reads as `complete`
  // (operationalStatus stays walked-in). Gates the Collect-payment button off
  // and shows a "paid" badge instead.
  const collected = !!reservation && reservation.status === RESERVATION_COMPLETE

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

  // True when this seat's active hold spans multiple items — drives the Group / Seat
  // toggle in the HELD branch. Distinct from the SunbedGroup toggle (applyToPair)
  // which is driven by physical grouping; this is driven by reservation seat-count.
  const groupedReservation = reservationItemIds.length > 1

  // Group scope is the safe default: converting the whole hold avoids leaving a
  // partially-held group in a confusing state. Staff opt into Seat split explicitly.
  const [applyToGroup, setApplyToGroup] = useState(true)

  // Re-initialize when the selected item changes
  useEffect(() => {
    setApplyToPair(inSync)
    setApplyToGroup(true)
    setRefunded(false)
    setNeedsReconnect(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // Pre-fill `until` from a multi-day reservation so the period carries into
  // the Rent / Walk-in panel without staff having to re-enter it. Only when the
  // reservation's `to` is strictly AFTER end-of-today (a genuine multi-day stay).
  useEffect(() => {
    if (reservation && reservation.to) {
      const resToEnd = dayjs(reservation.to).startOf('day')
      const todayEnd = dayjs().startOf('day')
      if (resToEnd.isAfter(todayEnd)) {
        setUntil(dayjs(reservation.to).format('YYYY-MM-DD'))
        return
      }
    }
    setUntil('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation?.id, reservation?.to])

  // A refund is offered only for a real Mollie payment (tr_…). Demo/cash/comp/held
  // bookings carry no refundable Mollie payment, so no refund control is shown.
  const isMolliePaid = !!reservation?.paymentRef && reservation.paymentRef.startsWith('tr_')
  const alreadyRefunded = refunded || !!reservation?.refundedAt

  /** Issue the Mollie refund without closing the dialog — flip the button to "Refunded". */
  function runRefund() {
    setError(null)
    setNeedsReconnect(false)
    startTransition(async () => {
      const result = await refundReservation(siteId, item.id, accessKey)
      if (result.status === 'ok') {
        setRefunded(true)
      } else {
        setError(result.errors?.[0] || 'Refund failed')
        if ((result as { needsReconnect?: boolean }).needsReconnect) setNeedsReconnect(true)
      }
    })
  }

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
      // Walk-in Seat mode on a multi-seat cash walk-in: split-then-depart this one
      // seat. The new single-seat reservation is created and departed; the original
      // keeps its remaining seats walked-in with the reduced paymentAmount.
      // Online checked-in (complete) and QR-collected (complete + walked-in) use the
      // whole-reservation path — invoice complexity makes per-seat splits unsafe.
      if (
        state === 'walked-in' &&
        !collected &&
        !applyToGroup &&
        groupedReservation
      ) {
        runAction(() => markDeparted(siteId, reservation.id, accessKey, [item.id]))
      } else {
        runAction(() => markDeparted(siteId, reservation.id, accessKey))
      }
    } else if (pendingConfirm === 'unreserve') {
      // In the walked-in branch, unreserve scope is driven by applyToGroup (the
      // reservation-based toggle, not the physical-group applyToPair toggle).
      // Group → delete whole reservation; Seat → disconnect this item only.
      if (state === 'walked-in') {
        runAction(() => unreserveItem(siteId, item.id, accessKey, applyToGroup))
      } else {
        runAction(() => unreserveItem(siteId, item.id, accessKey, applyToPair))
      }
    } else if (pendingConfirm === 'remove') {
      if (!reservation) return
      runAction(() => removeFailedReservation(siteId, reservation.id, accessKey))
    }
  }

  /** Shared inline confirm panel — renders instead of normal action buttons. */
  const confirmPanel = (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
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
      {/* Refund control — only when canceling a real Mollie payment. Manual:
          tap to issue the refund, which flips to a static "Refunded" confirmation.
          Canceling afterwards terminates the booking as REFUNDED. */}
      {pendingConfirm === 'cancel' && isMolliePaid && (
        alreadyRefunded ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 bg-green-50 dark:bg-green-950/30 border-2 border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-400 font-semibold text-sm rounded-xl py-3"
          >
            <span aria-hidden="true">✓</span>
            {t('refunded')}
          </div>
        ) : needsReconnect ? (
          /* Refund was rejected for missing permission (403). Re-consent is the
             only fix — deep-link to the Mollie authorize flow. NOTE: that endpoint
             needs the OWNER's partner session, so this only completes for an owner
             logged into the partner app in this browser (fine for testing); on a
             pure token-gated manage session it will 401. */
          <button
            onClick={() => {
              // Return to this exact manage page (incl. ?key=) after re-consent.
              const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
              window.location.href = `/api/mollie/authorize?returnTo=${returnTo}`
            }}
            className="block w-full text-center bg-amber-500 text-white font-bold text-base py-3.5 rounded-xl active:bg-amber-600"
          >
            {t('enableRefunds')}
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={runRefund}
            className="w-full bg-blue-500 text-white font-bold text-base py-3.5 rounded-xl active:bg-blue-600 disabled:opacity-50"
          >
            {isPending ? '...' : t('issueRefund')}
          </button>
        )
      )}
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
          className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold text-lg py-4 rounded-xl active:bg-gray-200 dark:active:bg-gray-700"
        >
          {t('back')}
        </button>
      </div>
    </div>
  )

  // Square "Move" button — sits on the dominant action's row, to its right.
  // Enters move-mode (tap-to-move / relocate) for this seat's reservation.
  const moveSquare = (
    <button
      onClick={() => { if (reservation) onMove?.(reservation.id) }}
      aria-label={t('move')}
      title={t('move')}
      className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl active:bg-gray-50 dark:active:bg-gray-800"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 7l-4 5 4 5M16 7l4 5-4 5M4 12h16" />
      </svg>
      <span className="text-[10px] font-semibold leading-none">{t('move')}</span>
    </button>
  )

  // Badge label: show "Hold" for staff holds so staff can tell them from paid bookings
  // A hold and an online booking both read as "Reserved" (unified) — the €/●
  // marker carries the paid-vs-hold distinction, not a separate label. (track 012)
  const badgeLabel = stateLabels[state]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 dark:text-gray-100 w-full max-w-lg rounded-t-2xl p-4 sm:p-5 shadow-xl animate-slide-up"
           style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}>
        {/* Header — big number, plain status */}
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <div className="flex items-center gap-2 sm:gap-3">
            {(isPool || isGroupExtra) ? (
              <div className="flex flex-col leading-tight">
                <span className="text-2xl sm:text-3xl font-black">
                  {isGroupExtra ? `#${groupExtraLabel}` : `+${poolSeq}`}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal leading-none">
                  {isGroupExtra && pairItem
                    ? t('groupExtraSeat', { n: formatSeat(pairItem, { parcel: true }) })
                    : t('additionalSeat')}
                </span>
              </div>
            ) : (
              <span className="text-2xl sm:text-3xl font-black">#{formatSeat(item, { parcel: true })}</span>
            )}
            {pairNumber && !isGroupExtra && (
              <span className="text-base sm:text-lg text-gray-400 dark:text-gray-500 font-medium">+ #{pairNumber}</span>
            )}
            <span className={`text-xs sm:text-sm font-bold px-2.5 sm:px-3 py-1 rounded-full ${stateBadgeColors[state]}`}>
              {badgeLabel}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 text-3xl leading-none p-2">&times;</button>
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
        {groupItems.length > 0 && TOGGLE_VISIBLE_STATES.includes(state) && !pendingConfirm && !(state === 'walked-in' && collected) && (
          <div className="mb-4">
            {inSync ? (
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
                <button
                  onClick={() => setApplyToPair(true)}
                  aria-pressed={applyToPair}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                    ${applyToPair
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {groupItems.length >= 2 ? t('group') : t('pair')}
                </button>
                <button
                  onClick={() => setApplyToPair(false)}
                  aria-pressed={!applyToPair}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors
                    ${!applyToPair
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
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
                className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold"
              >
                <div className="flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">
                  {t('seat')}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3 bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm rounded-xl px-4 py-3">
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
                className="flex-1 border-2 rounded-xl px-4 py-3.5 text-base dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
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
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 active:bg-gray-50'
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
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/40 border-2 dark:border-gray-600 rounded-xl px-3 py-2.5">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{t('until')}</span>
                <input
                  type="date"
                  value={until}
                  min={tomorrow}
                  max={maxUntil}
                  onChange={e => setUntil(e.target.value || tomorrow)}
                  className="flex-1 bg-transparent text-base font-medium outline-none dark:text-gray-100"
                />
                <button
                  onClick={() => setUntil('')}
                  className="text-gray-400 dark:text-gray-500 text-2xl leading-none px-1 flex-shrink-0"
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
                onClick={() => runAction(() => blockBed(siteId, item.id, undefined, accessKey, applyToPair, currentWorkerId))}
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
                  undefined,
                  currentWorkerId
                ))}
                aria-label={t('comp')}
                title={t('comp')}
                className="w-16 self-stretch flex flex-col items-center justify-center gap-0.5 border-2 border-purple-300 text-purple-600 rounded-xl active:bg-purple-50 disabled:opacity-50"
              >
                <span className="text-base leading-none" aria-hidden="true">★</span>
                <span className="text-[10px] font-semibold leading-none">{t('comp')}</span>
              </button>
              {/* Reserve — lightweight hold (no payment, shows as yellow "booked").
                  Until is passed so a multi-day period picked here is saved. */}
              <button
                disabled={isPending}
                onClick={() => runAction(() => holdBed(
                  siteId, item.id, accessKey,
                  groupItems.length > 0 ? applyToPair : false,
                  guestName || undefined,
                  undefined,
                  currentWorkerId,
                  (isPool && !isGroupExtra) ? undefined : (until || undefined)
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
                  groupItems.length > 0 ? applyToPair : false,
                  currentWorkerId
                ))}
                className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? '...' : t('rent')}
              </button>
            </div>
            {/* ── Seat management — compact link-style actions, divided off from the
                larger reservation controls above. Add + Remove share the row at
                equal width. ── */}
            {(groupItems.length > 0 || (isPool && !isGroupExtra)) && (
              <div className="mt-2 pt-2.5 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
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
                    className="flex-1 text-gray-500 dark:text-gray-400 text-sm py-2 active:text-gray-700 dark:active:text-gray-200 disabled:opacity-50"
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
                <OccupantInfo
                  t={t}
                  reservation={reservation}
                  tintClass="bg-yellow-50 dark:bg-yellow-950/30 border-2 border-yellow-200 dark:border-yellow-800/40"
                  paymentState="paid"
                />
                <div className="flex gap-3">
                  <button
                    disabled={isPending}
                    onClick={() => runAction(() => checkInReservation(siteId, reservation.id, accessKey))}
                    className="flex-1 bg-blue-500 text-white font-bold text-lg py-4 rounded-xl active:bg-blue-600 disabled:opacity-50"
                  >
                    {isPending ? '...' : t('checkIn')}
                  </button>
                  {moveSquare}
                </div>
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

        {/* ── RESERVED — paid-in-cash walk-in between days ──
            A multiday walk-in that departed for the day; reserved for the rest of
            its stay (status=paid-in-cash, op=expected, the Walk-in→Depart→expected
            leg of the daily cycle). Re-seat it ("Walk-in" → orange walked-in, no
            re-charge) or free it (Unreserve — delete, cash already settled offline).
            Uses resumeWalkIn (not checkInReservation) so the bed goes orange, not blue
            (this is a returning cash guest, not an online booking arrival). */}
        {state === 'expected' && reservation && reservation.status === RESERVATION_PAID_IN_CASH && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
                <OccupantInfo
                  t={t}
                  reservation={reservation}
                  tintClass="bg-yellow-50 dark:bg-yellow-950/30 border-2 border-yellow-200 dark:border-yellow-800/40"
                  paymentState="paid"
                  fallbackName={t('walkIn')}
                />
                <div className="flex gap-3">
                  <button
                    disabled={isPending}
                    onClick={() => runAction(() => resumeWalkIn(siteId, reservation.id, accessKey))}
                    className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
                  >
                    {isPending ? '...' : t('checkIn')}
                  </button>
                  {moveSquare}
                </div>
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

        {/* ── HELD — staff hold, no payment ──
            Lane: status=held, operationalStatus=expected
            Actions: Rent (convert hold → walk-in) · Release (no confirm — no money at stake)
            No Check-in: a held guest who arrives is Rented (hold converted in place to a paid
            walk-in). This removes the unpaid checked-in+held limbo where Cancel failed.
            Period picker ALWAYS; name input ONLY if the hold has no name yet. */}
        {state === 'expected' && reservation && reservation.status === RESERVATION_HELD && (
          <div className="space-y-3">
            {/* Group / Seat scope toggle — only when this hold covers multiple seats.
                Group (default): convert all seats in the hold at once.
                Seat: split off just this seat as a new walk-in; the hold keeps the rest.
                Styled to match the SunbedGroup pair toggle above (same segmented pill). */}
            {groupedReservation && (
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
                <button
                  onClick={() => setApplyToGroup(true)}
                  aria-pressed={applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                    ${applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('group')}
                </button>
                <button
                  onClick={() => setApplyToGroup(false)}
                  aria-pressed={!applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors
                    ${!applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('seat')}
                </button>
              </div>
            )}

            {/* Left: info card (named hold) OR name input (unnamed). The multi-day
                calendar toggle sits on the SAME row, to the right. */}
            <div className="flex gap-2 items-stretch">
              {reservation.guestName ? (
                <div className="flex-1 min-w-0 bg-yellow-50 dark:bg-yellow-950/30 rounded-xl p-4 border-2 border-dashed border-yellow-300 dark:border-yellow-800/40 flex flex-col justify-center">
                  <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                  {reservation.internalNotes && (
                    <div className="text-gray-500 dark:text-gray-400 italic text-sm truncate">{reservation.internalNotes}</div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder={t('guestName')}
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  className="flex-1 border-2 rounded-xl px-4 py-3.5 text-base dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500"
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
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 active:bg-gray-50'
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
              <div className="text-gray-500 dark:text-gray-400 italic text-sm px-1">{reservation.internalNotes}</div>
            )}

            {/* Date range picker — shown when multi-day toggle is on */}
            {until !== '' && (
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/40 border-2 dark:border-gray-600 rounded-xl px-3 py-2.5">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{t('until')}</span>
                <input
                  type="date"
                  value={until}
                  min={tomorrow}
                  max={maxUntil}
                  onChange={e => setUntil(e.target.value || tomorrow)}
                  className="flex-1 bg-transparent text-base font-medium outline-none dark:text-gray-100"
                />
                <button
                  onClick={() => setUntil('')}
                  className="text-gray-400 dark:text-gray-500 text-2xl leading-none px-1 flex-shrink-0"
                  aria-label={t('cancel')}
                >
                  &times;
                </button>
              </div>
            )}

            {/* Rent — convert hold to paid walk-in, with the chosen period and scope.
                Effective name: existing hold name if set, else the typed name.
                applyToGroup controls whether the whole hold converts (Group mode)
                or just this seat splits off into its own walk-in (Seat mode). */}
            <div className="flex gap-3">
              <button
                disabled={isPending}
                onClick={() => runAction(() => convertHoldToWalkIn(
                  siteId, item.id, accessKey,
                  reservation.guestName
                    ? reservation.guestName
                    : (guestName || undefined),
                  until || undefined,
                  currentWorkerId,
                  applyToGroup,
                ))}
                className="flex-1 bg-orange-500 text-white font-bold text-lg py-4 rounded-xl active:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? '...' : t('checkIn')}
              </button>
              {moveSquare}
            </div>

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
                <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-4 border-2 border-red-200 dark:border-red-800/40 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {reservation.guestName && (
                      <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                    )}
                    <div className="text-gray-600 dark:text-gray-300 text-sm truncate">{reservation.user.email}</div>
                  </div>
                  <span className="flex-shrink-0 text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{t('paymentFailed')}</span>
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
          && reservation.status !== RESERVATION_PAID_IN_CASH
          && !isFailedReservationStatus(reservation.status) && (
          <div className="space-y-3">
            <div className="bg-yellow-50 dark:bg-yellow-950/30 rounded-xl p-4 border-2 border-yellow-100 dark:border-yellow-800/40 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {reservation.guestName && (
                  <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                )}
                <div className="text-gray-600 dark:text-gray-300 text-sm truncate">{reservation.user.email}</div>
              </div>
              <span className="flex-shrink-0 text-xs font-semibold text-yellow-600 dark:text-yellow-400 whitespace-nowrap">{reservation.status}</span>
            </div>
          </div>
        )}

        {/* ── CHECKED-IN — guest present, paid booking ──
            Actions: Depart ⚠ · Cancel ⚠ */}
        {state === 'checked-in' && reservation && (
          <div className="space-y-3">
            {pendingConfirm ? confirmPanel : (
              <>
                <OccupantInfo
                  t={t}
                  reservation={reservation}
                  tintClass="bg-orange-50 dark:bg-orange-950/30 border-2 border-orange-200 dark:border-orange-800/40"
                  paymentState="paid"
                />
                <div className="flex gap-3">
                  <button
                    disabled={isPending}
                    onClick={() => setPendingConfirm('depart')}
                    className="flex-1 bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
                  >
                    {isPending ? '...' : t('markDeparted')}
                  </button>
                  {moveSquare}
                </div>
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
                {/* Reservation-based Group / Seat toggle for multi-seat cash walk-ins.
                    Shown only when this is a true cash walk-in (not QR-collected) and
                    the active reservation spans more than one seat. Mirrors the pattern
                    used by the HELD branch (applyToGroup / groupedReservation). */}
                {groupedReservation && !collected && (
                  <div className="mb-1">
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
                      <button
                        onClick={() => setApplyToGroup(true)}
                        aria-pressed={applyToGroup}
                        className={`
                          flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                          ${applyToGroup
                            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                            : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                        `}
                      >
                        {t('group')}
                      </button>
                      <button
                        onClick={() => setApplyToGroup(false)}
                        aria-pressed={!applyToGroup}
                        className={`
                          flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors
                          ${!applyToGroup
                            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                            : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                        `}
                      >
                        {t('seat')}
                      </button>
                    </div>
                  </div>
                )}
                <OccupantInfo
                  t={t}
                  reservation={reservation}
                  tintClass="bg-orange-50 dark:bg-orange-950/30 border-2 border-orange-200 dark:border-orange-800/40"
                  paymentState={collected ? 'paid' : 'none'}
                  fallbackName={t('walkIn')}
                />
                {siteIsPaid && !collected && (
                  <button
                    disabled={isPending}
                    onClick={() => {
                      if (!reservation) return
                      // Seat mode on a multi-seat walk-in: split off this seat into
                      // its own walk-in first so the QR charges only this seat's share.
                      // If the operator abandons the QR (cancelCollection), the new
                      // single-seat reservation reverts to cash — never stranded.
                      if (groupedReservation && !applyToGroup) {
                        setError(null)
                        startTransition(async () => {
                          const result = await splitWalkInSeat(siteId, reservation.id, item.id, accessKey)
                          if (result.status === 'ok') {
                            setCollectTargetId(result.reservationId)
                            setShowCollect(true)
                          } else {
                            setError(result.errors?.[0] || 'Could not split seat for collection')
                          }
                        })
                      } else {
                        // Group mode (or a single-seat walk-in): collect the whole reservation.
                        setCollectTargetId(reservation.id)
                        setShowCollect(true)
                      }
                    }}
                    className="w-full bg-blue-600 text-white font-bold text-lg py-4 rounded-xl active:bg-blue-700 disabled:opacity-50"
                  >
                    💳 {t('collectPayment')}
                  </button>
                )}
                <div className="flex gap-3">
                  <button
                    disabled={isPending}
                    onClick={() => setPendingConfirm('depart')}
                    className="flex-1 bg-gray-700 text-white font-bold text-lg py-4 rounded-xl active:bg-gray-800 disabled:opacity-50"
                  >
                    {isPending ? '...' : t('markDeparted')}
                  </button>
                  {moveSquare}
                </div>
                {/* A cash walk-in is removed via Unreserve (delete, cash settled
                    offline). A walk-in PAID ONLINE (QR-collected → `complete`) is a
                    real Mollie payment, so it's Canceled instead — routing through
                    the shared confirm panel, which surfaces the refund control just
                    like an online reservation (Unreserve wouldn't even match a
                    `complete` row). */}
                <button
                  disabled={isPending}
                  onClick={() => setPendingConfirm(collected ? 'cancel' : 'unreserve')}
                  className="w-full text-red-500 text-sm py-2 active:text-red-700"
                >
                  {collected ? t('cancelReservation') : t('unreserve')}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── BLOCKED — reservation-based Group/Seat toggle + unblock ── */}
        {state === 'blocked' && (
          <div className="space-y-3">
            {/* Group / Seat scope toggle — only when this block covers multiple seats
                (i.e. it was created via bulk-block → one grouped reservation).
                Group (default): delete the whole block reservation (frees all seats).
                Seat: disconnect just this seat, leaving the rest blocked.
                Mirrors the HELD and WALKED-IN branches (applyToGroup / groupedReservation). */}
            {groupedReservation && (
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
                <button
                  onClick={() => setApplyToGroup(true)}
                  aria-pressed={applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                    ${applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('group')}
                </button>
                <button
                  onClick={() => setApplyToGroup(false)}
                  aria-pressed={!applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors
                    ${!applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('seat')}
                </button>
              </div>
            )}
            <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {reservation?.internalNotes
                  ? <div className="font-medium text-base truncate">{reservation.internalNotes}</div>
                  : <div className="text-gray-400 dark:text-gray-500 text-sm italic">{t('blocked')}</div>}
              </div>
              <span className="flex-shrink-0 text-xl leading-none text-gray-400 dark:text-gray-500" aria-label={t('blocked')} title={t('blocked')}>✕</span>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => unblockBed(siteId, item.id, accessKey, applyToGroup))}
              className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50"
            >
              {isPending ? '...' : t('unblock')}
            </button>
          </div>
        )}

        {/* ── COMP — reservation-based Group/Seat toggle + end comp ── */}
        {state === 'comp' && (
          <div className="space-y-3">
            {/* Group / Seat scope toggle — only when this comp covers multiple seats
                (i.e. it was created via bulk-comp → one grouped reservation).
                Group (default): delete the whole comp reservation (frees all seats).
                Seat: disconnect just this seat, leaving the rest comped.
                Mirrors the HELD and WALKED-IN branches (applyToGroup / groupedReservation). */}
            {groupedReservation && (
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
                <button
                  onClick={() => setApplyToGroup(true)}
                  aria-pressed={applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm transition-colors
                    ${applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('group')}
                </button>
                <button
                  onClick={() => setApplyToGroup(false)}
                  aria-pressed={!applyToGroup}
                  className={`
                    flex-1 flex items-center justify-center px-3 min-h-[44px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors
                    ${!applyToGroup
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}
                  `}
                >
                  {t('seat')}
                </button>
              </div>
            )}
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-xl p-4 border-2 border-purple-200 dark:border-purple-800/40 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {reservation?.guestName
                  ? <div className="font-bold text-lg truncate">{reservation.guestName}</div>
                  : <div className="text-gray-400 dark:text-gray-500 text-sm italic">{t('comp')}</div>}
                {reservation?.internalNotes && (
                  <div className="text-gray-500 dark:text-gray-400 text-sm italic truncate">{reservation.internalNotes}</div>
                )}
              </div>
              <span className="flex-shrink-0 text-2xl leading-none text-purple-500 dark:text-purple-400" aria-label={t('comp')} title={t('comp')}>★</span>
            </div>
            <button
              disabled={isPending}
              onClick={() => runAction(() => uncompBed(siteId, item.id, accessKey, applyToGroup))}
              className="w-full bg-green-500 text-white font-bold text-lg py-4 rounded-xl active:bg-green-600 disabled:opacity-50"
            >
              {isPending ? '...' : t('endComp')}
            </button>
          </div>
        )}
      </div>

      {/* Full-screen Collect payment (QR → Mollie) for the walk-in.
          collectTargetId is either the original reservation.id (Group mode / single-seat)
          or the newly split single-seat reservation id (Seat mode on a multi-seat walk-in).
          Seat-mode split happens before the modal opens — the QR always points at a
          single-seat reservation so the collected amount is per-seat, not whole-group. */}
      {showCollect && collectTargetId && (
        <CollectPaymentModal
          actions={{
            create: () => collectReservationPayment(siteId, collectTargetId, accessKey),
            poll:   () => getCollectStatus(siteId, collectTargetId, accessKey),
            cancel: () => cancelCollection(siteId, collectTargetId, accessKey),
          }}
          onClose={() => { setShowCollect(false); setCollectTargetId(null) }}
          onSettled={() => onCollected?.()}
        />
      )}
    </div>
  )
}

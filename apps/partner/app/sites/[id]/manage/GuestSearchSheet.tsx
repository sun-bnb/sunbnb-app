'use client'

import { useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import {
  findReservations,
  checkInReservation,
  convertHoldToWalkIn,
  type ReservationMatch,
} from './actions'
import { RESERVATION_COMPLETE, RESERVATION_HELD, OP_EXPECTED } from '@repo/data/reservation-status'

/**
 * The "Guests" host stand (track 010 P2) — reservation lookup + today's arrivals
 * over the token-gated manage page.
 *
 * Default (no query) shows today's expected arrivals; typing searches name /
 * phone / email across the near future (so the floor reaches bookings the bed
 * grid can't show). Rows hand off to what staff already use: **Locate** jumps to
 * the bed (`onLocate` → `BedDetail` in the parent), and inline **Check in** /
 * **Rent** reuse the existing token-gated actions. Chrome mirrors `TillSheet`.
 */

/** Comma-joined bed labels (seatLabel ?? number) for a booking's seats. */
function bedLabel(items: ReservationMatch['items']): string {
  return items.map((i) => i.seatLabel || String(i.number)).join(', ')
}

/** Does the booking overlap today (i.e. it's on / actionable from today's floor)? */
function overlapsToday(r: ReservationMatch): boolean {
  return (
    new Date(r.from).getTime() <= dayjs().endOf('day').valueOf() &&
    new Date(r.to).getTime() >= dayjs().startOf('day').valueOf()
  )
}

export default function GuestSearchSheet({
  siteId,
  accessKey,
  onClose,
  onLocate,
  onRefresh,
}: {
  siteId: string
  accessKey?: string
  onClose: () => void
  /** Jump to the booking's bed + open BedDetail (resolved by the parent). */
  onLocate: (r: ReservationMatch) => void
  /** Refresh the grid after an inline check-in / rent. */
  onRefresh: () => void
}) {
  const t = useTranslations('Guests')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ReservationMatch[]>([])
  /** True only on the initial load (no prior rows to show). */
  const [loading, setLoading] = useState(true)
  /** True while a debounced re-fetch is in flight (prior rows remain visible). */
  const [stale, setStale] = useState(false)
  /** Non-null when findReservations returned an error shape. */
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const q = query.trim()
  const hasQuery = q.length > 0

  async function fetchRows() {
    const res = await findReservations(siteId, q || undefined, accessKey)
    if ('reservations' in res) {
      setRows(res.reservations ?? [])
      setFetchError(null)
    } else {
      // Error shape: { status: 'error', errors: string[] }
      setFetchError(res.errors?.[0] ?? t('error'))
    }
  }

  // Initial arrivals load + debounced re-fetch as the query changes.
  useEffect(() => {
    let cancelled = false

    // On the initial mount rows is empty so we show the full loading state.
    // On subsequent query changes we keep existing rows visible (stale) and
    // only switch to the full loading spinner when there are no prior rows.
    if (rows.length === 0) {
      setLoading(true)
      setStale(false)
    } else {
      setStale(true)
    }
    setFetchError(null)

    const id = setTimeout(async () => {
      const res = await findReservations(siteId, q || undefined, accessKey)
      if (cancelled) return
      if ('reservations' in res) {
        setRows(res.reservations ?? [])
        setFetchError(null)
      } else {
        setFetchError(res.errors?.[0] ?? t('error'))
      }
      setLoading(false)
      setStale(false)
    }, hasQuery ? 250 : 0)
    return () => { cancelled = true; clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, siteId, accessKey])

  function retry() {
    setFetchError(null)
    setLoading(true)
    findReservations(siteId, q || undefined, accessKey).then((res) => {
      if ('reservations' in res) {
        setRows(res.reservations ?? [])
        setFetchError(null)
      } else {
        setFetchError(res.errors?.[0] ?? t('error'))
      }
      setLoading(false)
    })
  }

  function checkIn(r: ReservationMatch) {
    startTransition(async () => {
      const res = await checkInReservation(siteId, r.id, accessKey)
      if (res.status === 'ok') { await fetchRows(); onRefresh() }
    })
  }
  function rent(r: ReservationMatch) {
    const itemId = r.items[0]?.id
    if (!itemId) return
    startTransition(async () => {
      const res = await convertHoldToWalkIn(siteId, itemId, accessKey)
      if (res.status === 'ok') { await fetchRows(); onRefresh() }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 dark:text-gray-100 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-black">👤 {t('title')}</h2>
          <button onClick={onClose} aria-label={t('close')} className="text-gray-400 dark:text-gray-500 text-4xl leading-none p-3 -mr-2">&times;</button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-base outline-none focus:border-gray-400 dark:focus:border-gray-500"
          />
        </div>

        {/* Body — aria-busy signals screen readers when a fetch is in flight */}
        <div
          className="flex-1 overflow-y-auto p-3 space-y-2"
          aria-busy={loading || stale}
        >
          {!hasQuery && (
            <div className="px-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t('expectedToday')}
            </div>
          )}

          {loading ? (
            <div role="status" className="py-12 text-center text-gray-400 dark:text-gray-500 font-bold">
              {t('loading')}
            </div>
          ) : fetchError ? (
            /* Error state — distinct from empty; offers a Retry affordance */
            <div role="status" className="py-10 flex flex-col items-center gap-3 text-center">
              <p className="text-red-600 dark:text-red-400 font-semibold text-sm">{t('error')}</p>
              <button
                onClick={retry}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 active:bg-gray-200 dark:active:bg-gray-700"
              >
                {t('retry')}
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div role="status" className="py-12 text-center text-gray-400 dark:text-gray-500 font-bold">
              {hasQuery ? t('noMatches') : t('noArrivals')}
            </div>
          ) : (
            /* Rows — subtly dimmed while a re-search is pending (stale) */
            <div className={stale ? 'opacity-50 pointer-events-none' : undefined}>
              {rows.map((r) => {
                const today = overlapsToday(r)
                const paid = r.status === RESERVATION_COMPLETE
                const held = r.status === RESERVATION_HELD
                const name = r.guestName || r.userEmail || t('guest')
                const beds = bedLabel(r.items)
                return (
                  <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold truncate">
                          {name}
                          {r.partySize > 1 && <span className="text-gray-400 font-semibold"> +{r.partySize - 1}</span>}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {beds && <span aria-hidden="true">🛏 </span>}{beds}
                          {r.internalNotes && <span className="italic"> · {r.internalNotes}</span>}
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        !today
                          ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                          : paid
                            ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                            : held
                              ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400'
                              : 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                      }`}>
                        {!today
                          ? t('upcomingOn', { date: dayjs(r.from).format('ddd D MMM') })
                          : paid ? t('paid') : held ? t('hold') : t('seated')}
                      </span>
                    </div>

                    {today && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => onLocate(r)}
                          disabled={pending}
                          className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 active:bg-gray-200 dark:active:bg-gray-700 disabled:opacity-50"
                        >
                          {t('locate')}
                        </button>
                        {paid && r.operationalStatus === OP_EXPECTED && (
                          <button
                            onClick={() => checkIn(r)}
                            disabled={pending}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-accent text-white active:bg-accent-hover disabled:opacity-50"
                          >
                            {pending ? '…' : t('checkIn')}
                          </button>
                        )}
                        {held && r.operationalStatus === OP_EXPECTED && (
                          <button
                            onClick={() => rent(r)}
                            disabled={pending}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-orange-500 text-white active:bg-orange-600 disabled:opacity-50"
                          >
                            {pending ? '…' : t('rent')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

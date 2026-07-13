'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getOpenTillItems, getTillDayReport, getDayShiftItems, closeTill } from './actions'
import type { EmployeeOpenTill } from '@repo/data/till'
import type { EmployeeShift } from '@repo/data/till'

/**
 * Full-page daily summary view for the token-gated manage surface.
 *
 * Admin-only page for the token-gated manage surface. Provides:
 *   - Open tills (default): per-employee unclosed balances since last close,
 *     with per-employee two-step Close flow.
 *   - Day report: date picker (defaults to today) → per-employee/per-sunbed
 *     earnings breakup (cash + card) via getDayShiftItems.
 *
 * State shapes differ by mode:
 *   - Open mode: EmployeeTill[] from getOpenTills / getTillDayReport (cash-ledger)
 *   - Day mode: EmployeeShift[] from getDayShiftItems (both channels, by-sunbed)
 *
 * No modal chrome (no backdrop, no role="dialog"/aria-modal, no escape-dismiss).
 * Page lives at /sites/[id]/manage/summary?key=... — backHref returns to landing.
 */

type Mode = 'open' | 'day'
type Phase = 'loading' | 'ready' | 'error'
type ClosePhase = 'idle' | 'confirming' | 'closing' | 'closed'

interface EmployeeCloseState {
  phase: ClosePhase
  closedTotal?: number
  closedCount?: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function DailySummaryView({
  siteId,
  accessKey,
  siteName,
  backHref,
}: {
  siteId: string
  accessKey: string
  siteName: string
  backHref: string
}) {
  const t = useTranslations('TillSummary')
  const [mode, setMode] = useState<Mode>('open')
  const [phase, setPhase] = useState<Phase>('loading')

  // Open-mode data: EmployeeOpenTill[] (superset of EmployeeTill; items[] holds per-transaction rows)
  const [tills, setTills] = useState<EmployeeOpenTill[]>([])
  // Day-mode data: EmployeeShift[]
  const [shifts, setShifts] = useState<EmployeeShift[]>([])

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [dayInput, setDayInput] = useState('')
  const [closeStates, setCloseStates] = useState<Record<string, EmployeeCloseState>>({})
  // Expanded rows in day mode (shift employeeId → expanded)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const startedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const today = todayIso()

  // ── Load open tills on mount ───────────────────────────────────────────────
  const loadOpenTills = async () => {
    setPhase('loading')
    setErrorMsg(null)
    setCloseStates({})
    setTills([])
    const res = await getOpenTillItems(siteId, accessKey)
    if (res.status !== 'ok') {
      setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
      setPhase('error')
      return
    }
    setTills(res.tills ?? [])
    setPhase('ready')
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    loadOpenTills()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Switch to open-tills mode ──────────────────────────────────────────────
  const switchToOpen = () => {
    setMode('open')
    setDayInput('')
    setErrorMsg(null)
    setTills([])
    setShifts([])
    setExpandedRows({})
    setCloseStates({})
    startedRef.current = false
    loadOpenTills()
  }

  // ── Switch to day-report mode — default to today ───────────────────────────
  const switchToDay = () => {
    setMode('day')
    setTills([])
    setShifts([])
    setExpandedRows({})
    setErrorMsg(null)
    // Default to today so the report loads immediately on tab switch
    const initialDay = today
    setDayInput(initialDay)
  }

  // ── Load day shift items when date changes (day mode) ─────────────────────
  useEffect(() => {
    if (mode !== 'day' || !dayInput) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const controller = abortRef.current

    ;(async () => {
      setPhase('loading')
      setErrorMsg(null)
      setExpandedRows({})
      const res = await getDayShiftItems(siteId, dayInput, accessKey)
      if (controller.signal.aborted) return
      if (res.status !== 'ok') {
        setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
        setPhase('error')
        return
      }
      setShifts(res.shifts ?? [])
      setPhase('ready')
    })()

    return () => { controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayInput, mode])

  // ── Close a single employee's till (open mode only) ───────────────────────
  const handleCloseEmployee = async (employeeId: string) => {
    setCloseStates(prev => ({ ...prev, [employeeId]: { phase: 'closing' } }))
    const res = await closeTill(siteId, employeeId, accessKey)
    if (res.status !== 'ok') {
      setCloseStates(prev => ({ ...prev, [employeeId]: { phase: 'idle' } }))
      setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
      return
    }
    setCloseStates(prev => ({
      ...prev,
      [employeeId]: {
        phase: 'closed',
        closedTotal: res.total ?? 0,
        closedCount: res.count ?? 0,
      },
    }))
    // Refresh the open-tills list after close (itemised source)
    const refresh = await getOpenTillItems(siteId, accessKey)
    if (refresh.status === 'ok') setTills(refresh.tills ?? [])
  }

  const setEmployeeConfirming = (employeeId: string, confirming: boolean) => {
    setCloseStates(prev => ({
      ...prev,
      [employeeId]: { phase: confirming ? 'confirming' : 'idle' },
    }))
  }

  const toggleExpand = (employeeId: string) => {
    setExpandedRows(prev => ({ ...prev, [employeeId]: !prev[employeeId] }))
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const nonZeroTills = tills.filter(t => t.total > 0 || t.count > 0)
  const allZero = mode === 'open' && phase === 'ready' && nonZeroTills.length === 0

  // Day-totals: vary by mode
  const grandTotal = mode === 'open'
    ? tills.reduce((sum, t) => sum + t.total, 0)
    : shifts.reduce((sum, s) => sum + s.total, 0)
  const grandCount = mode === 'open'
    ? tills.reduce((sum, t) => sum + t.count, 0)
    : shifts.reduce((sum, s) => sum + s.count, 0)

  const openDataLoaded = mode === 'open' && phase === 'ready' && tills.length > 0
  const dayDataLoaded = mode === 'day' && phase === 'ready' && shifts.length > 0
  const showTotals = openDataLoaded || dayDataLoaded

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">

      {/* Page header */}
      <div className="bg-white dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0"
          aria-label={t('backToMenu')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('backToMenu')}
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100 truncate">
            {t('title')}
          </h1>
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 truncate">{siteName}</p>
        </div>
      </div>

      {/* Day-totals summary header (visible when data is loaded) */}
      {showTotals && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {mode === 'open' ? t('totalCash') : t('totalEarnings')}
            </div>
            <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
              {`€${grandTotal.toFixed(2)}`}
            </div>
          </div>
          <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {mode === 'open' ? t('totalSales') : t('totalSunbeds')}
            </div>
            <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
              {grandCount}
            </div>
          </div>
        </div>
      )}

      {/* Mode toggle tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <button
          type="button"
          onClick={switchToOpen}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mode === 'open'
              ? 'text-gray-900 dark:text-gray-100 border-b-2 border-accent dark:border-gray-100 -mb-px'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {t('tabOpen')}
        </button>
        <button
          type="button"
          onClick={switchToDay}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mode === 'day'
              ? 'text-gray-900 dark:text-gray-100 border-b-2 border-accent dark:border-gray-100 -mb-px'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {t('tabDay')}
        </button>
      </div>

      {/* Page body */}
      <div className="flex-1 px-4 py-4 space-y-3 max-w-lg mx-auto w-full">

        {/* Day picker (day-report mode only) */}
        {mode === 'day' && (
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('selectDay')}
            </label>
            <input
              type="date"
              max={today}
              value={dayInput}
              onChange={e => setDayInput(e.target.value)}
              className="w-full rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100 focus:outline-none focus:border-accent dark:focus:border-gray-400 transition-colors"
            />
            {!dayInput && (
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mt-1">
                {t('dayPickerHint')}
              </p>
            )}
          </div>
        )}

        {/* Day-report read-only note */}
        {mode === 'day' && dayInput && phase === 'ready' && (
          <div className="px-3 py-2.5 rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs font-semibold">
            {t('dayReportNote')}
          </div>
        )}

        {/* Open-tills contextual note */}
        {mode === 'open' && phase === 'ready' && tills.length > 0 && (
          <div className="px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
            {t('openTillsNote')}
          </div>
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <div className="py-10 text-gray-500 dark:text-gray-400 font-bold text-center">
            {t('loading')}
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40 text-red-700 dark:text-red-400 font-black text-center">
            {errorMsg ?? t('errorGeneric')}
          </div>
        )}

        {/* Empty state — all tills at zero (open mode) */}
        {allZero && (
          <div className="py-10 text-center">
            <div className="text-4xl mb-2" aria-hidden="true">✅</div>
            <div className="text-base font-black text-gray-700 dark:text-gray-300">{t('allZeroTitle')}</div>
            <div className="text-sm font-bold text-gray-400 dark:text-gray-500 mt-1">{t('allZeroBody')}</div>
          </div>
        )}

        {/* Empty state — day report with no data */}
        {mode === 'day' && dayInput && phase === 'ready' && shifts.length === 0 && (
          <div className="py-10 text-center">
            <div className="text-4xl mb-2" aria-hidden="true">📭</div>
            <div className="text-sm font-black text-gray-400 dark:text-gray-500">{t('dayNoData')}</div>
          </div>
        )}

        {/* Open-mode till list */}
        {mode === 'open' && phase === 'ready' && tills.length > 0 && (
          <div className="space-y-3">
            {tills.map(till => {
              const cs = closeStates[till.employeeId] ?? { phase: 'idle' }
              const totalLabel = `€${till.total.toFixed(2)}`
              const hasBalance = till.total > 0 || till.count > 0

              return (
                <div
                  key={till.employeeId}
                  className={`rounded-2xl border-2 p-4 transition-colors ${
                    cs.phase === 'closed'
                      ? 'border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800/40'
                      : hasBalance
                        ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50'
                        : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/20'
                  }`}
                >
                  {/* Employee name + total */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`font-black text-base truncate ${
                        cs.phase === 'closed'
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {till.name}
                        {!till.active && (
                          <span className="ml-2 text-xs font-semibold text-gray-400 dark:text-gray-500">{t('inactive')}</span>
                        )}
                      </div>
                      {cs.phase !== 'closed' ? (
                        <div className="text-sm font-bold text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('employeeSalesCount', { count: till.count })}
                        </div>
                      ) : (
                        <div className="text-sm font-bold text-green-700/80 dark:text-green-400/80 mt-0.5">
                          {t('closedBody', { total: `€${(cs.closedTotal ?? 0).toFixed(2)}`, count: cs.closedCount ?? 0 })}
                        </div>
                      )}
                    </div>
                    <div className={`text-2xl font-black tabular-nums flex-shrink-0 ${
                      cs.phase === 'closed'
                        ? 'text-green-600 dark:text-green-400'
                        : hasBalance
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-300 dark:text-gray-600'
                    }`}>
                      {cs.phase === 'closed' ? '✅' : totalLabel}
                    </div>
                  </div>

                  {/* Inline itemised transaction list — only in open (non-closed) state */}
                  {cs.phase !== 'closed' && till.items.length > 0 && (
                    <ul
                      className="mt-3 max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
                      aria-label={`${till.name} till items`}
                    >
                      {till.items.map(item => {
                        const timeStr = new Date(item.at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                        const isRental = item.kind === 'rental'

                        return (
                          <li
                            key={item.id}
                            className="flex items-center justify-between gap-2 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-gray-800 dark:text-gray-200 truncate">
                                {item.label}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">
                                  {timeStr}
                                </span>
                                {isRental && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-400">
                                    {t('rentalTag')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-sm font-black tabular-nums text-gray-900 dark:text-gray-100 flex-shrink-0">
                              {`€${item.amount.toFixed(2)}`}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {/* Per-employee close controls (open mode only, non-zero, not yet closed) */}
                  {hasBalance && cs.phase !== 'closed' && (
                    <div className="mt-3">
                      {cs.phase === 'idle' && (
                        <button
                          type="button"
                          onClick={() => setEmployeeConfirming(till.employeeId, true)}
                          className="w-full py-2.5 rounded-xl font-bold text-sm text-white bg-accent active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900 transition-colors select-none"
                        >
                          {t('closeTill')}
                        </button>
                      )}
                      {cs.phase === 'confirming' && (
                        <>
                          <div className="mb-2.5 text-xs font-bold text-amber-700 dark:text-amber-300 text-center">
                            {t('confirmBody', { name: till.name, total: totalLabel })}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEmployeeConfirming(till.employeeId, false)}
                              className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 transition-colors"
                            >
                              {t('cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCloseEmployee(till.employeeId)}
                              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-accent active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900 transition-colors"
                            >
                              {t('confirmClose')}
                            </button>
                          </div>
                        </>
                      )}
                      {cs.phase === 'closing' && (
                        <button
                          disabled
                          className="w-full py-2.5 rounded-xl font-bold text-sm bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
                        >
                          {t('closing')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Day-mode shift list — per-employee / per-sunbed earnings */}
        {mode === 'day' && phase === 'ready' && shifts.length > 0 && (
          <div className="space-y-3">
            {shifts.map(shift => {
              const isExpanded = expandedRows[shift.employeeId] ?? false
              const expandId = `shift-items-${shift.employeeId}`

              return (
                <div
                  key={shift.employeeId}
                  className="rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden"
                >
                  {/* Employee summary row + expand toggle */}
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-base text-gray-900 dark:text-gray-100 truncate">
                        {shift.name}
                        {!shift.active && (
                          <span className="ml-2 text-xs font-semibold text-gray-400 dark:text-gray-500">{t('inactive')}</span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('employeeSunbedCount', { count: shift.count })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
                        {`€${shift.total.toFixed(2)}`}
                      </div>
                      <button
                        type="button"
                        aria-label={t('expandShift', { name: shift.name })}
                        aria-expanded={isExpanded}
                        aria-controls={expandId}
                        onClick={() => toggleExpand(shift.employeeId)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Expandable item list */}
                  {isExpanded && (
                    <div
                      id={expandId}
                      className="border-t border-gray-100 dark:border-gray-700"
                    >
                      {shift.items.length === 0 ? (
                        <div className="px-4 py-3 text-xs font-semibold text-gray-400 dark:text-gray-500">
                          {t('noShiftItems')}
                        </div>
                      ) : (
                        <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
                          {shift.items.map(item => {
                            const timeStr = new Date(item.at).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                            const seatLabel = item.seats.join(', ')
                            const isCash = item.channel === 'cash'

                            return (
                              <li
                                key={item.reservationId}
                                className="flex items-center justify-between gap-3 px-4 py-2.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-bold text-gray-800 dark:text-gray-200 truncate">
                                    {seatLabel}
                                  </div>
                                  <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 mt-0.5">
                                    {timeStr}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {/* Cash/card channel badge — status colors: green=cash, blue=card */}
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                                      isCash
                                        ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800/40 dark:text-green-400'
                                        : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400'
                                    }`}
                                  >
                                    {isCash ? t('channelCash') : t('channelCard')}
                                  </span>
                                  <div className="text-sm font-black tabular-nums text-gray-900 dark:text-gray-100">
                                    {`€${item.amount.toFixed(2)}`}
                                  </div>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
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
  )
}

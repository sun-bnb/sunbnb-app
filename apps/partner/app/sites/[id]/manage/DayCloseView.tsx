'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { getTillDayReport, getOpenTills, closeDay } from './actions'
import type { EmployeeCashTotal } from '@repo/data/till'

/**
 * Full-page end-of-day close view for the token-gated manage surface.
 *
 * Admin-only. Anchored to `todayIso` (venue-local civil day) throughout:
 *   - Day totals: prominent cash + sales count from getTillDayReport for today.
 *   - Desglose por empleado: per-employee rows (name, total, sales count).
 *   - Pre-close note: how many open tills will be swept, plus (day-anchored,
 *     track 016) how much of that sweep is carry-over from before today —
 *     the operator sees today vs. old cash before confirming.
 *   - Two-step Confirm: "Confirmar cierre" → confirm → closeDay() → success
 *     state, which surfaces the swept total and (if any) the carry-over
 *     portion of it (`closeDay`'s `carryOverClosed`).
 *
 * No modal chrome (no backdrop, no role="dialog"/aria-modal, no escape-dismiss).
 * Page lives at /sites/[id]/manage/close?key=... — backHref returns to landing.
 */

// Short, friendly rendering of the venue-local `todayIso` ('YYYY-MM-DD').
// Noon-UTC anchor avoids DST-edge date-shifting (same technique as the
// server-side `nominalNoon` used by getTillDayReport/getDayShiftItems).
function formatTodayLabel(dateIso: string, locale: string): string {
  const d = new Date(`${dateIso}T12:00:00.000Z`)
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

type Phase = 'loading' | 'ready' | 'error'
type ClosePhase = 'idle' | 'confirming' | 'closing' | 'done'

interface DayCloseViewProps {
  siteId: string
  accessKey: string
  siteName: string
  todayIso: string
  backHref: string
}

export default function DayCloseView({
  siteId,
  accessKey,
  siteName,
  todayIso,
  backHref,
}: DayCloseViewProps) {
  const t = useTranslations('DayClose')
  const locale = useLocale()

  const [phase, setPhase] = useState<Phase>('loading')
  const [tills, setTills] = useState<EmployeeCashTotal[]>([])
  const [openTillsCount, setOpenTillsCount] = useState(0)
  // Sum of open tills' carryOver.total — the portion of the pending sweep
  // that's uncounted cash from before today (day-anchored, track 016).
  const [openTillsCarryOverTotal, setOpenTillsCarryOverTotal] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [closePhase, setClosePhase] = useState<ClosePhase>('idle')
  const [closedCount, setClosedCount] = useState(0)
  const [totalClosed, setTotalClosed] = useState(0)
  const [carryOverClosed, setCarryOverClosed] = useState(0)
  const [closeError, setCloseError] = useState<string | null>(null)

  const startedRef = useRef(false)

  // ── Load day report + open tills on mount ─────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    ;(async () => {
      setPhase('loading')
      setErrorMsg(null)

      const [reportRes, openRes] = await Promise.all([
        getTillDayReport(siteId, todayIso, accessKey),
        getOpenTills(siteId, accessKey),
      ])

      if (reportRes.status !== 'ok') {
        setErrorMsg(reportRes.errors?.[0] ?? t('errorGeneric'))
        setPhase('error')
        return
      }

      setTills(reportRes.tills ?? [])
      const openTills = openRes.status === 'ok' ? (openRes.tills ?? []) : []
      setOpenTillsCount(openTills.filter(t => t.total > 0 || t.count > 0).length)
      setOpenTillsCarryOverTotal(openTills.reduce((sum, t) => sum + t.carryOver.total, 0))
      setPhase('ready')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Refresh day report after a successful close ────────────────────────────
  const refreshAfterClose = async () => {
    const res = await getTillDayReport(siteId, todayIso, accessKey)
    if (res.status === 'ok') setTills(res.tills ?? [])
    setOpenTillsCount(0)
    setOpenTillsCarryOverTotal(0)
  }

  // ── Close-day handler ──────────────────────────────────────────────────────
  const handleCloseDay = async () => {
    setClosePhase('closing')
    setCloseError(null)
    const res = await closeDay(siteId, accessKey)
    if (res.status !== 'ok') {
      setClosePhase('idle')
      setCloseError(res.errors?.[0] ?? t('errorGeneric'))
      return
    }
    setClosedCount(res.closedCount ?? 0)
    setTotalClosed(res.totalClosed ?? 0)
    setCarryOverClosed(res.carryOverClosed ?? 0)
    setClosePhase('done')
    // Refresh the day-totals rows (TillClose entries now exist; open balances = 0)
    await refreshAfterClose()
  }

  // ── Derived aggregates ─────────────────────────────────────────────────────
  const grandTotal = tills.reduce((sum, t) => sum + t.total, 0)
  const grandCount = tills.reduce((sum, t) => sum + t.count, 0)
  const showTotals = phase === 'ready' && tills.length > 0
  const todayLabel = formatTodayLabel(todayIso, locale)

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
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 truncate">
            {siteName} · {t('todayLine', { date: todayLabel })}
          </p>
        </div>
      </div>

      {/* Day-totals summary header */}
      {showTotals && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('totalCash')}
            </div>
            <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
              {`€${grandTotal.toFixed(2)}`}
            </div>
          </div>
          <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t('totalSales')}
            </div>
            <div className="text-2xl font-black tabular-nums text-gray-900 dark:text-gray-100">
              {grandCount}
            </div>
          </div>
        </div>
      )}

      {/* Page body */}
      <div className="flex-1 px-4 py-4 space-y-3 max-w-lg mx-auto w-full">

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

        {phase === 'ready' && (
          <>
            {/* Desglose por empleado */}
            {tills.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1">
                  {t('breakdownHeading')}
                </div>
                <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                  {tills.map(till => (
                    <div key={till.employeeId} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">
                          {till.name}
                          {!till.active && (
                            <span className="ml-2 text-xs font-semibold text-gray-400 dark:text-gray-500">
                              {t('inactive')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 mt-0.5">
                          {t('employeeSalesCount', { count: till.count })}
                        </div>
                      </div>
                      <div className={`text-lg font-black tabular-nums flex-shrink-0 ${
                        till.total > 0
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-300 dark:text-gray-600'
                      }`}>
                        {`€${till.total.toFixed(2)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <div className="text-base font-black text-gray-400 dark:text-gray-500">
                  {t('noData')}
                </div>
              </div>
            )}

            {/* What Confirm does — pre-close info note */}
            {closePhase !== 'done' && openTillsCount > 0 && (
              <div className="px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-xs font-semibold space-y-1">
                <div>{t('whatCloseDoes', { count: openTillsCount })}</div>
                {openTillsCarryOverTotal > 0 && (
                  <div>{t('carryOverPortion', { amount: `€${openTillsCarryOverTotal.toFixed(2)}` })}</div>
                )}
              </div>
            )}

            {/* Error from close attempt */}
            {closeError && (
              <div className="px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-semibold">
                {closeError}
              </div>
            )}

            {/* Success state */}
            {closePhase === 'done' && (
              <div className="rounded-2xl border-2 border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800/40 p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl" aria-hidden="true">✅</span>
                  <div className="font-black text-base text-green-700 dark:text-green-400">
                    {t('successTitle')}
                  </div>
                </div>
                <div className="text-sm font-bold text-green-700/80 dark:text-green-400/80">
                  <div>{t('successAmount', { total: `€${totalClosed.toFixed(2)}` })}</div>
                  <div className="mt-0.5">{t('successTills', { count: closedCount })}</div>
                  {carryOverClosed > 0 && (
                    <div className="mt-0.5 text-green-700/70 dark:text-green-400/70">
                      {t('successCarryOverNote', { amount: `€${carryOverClosed.toFixed(2)}` })}
                    </div>
                  )}
                </div>
                <Link
                  href={backHref}
                  className="mt-4 w-full flex items-center justify-center py-2.5 rounded-xl font-bold text-sm bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('backToMenu')}
                </Link>
              </div>
            )}

            {/* Two-step confirm */}
            {closePhase !== 'done' && (
              <div className="pt-1">
                {closePhase === 'idle' && (
                  <button
                    type="button"
                    onClick={() => setClosePhase('confirming')}
                    className="w-full py-3 rounded-xl font-bold text-sm text-white bg-accent active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900 transition-colors select-none"
                  >
                    {t('confirmClose')}
                  </button>
                )}

                {closePhase === 'confirming' && (
                  <>
                    <div className="mb-3 text-sm font-bold text-amber-700 dark:text-amber-300 text-center" role="status">
                      {t('confirmQuestion')}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setClosePhase('idle')}
                        className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 transition-colors"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleCloseDay}
                        className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-accent active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900 transition-colors"
                      >
                        {t('confirmButton')}
                      </button>
                    </div>
                  </>
                )}

                {closePhase === 'closing' && (
                  <button
                    disabled
                    className="w-full py-3 rounded-xl font-bold text-sm bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
                  >
                    {t('closing')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

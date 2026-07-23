'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { getTillStatus, closeTill } from './actions'

/**
 * Per-worker till sheet — the cash-handoff ritual at shift end.
 *
 * Day-anchored (track 016): the lead number is TODAY's cash, not the raw
 * since-last-close sweepable balance. Unclosed cash from before today (a
 * forgotten close on a prior shift) surfaces separately as an explicit
 * carry-over banner. A close always sweeps today + carry-over together —
 * there is no partial close — `closeTill`'s response carries the full
 * `today`/`carryOver` breakdown of what it just swept.
 *
 * Chrome mirrors CollectPaymentModal: bottom sheet on mobile, centered card on
 * desktop, with `dark:` variants (rendered inside the manage page's `.dark` root).
 */

type Phase = 'loading' | 'ready' | 'confirming' | 'closing' | 'closed' | 'error'

interface Bucket {
  total: number
  count: number
}

interface CarryOverBucket extends Bucket {
  oldestAt: Date | string | null
}

const EMPTY_TODAY: Bucket = { total: 0, count: 0 }
const EMPTY_CARRY_OVER: CarryOverBucket = { total: 0, count: 0, oldestAt: null }

function formatShortDate(at: Date | string, locale: string): string {
  const d = new Date(at)
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export default function TillSheet({
  siteId,
  worker,
  accessKey,
  onClose,
  onClosed,
}: {
  siteId: string
  worker: { id: string; name: string }
  accessKey?: string
  onClose: () => void
  /** Called after a successful close so the parent can refresh the grid. */
  onClosed: () => void
}) {
  const t = useTranslations('Till')
  const locale = useLocale()
  const [phase, setPhase] = useState<Phase>('loading')
  // Sweepable balance (today + carryOver) — what a close hands in.
  const [total, setTotal] = useState(0)
  const [count, setCount] = useState(0)
  const [today, setToday] = useState<Bucket>(EMPTY_TODAY)
  const [carryOver, setCarryOver] = useState<CarryOverBucket>(EMPTY_CARRY_OVER)
  // Carry-over portion actually swept by the close (only meaningful once closed).
  const [closedCarryOverAmount, setClosedCarryOverAmount] = useState<number | undefined>(undefined)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const startedRef = useRef(false)

  // ── Load the open till on mount ───────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    ;(async () => {
      const res = await getTillStatus(siteId, worker.id, accessKey)
      if (res.status !== 'ok') {
        setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
        setPhase('error')
        return
      }
      setTotal(res.total ?? 0)
      setCount(res.count ?? 0)
      setToday(res.today ?? EMPTY_TODAY)
      setCarryOver(res.carryOver ?? EMPTY_CARRY_OVER)
      setPhase('ready')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleClose() {
    setPhase('closing')
    const res = await closeTill(siteId, worker.id, accessKey)
    if (res.status !== 'ok') {
      setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
      setPhase('error')
      return
    }
    setTotal(res.total ?? 0)
    setCount(res.count ?? 0)
    setToday(res.today ?? EMPTY_TODAY)
    setCarryOver(res.carryOver ?? EMPTY_CARRY_OVER)
    setClosedCarryOverAmount(res.carryOverAmount)
    setPhase('closed')
    onClosed()
  }

  const totalLabel = `€${total.toFixed(2)}`
  const todayLabel = `€${today.total.toFixed(2)}`
  const carryOverLabel = `€${carryOver.total.toFixed(2)}`
  const isEmpty = total === 0
  const hasCarryOver = carryOver.count > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 dark:text-gray-100 w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 truncate">
            💶 {t('title', { name: worker.name })}
          </h2>
          <button onClick={onClose} aria-label={t('close')} className="text-gray-400 dark:text-gray-500 text-4xl leading-none p-3 -mr-2 flex-shrink-0">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-center">
          {phase === 'loading' ? (
            <div className="py-10 text-gray-500 dark:text-gray-400 font-bold">{t('loading')}</div>
          ) : phase === 'error' ? (
            <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40 text-red-700 dark:text-red-400 font-black">
              {errorMsg ?? t('errorGeneric')}
            </div>
          ) : phase === 'closed' ? (
            <div className="py-8 px-4 rounded-2xl border-2 border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800/40">
              <div className="text-5xl">✅</div>
              <div className="mt-2 text-xl font-black text-green-700 dark:text-green-400">{t('closedTitle')}</div>
              <div className="mt-1 text-sm font-bold text-green-700/80 dark:text-green-400/80">
                {t('closedBody', { total: totalLabel, count })}
              </div>
              {!!closedCarryOverAmount && closedCarryOverAmount > 0 && (
                <div className="mt-0.5 text-xs font-bold text-green-700/70 dark:text-green-400/70">
                  {t('closedCarryOverNote', { amount: `€${closedCarryOverAmount.toFixed(2)}` })}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Today lead */}
              <div>
                <div className="text-sm font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t('today')}</div>
                <div className="text-4xl font-black tabular-nums">{todayLabel}</div>
                <div className="mt-1 text-sm font-bold text-gray-500 dark:text-gray-400">
                  {t('todaySalesCount', { count: today.count })}
                </div>
              </div>

              {/* Carry-over banner — uncounted cash from before today */}
              {hasCarryOver && (
                <div
                  role="status"
                  className="py-3 px-4 rounded-2xl border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 font-bold text-sm"
                >
                  {t('carryOverBanner', {
                    date: carryOver.oldestAt ? formatShortDate(carryOver.oldestAt, locale) : '',
                    amount: carryOverLabel,
                    count: carryOver.count,
                  })}
                </div>
              )}

              {phase === 'confirming' && !isEmpty && (
                <div className="py-4 px-4 rounded-2xl border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 font-bold">
                  <div>{t('confirmBody', { total: totalLabel })}</div>
                  {hasCarryOver && (
                    <div className="mt-1.5 text-xs font-semibold text-amber-700/90 dark:text-amber-300/90">
                      {t('confirmBreakdown', { today: todayLabel, carryOver: carryOverLabel, total: totalLabel })}
                    </div>
                  )}
                </div>
              )}

              {isEmpty && (
                <div className="text-sm font-bold text-gray-400 dark:text-gray-500">{t('nothingToClose')}</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t-2 border-gray-200 dark:border-gray-700 space-y-2"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
          {phase === 'ready' && !isEmpty && (
            <button
              onClick={() => setPhase('confirming')}
              className="w-full font-black py-4 rounded-2xl text-lg select-none transition-colors bg-accent text-white active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900"
            >
              {t('closeTill')}
            </button>
          )}
          {phase === 'confirming' && (
            <div className="flex gap-2">
              <button
                onClick={() => setPhase('ready')}
                className="flex-1 font-black py-4 rounded-2xl text-lg select-none bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-200"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 font-black py-4 rounded-2xl text-lg select-none bg-accent text-white active:bg-accent-hover dark:bg-gray-100 dark:text-gray-900"
              >
                {t('confirmClose')}
              </button>
            </div>
          )}
          {phase === 'closing' && (
            <button disabled className="w-full font-black py-4 rounded-2xl text-lg bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
              {t('closing')}
            </button>
          )}
          {(phase === 'closed' || phase === 'error' || (phase === 'ready' && isEmpty)) && (
            <button
              onClick={onClose}
              className={`w-full font-black py-4 rounded-2xl text-lg select-none transition-colors ${
                phase === 'closed'
                  ? 'bg-green-600 text-white active:bg-green-700'
                  : 'bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {phase === 'closed' ? t('done') : t('close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

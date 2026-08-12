'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getManageTrends, getManageTrendsCsv } from '../actions'

/* ── Recharts safe casts (sidestep React 18 type friction, mirrors accounting/view.tsx) ── */
const SafeResponsiveContainer = ResponsiveContainer as unknown as React.ComponentType<any>
const SafeBarChart = BarChart as unknown as React.ComponentType<any>
const SafeCartesianGrid = CartesianGrid as unknown as React.ComponentType<any>
const SafeXAxis = XAxis as unknown as React.ComponentType<any>
const SafeYAxis = YAxis as unknown as React.ComponentType<any>
const SafeTooltip = Tooltip as unknown as React.ComponentType<any>
const SafeBar = Bar as unknown as React.ComponentType<any>

/* ── Types — mirrors accounting/view.tsx local interfaces ── */
interface DailyRevenueByChannel { date: string; cash: number; qr: number; online: number; total: number }
interface ChannelRevenueSummary { total: number; cash: number; qr: number; online: number; bestDay: DailyRevenueByChannel | null }
interface DailyOccupancy { date: string; capacity: number; occupied: number; comps: number; occupancyPct: number }
interface OccupancySummary { avgOccupancyPct: number; peakOccupancyPct: number; totalComps: number }
interface DailyReservationStats { date: string; rentedSeats: number; revenue: number }
interface ReservationStatsSummary { totalRevenue: number; totalSeats: number; bestDay: DailyReservationStats | null }

interface TrendsData {
  days: number
  revenue: { rows: DailyRevenueByChannel[]; summary: ChannelRevenueSummary }
  occupancy: { rows: DailyOccupancy[]; summary: OccupancySummary }
  operations: { rows: DailyReservationStats[]; summary: ReservationStatsSummary }
}

type TrendMetric = 'revenue' | 'occupancy' | 'sunbeds'
const TREND_METRICS: TrendMetric[] = ['revenue', 'occupancy', 'sunbeds']

/* Window options: 7d / 30d / 1y — maps to days 7 / 30 / 365 */
const WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 365, label: '1y' },
] as const
type TrendDays = 7 | 30 | 365

/* Channel bar colours — match accounting/view.tsx exactly */
const CHANNEL_COLORS: Record<string, string> = {
  cash: '#16a34a',
  qr: '#2563eb',
  online: '#111827',
}

/* ── Tooltip (mirrors accounting/view.tsx TrendChartTooltip) ── */
function TrendChartTooltip({
  active,
  payload,
  label,
  fmt,
  stacked,
  totalLabel,
}: {
  active?: boolean
  payload?: any[]
  label?: string
  fmt: (v: number) => string
  stacked?: boolean
  totalLabel?: string
}) {
  if (!active || !payload?.length) return null
  const dateLabel = label
    ? new Date(`${label}T00:00:00Z`).toLocaleDateString('default', { day: 'numeric', month: 'short' })
    : ''

  if (stacked) {
    const channels = payload.filter((p) => (p.value as number) > 0)
    const total = payload.reduce((s, p) => s + (p.value as number), 0)
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs min-w-[120px]">
        <p className="font-medium text-gray-700 mb-1.5">{dateLabel}</p>
        {channels.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3 mb-0.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CHANNEL_COLORS[p.dataKey] ?? '#9ca3af' }} />
              <span className="text-gray-600 capitalize">{p.dataKey}</span>
            </span>
            <span className="font-medium text-gray-900 tabular-nums">{fmt(p.value as number)}</span>
          </div>
        ))}
        {channels.length > 1 && (
          <div className="flex items-center justify-between gap-3 mt-1 pt-1 border-t border-gray-100">
            <span className="text-gray-500 font-medium">{totalLabel ?? 'Total'}</span>
            <span className="font-semibold text-gray-900 tabular-nums">{fmt(total)}</span>
          </div>
        )}
      </div>
    )
  }

  const value = payload[0]?.value as number
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{dateLabel}</p>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gray-900" />
        <span className="font-medium text-gray-900">{fmt(value)}</span>
      </div>
    </div>
  )
}

/* ── Spinner ── */
function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <svg
        className="animate-spin h-6 w-6 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </div>
  )
}

/* ── Short-form date label ("1 Jul") ── */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('default', { day: 'numeric', month: 'short' })
}

/* Richer than formatDay (adds weekday) — used standalone in the daily breakdown list,
   where there's no surrounding chart axis to supply the "which day" context.
   Mirrors accounting/view.tsx's formatDayLong. */
function formatDayLong(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('default', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/* ── Main component ── */
export default function TrendsView({
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
  const t = useTranslations('ManageTrends')

  const [selectedDays, setSelectedDays] = useState<TrendDays>(30)
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [data, setData] = useState<TrendsData | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)

  /* Fetch trends once per window change */
  const load = async (days: TrendDays) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setPhase('loading')
    setErrorMsg(null)

    const res = await getManageTrends(siteId, days, accessKey)
    if (abortRef.current?.signal.aborted) return

    if (res.status !== 'ok' || !res.revenue || !res.occupancy || !res.operations) {
      setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
      setPhase('error')
      return
    }

    setData({
      days: res.days ?? days,
      revenue: res.revenue,
      occupancy: res.occupancy,
      operations: res.operations,
    })
    setPhase('ready')
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    load(selectedDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleWindowChange = (days: TrendDays) => {
    setSelectedDays(days)
    startedRef.current = true
    load(days)
  }

  /* CSV download */
  const downloadCsv = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await getManageTrendsCsv(siteId, selectedDays, accessKey)
      if (res.status !== 'ok' || !res.csv) return
      const filename = `trends-${selectedDays}d.csv`
      const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  /* ── View-model: same derivation as accounting/view.tsx trendViewModel ── */
  const trendViewModel = useMemo(() => {
    if (!data) return null

    if (trendMetric === 'sunbeds') {
      const rows = data.occupancy.rows
      const occupied = rows.map((r) => r.occupied)
      const avg = rows.length > 0 ? Math.round(occupied.reduce((a, b) => a + b, 0) / rows.length) : 0
      const peak = Math.max(...occupied, 0)
      const peakRow = rows.find((r) => r.occupied === peak && peak > 0) ?? null
      return {
        bars: rows.map((r) => ({ date: r.date, value: r.occupied })),
        fmt: (v: number) => String(v),
        tiles: [
          { label: t('avgSunbeds'), value: String(avg) },
          { label: t('peakSunbeds'), value: String(peak) },
          { label: t('bestDay'), value: peakRow ? String(peakRow.occupied) : '—', date: peakRow?.date },
        ],
        empty: rows.every((r) => r.occupied === 0),
        isStacked: false,
      }
    }

    if (trendMetric === 'occupancy') {
      const rows = data.occupancy.rows
      const summary = data.occupancy.summary
      const peakRow = rows.find((r) => r.occupancyPct === summary.peakOccupancyPct && r.occupancyPct > 0) ?? null
      return {
        bars: rows.map((r) => ({ date: r.date, value: r.occupancyPct })),
        fmt: (v: number) => `${Math.round(v)}%`,
        tiles: [
          { label: t('avgOccupancy'), value: `${summary.avgOccupancyPct}%` },
          { label: t('peakOccupancy'), value: `${summary.peakOccupancyPct}%` },
          { label: t('bestDay'), value: peakRow ? `${Math.round(peakRow.occupancyPct)}%` : '—', date: peakRow?.date },
        ],
        empty: rows.every((r) => r.occupancyPct === 0),
        isStacked: false,
      }
    }

    /* revenue */
    const rows = data.revenue.rows
    const summary = data.revenue.summary
    const bestDay = summary.bestDay
    return {
      bars: rows,
      fmt: (v: number) => `€${v.toFixed(2)}`,
      tiles: [
        { label: t('revenue'), value: `€${summary.total.toFixed(2)}` },
        { label: t('bestDay'), value: bestDay ? `€${bestDay.total.toFixed(2)}` : '—', date: bestDay?.date },
      ],
      empty: summary.total === 0,
      isStacked: true,
    }
  }, [data, trendMetric, t])

  const hasData = phase === 'ready' && data !== null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">

      {/* Page header — mirrors DailySummaryView */}
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

      {/* Body */}
      <div className="flex-1 px-4 py-4 space-y-4 max-w-lg mx-auto w-full">

        {/* ── Window selector ── */}
        <div className="flex gap-1.5">
          {WINDOWS.map(({ days, label }) => (
            <button
              key={days}
              type="button"
              onClick={() => handleWindowChange(days)}
              aria-pressed={selectedDays === days}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedDays === days
                  ? 'bg-accent text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Loading ── */}
        {phase === 'loading' && <Spinner />}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40 text-red-700 dark:text-red-400 font-black text-center">
            {errorMsg ?? t('errorGeneric')}
          </div>
        )}

        {/* ── Content ── */}
        {hasData && trendViewModel && (
          <>
            {/* ── Metric toggle (segmented control) ── */}
            <div
              className="flex rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
              role="group"
              aria-label={t('metricToggleLabel')}
            >
              {TREND_METRICS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTrendMetric(m)}
                  aria-pressed={trendMetric === m}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    trendMetric === m
                      ? 'bg-accent text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {t(`metric${m.charAt(0).toUpperCase()}${m.slice(1)}` as 'metricRevenue' | 'metricOccupancy' | 'metricSunbeds')}
                </button>
              ))}
            </div>

            {/* ── KPI tiles ── */}
            {trendViewModel.empty ? (
              <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                {t('noDataYet')}
              </div>
            ) : (
              <>
                <div className={`grid gap-3 ${trendViewModel.tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {trendViewModel.tiles.map((tile) => (
                    <div
                      key={tile.label}
                      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3"
                    >
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-medium leading-tight">{tile.label}</div>
                      <div className="text-lg font-black text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums">{tile.value}</div>
                      {tile.date && (
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{formatDay(tile.date)}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* ── Revenue channel legend ── */}
                {trendMetric === 'revenue' && (
                  <div className="flex items-center gap-4 px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#16a34a' }} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('channelCash')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#2563eb' }} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('channelQr')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#111827' }} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{t('channelOnline')}</span>
                    </div>
                  </div>
                )}

                {/* ── Chart ── */}
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div className="h-44">
                    <SafeResponsiveContainer width="100%" height="100%">
                      <SafeBarChart
                        data={trendViewModel.isStacked ? data.revenue.rows : trendViewModel.bars}
                        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                      >
                        <SafeCartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <SafeXAxis
                          dataKey="date"
                          tickFormatter={(d: string) => formatDay(d)}
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          interval="preserveStartEnd"
                          minTickGap={selectedDays === 365 ? 40 : 24}
                          axisLine={false}
                          tickLine={false}
                        />
                        <SafeYAxis
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickFormatter={(v: number) =>
                            trendMetric === 'revenue'
                              ? `€${v}`
                              : trendViewModel.fmt(v)
                          }
                          width={44}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <SafeTooltip
                          content={(props: any) => (
                            <TrendChartTooltip
                              {...props}
                              fmt={trendViewModel.fmt}
                              stacked={trendMetric === 'revenue'}
                              totalLabel={t('channelTotal')}
                            />
                          )}
                          cursor={{ fill: '#f9fafb' }}
                        />
                        {trendMetric === 'revenue' ? (
                          <>
                            <SafeBar dataKey="cash" stackId="rev" fill="#16a34a" />
                            <SafeBar dataKey="qr" stackId="rev" fill="#2563eb" />
                            <SafeBar dataKey="online" stackId="rev" fill="#111827" radius={[4, 4, 0, 0]} />
                          </>
                        ) : (
                          <SafeBar dataKey="value" fill="#111827" radius={[4, 4, 0, 0]} />
                        )}
                      </SafeBarChart>
                    </SafeResponsiveContainer>
                  </div>
                </div>

                {/* ── Daily breakdown — plain scannable day-by-day list, newest first ── */}
                {trendMetric === 'revenue' && data.revenue.rows.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                      {t('dailyBreakdown')}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {[...data.revenue.rows].reverse().map((row) => (
                        <div
                          key={row.date}
                          className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-b-0 text-sm"
                        >
                          <span className="text-gray-600 dark:text-gray-400">{formatDayLong(row.date)}</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                            €{row.total.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── CSV export ── */}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={downloadCsv}
                    disabled={downloading}
                    className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors"
                  >
                    {downloading ? '…' : `↓ ${t('downloadCsv')}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

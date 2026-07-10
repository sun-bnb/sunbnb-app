'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import EventSeatIcon from '@mui/icons-material/EventSeat'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { useTranslations } from 'next-intl'

import { useSite } from '@/app/sites/site-context'
import {
  getOccupancyTrend,
  getRevenueCsv,
  getOperationsTrend,
  getFloorSnapshot,
  getStaffShiftItemsForDay,
  getMonthlySummary,
  getRevenueChannelTrend,
  getMonthlyFiscalReport,
} from './actions'

const MONTH_KEYS = ['january','february','march','april','may','june','july','august','september','october','november','december'] as const

// Invoice-trend windows (recentTrend card only)
const TREND_WINDOWS = [7, 30, 365] as const

// Channel revenue types (from getRevenueChannelTrend / @repo/data/analytics)
interface DailyRevenueByChannel { date: string; cash: number; qr: number; online: number; total: number }
interface ChannelRevenueSummary { total: number; cash: number; qr: number; online: number; bestDay: DailyRevenueByChannel | null }
interface ChannelTrend {
  rows: DailyRevenueByChannel[]
  summary: ChannelRevenueSummary
}

interface DailyOccupancy { date: string; capacity: number; occupied: number; comps: number; occupancyPct: number }
interface OccupancySummary { avgOccupancyPct: number; peakOccupancyPct: number; totalComps: number }
interface OccupancyTrend {
  rows: DailyOccupancy[]
  summary: OccupancySummary
}

type TrendMetric = 'revenue' | 'sunbeds' | 'occupancy'
const TREND_METRICS: TrendMetric[] = ['revenue', 'sunbeds', 'occupancy']

// Operations lens types (paymentAmount-based, from getOperationsTrend)
interface DailyReservationStats { date: string; rentedSeats: number; revenue: number }
interface ReservationStatsSummary { totalRevenue: number; totalSeats: number; bestDay: DailyReservationStats | null }
interface OperationsTrend {
  rows: DailyReservationStats[]
  summary: ReservationStatsSummary
}

// Floor state snapshot (5-way parcel state)
interface FloorStateSnapshot {
  capacity: number
  libres: number
  alquiladas: number
  reservadas: number
  gratis: number
  desactivada: number
}

// Per-employee shift item types (from getStaffShiftItemsForDay)
interface EmployeeShiftItem {
  reservationId: string
  seats: string[]
  amount: number
  at: Date
  channel: 'cash' | 'card'
}
interface EmployeeShift {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  items: EmployeeShiftItem[]
}

// MonthlyFiscalReport shape — mirrors @repo/data/fiscal
interface VatRateBucket { rate: number; net: number; vat: number; gross: number }
interface FiscalInvoiceLine {
  invoiceNumber: string | null
  invoicedAt: Date
  issuerType: string
  description: string | null
  net: number
  vatRate: number | null
  vat: number
  gross: number
  paymentRef: string | null
  reverseCharge: boolean
}
interface MonthlyFiscalReport {
  count: number
  gross: number
  net: number
  vat: number
  vatByRate: VatRateBucket[]
  platformCommission: number
  platformReverseCharge: boolean
  processingFees: number
  refunds: { count: number; amount: number }
  lines: FiscalInvoiceLine[]
}

// Format "YYYY-MM-DD" from a Date for a date input's default value
function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/* ── Recharts safe casts (sidestep React 18 type friction, mirrors dashboard) ── */
const SafeResponsiveContainer = ResponsiveContainer as unknown as React.ComponentType<any>
const SafeBarChart = BarChart as unknown as React.ComponentType<any>
const SafeCartesianGrid = CartesianGrid as unknown as React.ComponentType<any>
const SafeXAxis = XAxis as unknown as React.ComponentType<any>
const SafeYAxis = YAxis as unknown as React.ComponentType<any>
const SafeTooltip = Tooltip as unknown as React.ComponentType<any>
const SafeBar = Bar as unknown as React.ComponentType<any>

// MonthlySourceSummary shape — mirrors @repo/data/analytics export
interface MonthlySourceSummaryLocal {
  sunbeds: { revenue: number; count: number; seats: number }
  rentals: { revenue: number; count: number }
  orders: { revenue: number; count: number; bedLinkedRevenue: number }
  refunds: { revenue: number; count: number }
  total: number
  totalCount: number
  capacity: number
}

// Channel bar colour config — single source of truth for tooltip + bars
const CHANNEL_COLORS: Record<string, string> = {
  cash: '#16a34a',
  qr: '#2563eb',
  online: '#111827',
}

/* ── Trend chart tooltip — single-value (sunbeds/occupancy) or stacked (revenue) */
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
  fmt: (arg: number) => string
  stacked?: boolean
  totalLabel?: string
}) {
  if (!active || !payload?.length) return null
  // label is the raw date key (YYYY-MM-DD) passed via XAxis dataKey
  const dateLabel = label
    ? new Date(`${label}T00:00:00Z`).toLocaleDateString('default', { day: 'numeric', month: 'short' })
    : ''

  if (stacked) {
    // recharts passes all stacked series in payload; filter to non-zero channels
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

/** Escape a CSV field value — wrap in quotes if it contains comma, quote, or newline */
function csvEscape(value: string | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export default function AccountingView() {
  const { site } = useSite()
  const t = useTranslations('SiteAccounting')

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(true)

  // All-source monthly summary (sunbeds/rentals/orders/refunds + prev-month delta)
  const [monthlySummary, setMonthlySummary] = useState<{
    current: MonthlySourceSummaryLocal
    prevTotal: number
  } | null>(null)

  // Rolling-window channel revenue trend (all-channel takings, recentTrend card)
  const [trendWindow, setTrendWindow] = useState<(typeof TREND_WINDOWS)[number]>(30)
  const [channelTrend, setChannelTrend] = useState<ChannelTrend | null>(null)
  const [channelLoading, setChannelLoading] = useState(true)

  // Metric toggle for the recentTrend card (Revenue / Sunbeds / Occupancy)
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [occupancy, setOccupancy] = useState<OccupancyTrend | null>(null)
  const [occupancyLoading, setOccupancyLoading] = useState(true)

  // Daily summary — operations lens (paymentAmount-based, today-only)
  const [opsTrend, setOpsTrend] = useState<OperationsTrend | null>(null)
  const [opsTrendLoading, setOpsTrendLoading] = useState(true)

  // Daily summary — floor state snapshot (Estado de la parcela)
  const [floorSnapshot, setFloorSnapshot] = useState<FloorStateSnapshot | null>(null)
  const [floorLoading, setFloorLoading] = useState(true)

  // Per-employee shift items for a selected day (Desglose por Empleado)
  const todayIso = toDateInputValue(now)
  const [employeeDay, setEmployeeDay] = useState(todayIso)
  const [shiftItems, setShiftItems] = useState<EmployeeShift[] | null>(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set())

  // CSV export state (recentTrend card)
  const [downloading, setDownloading] = useState(false)

  // Fiscal report (accounting export section — invoice-based, month-scoped)
  const [fiscalReport, setFiscalReport] = useState<MonthlyFiscalReport | null>(null)
  const [fiscalLoading, setFiscalLoading] = useState(true)
  const [fiscalDownloading, setFiscalDownloading] = useState(false)

  // Load all-source monthly summary on month change
  useEffect(() => {
    if (!site?.id) return
    setLoading(true)
    getMonthlySummary(site.id, selectedYear, selectedMonth).then(
      (data) => {
        setMonthlySummary(data as { current: MonthlySourceSummaryLocal; prevTotal: number })
        setLoading(false)
      }
    )
  }, [selectedYear, selectedMonth, site?.id])

  // Load fiscal report on site + month change
  useEffect(() => {
    if (!site?.id) return
    setFiscalLoading(true)
    getMonthlyFiscalReport(site.id, selectedYear, selectedMonth).then((data) => {
      setFiscalReport(data as MonthlyFiscalReport)
      setFiscalLoading(false)
    })
  }, [site?.id, selectedYear, selectedMonth])

  // Load floor snapshot once on mount (always today)
  useEffect(() => {
    if (!site?.id) return
    setFloorLoading(true)
    getFloorSnapshot(site.id).then((snap) => {
      setFloorSnapshot(snap)
      setFloorLoading(false)
    })
  }, [site?.id])

  // Load channel revenue trend on site + window change (all-channel takings)
  useEffect(() => {
    if (!site?.id) return
    setChannelLoading(true)
    getRevenueChannelTrend(site.id, trendWindow).then((data) => {
      setChannelTrend(data as ChannelTrend)
      setChannelLoading(false)
    })
  }, [site?.id, trendWindow])

  // Load occupancy trend on site + window change (mirrors revenue effect)
  useEffect(() => {
    if (!site?.id) return
    setOccupancyLoading(true)
    getOccupancyTrend(site.id, trendWindow).then((data) => {
      setOccupancy(data as OccupancyTrend)
      setOccupancyLoading(false)
    })
  }, [site?.id, trendWindow])

  // Load operations trend — today-only (1-day window) for the Daily summary card
  useEffect(() => {
    if (!site?.id) return
    setOpsTrendLoading(true)
    getOperationsTrend(site.id, 1).then((data) => {
      setOpsTrend(data as OperationsTrend)
      setOpsTrendLoading(false)
    })
  }, [site?.id])

  // Load per-employee shift items for the selected day
  useEffect(() => {
    if (!site?.id) return
    setShiftLoading(true)
    setExpandedEmployees(new Set())
    getStaffShiftItemsForDay(site.id, employeeDay).then((data) => {
      setShiftItems(data as EmployeeShift[])
      setShiftLoading(false)
    })
  }, [site?.id, employeeDay])

  // Navigate months
  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear(selectedYear - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth(selectedMonth - 1)
    }
  }
  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear(selectedYear + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth(selectedMonth + 1)
    }
  }

  const formatDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('default', { day: 'numeric', month: 'short' })

  const formatTime = (d: Date | string) => {
    const date = new Date(d)
    return date.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' })
  }

  // Toggle an employee's itemized expansion in the per-employee card
  const toggleEmployee = useCallback((employeeId: string) => {
    setExpandedEmployees((prev) => {
      const next = new Set(prev)
      if (next.has(employeeId)) {
        next.delete(employeeId)
      } else {
        next.add(employeeId)
      }
      return next
    })
  }, [])

  // Today's operations figures — last row of opsTrend (window always ends today)
  const todayOps = opsTrend && opsTrend.rows.length > 0
    ? opsTrend.rows[opsTrend.rows.length - 1]
    : null

  // CSV export (recentTrend card)
  const downloadCsv = async () => {
    if (!site?.id) return
    setDownloading(true)
    try {
      const csv = await getRevenueCsv(site.id, trendWindow)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${site.name ?? 'site'}-figures-${trendWindow}d.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  // View-model for the recentTrend card — derived from selected metric
  const trendViewModel = useMemo(() => {
    if (trendMetric === 'sunbeds') {
      const rows = occupancy?.rows ?? []
      const occupied = rows.map((r) => r.occupied)
      const max = Math.max(...occupied, 1)
      const avg = rows.length > 0 ? Math.round(occupied.reduce((a, b) => a + b, 0) / rows.length) : 0
      const peak = Math.max(...occupied, 0)
      const peakRow = rows.find((r) => r.occupied === peak && peak > 0) ?? null
      return {
        bars: rows.map((r) => ({ date: r.date, value: r.occupied, max })),
        fmt: (v: number) => String(v),
        tiles: [
          { label: t('avgSunbeds'), value: String(avg) },
          { label: t('peakSunbeds'), value: String(peak) },
          { label: t('bestDay'), value: peakRow ? String(peakRow.occupied) : '—', date: peakRow?.date },
        ],
        loading: occupancyLoading,
        empty: rows.every((r) => r.occupied === 0),
      }
    }
    if (trendMetric === 'occupancy') {
      // occupancy %
      const rows = occupancy?.rows ?? []
      const summary = occupancy?.summary
      const max = Math.max(...rows.map((r) => r.occupancyPct), 1)
      const peakRow = rows.find((r) => r.occupancyPct === summary?.peakOccupancyPct && r.occupancyPct > 0) ?? null
      return {
        bars: rows.map((r) => ({ date: r.date, value: r.occupancyPct, max })),
        fmt: (v: number) => `${Math.round(v)}%`,
        tiles: [
          { label: t('avgOccupancy'), value: summary ? `${summary.avgOccupancyPct}%` : '—' },
          { label: t('peakOccupancy'), value: summary ? `${summary.peakOccupancyPct}%` : '—' },
          { label: t('bestDay'), value: peakRow ? `${Math.round(peakRow.occupancyPct)}%` : '—', date: peakRow?.date },
        ],
        loading: occupancyLoading,
        empty: rows.every((r) => r.occupancyPct === 0),
      }
    }
    // revenue — channel-based (all takings: cash + qr + online)
    const rows = channelTrend?.rows ?? []
    const summary = channelTrend?.summary
    const bestDay = summary?.bestDay ?? null
    return {
      bars: rows,
      fmt: (v: number) => `€${v.toFixed(2)}`,
      tiles: [
        { label: t('revenue'), value: summary ? `€${summary.total.toFixed(2)}` : '—' },
        { label: t('bestDay'), value: bestDay ? `€${bestDay.total.toFixed(2)}` : '—', date: bestDay?.date },
      ],
      loading: channelLoading,
      empty: !summary || summary.total === 0,
    }
  }, [trendMetric, channelTrend, channelLoading, occupancy, occupancyLoading, t])

  // Build the invoice-register CSV client-side from fiscalReport.lines
  const downloadFiscalCsv = () => {
    if (!fiscalReport || !site?.id) return
    setFiscalDownloading(true)
    try {
      const header = [
        'Invoice number',
        'Date',
        'Type',
        'Description',
        'Net',
        'VAT rate',
        'VAT',
        'Gross',
        'Payment ref',
        'Reverse charge',
      ].join(',')

      const rows = fiscalReport.lines.map((line) => {
        const date = new Date(line.invoicedAt).toISOString().slice(0, 10)
        return [
          csvEscape(line.invoiceNumber),
          date,
          line.issuerType,
          csvEscape(line.description),
          line.net.toFixed(2),
          line.vatRate != null ? String(line.vatRate) : '0',
          line.vat.toFixed(2),
          line.gross.toFixed(2),
          csvEscape(line.paymentRef),
          line.reverseCharge ? 'yes' : 'no',
        ].join(',')
      })

      const csv = [header, ...rows].join('\n')
      const monthPad = String(selectedMonth).padStart(2, '0')
      const filename = `accounting-${site.id}-${selectedYear}-${monthPad}.csv`
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setFiscalDownloading(false)
    }
  }

  return (
    <div className="pt-2">
      {/* Header */}
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">{t('title')}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {t('subtitle')}
        </p>
      </div>

      {/* ── A · Resumen Diario (today's summary + parcel state) ─────────────────
          Revenue + sunbeds rented today (from last row of any opsTrend), plus
          a 5-chip Estado de la parcela row. Alonso-parity daily-summary card. */}
      <div className="mb-4 border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">{t('dailySummaryTitle')}</h3>
          {(opsTrendLoading || floorLoading) && (
            <CircularProgress size={16} sx={{ color: '#9ca3af' }} />
          )}
        </div>

        {/* Today's revenue + sunbeds rented */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-gray-500 font-medium">{t('dailySummaryTakings')}</div>
            <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
              {opsTrendLoading ? '—' : (todayOps ? `€${todayOps.revenue.toFixed(2)}` : '€0.00')}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium">{t('dailySummarySunbeds')}</div>
            <div className="text-2xl font-bold text-gray-900 mt-0.5 tabular-nums">
              {opsTrendLoading ? '—' : (todayOps ? todayOps.rentedSeats : 0)}
            </div>
          </div>
        </div>

        {/* Estado de la parcela — 5 chips */}
        <div className="border-t border-gray-100 pt-3">
          <div className="text-xs text-gray-500 font-medium mb-2">{t('parcelStateTitle')}</div>
          {floorLoading ? (
            <div className="flex gap-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-7 w-16 bg-gray-100 rounded-full animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200">
                <span className="text-xs font-semibold text-green-700 tabular-nums">{floorSnapshot?.libres ?? 0}</span>
                <span className="text-xs text-green-600">{t('parcelLibres')}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200">
                <span className="text-xs font-semibold text-blue-700 tabular-nums">{floorSnapshot?.alquiladas ?? 0}</span>
                <span className="text-xs text-blue-600">{t('parcelAlquiladas')}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200">
                <span className="text-xs font-semibold text-amber-700 tabular-nums">{floorSnapshot?.reservadas ?? 0}</span>
                <span className="text-xs text-amber-600">{t('parcelReservadas')}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200">
                <span className="text-xs font-semibold text-sky-700 tabular-nums">{floorSnapshot?.gratis ?? 0}</span>
                <span className="text-xs text-sky-600">{t('parcelGratis')}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 border border-gray-200">
                <span className="text-xs font-semibold text-gray-600 tabular-nums">{floorSnapshot?.desactivada ?? 0}</span>
                <span className="text-xs text-gray-500">{t('parcelDesactivada')}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Keep: recentTrend card — invoice-based rolling chart ──────────────── */}
      <div className="mb-6 border border-gray-200 rounded-lg bg-white p-4">
        {/* Card header: title + window selector */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">{t('recentTrend')}</h3>
          <div className="flex gap-1">
            {TREND_WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setTrendWindow(w)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  trendWindow === w
                    ? 'bg-accent text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {w === 365 ? '1y' : `${w}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Metric selector: Revenue / Sunbeds / Occupancy */}
        <div className="flex gap-1 mb-3">
          {TREND_METRICS.map((m) => (
            <button
              key={m}
              onClick={() => setTrendMetric(m)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                trendMetric === m
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t(`metric${m.charAt(0).toUpperCase()}${m.slice(1)}` as `metric${Capitalize<TrendMetric>}`)}
            </button>
          ))}
        </div>

        {trendViewModel.loading ? (
          <div className="flex justify-center py-8">
            <CircularProgress size={20} sx={{ color: '#9ca3af' }} />
          </div>
        ) : trendViewModel.empty ? (
          <div className="py-8 text-center text-sm text-gray-400">{t('noRevenueYet')}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {trendViewModel.tiles.map((tile) => (
                <div key={tile.label}>
                  <div className="text-xs text-gray-500 font-medium">{tile.label}</div>
                  <div className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums">{tile.value}</div>
                  {tile.date && (
                    <div className="text-[10px] text-gray-400">{formatDay(tile.date)}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Channel legend — revenue metric only */}
            {trendMetric === 'revenue' && (
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#16a34a' }} />
                  <span className="text-xs text-gray-500">{t('channelCash')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#2563eb' }} />
                  <span className="text-xs text-gray-500">{t('channelQr')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#111827' }} />
                  <span className="text-xs text-gray-500">{t('channelOnline')}</span>
                </div>
              </div>
            )}

            {/* Recharts bar chart — Y-axis scale + hover/touch tooltip */}
            <div className="h-48">
              <SafeResponsiveContainer width="100%" height="100%">
                <SafeBarChart
                  data={trendMetric === 'revenue' ? channelTrend?.rows ?? [] : trendViewModel.bars}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <SafeCartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <SafeXAxis
                    dataKey="date"
                    tickFormatter={(d: string) => formatDay(d)}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    axisLine={false}
                    tickLine={false}
                  />
                  <SafeYAxis
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    tickFormatter={(v: number) => trendMetric === 'revenue' ? `€${v}` : trendViewModel.fmt(v)}
                    width={48}
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
          </>
        )}

        {/* CSV export — revenue (channel) window */}
        {trendMetric === 'revenue' && channelTrend && channelTrend.rows.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
            <button
              onClick={downloadCsv}
              disabled={downloading}
              className="text-xs font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-50 transition-colors"
            >
              {downloading ? '…' : `↓ ${t('downloadCsv')}`}
            </button>
          </div>
        )}
      </div>

      {/* ── B+C · Desglose por Empleado — per-employee, day-scoped ──────────────
          Read-only. Employee rows sorted by € desc, each expandable to itemized
          rentals for the chosen day. Alonso's Cierre de caja + Desglose model. */}
      <div className="mb-6 border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-gray-800">{t('employeeCardTitle')}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <label htmlFor="employee-day-picker" className="text-xs text-gray-500 font-medium">
              {t('employeeDayPicker')}
            </label>
            <input
              id="employee-day-picker"
              type="date"
              max={todayIso}
              value={employeeDay}
              onChange={(e) => setEmployeeDay(e.target.value)}
              className="input text-sm py-1 px-2 h-8"
            />
          </div>
        </div>

        {shiftLoading ? (
          <div className="flex justify-center py-6">
            <CircularProgress size={18} sx={{ color: '#9ca3af' }} />
          </div>
        ) : !shiftItems || shiftItems.filter((s) => s.items.length > 0).length === 0 ? (
          <div className="px-4 py-4 text-sm text-gray-400">{t('employeeEmpty')}</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shiftItems
              .filter((s) => s.items.length > 0)
              .sort((a, b) => b.total - a.total)
              .map((shift) => {
                const isExpanded = expandedEmployees.has(shift.employeeId)
                return (
                  <li key={shift.employeeId}>
                    {/* Employee summary row */}
                    <button
                      type="button"
                      className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      onClick={() => toggleEmployee(shift.employeeId)}
                      aria-expanded={isExpanded}
                    >
                      <span className="flex items-center gap-1.5 text-sm text-gray-800 truncate">
                        <span className="text-gray-400 flex-shrink-0" aria-hidden="true">
                          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        </span>
                        {shift.name}
                        {!shift.active && (
                          <span className="ml-2 text-[11px] text-gray-400">{t('inactiveStaff')}</span>
                        )}
                      </span>
                      <span className="text-sm text-gray-700 tabular-nums whitespace-nowrap flex-shrink-0 ml-3">
                        <span className="font-semibold">€{shift.total.toFixed(2)}</span>
                        <span className="text-gray-400 ml-2">{t('staffSales', { count: shift.count })}</span>
                      </span>
                    </button>

                    {/* Itemized expansion */}
                    {isExpanded && (
                      <ul className="mx-4 mb-3 rounded-md border border-gray-100 bg-gray-50 overflow-hidden divide-y divide-gray-100">
                        {shift.items.map((item) => (
                          <li
                            key={item.reservationId}
                            className="flex items-center justify-between px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-700 truncate">
                                {item.seats.length > 0 ? item.seats.join(', ') : '—'}
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">
                                {formatTime(item.at)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  item.channel === 'cash'
                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                                }`}
                              >
                                {item.channel === 'cash' ? t('channelCash') : t('channelCard')}
                              </span>
                              <span className="text-xs font-semibold text-gray-900 tabular-nums">
                                €{item.amount.toFixed(2)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      {/* ── Month navigator ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <IconButton size="small" onClick={goToPrevMonth}>
          <ChevronLeftIcon />
        </IconButton>
        <h3 className="text-base font-semibold text-gray-800">
          {t(MONTH_KEYS[selectedMonth - 1])} {selectedYear}
        </h3>
        <IconButton
          size="small"
          onClick={goToNextMonth}
          disabled={selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1}
        >
          <ChevronRightIcon />
        </IconButton>
      </div>

      {/* Summary cards — all-source, takings-based */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">

        {/* Card 1: Revenue — total all-source + month-over-month delta */}
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('revenue')}</div>
          <div className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
            {monthlySummary === null ? '—' : `€${monthlySummary.current.total.toFixed(2)}`}
          </div>
          {monthlySummary !== null && (
            <>
              <div className="text-xs text-gray-400 mt-0.5">
                {t('salesCount', { count: monthlySummary.current.totalCount })}
              </div>
              {monthlySummary.prevTotal > 0 ? (() => {
                const delta = ((monthlySummary.current.total - monthlySummary.prevTotal) / monthlySummary.prevTotal) * 100
                const up = delta >= 0
                return (
                  <div className={`text-xs font-semibold mt-1 ${up ? 'text-green-600' : 'text-red-500'}`}>
                    {up ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}% <span className="font-normal text-gray-400">{t('vsLastMonth')}</span>
                  </div>
                )
              })() : (
                <div className="text-xs text-gray-400 mt-1">— <span>{t('vsLastMonth')}</span></div>
              )}
            </>
          )}
        </div>

        {/* Card 2: By source — sunbeds / rentals / orders */}
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('bySourceTitle')}</div>
          {monthlySummary === null ? (
            <div className="text-xl font-bold text-gray-900 mt-1">—</div>
          ) : (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <EventSeatIcon sx={{ fontSize: 13 }} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1">{t('sourceSunbeds')}</span>
                <span className="text-xs font-semibold text-gray-800 tabular-nums">€{monthlySummary.current.sunbeds.revenue.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <BeachAccessIcon sx={{ fontSize: 13 }} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1">{t('sourceRentals')}</span>
                <span className="text-xs font-semibold text-gray-800 tabular-nums">€{monthlySummary.current.rentals.revenue.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShoppingCartIcon sx={{ fontSize: 13 }} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 flex-1">{t('sourceOrders')}</span>
                <span className="text-xs font-semibold text-gray-800 tabular-nums">€{monthlySummary.current.orders.revenue.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 3: Refunds */}
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('refundsTitle')}</div>
          <div className={`text-xl font-bold mt-1 tabular-nums ${monthlySummary && monthlySummary.current.refunds.revenue > 0 ? 'text-red-500' : 'text-gray-900'}`}>
            {monthlySummary === null ? '—' : `€${monthlySummary.current.refunds.revenue.toFixed(2)}`}
          </div>
          {monthlySummary !== null && (
            <div className="text-xs text-gray-400 mt-0.5">
              {t('salesCount', { count: monthlySummary.current.refunds.count })}
            </div>
          )}
        </div>

        {/* Card 4: Turnover per bed — (sunbed revenue + F&B ordered from beds) ÷ bed
            capacity. RevPAR-style yield: reflects price × occupancy × on-bed spend. */}
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('turnoverPerBedTitle')}</div>
          <div className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
            {monthlySummary === null || monthlySummary.current.capacity === 0
              ? '—'
              : `€${((monthlySummary.current.sunbeds.revenue + monthlySummary.current.orders.bedLinkedRevenue) / monthlySummary.current.capacity).toFixed(2)}`
            }
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{t('turnoverPerBedHint')}</div>
        </div>

      </div>

      {/* ── Accounting export — for your accountant ──────────────────────────── */}
      <div className="mb-6 border border-gray-200 rounded-lg bg-white overflow-hidden">
        {/* Card header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-800">{t('accountingExportTitle')}</h3>
              <span className="text-xs text-gray-400 font-medium">
                {t(MONTH_KEYS[selectedMonth - 1])} {selectedYear}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{t('accountingExportSubtitle')}</p>
          </div>
          <button
            onClick={downloadFiscalCsv}
            disabled={fiscalDownloading || fiscalLoading || !fiscalReport || fiscalReport.count === 0}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {fiscalDownloading ? '…' : `↓ ${t('downloadCsvRegister')}`}
          </button>
        </div>

        {/* Card body */}
        {fiscalLoading ? (
          <div className="flex justify-center py-8">
            <CircularProgress size={20} sx={{ color: '#9ca3af' }} />
          </div>
        ) : !fiscalReport || fiscalReport.count === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400">{t('accountingExportEmpty')}</div>
        ) : (
          <div className="px-4 py-4 space-y-4">
            {/* Headline figures */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('payments')}</div>
                <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">{fiscalReport.count}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('gross')}</div>
                <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">€{fiscalReport.gross.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('net')}</div>
                <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">€{fiscalReport.net.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('vat')}</div>
                <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums">€{fiscalReport.vat.toFixed(2)}</div>
              </div>
            </div>

            {/* VAT by rate — the VAT-return input */}
            {fiscalReport.vatByRate.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 font-medium mb-1.5">{t('vatByRateTitle')}</div>
                <div className="border border-gray-100 rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-3 py-1.5 text-gray-500 font-medium">%</th>
                        <th className="text-right px-3 py-1.5 text-gray-500 font-medium">{t('net')}</th>
                        <th className="text-right px-3 py-1.5 text-gray-500 font-medium">{t('vat')}</th>
                        <th className="text-right px-3 py-1.5 text-gray-500 font-medium">{t('gross')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {fiscalReport.vatByRate.map((bucket) => (
                        <tr key={bucket.rate}>
                          <td className="px-3 py-1.5 text-gray-700 font-semibold tabular-nums">{bucket.rate}%</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums">€{bucket.net.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums">€{bucket.vat.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-700 tabular-nums">€{bucket.gross.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Platform commission, processing fees, refunds */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              {/* Platform commission */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t('platformCommissionLabel')}</span>
                  {fiscalReport.platformReverseCharge && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      {t('reverseChargeChip')}
                    </span>
                  )}
                </div>
                <span className="text-xs font-semibold text-gray-700 tabular-nums">
                  €{fiscalReport.platformCommission.toFixed(2)}
                </span>
              </div>

              {/* Processing fees */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('processingFeesLabel')}</span>
                <span className="text-xs font-semibold text-gray-700 tabular-nums">
                  €{fiscalReport.processingFees.toFixed(2)}
                </span>
              </div>

              {/* Refunds */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{t('refundsTitle')}</span>
                <span className={`text-xs font-semibold tabular-nums ${fiscalReport.refunds.amount > 0 ? 'text-red-500' : 'text-gray-700'}`}>
                  €{fiscalReport.refunds.amount.toFixed(2)}
                  {fiscalReport.refunds.count > 0 && (
                    <span className="text-gray-400 font-normal ml-1">
                      ({fiscalReport.refunds.count})
                    </span>
                  )}
                </span>
              </div>

              {/* Credit-note caveat */}
              <p className="text-[11px] text-gray-400 pt-1">{t('refundsNotCreditNotesHint')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

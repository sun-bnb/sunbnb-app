'use client'

import React from 'react'
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
import {
  RESERVATION_CANCELED,
  RESERVATION_PAYMENT_FAILED,
  RESERVATION_COMPLETE,
  RESERVATION_PAID_IN_CASH,
  OP_CHECKED_IN,
  OP_WALKED_IN,
} from '@repo/data/reservation-status'

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface UpcomingReservation {
  id: string
  siteName: string
  siteId: string
  from: string
  to: string
  status: string
  operationalStatus: string
  guestName: string | null
  itemCount: number
}

export interface ArrivingSoon {
  id: string
  siteName: string
  siteId: string
  from: string
  to: string
  guestName: string | null
  itemCount: number
}

export interface DashboardData {
  // Today
  /** Active seats the operator could sell today (`capacity − blocked`). */
  sellableInventory: number
  /** Seats out of service today — shown as context for why sellable < capacity. */
  blockedInventory: number
  /** Seats with a guest on them today (rented + comps). */
  occupiedSeats: number
  occupancyPct: number
  /** Guest parties (reservation ROWS) holding a seat today — the check-in denominator. */
  partiesToday: number
  checkedInCount: number
  pendingOrders: number
  hasFnb: boolean

  // Financial
  revenueToday: number
  revenueThisMonth: number
  revenueYearToDate: number
  feesYearToDate: number
  revenueHistory: { month: string; revenue: number; fees: number }[]

  // Activity
  cancellationPct: number
  arrivingSoon: ArrivingSoon[]
  upcomingReservations: UpcomingReservation[]
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-EU', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMonth(month: string) {
  const [y, m] = month.split('-')
  const date = new Date(Number(y), Number(m) - 1)
  return date.toLocaleString('en', { month: 'short' })
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function timeUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

/* ── Stat Card ─────────────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  subtitle,
  icon,
  accent,
}: {
  label: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${accent || 'bg-gray-100 text-gray-500'}`}>
          {icon}
        </span>
      </div>
      <span className="text-2xl font-semibold text-gray-900">{value}</span>
      {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
    </div>
  )
}

/* ── Occupancy bar ─────────────────────────────────────────────────────────── */

function OccupancyBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-gray-300'
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

/* ── Custom Tooltip ────────────────────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{formatMonth(label)}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-gray-500">{entry.name}</span>
          <span className="ml-auto font-medium text-gray-900">{formatCurrency(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Reservation status badge ──────────────────────────────────────────────── */

function StatusBadge({ status, opStatus, t }: { status: string; opStatus?: string; t: (key: string) => string }) {
  if (opStatus === OP_CHECKED_IN || opStatus === OP_WALKED_IN) {
    return (
      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
        {opStatus === OP_WALKED_IN ? t('statusWalkIn') : t('statusCheckedIn')}
      </span>
    )
  }

  const styles: Record<string, string> = {
    complete: 'bg-emerald-50 text-emerald-700',
    paid_in_cash: 'bg-emerald-50 text-emerald-700',
    pending: 'bg-amber-50 text-amber-700',
    processing: 'bg-blue-50 text-blue-600',
    payment_failed: 'bg-red-50 text-red-600',
    [RESERVATION_CANCELED]: 'bg-red-50 text-red-600',
  }

  const labels: Record<string, string> = {
    complete: t('statusPaid'),
    paid_in_cash: t('statusCash'),
    pending: t('statusPending'),
    processing: t('statusProcessing'),
    payment_failed: t('statusFailed'),
    [RESERVATION_CANCELED]: t('statusCanceled'),
  }

  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {labels[status] || status}
    </span>
  )
}

/* ── Icons (inline SVG) ────────────────────────────────────────────────────── */

const icons = {
  occupancy: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  ),
  checkIn: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  ),
  revenue: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ),
  orders: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  ),
  calendar: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  ),
}

/* ── Main View ─────────────────────────────────────────────────────────────── */

export default function DashboardView({ data }: { data: DashboardData }) {
  const t = useTranslations('Dashboard')

  const SafeResponsiveContainer = ResponsiveContainer as unknown as React.ComponentType<any>
  const SafeBarChart = BarChart as unknown as React.ComponentType<any>
  const SafeCartesianGrid = CartesianGrid as unknown as React.ComponentType<any>
  const SafeXAxis = XAxis as unknown as React.ComponentType<any>
  const SafeYAxis = YAxis as unknown as React.ComponentType<any>
  const SafeTooltip = Tooltip as unknown as React.ComponentType<any>
  const SafeBar = Bar as unknown as React.ComponentType<any>

  const chartData = data.revenueHistory.map(d => ({
    ...d,
    label: formatMonth(d.month),
    net: d.revenue - d.fees,
  }))

  const availableSpots = data.sellableInventory - data.occupiedSeats

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* ── Today's Snapshot ──────────────────────────────────────────────────── */}

      <div className={`grid gap-4 mb-6 ${data.hasFnb ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-3'}`}>

        {/* Occupancy */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('occupancy')}</span>
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600">
              {icons.occupancy}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-gray-900">{data.occupancyPct}%</span>
            <span className="text-sm text-gray-400">
              {data.occupiedSeats}/{data.sellableInventory}
            </span>
          </div>
          <OccupancyBar pct={data.occupancyPct} />
          <span className="text-xs text-gray-400">
            {availableSpots > 0
              ? t('spotsAvailable', { count: availableSpots })
              : t('fullyBooked')}
            {data.blockedInventory > 0 && (
              <> &middot; {t('outOfService', { count: data.blockedInventory })}</>
            )}
          </span>
        </div>

        {/* Check-ins */}
        <StatCard
          label={t('checkIns')}
          value={`${data.checkedInCount}/${data.partiesToday}`}
          subtitle={data.partiesToday > 0
            ? t('arrivedPct', { pct: Math.round((data.checkedInCount / data.partiesToday) * 100) })
            : t('noReservationsToday')}
          icon={icons.checkIn}
          accent="bg-amber-50 text-amber-600"
        />

        {/* Revenue today */}
        <StatCard
          label={t('revenueToday')}
          value={formatCurrency(data.revenueToday)}
          subtitle={t('mtd', { amount: formatCurrency(data.revenueThisMonth) })}
          icon={icons.revenue}
          accent="bg-emerald-50 text-emerald-600"
        />

        {/* Active orders (only if site has F&B) */}
        {data.hasFnb && (
          <StatCard
            label={t('activeOrders')}
            value={data.pendingOrders}
            subtitle={data.pendingOrders > 0 ? t('needAttention') : t('allClear')}
            icon={icons.orders}
            accent={data.pendingOrders > 0 ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'}
          />
        )}
      </div>

      {/* ── Arriving Soon ──────────────────────────────────────────────────────── */}

      {data.arrivingSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-sm font-semibold text-amber-900">{t('arrivingSoon')}</h2>
            <span className="text-xs text-amber-600 ml-auto">{t('expectedSoon', { count: data.arrivingSoon.length })}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.arrivingSoon.map((r) => (
              <Link
                key={r.id}
                href={`/reservations/${r.id}`}
                className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 hover:shadow-sm transition-shadow"
              >
                <div className="flex-shrink-0 text-center w-10">
                  <span className="text-sm font-semibold text-amber-700">{timeUntil(r.from)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{r.guestName || 'Guest'}</p>
                  <p className="text-xs text-gray-400">{formatTime(r.from)} · {t('items', { count: r.itemCount })}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Revenue Chart + Upcoming ───────────────────────────────────────────── */}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* Revenue chart */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{t('revenueAndFees')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('last5Months')}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-900" /> {t('revenue')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> {t('fees')}
              </span>
            </div>
          </div>

          {/* YTD callout */}
          <div className="mb-4 flex items-baseline gap-4">
            <div className="px-3 py-2 bg-gray-50 rounded-lg inline-flex items-baseline gap-2">
              <span className="text-xs text-gray-500">{t('ytdGross')}</span>
              <span className="text-lg font-semibold text-gray-900">{formatCurrency(data.revenueYearToDate)}</span>
            </div>
            <div className="px-3 py-2 bg-gray-50 rounded-lg inline-flex items-baseline gap-2">
              <span className="text-xs text-gray-500">{t('ytdNet')}</span>
              <span className="text-lg font-semibold text-emerald-700">{formatCurrency(data.revenueYearToDate - data.feesYearToDate)}</span>
            </div>
          </div>

          <div className="h-[220px]">
            <SafeResponsiveContainer width="100%" height="100%">
              <SafeBarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <SafeCartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <SafeXAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                />
                <SafeYAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                  tickFormatter={(v: number) => `€${v}`}
                />
                <SafeTooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                <SafeBar dataKey="revenue" name={t('revenue')} fill="#111827" radius={[4, 4, 0, 0]} barSize={24} />
                <SafeBar dataKey="fees" name={t('fees')} fill="#f87171" radius={[4, 4, 0, 0]} barSize={24} />
              </SafeBarChart>
            </SafeResponsiveContainer>
          </div>

          {/* Cancellation rate footnote */}
          {data.cancellationPct > 0 && (
            <p className="text-xs text-red-400 mt-3">
              {t('cancellationRate', { pct: data.cancellationPct })}
            </p>
          )}
        </div>

        {/* Upcoming reservations */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">{t('upcoming')}</h2>
            <span className="text-xs text-gray-400">{t('upcomingCount', { count: data.upcomingReservations.length })}</span>
          </div>

          {data.upcomingReservations.length > 0 ? (
            <div className="flex-1 overflow-y-auto -mx-2 space-y-1">
              {data.upcomingReservations.map((r) => (
                <Link
                  key={r.id}
                  href={`/reservations/${r.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {/* Date pill */}
                  <div className="flex-shrink-0 w-11 h-11 rounded-lg bg-gray-100 flex flex-col items-center justify-center">
                    <span className="text-[10px] leading-none text-gray-400 uppercase">
                      {new Date(r.from).toLocaleString('en', { month: 'short' })}
                    </span>
                    <span className="text-sm font-semibold text-gray-900 leading-tight">
                      {new Date(r.from).getDate()}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{r.guestName || r.siteName}</p>
                    <p className="text-xs text-gray-400">
                      {formatTime(r.from)}–{formatTime(r.to)} · {t('items', { count: r.itemCount })}
                    </p>
                  </div>

                  <StatusBadge status={r.status} opStatus={r.operationalStatus} t={t} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-gray-400">{t('noUpcomingReservations')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

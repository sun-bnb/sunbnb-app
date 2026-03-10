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
import { RESERVATION_CANCELED } from '@repo/data/reservation-status'

export interface UpcomingReservation {
  id: string
  siteName: string
  siteId: string
  from: string
  to: string
  status: string
  itemCount: number
}

export interface DashboardData {
  totalSites: number
  totalChairs: number
  reservationsToday: number
  revenueThisMonth: number
  revenueYearToDate: number
  revenueHistory: { month: string; revenue: number; fees: number }[]
  upcomingReservations: UpcomingReservation[]
}

/* ── Helpers ───────────────────────────────────────────────── */

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

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short' })
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/* ── Stat Card ─────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{label}</span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent || 'bg-gray-100 text-gray-500'}`}>
          {icon}
        </span>
      </div>
      <span className="text-2xl font-semibold text-gray-900">{value}</span>
    </div>
  )
}

/* ── Custom Tooltip ────────────────────────────────────────── */

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-700 mb-1">{formatMonth(label)}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-gray-500">{entry.name}</span>
          <span className="ml-auto font-medium text-gray-900">€{Number(entry.value).toFixed(0)}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Reservation status badge ──────────────────────────────── */

function ReservationStatus({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700',
    pending: 'bg-amber-50 text-amber-700',
    [RESERVATION_CANCELED]: 'bg-red-50 text-red-600',
  }
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

/* ── Main View ─────────────────────────────────────────────── */

export default function DashboardView({ data }: { data: DashboardData }) {

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

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overview of your business</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Sites"
          value={data.totalSites}
          accent="bg-blue-50 text-blue-600"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21" />
            </svg>
          }
        />
        <StatCard
          label="Inventory"
          value={data.totalChairs}
          accent="bg-violet-50 text-violet-600"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5M10.5 21V8.94a.75.75 0 0 0-.82-.747l-7.5.856A.75.75 0 0 0 1.5 9.848V21" />
            </svg>
          }
        />
        <StatCard
          label="Today"
          value={data.reservationsToday}
          accent="bg-amber-50 text-amber-600"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
          }
        />
        <StatCard
          label="Revenue MTD"
          value={formatCurrency(data.revenueThisMonth)}
          accent="bg-emerald-50 text-emerald-600"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
            </svg>
          }
        />
      </div>

      {/* Two-column: Chart + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Revenue chart */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Revenue & Fees</h2>
              <p className="text-xs text-gray-400 mt-0.5">Last 5 months</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-gray-900" /> Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> Fees
              </span>
            </div>
          </div>

          {/* YTD callout */}
          <div className="mb-4 px-3 py-2.5 bg-gray-50 rounded-lg inline-flex items-baseline gap-2">
            <span className="text-xs text-gray-500">Year to date</span>
            <span className="text-lg font-semibold text-gray-900">{formatCurrency(data.revenueYearToDate)}</span>
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
                <SafeBar dataKey="revenue" name="Revenue" fill="#111827" radius={[4, 4, 0, 0]} barSize={24} />
                <SafeBar dataKey="fees" name="Fees" fill="#f87171" radius={[4, 4, 0, 0]} barSize={24} />
              </SafeBarChart>
            </SafeResponsiveContainer>
          </div>
        </div>

        {/* Upcoming reservations */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Upcoming</h2>
            <span className="text-xs text-gray-400">{data.upcomingReservations.length} reservations</span>
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
                    <p className="text-sm text-gray-900 truncate">{r.siteName}</p>
                    <p className="text-xs text-gray-400">
                      {formatTime(r.from)}–{formatTime(r.to)} · {r.itemCount} {r.itemCount === 1 ? 'item' : 'items'}
                    </p>
                  </div>

                  <ReservationStatus status={r.status} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-gray-400">No upcoming reservations</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useMemo } from 'react'
import IconButton from '@mui/material/IconButton'
import Collapse from '@mui/material/Collapse'
import CircularProgress from '@mui/material/CircularProgress'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import EventSeatIcon from '@mui/icons-material/EventSeat'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { useTranslations } from 'next-intl'

import { useSite } from '@/app/sites/site-context'
import { getPaidItemsByMonth, getRevenueTrend, getOccupancyTrend, getRevenueCsv, getStaffTill } from './actions'
import { formatSeat } from '@repo/data/seat-label'

const MONTH_KEYS = ['january','february','march','april','may','june','july','august','september','october','november','december'] as const
const TREND_WINDOWS = [7, 30, 365] as const

interface DailyRevenue { date: string; revenue: number; count: number }
interface RevenueTrend {
  rows: DailyRevenue[]
  summary: { totalRevenue: number; totalCount: number; bestDay: DailyRevenue | null }
}
interface DailyOccupancy { date: string; capacity: number; occupied: number; comps: number; occupancyPct: number }
interface OccupancyTrend {
  rows: DailyOccupancy[]
  summary: { avgOccupancyPct: number; peakOccupancyPct: number; totalComps: number }
}
interface EmployeeTill { employeeId: string; name: string; active: boolean; total: number; count: number }

export default function AccountingView() {
  const { site } = useSite()
  const t = useTranslations('SiteAccounting')

  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [paidItems, setPaidItems] = useState<{ orders: any[]; reservations: any[] }>({
    orders: [],
    reservations: [],
  })

  // Expand sections
  const [ordersExpanded, setOrdersExpanded] = useState(true)
  const [reservationsExpanded, setReservationsExpanded] = useState(true)

  // Rolling-window revenue trend (operational pulse, alongside the monthly view)
  const [trendWindow, setTrendWindow] = useState<(typeof TREND_WINDOWS)[number]>(30)
  const [trend, setTrend] = useState<RevenueTrend | null>(null)
  const [trendLoading, setTrendLoading] = useState(true)
  const [occupancy, setOccupancy] = useState<OccupancyTrend | null>(null)
  const [occupancyLoading, setOccupancyLoading] = useState(true)

  // Per-employee floor cash for the selected month (null until loaded; empty
  // array ⇒ the account has no staff roster → the card stays hidden).
  const [staffTill, setStaffTill] = useState<EmployeeTill[] | null>(null)

  useEffect(() => {
    if (!site?.id) return
    setLoading(true)
    getPaidItemsByMonth(site.id, selectedYear, selectedMonth).then((data) => {
      setPaidItems(data)
      setLoading(false)
    })
    getStaffTill(site.id, selectedYear, selectedMonth).then(setStaffTill)
  }, [selectedYear, selectedMonth, site?.id])

  useEffect(() => {
    if (!site?.id) return
    setTrendLoading(true)
    getRevenueTrend(site.id, trendWindow).then((data) => {
      setTrend(data)
      setTrendLoading(false)
    })
    setOccupancyLoading(true)
    getOccupancyTrend(site.id, trendWindow).then((data) => {
      setOccupancy(data)
      setOccupancyLoading(false)
    })
  }, [site?.id, trendWindow])

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

  // Summary totals
  const orderTotal = useMemo(() =>
    paidItems.orders.reduce((s, o) => s + (o.invoices?.[0]?.totalAmount || 0), 0),
    [paidItems.orders]
  )
  const reservationTotal = useMemo(() =>
    paidItems.reservations.reduce((s, r) => s + (r.invoices?.[0]?.totalAmount || 0), 0),
    [paidItems.reservations]
  )
  const grandTotal = orderTotal + reservationTotal
  const totalTax = useMemo(() => {
    const orderTax = paidItems.orders.reduce((s, o) => s + (o.invoices?.[0]?.totalTax || 0), 0)
    const resTax = paidItems.reservations.reduce((s, r) => s + (r.invoices?.[0]?.totalTax || 0), 0)
    return orderTax + resTax
  }, [paidItems])
  const totalTransactions = paidItems.orders.length + paidItems.reservations.length

  const formatDate = (d: string | Date) => {
    const date = new Date(d)
    return date.toLocaleDateString('default', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }
  const formatDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('default', { day: 'numeric', month: 'short' })

  // Plain figures export — serialized server-side (the analytics module pulls
  // prisma, so it must not enter the client bundle), downloaded client-side.
  const [downloading, setDownloading] = useState(false)
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

  return (
    <div className="pt-2">
      {/* Header */}
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">{t('title')}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {t('subtitle')}
        </p>
      </div>

      {/* Recent trend — rolling-window pulse alongside the monthly view below */}
      <div className="mb-6 border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center justify-between mb-3">
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

        {trendLoading || !trend ? (
          <div className="flex justify-center py-8">
            <CircularProgress size={20} sx={{ color: '#9ca3af' }} />
          </div>
        ) : trend.summary.totalCount === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">{t('noRevenueYet')}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('revenue')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">€{trend.summary.totalRevenue.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('sales')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">{trend.summary.totalCount}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('bestDay')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">
                  {trend.summary.bestDay ? `€${trend.summary.bestDay.revenue.toFixed(2)}` : '—'}
                </div>
                {trend.summary.bestDay && (
                  <div className="text-[10px] text-gray-400">{formatDay(trend.summary.bestDay.date)}</div>
                )}
              </div>
            </div>

            {/* Daily revenue bars (height ∝ revenue) */}
            <div className="flex items-end gap-px h-20" aria-hidden="true">
              {(() => {
                const max = Math.max(...trend.rows.map((r) => r.revenue), 1)
                return trend.rows.map((r) => (
                  <div
                    key={r.date}
                    className="flex-1 bg-accent/70 rounded-sm min-h-[2px]"
                    style={{ height: `${(r.revenue / max) * 100}%` }}
                    title={`${formatDay(r.date)}: €${r.revenue.toFixed(2)}`}
                  />
                ))
              })()}
            </div>
          </>
        )}

        {/* Occupancy — visible even with zero revenue (comps/blocks carry none) */}
        {!occupancyLoading && occupancy && occupancy.rows.some((r) => r.capacity > 0) && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('occupancy')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">{occupancy.summary.avgOccupancyPct}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('peak')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">{occupancy.summary.peakOccupancyPct}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('comps')}</div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">{occupancy.summary.totalComps}</div>
              </div>
            </div>

            {/* Daily occupancy bars (height = occupancy %) */}
            <div className="flex items-end gap-px h-16" aria-hidden="true">
              {occupancy.rows.map((r) => (
                <div
                  key={r.date}
                  className="flex-1 bg-purple-400/70 rounded-sm min-h-[2px]"
                  style={{ height: `${Math.min(100, r.occupancyPct)}%` }}
                  title={`${formatDay(r.date)}: ${r.occupancyPct}%${r.comps > 0 ? ` · ${r.comps} comp` : ''}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Plain figures export */}
        {trend && trend.rows.length > 0 && (
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

      {/* Month navigator */}
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

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('revenue')}</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {loading ? '—' : `€${grandTotal.toFixed(2)}`}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {loading ? '' : t('transactions', { count: totalTransactions })}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('taxCollected')}</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {loading ? '—' : `€${totalTax.toFixed(2)}`}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {loading ? '' : t('netAmount', { amount: (grandTotal - totalTax).toFixed(2) })}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">{t('breakdown')}</div>
          <div className="flex items-baseline gap-1 mt-1">
            <ShoppingCartIcon sx={{ fontSize: 14 }} className="text-blue-500" />
            <span className="text-sm font-semibold text-gray-800">€{loading ? '—' : orderTotal.toFixed(2)}</span>
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <EventSeatIcon sx={{ fontSize: 14 }} className="text-green-500" />
            <span className="text-sm font-semibold text-gray-800">€{loading ? '—' : reservationTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Staff cash till — per-worker floor cash (walk-ins + cash rentals) for the
          selected month. Hidden when the account has no roster, so single-operator
          venues see nothing. Read-only retrospective; the manage-page till is live. */}
      {staffTill && staffTill.length > 0 && (() => {
        const withCash = staffTill.filter(w => w.count > 0).sort((a, b) => b.total - a.total)
        const monthTotal = withCash.reduce((s, w) => s + w.total, 0)
        return (
          <div className="mb-6 border border-gray-200 rounded-lg bg-white p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-800">{t('staffTill')}</h3>
              <span className="text-sm font-bold text-gray-900 tabular-nums">€{monthTotal.toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">{t('staffTillHint')}</p>
            {withCash.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">{t('noStaffCash')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {withCash.map(w => (
                  <li key={w.employeeId} className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-800 truncate">
                      {w.name}
                      {!w.active && <span className="ml-2 text-[11px] text-gray-400">{t('inactiveStaff')}</span>}
                    </span>
                    <span className="text-sm text-gray-700 tabular-nums whitespace-nowrap">
                      <span className="font-semibold">€{w.total.toFixed(2)}</span>
                      <span className="text-gray-400 ml-2">{t('staffSales', { count: w.count })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })()}

      {loading ? (
        <div className="flex justify-center py-12">
          <CircularProgress size={24} sx={{ color: '#9ca3af' }} />
        </div>
      ) : totalTransactions === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <ReceiptLongIcon sx={{ fontSize: 48, mb: 1, color: '#d1d5db' }} />
          <p className="text-sm">{t('noTransactions')}</p>
        </div>
      ) : (
        <>
          {/* Orders section */}
          {paidItems.orders.length > 0 && (
            <div className="mb-4">
              <button
                className="flex items-center gap-2 w-full text-left py-2"
                onClick={() => setOrdersExpanded(!ordersExpanded)}
              >
                <ShoppingCartIcon sx={{ fontSize: 16 }} className="text-blue-500" />
                <span className="text-sm font-semibold text-gray-700">
                  {t('productOrders', { count: paidItems.orders.length })}
                </span>
                {ordersExpanded ? <ExpandLessIcon fontSize="small" className="text-gray-400" /> : <ExpandMoreIcon fontSize="small" className="text-gray-400" />}
              </button>
              <Collapse in={ordersExpanded}>
                <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                  {paidItems.orders.map((order, idx) => (
                    <div
                      key={order.id}
                      className={`flex items-center justify-between px-4 py-3 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-800">
                          {order.orderItems?.map((oi: any) => oi.name).join(', ') || 'Order'}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {formatDate(order.createdAt)}
                          {order.user?.email && <span className="ml-2">· {order.user.email}</span>}
                          {order.seat?.number != null && <span className="ml-2">· {t('seat')} #{formatSeat(order.seat, { parcel: true })}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <div className="text-sm font-semibold text-gray-900">€{order.invoices?.[0]?.totalAmount?.toFixed(2)}</div>
                        {(order.invoices?.[0]?.totalTax ?? 0) > 0 && (
                          <div className="text-xs text-gray-400">{t('taxAmount', { amount: order.invoices[0].totalTax.toFixed(2) })}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Collapse>
            </div>
          )}

          {/* Reservations section */}
          {paidItems.reservations.length > 0 && (
            <div className="mb-4">
              <button
                className="flex items-center gap-2 w-full text-left py-2"
                onClick={() => setReservationsExpanded(!reservationsExpanded)}
              >
                <EventSeatIcon sx={{ fontSize: 16 }} className="text-green-500" />
                <span className="text-sm font-semibold text-gray-700">
                  {t('reservationsCount', { count: paidItems.reservations.length })}
                </span>
                {reservationsExpanded ? <ExpandLessIcon fontSize="small" className="text-gray-400" /> : <ExpandMoreIcon fontSize="small" className="text-gray-400" />}
              </button>
              <Collapse in={reservationsExpanded}>
                <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                  {paidItems.reservations.map((res, idx) => (
                    <div
                      key={res.id}
                      className={`flex items-center justify-between px-4 py-3 ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-800">
                          {res.type === 'hours' ? t('hourly') : t('daily')} reservation
                          {res.items?.length > 0 && (
                            <span className="text-gray-500">
                              {' '}· {res.items.length > 1 ? t('seats') : t('seat')} {res.items.map((i: any) => `#${formatSeat(i, { parcel: true })}`).join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {formatDate(res.from)} — {formatDate(res.to)}
                          {res.user?.email && <span className="ml-2">· {res.user.email}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <div className="text-sm font-semibold text-gray-900">€{res.invoices?.[0]?.totalAmount?.toFixed(2)}</div>
                        {(res.invoices?.[0]?.totalTax ?? 0) > 0 && (
                          <div className="text-xs text-gray-400">{t('taxAmount', { amount: res.invoices[0].totalTax.toFixed(2) })}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Collapse>
            </div>
          )}
        </>
      )}
    </div>
  )
}

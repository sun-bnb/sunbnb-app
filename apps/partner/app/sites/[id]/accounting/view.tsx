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

import { useSite } from '@/app/sites/site-context'
import { getPaidItemsByMonth } from './actions'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function AccountingView() {
  const { site } = useSite()

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

  useEffect(() => {
    if (!site?.id) return
    setLoading(true)
    getPaidItemsByMonth(site.id, selectedYear, selectedMonth).then((data) => {
      setPaidItems(data)
      setLoading(false)
    })
  }, [selectedYear, selectedMonth, site?.id])

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

  return (
    <div className="container mx-auto p-4">
      {/* Header */}
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">Accounting</h2>
        <p className="text-sm text-gray-500 mt-1">
          Track revenue from reservations and product orders.
        </p>
      </div>

      {/* Month navigator */}
      <div className="flex items-center justify-between mb-4">
        <IconButton size="small" onClick={goToPrevMonth}>
          <ChevronLeftIcon />
        </IconButton>
        <h3 className="text-base font-semibold text-gray-800">
          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
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
          <div className="text-xs text-gray-500 font-medium">Revenue</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {loading ? '—' : `€${grandTotal.toFixed(2)}`}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {loading ? '' : `${totalTransactions} transaction${totalTransactions !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">Tax collected</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {loading ? '—' : `€${totalTax.toFixed(2)}`}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {loading ? '' : `Net: €${(grandTotal - totalTax).toFixed(2)}`}
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg bg-white p-3">
          <div className="text-xs text-gray-500 font-medium">Breakdown</div>
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

      {loading ? (
        <div className="flex justify-center py-12">
          <CircularProgress size={24} sx={{ color: '#9ca3af' }} />
        </div>
      ) : totalTransactions === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <ReceiptLongIcon sx={{ fontSize: 48, mb: 1, color: '#d1d5db' }} />
          <p className="text-sm">No transactions this month</p>
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
                  Product orders ({paidItems.orders.length})
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
                          {order.seat?.number != null && <span className="ml-2">· Seat #{String(order.seat.number).padStart(4, '0')}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <div className="text-sm font-semibold text-gray-900">€{order.invoices?.[0]?.totalAmount?.toFixed(2)}</div>
                        {(order.invoices?.[0]?.totalTax ?? 0) > 0 && (
                          <div className="text-xs text-gray-400">tax €{order.invoices[0].totalTax.toFixed(2)}</div>
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
                  Reservations ({paidItems.reservations.length})
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
                          {res.type === 'hours' ? 'Hourly' : 'Daily'} reservation
                          {res.items?.length > 0 && (
                            <span className="text-gray-500">
                              {' '}· Seat{res.items.length > 1 ? 's' : ''} {res.items.map((i: any) => `#${String(i.number).padStart(4, '0')}`).join(', ')}
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
                          <div className="text-xs text-gray-400">tax €{res.invoices[0].totalTax.toFixed(2)}</div>
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

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

import { RestaurantSubNav } from '../RestaurantSubNav'
import { RestaurantHeader } from '../RestaurantHeader'
import { getRestaurantTabInvoicesByMonth, type RestaurantTabInvoiceEntry } from './actions'

// Month names + net/vat/gross/payments/table labels are shared 1:1 with the
// site accounting page's dine-in tabs table — reused via the SiteAccounting
// namespace rather than duplicating the copy across three locale files.
const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const

/**
 * Minimal restaurant accounting page (dine-in v2 Phase 6) — month picker +
 * dine-in tab invoice table + revenue/VAT totals. No charts, no fiscal
 * export, no per-employee till — those stay site-only for now. Modeled on
 * the "Dine-in tabs" card in sites/[id]/accounting/view.tsx.
 */
/** Cash vs online payment chip (status colours: green = cash, blue = paid online). */
function PaymentBadge({ isCash, label }: { isCash: boolean; label: string }) {
  return (
    <span
      className={`badge border ${
        isCash
          ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-blue-50 text-blue-700 border-blue-200'
      }`}
    >
      {label}
    </span>
  )
}

export default function AccountingView({ restaurantId }: { restaurantId: string }) {
  const t = useTranslations('RestaurantAccounting')
  const ts = useTranslations('SiteAccounting')

  const now = useMemo(() => new Date(), [])
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [invoices, setInvoices] = useState<RestaurantTabInvoiceEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getRestaurantTabInvoicesByMonth(restaurantId, selectedMonth, selectedYear)
    if (res.status === 'ok') {
      setInvoices(res.invoices)
      setErrors([])
    } else {
      setInvoices([])
      setErrors(res.errors)
    }
    setLoading(false)
  }, [restaurantId, selectedMonth, selectedYear])

  useEffect(() => {
    load()
  }, [load])

  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1)
      setSelectedMonth(12)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }
  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1)
      setSelectedMonth(1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1

  // Revenue/VAT totals — same net/tax/gross field mapping as the site
  // accounting tabs card (totalCharge=NET, totalTax=VAT, totalAmount=GROSS).
  const totals = useMemo(() => {
    const list = invoices ?? []
    return {
      count: list.length,
      net: list.reduce((s, inv) => s + inv.totalCharge, 0),
      vat: list.reduce((s, inv) => s + inv.totalTax, 0),
      gross: list.reduce((s, inv) => s + inv.totalAmount, 0),
    }
  }, [invoices])

  // Per-row display values, shared by the phone card list and the sm+ table.
  // Tab invoice semantics (processConfirmedTabPayment):
  // totalCharge = NET base, totalTax = VAT, totalAmount = GROSS.
  const rows = (invoices ?? []).map((inv) => {
    const tab = inv.tableTab
    const fmt = (d: Date | string) =>
      new Date(d).toLocaleDateString('default', { day: 'numeric', month: 'short' })
    return {
      id: inv.id,
      isCash: tab?.status === 'settled_cash',
      tableLabel: tab
        ? `${ts('tabTableLabel')} ${tab.table.number}${tab.table.label ? ` · ${tab.table.label}` : ''}`
        : '—',
      closedDate: tab?.closedAt ? fmt(tab.closedAt) : inv.invoicedAt ? fmt(inv.invoicedAt) : '—',
      net: inv.totalCharge,
      tax: inv.totalTax,
      gross: inv.totalAmount,
    }
  })

  return (
    <div className="pt-2">
      <RestaurantSubNav restaurantId={restaurantId} active="accounting" />
      <div className="py-4 space-y-4">
        <RestaurantHeader restaurantId={restaurantId} />

        <div>
          <h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('hint')}</p>
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {errors.join(', ')}
          </div>
        )}

        {/* Phone → md: month navigator, totals, invoices stacked. lg+: the
            navigator + totals become an 18rem side column (totals stacked
            1-up) beside the invoice table, which gets the remaining width. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
        {/* ── Month navigator ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <IconButton onClick={goToPrevMonth}>
            <ChevronLeftIcon />
          </IconButton>
          <h3 className="text-base font-semibold text-gray-800">
            {ts(MONTH_KEYS[selectedMonth - 1]!)} {selectedYear}
          </h3>
          <IconButton onClick={goToNextMonth} disabled={isCurrentMonth}>
            <ChevronRightIcon />
          </IconButton>
        </div>

        {/* ── Revenue/VAT summary cards ───────────────────────────────────── */}
        {/* Phone: one row per total (label left, value right) — three € figures
            at text-xl don't fit 3-up in ~100px columns. sm+: the 3-up grid. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-1">
          <div className="flex items-baseline justify-between gap-3 border border-gray-200 rounded-lg bg-white p-3 sm:block">
            <div className="text-xs text-gray-500 font-medium">{ts('net')}</div>
            <div className="text-lg font-bold text-gray-900 tabular-nums sm:mt-1 sm:text-xl">
              {loading ? '—' : `€${totals.net.toFixed(2)}`}
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-3 border border-gray-200 rounded-lg bg-white p-3 sm:block">
            <div className="text-xs text-gray-500 font-medium">{ts('vat')}</div>
            <div className="text-lg font-bold text-gray-900 tabular-nums sm:mt-1 sm:text-xl">
              {loading ? '—' : `€${totals.vat.toFixed(2)}`}
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-3 border border-gray-200 rounded-lg bg-white p-3 sm:block">
            <div>
              <div className="text-xs text-gray-500 font-medium">{ts('gross')}</div>
              {!loading && (
                <div className="text-xs text-gray-400 mt-0.5 sm:hidden">
                  {ts('salesCount', { count: totals.count })}
                </div>
              )}
            </div>
            <div className="text-lg font-bold text-gray-900 tabular-nums sm:mt-1 sm:text-xl">
              {loading ? '—' : `€${totals.gross.toFixed(2)}`}
            </div>
            {!loading && (
              <div className="hidden text-xs text-gray-400 mt-0.5 sm:block">
                {ts('salesCount', { count: totals.count })}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* ── Invoice table ────────────────────────────────────────────────── */}
        <div className="min-w-0 border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-gray-800">{ts('tabsGroupTitle')}</h3>
            {loading && <CircularProgress size={16} sx={{ color: '#9ca3af' }} />}
          </div>

          {loading ? (
            <div className="flex justify-center py-6">
              <CircularProgress size={18} sx={{ color: '#9ca3af' }} />
            </div>
          ) : !invoices || invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <p className="text-sm font-medium">{t('empty')}</p>
            </div>
          ) : (
            <>
              {/* Phone: one card per invoice — six columns don't fit 360px. */}
              <ul className="divide-y divide-gray-100 sm:hidden">
                {rows.map((row) => (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-800">{row.tableLabel}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>{row.closedDate}</span>
                          <PaymentBadge isCash={row.isCash} label={row.isCash ? ts('tabStatusCash') : ts('tabStatusPaid')} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-gray-900 tabular-nums">€{row.gross.toFixed(2)}</div>
                        <div className="mt-1 text-xs text-gray-500 tabular-nums">
                          {ts('net')} €{row.net.toFixed(2)} · {ts('vat')} €{row.tax.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-xs lg:text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">{ts('tabTableLabel')}</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">{ts('tabClosedAt')}</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">{ts('payments')}</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">{ts('net')}</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">{ts('vat')}</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">{ts('gross')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{row.tableLabel}</td>
                        <td className="px-4 py-2.5 text-gray-500">{row.closedDate}</td>
                        <td className="px-4 py-2.5">
                          <PaymentBadge isCash={row.isCash} label={row.isCash ? ts('tabStatusCash') : ts('tabStatusPaid')} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">€{row.net.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">€{row.tax.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-900 font-semibold tabular-nums">€{row.gross.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}

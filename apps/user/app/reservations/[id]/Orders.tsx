'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Invoice } from '@/app/types/types'

const statusStyle: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700',
  paid:      'bg-emerald-50 text-emerald-700',
  complete:  'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
}

interface OrderData {
  id: string
  createdAt: Date
  totalPrice: number
  status: string
  orderItems: {
    id: string
    name: string
    quantity: number
    price: number
    tax: number
    totalPrice: number
  }[]
  invoices?: Invoice[]
}

export default function Orders({ orders, reservationId }: { orders: OrderData[], reservationId: string }) {
  const { data: session } = useSession()
  const [anonId, setAnonId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = orders.find(o => o.id === selectedId) ?? null

  useEffect(() => {
    if (!session?.user?.id) {
      const stored = localStorage.getItem('sunbnb-anonId')
      setAnonId(stored)
    }
  }, [session?.user?.id])

  /** Append anonId for anonymous users */
  const receiptUrl = (base: string) => {
    if (session?.user?.id) return base
    return anonId ? `${base}&anonId=${anonId}` : base
  }

  /* ── Detail view ── */

  if (selected) {
    const hasInvoice = !!(selected.invoices && selected.invoices.length > 0)

    // Use the PARTNER invoice for product lines and PLATFORM invoice for service fee
    const partnerInvoice = selected.invoices?.find(i => i.issuerType === 'PARTNER')
    const platformInvoice = selected.invoices?.find(i => i.issuerType === 'PLATFORM')
    const displayInvoice = partnerInvoice ?? selected.invoices?.[0]

    const rows = hasInvoice && displayInvoice
      ? [
          ...displayInvoice.invoiceLines.map(l => ({
            key: l.id,
            label: l.description ?? '—',
            net: l.charge,
            tax: l.tax,
            gross: l.amount,
          })),
          ...(platformInvoice && platformInvoice !== displayInvoice
            ? platformInvoice.invoiceLines.map(l => ({
                key: l.id,
                label: (l.description ?? 'Service fee').replace(/\s*\([A-Z]{2,3}\)\s*$/, ''),
                net: l.charge,
                tax: l.tax,
                gross: l.amount,
              }))
            : []),
        ]
      : selected.orderItems.map(oi => ({
          key: oi.id,
          label: `${oi.name} × ${oi.quantity}`,
          net: oi.price,
          tax: oi.totalPrice - oi.price,
          gross: oi.totalPrice,
        }))

    const totals = hasInvoice
      ? (selected.invoices ?? []).reduce(
          (a, inv) => ({ net: a.net + inv.totalCharge, tax: a.tax + inv.totalTax, gross: a.gross + inv.totalAmount }),
          { net: 0, tax: 0, gross: 0 },
        )
      : rows.reduce(
          (a, r) => ({ net: a.net + r.net, tax: a.tax + r.tax, gross: a.gross + r.gross }),
          { net: 0, tax: 0, gross: 0 },
        )

    return (
      <div className="px-5 pt-4 pb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500">
              {new Date(selected.createdAt).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
            <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[selected.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
            </span>
          </div>
          <button onClick={() => setSelectedId(null)} className="text-sm font-medium text-gray-500 active:text-gray-800">
            ← Back
          </button>
        </div>

        {/* Items */}
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 bg-gray-50 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
            <span>Item</span>
            <span className="w-14 text-right">Net</span>
            <span className="w-12 text-right">Tax</span>
            <span className="w-14 text-right">Total</span>
          </div>

          {rows.map(r => (
            <div key={r.key} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2.5 border-t border-gray-100 text-[13px]">
              <span className="text-gray-800 truncate">{r.label}</span>
              <span className="w-14 text-right text-gray-500">{r.net.toFixed(2)}</span>
              <span className="w-12 text-right text-gray-400">{r.tax.toFixed(2)}</span>
              <span className="w-14 text-right font-medium text-gray-900">{r.gross.toFixed(2)}</span>
            </div>
          ))}

          {/* Totals */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2.5 border-t-2 border-gray-200 text-[13px] font-semibold">
            <span className="text-gray-900">Total</span>
            <span className="w-14 text-right text-gray-700">{totals.net.toFixed(2)}</span>
            <span className="w-12 text-right text-gray-500">{totals.tax.toFixed(2)}</span>
            <span className="w-14 text-right text-gray-900">{totals.gross.toFixed(2)}</span>
          </div>
        </div>

        {/* Receipt link */}
        {hasInvoice && (
          <a
            href={receiptUrl(`/reservations/${reservationId}/receipt?orderId=${selected.id}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 px-4 py-2.5 border border-gray-200 rounded-xl
                       text-sm font-medium text-gray-700 bg-white active:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
            View Receipt
          </a>
        )}
      </div>
    )
  }

  /* ── List view ── */

  return (
    <div className="px-5 pt-4 pb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Orders</h3>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <p className="text-sm">No orders yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(o => (
            <button
              key={o.id}
              onClick={() => setSelectedId(o.id)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-100
                         shadow-sm active:bg-gray-50 transition-colors text-left"
            >
              <div>
                <p className="text-sm text-gray-800">
                  {new Date(o.createdAt).toLocaleString(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {o.orderItems.length} item{o.orderItems.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-gray-900">{o.totalPrice.toFixed(2)}&nbsp;€</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusStyle[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Invoice } from '@/app/types/types'
import {
  ORDER_PENDING,
  ORDER_PROCESSING,
  ORDER_COMPLETE,
  ORDER_PAYMENT_FAILED,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
  ORDER_COMPLETED,
  ORDER_REJECTED,
  ORDER_CANCELED,
  ORDER_REFUNDED,
  ORDER_DISCARDED,
} from '@repo/data/reservation-status'

// Status = green / blue / amber / red pills (.claude/rules/ui.md): amber while
// it is waiting on something, blue once the venue has it, green when it is
// ready or done, red when it will not arrive.
const TONE = {
  green: 'bg-green-50 border-green-200 text-green-700',
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
  red: 'bg-red-50 border-red-200 text-red-700',
} as const

const STATUS: Record<string, { label: string; tone: keyof typeof TONE }> = {
  [ORDER_PENDING]:        { label: 'Awaiting payment', tone: 'amber' },
  [ORDER_PROCESSING]:     { label: 'Processing payment', tone: 'amber' },
  [ORDER_COMPLETE]:       { label: 'Received', tone: 'blue' },
  [ORDER_ACCEPTED]:       { label: 'Accepted', tone: 'blue' },
  [ORDER_PREPARING]:      { label: 'Preparing', tone: 'amber' },
  [ORDER_READY]:          { label: 'Ready', tone: 'green' },
  [ORDER_DELIVERED]:      { label: 'Delivered', tone: 'green' },
  [ORDER_COMPLETED]:      { label: 'Done', tone: 'green' },
  [ORDER_PAYMENT_FAILED]: { label: 'Payment failed', tone: 'red' },
  [ORDER_REJECTED]:       { label: 'Rejected', tone: 'red' },
  [ORDER_CANCELED]:       { label: 'Canceled', tone: 'red' },
  [ORDER_DISCARDED]:      { label: 'Canceled', tone: 'red' },
  [ORDER_REFUNDED]:       { label: 'Refunded', tone: 'amber' },
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

const fmt = (n: number) => `€${n.toFixed(2)}`

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('Orders')
  const s = STATUS[status]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s ? TONE[s.tone] : TONE.amber}`}>
      {s ? t(s.label) : status}
    </span>
  )
}

export default function Orders({ orders, reservationId }: { orders: OrderData[], reservationId: string }) {
  const t = useTranslations('Orders')
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

  const when = (d: Date) =>
    new Date(d).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

  /* ── Detail view ── */

  if (selected) {
    const hasInvoice = !!(selected.invoices && selected.invoices.length > 0)

    // Consumer display: PARTNER invoice is the gross amount the consumer paid.
    // The PLATFORM invoice is a B2B commission billed to the partner — not shown here.
    const partnerInvoice = selected.invoices?.find(i => i.issuerType === 'PARTNER')
    const displayInvoice = partnerInvoice ?? selected.invoices?.[0]

    // A guest reads what they ordered and what it cost — prices are VAT-inclusive,
    // so the VAT is stated once under the total rather than as a column per line.
    const lines = selected.orderItems.map(oi => ({
      key: oi.id,
      name: oi.name,
      quantity: oi.quantity,
      gross: oi.totalPrice,
    }))
    const total = hasInvoice && displayInvoice ? displayInvoice.totalAmount : lines.reduce((a, l) => a + l.gross, 0)
    const vat = hasInvoice && displayInvoice
      ? displayInvoice.totalTax
      : selected.orderItems.reduce((a, oi) => a + (oi.totalPrice - oi.price), 0)

    return (
      <div className="px-5 pt-2 pb-6">
        <button
          onClick={() => setSelectedId(null)}
          className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-sm px-1 text-sm font-medium text-brand-ink/70 hover:text-brand-ink"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.8 4.2a1 1 0 0 1 0 1.4L8.4 10l4.4 4.4a1 1 0 0 1-1.4 1.4l-5.1-5.1a1 1 0 0 1 0-1.4l5.1-5.1a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
          </svg>
          {t('Your orders')}
        </button>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-brand-ink">{t('Order')}</h3>
            <p className="mt-0.5 text-xs text-brand-ink/70">{when(selected.createdAt)}</p>
          </div>
          <StatusPill status={selected.status} />
        </div>

        <div className="mt-4 rounded-2xl bg-white ring-1 ring-brand-ink/[0.07]">
          <ul className="divide-y divide-brand-ink/6 px-4">
            {lines.map(l => (
              <li key={l.key} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="font-semibold text-brand-gold tabular-nums">{l.quantity}×</span>
                  <span className="truncate text-brand-ink">{l.name}</span>
                </span>
                <span className="font-medium text-brand-ink tabular-nums">{fmt(l.gross)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-brand-ink/10 px-4 py-3">
            <span className="text-sm font-semibold text-brand-ink">{t('Total')}</span>
            <span className="text-right">
              <span className="block text-base font-semibold text-brand-ink tabular-nums">{fmt(total)}</span>
              <span className="block text-[11px] text-brand-ink/60 tabular-nums">{t('Including VAT {amount}', { amount: fmt(vat) })}</span>
            </span>
          </div>
        </div>

        {hasInvoice && (
          <a
            href={receiptUrl(`/reservations/${reservationId}/receipt?orderId=${selected.id}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-brand-ink
                       ring-1 ring-brand-ink/15 transition-colors hover:bg-cream-light active:bg-cream"
          >
            <svg className="h-4 w-4 text-brand-ink/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
            {t('View receipt')}
          </a>
        )}
      </div>
    )
  }

  /* ── List view ── */

  return (
    <div className="px-5 pt-3 pb-6">
      <h3 className="mb-4 text-lg font-semibold text-brand-ink">{t('Your orders')}</h3>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <svg className="h-8 w-8 text-brand-gold/60" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="16" cy="16" r="7.5" /><circle cx="16" cy="16" r="4.5" />
            <path d="M5 6v20M3.5 6v4.5a1.5 1.5 0 0 0 3 0V6" /><path d="M27.5 26V6c-1.7 1-2.5 3.3-2.5 6.5V15h2.5" />
          </svg>
          <p className="text-sm text-brand-ink/70">{t('No orders yet')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {[...orders].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()).map(o => {
            const count = o.orderItems.reduce((a, i) => a + i.quantity, 0)
            const summary = o.orderItems.map(i => i.name).join(', ')
            return (
              <li key={o.id}>
                <button
                  onClick={() => setSelectedId(o.id)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-brand-ink/[0.07]
                             transition-colors hover:bg-cream-light active:bg-cream"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-brand-ink">{when(o.createdAt)}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-brand-ink/70">
                      {count} {count === 1 ? t('item') : t('items')} · {summary}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-brand-ink tabular-nums">{fmt(o.totalPrice)}</span>
                  <svg className="h-4 w-4 shrink-0 text-brand-ink/40" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.2 15.8a1 1 0 0 1 0-1.4l4.4-4.4-4.4-4.4a1 1 0 1 1 1.4-1.4l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0Z" clipRule="evenodd" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

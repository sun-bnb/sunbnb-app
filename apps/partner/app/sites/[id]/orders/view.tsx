'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import * as siteOrderActions from './actions'
import * as restaurantOrderActions from '@/app/restaurants/[id]/orders/actions'
import type { OrderTab, TabSummary } from './actions'
import { Order } from '@/types/shared'
import {
  ORDER_COMPLETE,
  ORDER_ACCEPTED,
  ORDER_PREPARING,
  ORDER_READY,
  ORDER_DELIVERED,
  ORDER_COMPLETED,
  ORDER_REJECTED,
  ORDER_DISCARDED,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'

// ─── Scope dispatch ──────────────────────────────────────────────────────────
//
// `Orders` backs both the site-scoped (`/sites/[id]/orders`) and
// restaurant-scoped (`/restaurants/[id]/orders`) kitchen dashboards. `scope`
// picks which action module (and therefore which `where` clause / auth gate)
// each call goes through; the id inside `scope` is the siteId or
// restaurantId respectively. Site behavior is unchanged — `scope.kind ===
// 'site'` dispatches to the exact same `./actions` functions as before.

export type OrdersScope = { kind: 'site' | 'restaurant'; id: string }

function scopedSetOrderStatus(
  scope: OrdersScope,
  orderId: string,
  status: string,
  reason: string | undefined,
  accessKey?: string,
) {
  return scope.kind === 'site'
    ? siteOrderActions.setOrderStatus(scope.id, orderId, status, reason, accessKey)
    : restaurantOrderActions.setRestaurantOrderStatus(scope.id, orderId, status, reason, accessKey)
}

function scopedGetOrders(scope: OrdersScope, tab: OrderTab, accessKey?: string) {
  return scope.kind === 'site'
    ? siteOrderActions.getOrders(scope.id, tab, accessKey)
    : restaurantOrderActions.getRestaurantOrders(scope.id, tab, accessKey)
}

function scopedGetOpenTabs(scope: OrdersScope, accessKey?: string) {
  return scope.kind === 'site'
    ? siteOrderActions.getOpenTabs(scope.id, accessKey)
    : restaurantOrderActions.getRestaurantOpenTabs(scope.id, accessKey)
}

function scopedSettleTabCash(scope: OrdersScope, tabId: string, accessKey?: string) {
  return scope.kind === 'site'
    ? siteOrderActions.settleTabCash(scope.id, tabId, accessKey)
    : restaurantOrderActions.settleRestaurantTabCash(scope.id, tabId, accessKey)
}

function scopedDiscardTab(scope: OrdersScope, tabId: string, accessKey?: string) {
  return scope.kind === 'site'
    ? siteOrderActions.discardTab(scope.id, tabId, accessKey)
    : restaurantOrderActions.discardRestaurantTab(scope.id, tabId, accessKey)
}

// ─── Audio Alert ─────────────────────────────────────────────────────────────

function useNewOrderAlert(orders: Order[]) {
  const prevIdsRef = useRef<Set<string>>(new Set(orders.map(o => o.id)))
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Create a reusable audio element with a simple beep via data URI
    // Two-tone "ding-ding" notification
    if (typeof window !== 'undefined' && !audioRef.current) {
      const ctx = new AudioContext()
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < buf.length; i++) {
        const t = i / ctx.sampleRate
        // Two short beeps at 880Hz
        const env = t < 0.15 ? 1 : t < 0.2 ? 0 : t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) * 4)
        data[i] = Math.sin(2 * Math.PI * 880 * t) * env * 0.3
      }
      // Store context and buffer for playback
      ;(audioRef as any)._ctx = ctx
      ;(audioRef as any)._buf = buf
    }
  }, [])

  useEffect(() => {
    const currentIds = new Set(orders.map(o => o.id))
    const newOrders = orders.filter(o => !prevIdsRef.current.has(o.id))
    prevIdsRef.current = currentIds

    if (newOrders.length > 0 && (audioRef as any)?._ctx) {
      try {
        const ctx = (audioRef as any)._ctx as AudioContext
        const buf = (audioRef as any)._buf as AudioBuffer
        if (ctx.state === 'suspended') ctx.resume()
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.start()
      } catch {
        // Audio not available — silent fallback
      }
    }
  }, [orders])
}

// ─── Live Timer ──────────────────────────────────────────────────────────────

function ElapsedTimer({ since }: { since: Date | string }) {
  const [elapsed, setElapsed] = useState<string | null>(null)

  useEffect(() => {
    const calc = () => {
      const ms = Date.now() - new Date(since).getTime()
      const mins = Math.floor(ms / 60000)
      const secs = Math.floor((ms % 60000) / 1000)
      setElapsed(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`)
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [since])

  // Render nothing on the server; client fills in after mount
  return <span>{elapsed ?? '—'}</span>
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

type DashboardTab = OrderTab | 'tabs'

const TABS: { key: DashboardTab; labelKey: string }[] = [
  { key: 'incoming', labelKey: 'tabNew' },
  { key: 'active',   labelKey: 'tabKitchen' },
  { key: 'ready',    labelKey: 'tabDeliver' },
  { key: 'history',  labelKey: 'tabDone' },
  { key: 'tabs',     labelKey: 'tabsHeading' },
]

// ─── Status Colours & Labels ─────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; text: string; labelKey: string }> = {
  paid:              { bg: 'bg-amber-100',   text: 'text-amber-800',   labelKey: 'statusNew' },
  [ORDER_COMPLETE]:  { bg: 'bg-amber-100',   text: 'text-amber-800',   labelKey: 'statusNew' },
  [ORDER_ACCEPTED]:  { bg: 'bg-blue-100',    text: 'text-blue-800',    labelKey: 'statusAccepted' },
  [ORDER_PREPARING]: { bg: 'bg-orange-100',  text: 'text-orange-800',  labelKey: 'statusPreparing' },
  [ORDER_READY]:     { bg: 'bg-emerald-100', text: 'text-emerald-800', labelKey: 'statusReady' },
  [ORDER_DELIVERED]: { bg: 'bg-teal-100',    text: 'text-teal-800',    labelKey: 'statusDelivered' },
  [ORDER_COMPLETED]: { bg: 'bg-gray-100',    text: 'text-gray-600',    labelKey: 'statusCompleted' },
  [ORDER_REJECTED]:  { bg: 'bg-red-100',     text: 'text-red-700',     labelKey: 'statusRejected' },
  [ORDER_DISCARDED]: { bg: 'bg-gray-100',    text: 'text-gray-500',    labelKey: 'statusDiscarded' },
}

// ─── Action Buttons Per Status ───────────────────────────────────────────────

function OrderActions({
  scope,
  order,
  onUpdated,
  accessKey,
}: {
  scope: OrdersScope
  order: Order
  onUpdated: () => void
  accessKey?: string
}) {
  const t = useTranslations('SiteOrders')
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const act = async (status: string, reason?: string) => {
    setBusy(true)
    await scopedSetOrderStatus(scope, order.id, status, reason, accessKey)
    setBusy(false)
    onUpdated()
  }

  const { status } = order

  if (showReject) {
    return (
      <div className="space-y-2 mt-3">
        <input
          type="text"
          placeholder={t('rejectReasonPlaceholder')}
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={() => { setShowReject(false); setRejectReason('') }}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 font-semibold text-sm"
          >
            {t('cancel').toUpperCase()}
          </button>
          <button
            onClick={() => act(ORDER_REJECTED, rejectReason || undefined)}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm disabled:opacity-50"
          >
            {t('confirmReject').toUpperCase()}
          </button>
        </div>
      </div>
    )
  }

  // Map each status to its primary + secondary actions
  const actions: Record<string, React.ReactNode> = {
    paid: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_ACCEPTED)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold text-base disabled:opacity-50 active:bg-blue-700">
          {t('accept').toUpperCase()}
        </button>
        <button onClick={() => setShowReject(true)} disabled={busy}
          className="w-16 py-3 rounded-lg border-2 border-red-400 text-red-600 font-bold text-xs disabled:opacity-50">
          ✕
        </button>
      </div>
    ),
    [ORDER_COMPLETE]: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_ACCEPTED)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-bold text-base disabled:opacity-50 active:bg-blue-700">
          {t('accept').toUpperCase()}
        </button>
        <button onClick={() => setShowReject(true)} disabled={busy}
          className="w-16 py-3 rounded-lg border-2 border-red-400 text-red-600 font-bold text-xs disabled:opacity-50">
          ✕
        </button>
      </div>
    ),
    [ORDER_ACCEPTED]: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_PREPARING)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-orange-500 text-white font-bold text-base disabled:opacity-50 active:bg-orange-600">
          {t('startPreparing').toUpperCase()}
        </button>
      </div>
    ),
    [ORDER_PREPARING]: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_READY)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-bold text-base disabled:opacity-50 active:bg-emerald-700">
          {t('ready').toUpperCase()}
        </button>
      </div>
    ),
    [ORDER_READY]: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_DELIVERED)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-teal-600 text-white font-bold text-base disabled:opacity-50 active:bg-teal-700">
          {t('delivered').toUpperCase()}
        </button>
      </div>
    ),
    [ORDER_DELIVERED]: (
      <div className="flex gap-2 mt-3">
        <button onClick={() => act(ORDER_COMPLETED)} disabled={busy}
          className="flex-1 py-3 rounded-lg bg-gray-800 text-white font-bold text-base disabled:opacity-50 active:bg-gray-900">
          {t('complete').toUpperCase()}
        </button>
      </div>
    ),
  }

  return actions[status] ?? null
}

// ─── Table Chip ──────────────────────────────────────────────────────────────

function TableChip({ number, label }: { number: number; label: string | null }) {
  const text = label ? `Table ${number} — ${label}` : `Table ${number}`
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3" aria-hidden="true">
        <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v1A1.5 1.5 0 0112.5 6h-.75v5.5h.75a.75.75 0 010 1.5H3.5a.75.75 0 010-1.5h.75V6H3.5A1.5 1.5 0 012 4.5v-1zm4 2.5v5.5h4V6H6z" />
      </svg>
      {text}
    </span>
  )
}

// ─── Elapsed helper ──────────────────────────────────────────────────────────

function formatElapsed(since: Date | string): string {
  const ms = Date.now() - new Date(since).getTime()
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(mins / 60)
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins}m`
}

// ─── Tab Card ────────────────────────────────────────────────────────────────

function TabCard({
  scope,
  tab,
  onUpdated,
  accessKey,
}: {
  scope: OrdersScope
  tab: TabSummary
  onUpdated: () => void
  accessKey?: string
}) {
  const t = useTranslations('SiteOrders')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'settle' | 'discard' | null>(null)

  const isPending = tab.status === TAB_PENDING_PAYMENT

  const handleSettle = async () => {
    setBusy(true)
    await scopedSettleTabCash(scope, tab.id, accessKey)
    setBusy(false)
    setConfirm(null)
    onUpdated()
  }

  const handleDiscard = async () => {
    setBusy(true)
    await scopedDiscardTab(scope, tab.id, accessKey)
    setBusy(false)
    setConfirm(null)
    onUpdated()
  }

  const tableLabel = tab.tableLabel
    ? `Table ${tab.tableNumber} — ${tab.tableLabel}`
    : `Table ${tab.tableNumber}`

  if (confirm === 'settle') {
    return (
      <div className="w-full rounded-xl border-2 border-green-200 bg-white shadow-sm p-4 space-y-3">
        <div className="font-bold text-gray-900">{t('tabSettleConfirmTitle')}</div>
        <div className="text-sm text-gray-600">
          {t('tabSettleConfirmBody', { amount: `€${tab.amountDue.toFixed(2)}` })}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirm(null)}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 font-semibold text-sm disabled:opacity-50"
          >
            {t('tabCancelAction').toUpperCase()}
          </button>
          <button
            onClick={handleSettle}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-green-600 text-white font-bold text-sm disabled:opacity-50 active:bg-green-700"
          >
            {t('tabSettleConfirm', { amount: `€${tab.amountDue.toFixed(2)}` }).toUpperCase()}
          </button>
        </div>
      </div>
    )
  }

  if (confirm === 'discard') {
    return (
      <div className="w-full rounded-xl border-2 border-red-200 bg-white shadow-sm p-4 space-y-3">
        <div className="font-bold text-gray-900">{t('tabDiscardConfirmTitle')}</div>
        <div className="text-sm text-gray-600">{t('tabDiscardConfirmBody')}</div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirm(null)}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-600 font-semibold text-sm disabled:opacity-50"
          >
            {t('tabCancelAction').toUpperCase()}
          </button>
          <button
            onClick={handleDiscard}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-bold text-sm disabled:opacity-50 active:bg-red-700"
          >
            {t('tabDiscardConfirm').toUpperCase()}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full rounded-xl border-2 border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gray-900 text-white text-base font-black">
            {tab.tableNumber}
          </div>
          <div>
            <div className="text-base font-bold text-gray-900">{tableLabel}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {isPending ? (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                  {t('tabStatusPendingPayment')}
                </span>
              ) : (
                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
                  {t('tabStatusOpen')}
                </span>
              )}
              <span className="text-xs text-gray-500">
                {t('tabOpenedAt', { time: formatElapsed(tab.openedAt) })}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-gray-900">€{tab.amountDue.toFixed(2)}</div>
          <div className="text-xs text-gray-500">{t('tabRounds', { count: tab.roundsCount })}</div>
        </div>
      </div>

      {/* Items summary */}
      {tab.items.length > 0 && (
        <div className="px-4 py-3 space-y-1">
          {tab.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{item.quantity}× {item.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 pb-4">
        {isPending ? (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {t('tabPendingPaymentHint')}
          </div>
        ) : (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setConfirm('settle')}
              disabled={busy}
              className="flex-1 py-3 rounded-lg bg-green-600 text-white font-bold text-sm disabled:opacity-50 active:bg-green-700"
            >
              {t('tabSettleCash').toUpperCase()}
            </button>
            <button
              onClick={() => setConfirm('discard')}
              disabled={busy}
              className="flex-1 py-3 rounded-lg border-2 border-red-400 text-red-600 font-bold text-sm disabled:opacity-50 active:bg-red-50"
            >
              {t('tabDiscard').toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Order Card ──────────────────────────────────────────────────────────────

function OrderCard({
  scope,
  order,
  tableEntry,
  onUpdated,
  compact = false,
  accessKey,
}: {
  scope: OrdersScope
  order: Order
  tableEntry?: { number: number; label: string | null }
  onUpdated: () => void
  compact?: boolean
  accessKey?: string
}) {
  const t = useTranslations('SiteOrders')
  const fallback = { bg: 'bg-gray-100', text: 'text-gray-600', labelKey: order.status }
  const style = STATUS_STYLE[order.status] ?? fallback

  // Group items by category for kitchen visibility
  const categoryGroups = useMemo(() => {
    const groups: Record<string, typeof order.orderItems> = {}
    for (const item of order.orderItems) {
      const cat = item.category ?? 'other'
      if (!groups[cat]) groups[cat] = []
      groups[cat]!.push(item)
    }
    return groups
  }, [order.orderItems])

  return (
    <div className="w-full rounded-xl border-2 border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          {/* Seat number — large for runner visibility */}
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gray-900 text-white text-xl font-black">
            {order.seat?.number ?? '–'}
          </div>
          <div>
            <div className="text-lg font-bold text-gray-900">
              <ElapsedTimer since={order.createdAt} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <div className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${style.bg} ${style.text}`}>
                {t(style.labelKey as any)}
              </div>
              {tableEntry && (
                <TableChip number={tableEntry.number} label={tableEntry.label} />
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-gray-900">€{order.totalPrice.toFixed(2)}</div>
        </div>
      </div>

      {/* Items */}
      <div className="px-4 py-3">
        {Object.entries(categoryGroups).map(([category, items]) => (
          <div key={category} className="mb-2 last:mb-0">
            {Object.keys(categoryGroups).length > 1 && (
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                {category}
              </div>
            )}
            {items.map(item => (
              <div key={item.id} className="flex items-start justify-between py-1.5">
                <div className="flex-1">
                  <span className="text-base font-semibold text-gray-900">
                    {item.quantity}× {item.name}
                  </span>
                  {item.notes && (
                    <p className="text-sm text-amber-700 font-medium mt-0.5">📝 {item.notes}</p>
                  )}
                </div>
                {!compact && (
                  <span className="text-sm font-medium text-gray-500 ml-2">
                    €{(item.totalPrice * item.quantity).toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Order-level notes */}
        {order.notes && (
          <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            📝 {order.notes}
          </div>
        )}
      </div>

      {/* Rejection reason if shown */}
      {order.rejectReason && (
        <div className="px-4 pb-2 text-sm text-red-600">
          {t('reason', { text: order.rejectReason })}
        </div>
      )}

      {/* Actions */}
      {!compact && (
        <div className="px-4 pb-4">
          <OrderActions scope={scope} order={order} onUpdated={onUpdated} accessKey={accessKey} />
        </div>
      )}
    </div>
  )
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function Orders({
  scope,
  orders: initialOrders,
  tableMap = {},
  accessKey,
}: {
  /** Which action module (site- or restaurant-scoped) drives this dashboard. */
  scope: OrdersScope
  orders: Order[]
  /** Mapping of Table.id → { number, label } for dine-in tab orders. */
  tableMap?: Record<string, { number: number; label: string | null }>
  accessKey?: string
}) {
  const t = useTranslations('SiteOrders')
  const [activeTab, setActiveTab] = useState<DashboardTab>('incoming')
  const [allOrders, setAllOrders] = useState<Order[]>(initialOrders)
  const [openTabs, setOpenTabs] = useState<TabSummary[]>([])

  // Filter current tab's orders from the full set
  const tabStatuses: Record<OrderTab, string[]> = {
    incoming: [ORDER_COMPLETE],
    active:   [ORDER_ACCEPTED, ORDER_PREPARING],
    ready:    [ORDER_READY, ORDER_DELIVERED],
    history:  [ORDER_COMPLETED, ORDER_REJECTED, ORDER_DISCARDED],
  }

  const tabOrders = useMemo(
    () => activeTab === 'tabs' ? [] : allOrders.filter(o => tabStatuses[activeTab as OrderTab]?.includes(o.status)),
    [allOrders, activeTab],
  )

  // Count badges per tab
  const counts = useMemo(() => {
    const c: Record<DashboardTab, number> = { incoming: 0, active: 0, ready: 0, history: 0, tabs: 0 }
    for (const o of allOrders) {
      for (const [tab, statuses] of Object.entries(tabStatuses)) {
        if (statuses.includes(o.status)) c[tab as OrderTab]++
      }
    }
    c.tabs = openTabs.length
    return c
  }, [allOrders, openTabs])

  // Audio alert for incoming tab
  const incomingOrders = useMemo(
    () => allOrders.filter(o => tabStatuses.incoming.includes(o.status)),
    [allOrders],
  )
  useNewOrderAlert(incomingOrders)

  // Fetch open tabs
  const fetchOpenTabs = useCallback(async () => {
    const result = await scopedGetOpenTabs(scope, accessKey)
    if (result.status === 'ok' && result.tabs) {
      setOpenTabs(result.tabs)
    }
  }, [scope, accessKey])

  // Polling — fetch all active orders every 5 seconds; open tabs in parallel
  const fetchOrders = useCallback(async () => {
    const orderTabs: OrderTab[] = activeTab === 'history' ? ['history'] : ['incoming', 'active', 'ready']
    const results = await Promise.all(orderTabs.map(t => scopedGetOrders(scope, t, accessKey)))
    const merged = results.flatMap(r => r.orders ?? [])
    setAllOrders(merged)
  }, [scope, activeTab, accessKey])

  useEffect(() => {
    const id = setInterval(() => {
      fetchOrders()
      fetchOpenTabs()
    }, 5000)
    return () => clearInterval(id)
  }, [fetchOrders, fetchOpenTabs])

  // Initial load of open tabs
  useEffect(() => {
    fetchOpenTabs()
  }, [fetchOpenTabs])

  // Refresh after status change
  const handleUpdated = () => {
    fetchOrders()
    fetchOpenTabs()
  }
  const handleTabUpdated = () => {
    fetchOpenTabs()
  }

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* Tab bar — sticky top */}
      <div className="flex border-b border-gray-200 bg-white sticky top-0 z-10">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-center text-sm font-semibold relative transition-colors
              ${activeTab === tab.key
                ? 'text-gray-900 border-b-2 border-gray-900'
                : 'text-gray-400 hover:text-gray-600'}`}
          >
            {t(tab.labelKey as any)}
            {counts[tab.key] > 0 && tab.key !== 'history' && (
              <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white
                ${tab.key === 'incoming' ? 'bg-red-500 animate-pulse' : tab.key === 'tabs' ? 'bg-green-600' : 'bg-gray-500'}`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Open Tabs panel */}
      {activeTab === 'tabs' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {openTabs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="text-5xl mb-3">🧾</div>
              <p className="text-sm font-medium">{t('tabsEmpty')}</p>
            </div>
          ) : (
            openTabs.map(tab => (
              <TabCard
                key={tab.id}
                scope={scope}
                tab={tab}
                onUpdated={handleTabUpdated}
                accessKey={accessKey}
              />
            ))
          )}
        </div>
      )}

      {/* Order list */}
      {activeTab !== 'tabs' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {tabOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="text-5xl mb-3">
                {activeTab === 'incoming' ? '🔔' : activeTab === 'active' ? '👨‍🍳' : activeTab === 'ready' ? '🏃' : '✅'}
              </div>
              <p className="text-sm font-medium">
                {activeTab === 'incoming' ? t('noNewOrders') :
                 activeTab === 'active' ? t('nothingPreparing') :
                 activeTab === 'ready' ? t('noOrdersToDeliver') :
                 t('noCompletedOrders')}
              </p>
            </div>
          ) : (
            tabOrders.map(order => (
              <OrderCard
                key={order.id}
                scope={scope}
                order={order}
                tableEntry={order.tableId ? tableMap[order.tableId] : undefined}
                onUpdated={handleUpdated}
                compact={activeTab === 'history'}
                accessKey={accessKey}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

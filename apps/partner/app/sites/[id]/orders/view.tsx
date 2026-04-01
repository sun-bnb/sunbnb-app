'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { setOrderStatus, getOrders, type OrderTab } from './actions'
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
} from '@repo/data/reservation-status'

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

const TABS: { key: OrderTab; labelKey: string }[] = [
  { key: 'incoming', labelKey: 'tabNew' },
  { key: 'active',   labelKey: 'tabKitchen' },
  { key: 'ready',    labelKey: 'tabDeliver' },
  { key: 'history',  labelKey: 'tabDone' },
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
  siteId,
  order,
  onUpdated,
}: {
  siteId: string
  order: Order
  onUpdated: () => void
}) {
  const t = useTranslations('SiteOrders')
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const act = async (status: string, reason?: string) => {
    setBusy(true)
    await setOrderStatus(siteId, order.id, status, reason)
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

// ─── Order Card ──────────────────────────────────────────────────────────────

function OrderCard({
  siteId,
  order,
  onUpdated,
  compact = false,
}: {
  siteId: string
  order: Order
  onUpdated: () => void
  compact?: boolean
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
            <div className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${style.bg} ${style.text}`}>
              {t(style.labelKey as any)}
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
          <OrderActions siteId={siteId} order={order} onUpdated={onUpdated} />
        </div>
      )}
    </div>
  )
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function Orders({ siteId, orders: initialOrders }: { siteId: string; orders: Order[] }) {
  const t = useTranslations('SiteOrders')
  const [activeTab, setActiveTab] = useState<OrderTab>('incoming')
  const [allOrders, setAllOrders] = useState<Order[]>(initialOrders)

  // Filter current tab's orders from the full set
  const tabStatuses: Record<OrderTab, string[]> = {
    incoming: [ORDER_COMPLETE],
    active:   [ORDER_ACCEPTED, ORDER_PREPARING],
    ready:    [ORDER_READY, ORDER_DELIVERED],
    history:  [ORDER_COMPLETED, ORDER_REJECTED, ORDER_DISCARDED],
  }

  const tabOrders = useMemo(
    () => allOrders.filter(o => tabStatuses[activeTab]?.includes(o.status)),
    [allOrders, activeTab],
  )

  // Count badges per tab
  const counts = useMemo(() => {
    const c: Record<OrderTab, number> = { incoming: 0, active: 0, ready: 0, history: 0 }
    for (const o of allOrders) {
      for (const [tab, statuses] of Object.entries(tabStatuses)) {
        if (statuses.includes(o.status)) c[tab as OrderTab]++
      }
    }
    return c
  }, [allOrders])

  // Audio alert for incoming tab
  const incomingOrders = useMemo(
    () => allOrders.filter(o => tabStatuses.incoming.includes(o.status)),
    [allOrders],
  )
  useNewOrderAlert(incomingOrders)

  // Polling — fetch all active orders every 5 seconds
  const fetchOrders = useCallback(async () => {
    const tabs: OrderTab[] = activeTab === 'history' ? ['history'] : ['incoming', 'active', 'ready']
    const results = await Promise.all(tabs.map(t => getOrders(siteId, t)))
    const merged = results.flatMap(r => r.orders ?? [])
    setAllOrders(merged)
  }, [siteId, activeTab])

  useEffect(() => {
    const id = setInterval(fetchOrders, 5000)
    return () => clearInterval(id)
  }, [fetchOrders])

  // Refresh after status change
  const handleUpdated = () => fetchOrders()

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
                ${tab.key === 'incoming' ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Order list */}
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
              siteId={siteId}
              order={order}
              onUpdated={handleUpdated}
              compact={activeTab === 'history'}
            />
          ))
        )}
      </div>
    </div>
  )
}

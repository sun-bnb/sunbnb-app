'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { placeTabOrder, getTabState } from './actions'
import { initiateDemoTabPayment } from '@/app/payment/actions'
import type { DineContext, TabState, PlaceTabOrderItem } from './actions'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEM_QTY = 99
const ANON_ID_KEY = 'sunbnb-anonId'
const TAB_POLL_INTERVAL_MS = 30_000
const RETURN_POLL_INTERVAL_MS = 3_000
const RETURN_POLL_MAX_ATTEMPTS = 40

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

const CATEGORY_ORDER = ['food', 'drink', 'snack', 'accessory'] as const

// ── Types ─────────────────────────────────────────────────────────────────────

type CartItem = {
  product: DineContext['products'][number]
  quantity: number
  notes?: string
}

type UiState =
  | { phase: 'ordering' }
  | { phase: 'confirm_pay' }
  | { phase: 'paying' }
  | { phase: 'verifying' } // tabReturn poll
  | { phase: 'paid'; paidTotal?: number }
  | { phase: 'closed' } // discarded / 404 after return

// ── Sub-components ────────────────────────────────────────────────────────────

function TableChip({ label, number }: { label: string | null; number: number }) {
  const display = label ?? `#${number}`
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-900 text-white text-xs font-semibold tracking-wide">
      <svg className="w-3 h-3 opacity-70" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
      </svg>
      {display}
    </span>
  )
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  // Auto-dismiss after 5 s
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed top-4 inset-x-4 z-50 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm"
    >
      <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <p className="flex-1 text-sm text-red-700">{message}</p>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600 ml-1">
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 inset-x-4 z-50 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 shadow-sm"
    >
      <svg className="w-4 h-4 text-green-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
      <p className="text-sm text-green-700">{message}</p>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function DineView({
  context,
  siteId,
  tableId,
}: {
  context: DineContext
  siteId: string
  tableId: string
}) {
  const t = useTranslations('Dine')
  const router = useRouter()
  const searchParams = useSearchParams()

  const CATEGORY_LABELS: Record<string, string> = {
    food: `${t('Food')}`,
    drink: `${t('Drinks')}`,
    snack: `${t('Snacks')}`,
    accessory: `${t('Accessories')}`,
  }

  // ── anonId ────────────────────────────────────────────────────────────────
  // On mount: read or create a UUID in localStorage. Same pattern as POS/sunbed flows.
  const [anonId, setAnonId] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let id = window.localStorage.getItem(ANON_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(ANON_ID_KEY, id)
    }
    setAnonId(id)
  }, [])

  // ── Cart state ────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([])
  const [orderNotes, setOrderNotes] = useState('')

  const updateQuantity = (product: DineContext['products'][number], delta: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id)
      if (idx > -1) {
        const updated = [...prev]
        const newQty = updated[idx]!.quantity + delta
        if (newQty <= 0) {
          updated.splice(idx, 1)
        } else if (newQty > MAX_ITEM_QTY) {
          return prev
        } else {
          updated[idx] = { ...updated[idx]!, quantity: newQty }
        }
        return updated
      }
      return delta > 0 ? [...prev, { product, quantity: 1 }] : prev
    })
  }

  const updateItemNotes = (productId: string, notes: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, notes } : item,
      ),
    )
  }

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)
  const cartTotal = cart.reduce((s, i) => s + i.quantity * i.product.totalPrice, 0)

  // ── Order-review panel state ───────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false)
  const [placing, setPlacing] = useState(false)

  // ── UI phase state ────────────────────────────────────────────────────────
  const [uiState, setUiState] = useState<UiState>({ phase: 'ordering' })

  // ── Tab state (polling) ───────────────────────────────────────────────────
  const [tab, setTab] = useState<TabState | null>(null)
  const [tabLoading, setTabLoading] = useState(true)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Capture the pre-payment totals so we can display them on the paid screen
  const [prePaidTotal, setPrePaidTotal] = useState<number | undefined>(undefined)

  const fetchTab = useCallback(async () => {
    const res = await getTabState(context.site.id, context.table.id)
    if (res.status === 'ok') {
      setTab(res.tab)
    }
    setTabLoading(false)
  }, [context.site.id, context.table.id])

  // Initial fetch + 30 s polling (suspended during verifying/paid phases)
  useEffect(() => {
    void fetchTab()
    const schedule = () => {
      pollTimerRef.current = setTimeout(async () => {
        await fetchTab()
        schedule()
      }, TAB_POLL_INTERVAL_MS)
    }
    schedule()
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [fetchTab])

  // Guard: if the tab:null comes from the server poll after tab is closed (getTabState
  // looks up by openTableId and returns null for closed tabs), do NOT clobber the paid state.
  useEffect(() => {
    if (tab === null && (uiState.phase === 'paid' || uiState.phase === 'closed')) {
      // Tab was closed server-side — the local paid state is authoritative. Leave it.
      return
    }
    if (tab !== null && tab.status === 'pending_payment' && uiState.phase === 'ordering') {
      // A companion phone has already claimed the tab for payment — show the banner.
      // (The local payer's own flow is handled via uiState transitions below.)
    }
  }, [tab, uiState.phase])

  // When the 30s poll sees pending_payment on a companion phone and the tab later
  // transitions to paid/closed (getTabState returns null), flip to paid state.
  const prevTabStatusRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prevStatus = prevTabStatusRef.current
    if (tab !== null) {
      prevTabStatusRef.current = tab.status
    }

    // If we're currently watching pending_payment (companion phone) and tab
    // disappears (closed by payer), move to paid state.
    if (
      prevStatus === 'pending_payment' &&
      tab === null &&
      uiState.phase === 'ordering'
    ) {
      setUiState({ phase: 'paid' })
    }
  }, [tab, uiState.phase])

  // ── Banner state ──────────────────────────────────────────────────────────
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successVisible, setSuccessVisible] = useState(false)

  // Payment failed (returned from Mollie with failed status)
  const [paymentFailedMsg, setPaymentFailedMsg] = useState<string | null>(null)

  const dismissError = useCallback(() => setErrorMsg(null), [])
  const dismissPaymentFailed = useCallback(() => setPaymentFailedMsg(null), [])

  // Auto-dismiss success banner after 3 s
  useEffect(() => {
    if (!successVisible) return
    const t = setTimeout(() => setSuccessVisible(false), 3000)
    return () => clearTimeout(t)
  }, [successVisible])

  // ── tabReturn handling (on mount) ─────────────────────────────────────────
  const returnPollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnPollAttemptsRef = useRef(0)

  useEffect(() => {
    const tabReturnId = searchParams.get('tabReturn')
    if (!tabReturnId) return

    // Strip the param immediately so a refresh doesn't re-enter verifying
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.delete('tabReturn')
    router.replace(newUrl.pathname + (newUrl.search === '?' ? '' : newUrl.search))

    setUiState({ phase: 'verifying' })
    returnPollAttemptsRef.current = 0

    const pollReturn = async () => {
      if (returnPollAttemptsRef.current >= RETURN_POLL_MAX_ATTEMPTS) {
        // Timed out — treat as failed/unknown
        setPaymentFailedMsg(t('paymentNotConfirmed'))
        setUiState({ phase: 'ordering' })
        return
      }

      returnPollAttemptsRef.current += 1

      try {
        const res = await fetch(`/api/tabs/${tabReturnId}`)
        if (res.status === 404) {
          setUiState({ phase: 'closed' })
          return
        }

        const data: { id: string; status: string; closedAt: string | null } = await res.json()

        if (data.status === 'paid' || data.status === 'settled_cash') {
          setUiState({ phase: 'paid', paidTotal: prePaidTotal })
          return
        }

        if (data.status === 'open') {
          // Payment was canceled or failed — revert to ordering
          setPaymentFailedMsg(t('paymentCanceled'))
          setUiState({ phase: 'ordering' })
          // Refresh tab state so banner clears
          await fetchTab()
          return
        }

        if (data.status === 'discarded') {
          setUiState({ phase: 'closed' })
          return
        }

        // pending_payment — keep polling
        returnPollRef.current = setTimeout(pollReturn, RETURN_POLL_INTERVAL_MS)
      } catch {
        // Transient error — keep polling
        returnPollRef.current = setTimeout(pollReturn, RETURN_POLL_INTERVAL_MS)
      }
    }

    returnPollRef.current = setTimeout(pollReturn, RETURN_POLL_INTERVAL_MS)

    return () => {
      if (returnPollRef.current) clearTimeout(returnPollRef.current)
    }
  }, []) // intentionally run once on mount — tabReturn is read from searchParams at mount time only

  // ── Place order handler ───────────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (placing || cart.length === 0) return
    setPlacing(true)

    const items: PlaceTabOrderItem[] = cart.map((i) => ({
      product: { id: i.product.id },
      quantity: i.quantity,
      notes: i.notes,
    }))

    const result = await placeTabOrder({
      siteId: context.site.id,
      tableId: context.table.id,
      anonId: anonId ?? undefined,
      notes: orderNotes || undefined,
      items,
    })

    if (result.status === 'ok') {
      setCart([])
      setOrderNotes('')
      setReviewOpen(false)
      setSuccessVisible(true)
      // Refresh the tab immediately after a successful order
      await fetchTab()
    } else {
      setErrorMsg(result.errors?.[0] ?? t('orderFailed'))
    }

    setPlacing(false)
  }

  // ── Close & pay handlers ──────────────────────────────────────────────────

  const handlePayClick = () => {
    // Capture totals before payment so paid state can display them
    if (tab) {
      setPrePaidTotal(tab.totals.payableTotal)
    }
    setUiState({ phase: 'confirm_pay' })
  }

  const handleCancelPay = () => {
    setUiState({ phase: 'ordering' })
  }

  const handleConfirmPay = async () => {
    if (!tab) return
    setUiState({ phase: 'paying' })

    if (DEMO_MODE) {
      // Demo path: call server action, show paid state on ok
      const result = await initiateDemoTabPayment(tab.id)
      if (result.status === 'ok') {
        setUiState({ phase: 'paid', paidTotal: prePaidTotal })
        // Tab is now closed; the 30s getTabState poll will return null — that's expected.
      } else {
        const msg = result.errors?.[0] ?? t('paymentFailed')
        setErrorMsg(msg)
        // If the error was 409 "Payment already in progress", update local state accordingly
        if (msg.toLowerCase().includes('progress') || msg.toLowerCase().includes('progress')) {
          await fetchTab()
        }
        setUiState({ phase: 'ordering' })
      }
      return
    }

    // Mollie path
    const redirectUrl = `${window.location.origin}/sites/${siteId}/dine/${tableId}?tabReturn=${tab.id}`

    try {
      const res = await fetch('/api/tab-payment/mollie/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: tab.id, redirectUrl }),
      })

      const data = await res.json()

      if (!res.ok) {
        const msg = data.error ?? t('paymentFailed')
        // 409 "Payment already in progress" — flip to pending_payment and poll
        if (res.status === 409 && (data.error ?? '').toLowerCase().includes('progress')) {
          await fetchTab()
          setUiState({ phase: 'ordering' })
          // The pending_payment banner will appear via the tab state
        } else {
          setErrorMsg(msg)
          setUiState({ phase: 'ordering' })
        }
        return
      }

      // Redirect to Mollie checkout
      window.location.href = data.checkoutUrl
    } catch {
      setErrorMsg(t('paymentFailed'))
      setUiState({ phase: 'ordering' })
    }
  }

  // ── Tab locked for payment ─────────────────────────────────────────────────
  const isPendingPayment = tab?.status === 'pending_payment'

  // Show pay button when tab is open and has a payable total
  const canPay =
    tab !== null &&
    tab.status === 'open' &&
    tab.totals.payableTotal > 0

  // ── Verifying state ───────────────────────────────────────────────────────
  if (uiState.phase === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
        <p className="text-sm font-medium text-gray-700">{t('confirmingPayment')}</p>
      </div>
    )
  }

  // ── Paid state ────────────────────────────────────────────────────────────
  if (uiState.phase === 'paid') {
    const total = uiState.paidTotal ?? prePaidTotal
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-gray-900">{t('paidTitle')}</h2>
          <p className="text-sm text-gray-500">{t('paidSubtitle')}</p>
          {total !== undefined && (
            <p className="text-2xl font-bold text-gray-900 mt-2">{total.toFixed(2)}&nbsp;€</p>
          )}
        </div>
        <button
          onClick={() => {
            // Navigate back to the dine page without ?tabReturn so a fresh tab
            // can be opened lazily on the next order.
            router.replace(`/sites/${siteId}/dine/${tableId}`)
            // Reset local state so the user can start ordering again
            setUiState({ phase: 'ordering' })
            setTab(null)
            setTabLoading(true)
            void fetchTab()
          }}
          className="mt-2 px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold
                     active:bg-gray-800 transition-colors"
        >
          {t('startNewOrder')}
        </button>
      </div>
    )
  }

  // ── Closed (discarded / 404) state ────────────────────────────────────────
  if (uiState.phase === 'closed') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
          <svg className="w-8 h-8 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-1 9a1 1 0 01-1-1V9a1 1 0 112 0v5a1 1 0 01-1 1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-gray-900">{t('tabClosedTitle')}</h2>
          <p className="text-sm text-gray-500">{t('tabClosedSubtitle')}</p>
        </div>
      </div>
    )
  }

  // ── Render (ordering / confirm_pay / paying phases) ───────────────────────

  const { site, restaurant, table, products } = context

  const displayName = restaurant.name || site.name

  const availableProducts = products.filter((p) => p.active && !p.soldOut)

  return (
    <>
      {/* Floating banners */}
      {errorMsg && <ErrorBanner message={errorMsg} onDismiss={dismissError} />}
      {paymentFailedMsg && (
        <div
          role="status"
          aria-live="assertive"
          className="fixed top-4 inset-x-4 z-50 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm"
        >
          <svg className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <p className="flex-1 text-sm text-red-700">{paymentFailedMsg}</p>
          <button onClick={dismissPaymentFailed} className="text-red-400 hover:text-red-600 ml-1">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}
      {successVisible && <SuccessBanner message={t('orderReceived')} />}

      {/* ── Page ── */}
      <div className="min-h-screen bg-gray-50 pb-32">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-4 pt-12 pb-4">
          <div className="max-w-xl mx-auto flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{displayName}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{t('dineIn')}</p>
            </div>
            <TableChip label={table.label} number={table.number} />
          </div>
        </header>

        {/* Pending-payment banner */}
        {isPendingPayment && (
          <div
            role="status"
            className="max-w-xl mx-auto mt-4 mx-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <p className="text-sm font-medium text-amber-800">{t('paymentInProgress')}</p>
            <p className="text-xs text-amber-600 mt-0.5">{t('paymentInProgressDesc')}</p>
          </div>
        )}

        {/* ── Menu section ── */}
        <section className="max-w-xl mx-auto px-4 pt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">{t('menuHeading')}</h2>

          {availableProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <p className="text-sm">{t('noProducts')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {CATEGORY_ORDER.map((cat) => {
                const catProducts = availableProducts.filter(
                  (p) => (p.category ?? 'food') === cat,
                )
                if (catProducts.length === 0) return null
                return (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      {CATEGORY_LABELS[cat]}
                    </h3>
                    <div className="space-y-2">
                      {catProducts.map((product) => {
                        const qty =
                          cart.find((b) => b.product.id === product.id)?.quantity ?? 0
                        return (
                          <div
                            key={product.id}
                            className="flex items-start gap-3 bg-white rounded-xl p-3 shadow-sm border border-gray-100"
                          >
                            {/* Product image */}
                            {product.imageUrl ? (
                              <Image
                                src={product.imageUrl}
                                alt={product.name}
                                width={64}
                                height={64}
                                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-gray-50 flex-shrink-0" />
                            )}

                            {/* Info + controls */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {product.name}
                              </p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-sm font-semibold text-gray-900">
                                  {product.totalPrice.toFixed(2)}&nbsp;€
                                </span>
                                <div className="flex items-center gap-1">
                                  {qty > 0 && (
                                    <>
                                      <button
                                        onClick={() => updateQuantity(product, -1)}
                                        disabled={isPendingPayment}
                                        aria-label={t('decreaseQty', { name: product.name })}
                                        className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center
                                                   text-gray-600 active:bg-gray-200 transition-colors
                                                   disabled:opacity-30 disabled:cursor-not-allowed"
                                      >
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                          <path d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" />
                                        </svg>
                                      </button>
                                      <span className="w-6 text-center text-sm font-medium text-gray-900">
                                        {qty}
                                      </span>
                                    </>
                                  )}
                                  <button
                                    onClick={() => updateQuantity(product, 1)}
                                    disabled={isPendingPayment}
                                    aria-label={t('addToCart', { name: product.name })}
                                    className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center
                                               text-white active:bg-gray-700 transition-colors
                                               disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Your tab section ── */}
        <section className="max-w-xl mx-auto px-4 pt-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">{t('yourTab')}</h2>

          {tabLoading ? (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
          ) : !tab ? (
            <div className="py-8 text-center text-sm text-gray-400">{t('tabEmpty')}</div>
          ) : (
            <div className="space-y-3">
              {/* Order rounds */}
              {tab.orders.map((order, idx) => (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {t('round', { n: idx + 1 })}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(order.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {order.items.map((item) => (
                      <div key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-[11px] font-medium text-gray-600 flex-shrink-0">
                            {item.quantity}
                          </span>
                          <span className="text-sm text-gray-800 truncate">{item.name}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-900 flex-shrink-0">
                          {item.totalPrice.toFixed(2)}&nbsp;€
                        </span>
                      </div>
                    ))}
                    {order.notes && (
                      <div className="px-4 py-2 text-xs text-gray-400 italic">{order.notes}</div>
                    )}
                  </div>
                </div>
              ))}

              {/* Totals block */}
              {tab.orders.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-2">
                  <div className="divide-y divide-gray-100">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-600">{t('ordersTotal')}</span>
                      <span className="text-sm font-medium text-gray-900">
                        {tab.totals.ordersTotal.toFixed(2)}&nbsp;€
                      </span>
                    </div>
                    {tab.totals.serviceFee > 0 && (
                      <div className="px-4 py-3 flex items-center justify-between">
                        <span className="text-sm text-gray-600">{t('serviceFee')}</span>
                        <span className="text-sm font-medium text-gray-900">
                          {tab.totals.serviceFee.toFixed(2)}&nbsp;€
                        </span>
                      </div>
                    )}
                    <div className="px-4 py-3 flex items-center justify-between bg-gray-50">
                      <span className="text-sm font-semibold text-gray-900">{t('payableTotal')}</span>
                      <span className="text-base font-bold text-gray-900">
                        {tab.totals.payableTotal.toFixed(2)}&nbsp;€
                      </span>
                    </div>
                  </div>

                  {/* Close & pay button */}
                  {canPay && uiState.phase === 'ordering' && (
                    <div className="px-4 pb-4 pt-3 border-t border-gray-100">
                      <button
                        onClick={handlePayClick}
                        className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold
                                   active:bg-gray-800 transition-colors"
                      >
                        {t('closeAndPay')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Fixed cart bar (only when cart has items and ordering is allowed) ── */}
      {totalItems > 0 && !isPendingPayment && uiState.phase === 'ordering' && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-4 py-3 z-20">
          <div className="max-w-xl mx-auto">
            <button
              onClick={() => setReviewOpen(true)}
              disabled={placing}
              className="w-full flex items-center justify-between h-12 rounded-xl bg-gray-900 text-white px-4
                         disabled:opacity-40 active:bg-gray-800 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20 text-xs font-bold">
                  {totalItems}
                </span>
                {t('reviewOrder')}
              </span>
              <span className="text-sm font-semibold">{cartTotal.toFixed(2)}&nbsp;€</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Order-review bottom sheet ── */}
      {reviewOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-30"
            onClick={() => setReviewOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed bottom-0 inset-x-0 z-40 bg-white rounded-t-2xl shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('reviewOrderTitle')}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-3 mb-1" />

            <div className="flex flex-col max-h-[75dvh]">
              {/* Sheet header */}
              <div className="px-5 pt-3 pb-3 flex items-center justify-between border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900">{t('reviewOrderTitle')}</h3>
                <button
                  onClick={() => setReviewOpen(false)}
                  className="text-gray-400 active:text-gray-600 p-1 -mr-1"
                  aria-label={t('close')}
                >
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* Cart items */}
              <div className="flex-1 overflow-auto px-5 py-3">
                {cart.map((item) => (
                  <div key={item.product.id} className="py-3 border-b border-gray-100 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-medium text-gray-600 flex-shrink-0">
                          {item.quantity}
                        </span>
                        <span className="text-sm text-gray-800 truncate">{item.product.name}</span>
                      </div>
                      <span className="text-sm font-medium text-gray-900 flex-shrink-0">
                        {(item.product.totalPrice * item.quantity).toFixed(2)}&nbsp;€
                      </span>
                    </div>
                    {/* Per-item note */}
                    <div className="ml-9 mt-1">
                      <input
                        type="text"
                        placeholder={t('itemNote')}
                        value={item.notes ?? ''}
                        onChange={(e) => updateItemNotes(item.product.id, e.target.value)}
                        maxLength={200}
                        className="w-full text-xs text-gray-500 bg-transparent border-b border-gray-100 focus:border-gray-300 outline-none py-1 placeholder:text-gray-300"
                      />
                    </div>
                  </div>
                ))}

                {/* Order-level note */}
                <div className="mt-3">
                  <textarea
                    placeholder={t('kitchenNote')}
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full text-xs text-gray-600 bg-gray-50 rounded-lg border border-gray-200 focus:border-gray-300 outline-none p-2 placeholder:text-gray-300 resize-none"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-gray-200 px-5 pb-6 pt-3 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">{t('total')}</span>
                  <span className="text-base font-semibold text-gray-900">
                    {cartTotal.toFixed(2)}&nbsp;€
                  </span>
                </div>
                <button
                  onClick={handlePlaceOrder}
                  disabled={placing || cart.length === 0}
                  className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold
                             disabled:opacity-40 active:bg-gray-800 transition-colors"
                >
                  {placing ? t('placingOrder') : t('placeOrder')}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm pay sheet ── */}
      {(uiState.phase === 'confirm_pay' || uiState.phase === 'paying') && tab && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30 z-30" aria-hidden="true" />
          <div
            className="fixed bottom-0 inset-x-0 z-40 bg-white rounded-t-2xl shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label={t('confirmPayTitle')}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-3 mb-1" />

            <div className="px-5 pt-4 pb-8 space-y-5">
              <h3 className="text-lg font-semibold text-gray-900">{t('confirmPayTitle')}</h3>

              {/* Summary breakdown */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="divide-y divide-gray-100">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-sm text-gray-600">{t('ordersTotal')}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {tab.totals.ordersTotal.toFixed(2)}&nbsp;€
                    </span>
                  </div>
                  {tab.totals.serviceFee > 0 && (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-sm text-gray-600">{t('serviceFee')}</span>
                      <span className="text-sm font-medium text-gray-900">
                        {tab.totals.serviceFee.toFixed(2)}&nbsp;€
                      </span>
                    </div>
                  )}
                  <div className="px-4 py-3 flex items-center justify-between bg-gray-50">
                    <span className="text-sm font-semibold text-gray-900">{t('payableTotal')}</span>
                    <span className="text-base font-bold text-gray-900">
                      {tab.totals.payableTotal.toFixed(2)}&nbsp;€
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2">
                <button
                  onClick={handleConfirmPay}
                  disabled={uiState.phase === 'paying'}
                  className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold
                             disabled:opacity-50 active:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                >
                  {uiState.phase === 'paying' && (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                  )}
                  {uiState.phase === 'paying' ? t('processingPayment') : t('confirmPay')}
                </button>
                {uiState.phase !== 'paying' && (
                  <button
                    onClick={handleCancelPay}
                    className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium
                               active:bg-gray-50 transition-colors"
                  >
                    {t('cancelPay')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

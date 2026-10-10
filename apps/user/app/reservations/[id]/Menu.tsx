'use client'

import { v4 as uuidv4 } from 'uuid'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { getProducts, createOrder, getOrders, completeUnpaidOrder } from './actions'
import { Product, Invoice } from '@/app/types/types'
import Drawer from '@mui/material/Drawer'
import CircularProgress from '@mui/material/CircularProgress'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import ListAltIcon from '@mui/icons-material/ListAlt'
import { useSession } from 'next-auth/react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/store/store'
import { setValue } from '@/store/features/reservation/reservationSlice'
import { useGetOrderByIdQuery } from '@/store/features/api/apiSlice'
import OrderPaymentView from '@/app/payment/OrderPayment'
import { ORDER_PROCESSING } from '@repo/data/reservation-status'
import Orders from './Orders'
import { trackReservationCreated } from '@/app/analytics/track'
import { useTranslations } from 'next-intl'

const MAX_ITEM_QTY = 99

const CATEGORY_ORDER = ['food', 'drink', 'snack', 'accessory'] as const

export default function Menu({
  siteId,
  reservationId,
  seatId,
  siteType,
  paymentProvider,
  orders,
  showConfirmation,
}: {
  siteId: string
  reservationId: string
  seatId?: string
  siteType?: string
  paymentProvider?: string
  orders?: {
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
  }[] | null
  showConfirmation?: boolean
}) {

  const isUnpaid = siteType !== 'paid'

  const t = useTranslations('Menu')

  const CATEGORY_LABELS: Record<string, string> = {
    food: t('Food'),
    drink: t('Drinks'),
    snack: t('Snacks'),
    accessory: t('Accessories'),
  }

  const { data: session } = useSession()
  const dispatch = useDispatch()
  const reservationState = useSelector((state: RootState) => state.reservation)
  const { orderState, pendingOrderId } = reservationState

  /* ── All hooks BEFORE any conditional return ── */

  const { data: order } = useGetOrderByIdQuery(
    { id: pendingOrderId },
    { skip: !pendingOrderId },
  )

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [basket, setBasket] = useState<Array<{ product: Product; quantity: number; notes?: string }>>([]) 
  const [orderNotes, setOrderNotes] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerContent, setDrawerContent] = useState<'new-order' | 'orders'>('new-order')
  const [openConfirmation, setOpenConfirmation] = useState(showConfirmation ?? false)
  const [currentOrders, setCurrentOrders] = useState(orders ?? [])
  const [placing, setPlacing] = useState(false)

  useEffect(() => {
    if (!openConfirmation) return
    const timer = setTimeout(() => setOpenConfirmation(false), 4000)
    return () => clearTimeout(timer)
  }, [openConfirmation])

  useEffect(() => {
    getProducts(siteId)
      .then(setProducts)
      .finally(() => setLoading(false))
  }, [siteId])


  /* ── Basket helpers ── */

  const updateQuantity = (product: Product, delta: number) => {
    setBasket(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id)
      if (idx > -1) {
        const updated = [...prev]
        const newQty = updated[idx]!.quantity + delta
        if (newQty <= 0) updated.splice(idx, 1)
        else if (newQty > MAX_ITEM_QTY) return prev
        else updated[idx] = { ...updated[idx]!, quantity: newQty }
        return updated
      }
      return delta > 0 ? [...prev, { product, quantity: 1 }] : prev
    })
  }

  const updateItemNotes = (productId: string, notes: string) => {
    setBasket(prev => prev.map(item =>
      item.product.id === productId ? { ...item, notes } : item
    ))
  }

  const totalItems = basket.reduce((s, i) => s + i.quantity, 0)
  const totalPrice = basket.reduce((s, i) => s + i.quantity * i.product.totalPrice, 0)

  // Fees are included in the product price — customer pays exactly totalPrice

  /* ── Order placement ── */

  const handlePlaceOrder = async () => {
    if (placing) return
    setPlacing(true)
    dispatch(setValue({ orderState: 'saving' }))

    let anonId: string | undefined
    if (!session?.user?.id) {
      anonId = localStorage.getItem('sunbnb-anonId') ?? undefined
      if (!anonId) {
        anonId = uuidv4()
        localStorage.setItem('sunbnb-anonId', anonId)
      }
    }

    const result = await createOrder({ items: basket, siteId, anonId, reservationId, seatId, notes: orderNotes || undefined })

    if (result?.status === 'ok' && result.id) {
      if (isUnpaid) {
        // Off-platform billing: complete immediately without payment
        // A guest proves ownership with the anonId the order was created under —
        // without it the action refuses ('Authentication required') and the
        // order stays pending, invisible to the kitchen.
        await completeUnpaidOrder(result.id, anonId)
        trackReservationCreated({ kind: 'fnb', siteId, transactionId: result.id })
        // Refresh orders list, clear basket, close drawer, show confirmation
        getOrders({ reservationId }).then(r => { if (Array.isArray(r)) setCurrentOrders(r) })
        setBasket([])
        setOrderNotes('')
        setDrawerOpen(false)
        setOpenConfirmation(true)
        dispatch(setValue({ orderState: undefined, pendingOrderId: undefined }))
      } else {
        dispatch(setValue({
          orderState: 'processing',
          pendingOrderId: result.id,
          panelBottom: 'bottom-0',
        }))
      }
    }
    setPlacing(false)
  }

  const handleOpenOrders = () => {
    getOrders({ reservationId }).then(result => {
      if (Array.isArray(result)) setCurrentOrders(result)
    })
    setDrawerContent('orders')
    setDrawerOpen(true)
  }

  /* ── Drawer content ── */

  const anonId = typeof window !== 'undefined' ? localStorage.getItem('sunbnb-anonId') : null

  const fmt = (n: number) => `€${n.toFixed(2)}`

  // Step 1 — review: items (with per-item notes), kitchen notes, one CTA that
  // says what happens next. Step 2 (paid sites) — the payment panel, headed by a
  // compact summary of what is being paid for.
  const orderPreview = !order ? (
    <div className="flex flex-col" style={{ maxHeight: '75dvh' }}>
      <div className="px-5 pt-3 pb-2">
        <h3 className="text-lg font-semibold text-brand-ink">{isUnpaid ? t('Confirm your order') : t('Review your order')}</h3>
        <p className="mt-0.5 text-xs text-brand-ink/70">
          {totalItems} {totalItems === 1 ? t('item') : t('items')}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-5">
        <ul className="divide-y divide-brand-ink/[0.07]">
          {basket.map(item => (
            <li key={item.product.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span className="text-sm font-semibold text-brand-gold tabular-nums">{item.quantity}×</span>
                  <span className="truncate text-sm font-medium text-brand-ink">{item.product.name}</span>
                </span>
                <span className="text-sm font-medium text-brand-ink tabular-nums">{fmt(item.product.totalPrice * item.quantity)}</span>
              </div>
              <input
                type="text"
                aria-label={`${t('Special instructions (optional)')} — ${item.product.name}`}
                placeholder={t('Special instructions (optional)')}
                value={item.notes ?? ''}
                onChange={(e) => updateItemNotes(item.product.id, e.target.value)}
                maxLength={200}
                className="mt-1.5 ml-7 w-[calc(100%-1.75rem)] border-0 border-b border-transparent bg-transparent py-1 text-xs text-brand-ink
                           placeholder:text-brand-ink/40 focus:border-brand-ink/20 focus:outline-hidden"
              />
            </li>
          ))}
        </ul>

        <textarea
          aria-label={t('Notes for the kitchen (optional)')}
          placeholder={t('Notes for the kitchen (optional)')}
          value={orderNotes}
          onChange={(e) => setOrderNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-2 mb-3 w-full resize-none rounded-xl bg-cream-light p-3 text-xs text-brand-ink ring-1 ring-brand-ink/8
                     placeholder:text-brand-ink/40 focus:outline-hidden focus:ring-brand-ink/25"
        />
      </div>

      <div className="space-y-3 border-t border-brand-ink/8 px-5 pt-3 pb-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-brand-ink">{t('Total')}</span>
          <span className="text-lg font-semibold text-brand-ink tabular-nums">{fmt(totalPrice)}</span>
        </div>
        {isUnpaid && <p className="-mt-1 text-xs text-brand-ink/70">{t('You pay at the venue')}</p>}
        <button
          onClick={handlePlaceOrder}
          disabled={placing || basket.length === 0}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-brand-ink text-sm font-semibold text-cream
                     transition-colors hover:bg-brand-ink-hover active:bg-brand-ink-hover disabled:opacity-40"
        >
          {placing
            ? t('Placing order')
            : <span className="tabular-nums">{isUnpaid ? t('Send order') : t('Continue to payment')}&ensp;·&ensp;{fmt(totalPrice)}</span>}
        </button>
      </div>
    </div>
  ) : (
    <div className="px-5 pt-3 pb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-brand-ink">{t('Order payment')}</h3>
        <span className="text-lg font-semibold text-brand-ink tabular-nums">{fmt(order.totalPrice)}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {basket.map(item => (
          <li key={item.product.id} className="flex justify-between gap-3 text-xs text-brand-ink/70">
            <span className="truncate">{item.quantity}× {item.product.name}</span>
            <span className="tabular-nums">{fmt(item.product.totalPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  const paymentContent =
    orderState === ORDER_PROCESSING || orderState === 'payment_in_progress' ? (
      !order ? (
        <div className="flex justify-center py-12">
          <CircularProgress size={28} sx={{ color: '#17323a' }} />
        </div>
      ) : (
        <OrderPaymentView
          paymentProvider={paymentProvider}
          preview={orderPreview}
          completeUrl={`/reservations/${reservationId}${anonId ? `?anonId=${anonId}` : ''}`}
          order={order}
        />
      )
    ) : (
      orderPreview
    )

  /* ── Render ── */

  return (
    <div className="px-4 pt-4 pb-28">
      {/* Product grid – grouped by category, soldOut filtered */}
      {loading ? (
        <div className="flex justify-center py-16">
          <CircularProgress size={28} sx={{ color: '#9ca3af' }} />
        </div>
      ) : products.filter(p => !p.soldOut).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <p className="text-sm">{t('No products available')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.map(cat => {
            const catProducts = products.filter(p => !p.soldOut && (p.category ?? 'food') === cat)
            if (catProducts.length === 0) return null
            return (
              <div key={cat}>
                <h3 className="mb-3 flex items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-gold">
                  {CATEGORY_LABELS[cat]}
                  <span className="h-px flex-1 bg-brand-ink/10" aria-hidden="true" />
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {catProducts.map(product => {
                    const qty = basket.find(b => b.product.id === product.id)?.quantity ?? 0
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl bg-white p-3 ring-1 ring-brand-ink/[0.07]"
                      >
                        {/* Image */}
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={product.name}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-xl object-cover shrink-0"
                          />
                        ) : (
                          <ProductPlaceholder category={product.category ?? 'food'} />
                        )}

                        {/* Info + controls */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-medium leading-snug text-brand-ink truncate">{product.name}</p>
                          {product.description && (
                            <p className="text-xs leading-snug text-brand-ink/70 mt-0.5 line-clamp-2">{product.description}</p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-sm font-semibold text-brand-ink tabular-nums">
                              {fmt(product.totalPrice)}
                            </span>
                            <div className="flex items-center gap-1">
                              {qty > 0 && (
                                <>
                                  <button
                                    onClick={() => updateQuantity(product, -1)}
                                    aria-label={t('Remove one')}
                                    className="w-8 h-8 rounded-full bg-white ring-1 ring-brand-ink/15 flex items-center justify-center
                                               text-brand-ink hover:bg-cream-light active:bg-cream transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" />
                                    </svg>
                                  </button>
                                  <span className="w-6 text-center text-sm font-semibold text-brand-ink tabular-nums">{qty}</span>
                                </>
                              )}
                              <button
                                onClick={() => updateQuantity(product, 1)}
                                aria-label={t('Add one')}
                                className="w-8 h-8 rounded-full bg-brand-ink flex items-center justify-center
                                           text-cream hover:bg-brand-ink-hover active:bg-brand-ink-hover transition-colors"
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

      {/* Order-confirmed toast — sits just above the order bar, auto-dismisses */}
      {openConfirmation && (
        <div className="fixed inset-x-4 bottom-30 z-20 flex justify-center" role="status">
          <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 shadow-[0_8px_24px_-12px_rgba(23,50,58,0.35)]">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
            </svg>
            {t('Order received')}
            <button onClick={() => setOpenConfirmation(false)} aria-label={t('Dismiss')} className="-mr-1 ml-1 rounded-sm p-0.5 text-green-700/70 hover:text-green-800">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Fixed bottom bar */}
      <div className="fixed bottom-12 inset-x-0 px-4 py-2.5 bg-cream/95 backdrop-blur-xs border-t border-brand-ink/10 flex items-center gap-2 z-10">
        <button
          onClick={() => { setDrawerContent('new-order'); setDrawerOpen(true) }}
          disabled={basket.length === 0}
          className="flex-1 flex items-center justify-center gap-2.5 h-11 rounded-xl bg-brand-ink text-cream text-sm font-semibold
                     disabled:opacity-30 hover:bg-brand-ink-hover active:bg-brand-ink-hover transition-colors"
        >
          <span className="relative mr-2 inline-flex">
            <ShoppingCartIcon sx={{ fontSize: 18 }} />
            {totalItems > 0 && <CountBubble count={totalItems} className="bg-cream text-brand-ink" />}
          </span>
          <span className="tabular-nums">{isUnpaid ? t('Order') : t('Checkout')}&ensp;·&ensp;{fmt(totalPrice)}</span>
        </button>

        <button
          onClick={handleOpenOrders}
          aria-label={t('Your orders')}
          className="h-11 w-11 rounded-xl bg-white ring-1 ring-brand-ink/15 flex items-center justify-center
                     text-brand-ink hover:bg-cream-light active:bg-cream transition-colors"
        >
          <span className="relative inline-flex">
            <ListAltIcon sx={{ fontSize: 20 }} />
            {currentOrders.length > 0 && <CountBubble count={currentOrders.length} className="bg-brand-ink text-cream" />}
          </span>
        </button>
      </div>

      {/* Bottom drawer */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: { sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85dvh' } }
        }}
      >
        <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-brand-ink/15" aria-hidden="true" />
        {drawerContent === 'new-order' ? paymentContent : <Orders orders={currentOrders} reservationId={reservationId} />}
      </Drawer>
    </div>
  );
}

/** Item count on an icon — replaces MUI Badge (whose palette colours clashed). */
function CountBubble({ count, className }: { count: number; className: string }) {
  return (
    <span
      className={`absolute -right-2.5 -top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ${className}`}
    >
      {count}
    </span>
  )
}

/** Drawn stand-in for a product without a photo: a plate for food, a glass for drinks. */
function ProductPlaceholder({ category }: { category: string }) {
  const drink = category === 'drink'
  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-cream-dark" aria-hidden="true">
      <svg viewBox="0 0 32 32" className="h-7 w-7 text-brand-gold/70" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {drink ? (
          <>
            <path d="M10 6h12l-1.6 19.2A2 2 0 0 1 18.4 27h-4.8a2 2 0 0 1-2-1.8L10 6Z" />
            <path d="M10.6 12h10.8" />
          </>
        ) : (
          <>
            {/* plate, fork left, knife right */}
            <circle cx="16" cy="16" r="7.5" />
            <circle cx="16" cy="16" r="4.5" />
            <path d="M5 6v20M3.5 6v4.5a1.5 1.5 0 0 0 3 0V6" />
            <path d="M27.5 26V6c-1.7 1-2.5 3.3-2.5 6.5V15h2.5" />
          </>
        )}
      </svg>
    </div>
  )
}

'use client'

import { v4 as uuidv4 } from 'uuid'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { getProducts, createOrder, getOrders, completeUnpaidOrder } from './actions'
import { Product, Invoice } from '@/app/types/types'
import Badge from '@mui/material/Badge'
import Drawer from '@mui/material/Drawer'
import CircularProgress from '@mui/material/CircularProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import ListAltIcon from '@mui/icons-material/ListAlt'
import { useSession } from 'next-auth/react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/store/store'
import { setValue } from '@/store/features/reservation/reservationSlice'
import { useGetOrderByIdQuery } from '@/store/features/api/apiSlice'
import OrderPaymentView from '@/app/payment/OrderPayment'
import Orders from './Orders'

const MAX_ITEM_QTY = 99

export default function Menu({
  siteId,
  reservationId,
  seatId,
  siteType,
  stripePublicKey,
  paymentProvider,
  orders,
  showConfirmation,
}: {
  siteId: string
  reservationId: string
  seatId?: string
  siteType?: string
  stripePublicKey: string | undefined
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

  const isUnpaid = siteType === 'unpaid'

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
  const [basket, setBasket] = useState<Array<{ product: Product; quantity: number }>>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerContent, setDrawerContent] = useState<'new-order' | 'orders'>('new-order')
  const [openConfirmation, setOpenConfirmation] = useState(showConfirmation ?? false)
  const [currentOrders, setCurrentOrders] = useState(orders ?? [])
  const [placing, setPlacing] = useState(false)

  useEffect(() => {
    if (!showConfirmation) return
    const timer = setTimeout(() => setOpenConfirmation(false), 3000)
    return () => clearTimeout(timer)
  }, [showConfirmation])

  useEffect(() => {
    getProducts(siteId)
      .then(setProducts)
      .finally(() => setLoading(false))
  }, [siteId])

  /* ── Conditional return AFTER hooks ── */

  if (!isUnpaid && !stripePublicKey && paymentProvider !== 'mollie') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <p className="text-sm">Payment gateway unavailable</p>
      </div>
    )
  }

  /* ── Basket helpers ── */

  const updateQuantity = (product: Product, delta: number) => {
    setBasket(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id)
      if (idx > -1) {
        const updated = [...prev]
        const newQty = updated[idx]!.quantity + delta
        if (newQty <= 0) updated.splice(idx, 1)
        else if (newQty > MAX_ITEM_QTY) return prev
        else updated[idx] = { product, quantity: newQty }
        return updated
      }
      return delta > 0 ? [...prev, { product, quantity: 1 }] : prev
    })
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

    const result = await createOrder({ items: basket, siteId, anonId, reservationId, seatId })

    if (result?.status === 'ok' && result.id) {
      if (isUnpaid) {
        // Off-platform billing: complete immediately without payment
        await completeUnpaidOrder(result.id)
        // Refresh orders list, clear basket, close drawer, show confirmation
        getOrders({ reservationId }).then(r => { if (Array.isArray(r)) setCurrentOrders(r) })
        setBasket([])
        setDrawerOpen(false)
        setOpenConfirmation(true)
        dispatch(setValue({ orderState: undefined, pendingOrderId: undefined }))
      } else {
        dispatch(setValue({
          orderState: 'processing',
          pendingOrderId: result.id,
          panelBottom: 'bottom-[0px]',
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

  const orderPreview = !order ? (
    <div className="flex flex-col" style={{ height: '50dvh' }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-lg font-semibold text-gray-900">{isUnpaid ? 'Confirm your order' : 'Review your order'}</h3>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-auto px-5">
        {basket.map(item => (
          <div key={item.product.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                {item.quantity}
              </span>
              <span className="text-sm text-gray-800">{item.product.name}</span>
            </div>
            <span className="text-sm font-medium text-gray-900">
              {(item.product.totalPrice * item.quantity).toFixed(2)}&nbsp;€
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-5 pb-5 pt-3 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-base font-semibold text-gray-900">Total</span>
          <span className="text-base font-semibold text-gray-900">
            {totalPrice.toFixed(2)}&nbsp;€
          </span>
        </div>
        <button
          onClick={handlePlaceOrder}
          disabled={placing || basket.length === 0}
          className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold
                     disabled:opacity-40 active:bg-gray-800 transition-colors"
        >
          {placing ? 'Placing order…' : isUnpaid ? 'Confirm Order' : 'Place Order'}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between px-5 py-4">
      <h3 className="text-lg font-semibold text-gray-900">Order payment</h3>
      <span className="text-lg font-semibold text-gray-900">
        {totalPrice.toFixed(2)}&nbsp;€
      </span>
    </div>
  )

  const paymentContent =
    orderState === 'processing' || orderState === 'payment_in_progress' ? (
      !order ? (
        <div className="flex justify-center py-12">
          <CircularProgress size={32} />
        </div>
      ) : (
        <OrderPaymentView
          stripePublicKey={stripePublicKey}
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
      {/* Product grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <CircularProgress size={28} sx={{ color: '#9ca3af' }} />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <p className="text-sm">No products available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.map(product => {
            const qty = basket.find(b => b.product.id === product.id)?.quantity ?? 0
            return (
              <div
                key={product.id}
                className="flex items-start gap-3 bg-white rounded-xl p-3 shadow-sm border border-gray-100"
              >
                {/* Image */}
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
                  <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                  {product.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{product.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {product.totalPrice.toFixed(2)}&nbsp;€
                    </span>
                    <div className="flex items-center gap-1">
                      {qty > 0 && (
                        <>
                          <button
                            onClick={() => updateQuantity(product, -1)}
                            className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center
                                       text-gray-600 active:bg-gray-200 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" />
                            </svg>
                          </button>
                          <span className="w-6 text-center text-sm font-medium text-gray-900">{qty}</span>
                        </>
                      )}
                      <button
                        onClick={() => updateQuantity(product, 1)}
                        className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center
                                   text-white active:bg-gray-700 transition-colors"
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
      )}

      {/* Order-confirmed toast */}
      <Snackbar
        open={openConfirmation}
        onClose={() => setOpenConfirmation(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: 112 }}
      >
        <Alert onClose={() => setOpenConfirmation(false)} severity="success" sx={{ width: '100%' }}>
          Order received
        </Alert>
      </Snackbar>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-12 inset-x-0 px-4 py-2.5 bg-white/95 backdrop-blur-sm border-t border-gray-100 flex items-center gap-2 z-10">
        <button
          onClick={() => { setDrawerContent('new-order'); setDrawerOpen(true) }}
          disabled={basket.length === 0}
          className="flex-1 flex items-center justify-center gap-2.5 h-11 rounded-xl bg-gray-900 text-white text-sm font-semibold
                     disabled:opacity-30 active:bg-gray-800 transition-colors"
        >
          <Badge
            badgeContent={totalItems}
            color="secondary"
            sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 18, height: 18 } }}
          >
            <ShoppingCartIcon sx={{ fontSize: 18 }} />
          </Badge>
          <span>{isUnpaid ? 'Order' : 'Checkout'}&ensp;–&ensp;{totalPrice.toFixed(2)}&nbsp;€</span>
        </button>

        <button
          onClick={handleOpenOrders}
          className="h-11 w-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center
                     text-gray-600 active:bg-gray-50 transition-colors"
        >
          {currentOrders.length > 0 ? (
            <Badge
              badgeContent={currentOrders.length}
              color="error"
              sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 16, height: 16 } }}
            >
              <ListAltIcon sx={{ fontSize: 20 }} />
            </Badge>
          ) : (
            <ListAltIcon sx={{ fontSize: 20 }} />
          )}
        </button>
      </div>

      {/* Bottom drawer */}
      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
      >
        <div className="w-12 h-1 rounded-full bg-gray-300 mx-auto mt-2 mb-1" />
        {drawerContent === 'new-order' ? paymentContent : <Orders orders={currentOrders} />}
      </Drawer>
    </div>
  )
}

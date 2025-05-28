'use client'

import { useEffect, useMemo, useState } from 'react'
import { setOrderStatus, getOrders } from '../actions'
import { Order } from '@/types/shared'
import { get } from 'http';

export default function Orders({ siteId, orders }: { siteId: string; orders: Order[] }) {

  const now = new Date()
  const [updatedOrders, setUpdatedOrders] = useState<Order[]>(orders)

  useEffect(() => {
    const intervalId = setInterval(() => {
      getOrders(siteId)
        .then((result) => {
          setUpdatedOrders(result.orders || [])
        })
    }, 1000)
  
    return () => clearInterval(intervalId)
  }, [])

  const sorted = useMemo(
    () =>
      [...updatedOrders].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [updatedOrders]
  )

  const clamp = (v: number, min: number, max: number) =>
    v < min ? min : v > max ? max : v

  const fresh = { r: 204, g: 255, b: 204 }
  const stale = { r: 255, g: 192, b: 203 }

  return (
    <div className="w-full space-y-4 py-4 px-4">
      {sorted.map((order) => {
        const createdTime = new Date(order.createdAt).getTime()
        const diffMs = now.getTime() - createdTime
        const diffMin = diffMs / 60000
        const ratio = clamp((diffMin - 2) / (15 - 2), 0, 1)
        const R = Math.round(fresh.r + ratio * (stale.r - fresh.r))
        const G = Math.round(fresh.g + ratio * (stale.g - fresh.g))
        const B = Math.round(fresh.b + ratio * (stale.b - fresh.b))

        const mins = Math.floor(diffMs / 60000)
        const secs = Math.floor((diffMs % 60000) / 1000)
        const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

        const sumNet = order.price
        const sumTotal = order.totalPrice
        const sumTax = sumTotal - sumNet

        return (
          <div
            key={order.id}
            className="w-full rounded-lg p-4 text-black"
            style={{ backgroundColor: `rgb(${R},${G},${B})` }}
          >
            {/* Header row: elapsed + status grouped, seat prominent */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div className="text-2xl font-bold">{elapsed}</div>
              </div>
              <div className="flex">
                <div className="px-3 py-1 bg-white bg-opacity-60 rounded-full font-semibold mr-2">
                  {order.status.toUpperCase()}
                </div>
                <div className="text-3xl font-extrabold">{order.seat?.number ?? '–'}</div>
              </div>
            </div>

            {/* Items list */}
            <div className="overflow-x-auto">
              <div className="min-w-full grid grid-cols-4 text-xs font-semibold mb-1">
                <div>Item × Qty</div>
                <div className="text-right">Price (€)</div>
                <div className="text-right">Tax (€)</div>
                <div className="text-right">Total (€)</div>
              </div>
              {order.orderItems.map((it) => {
                const price = it.price * it.quantity
                const total = it.totalPrice * it.quantity
                const taxAmt = total - price
                return (
                  <div
                    key={it.id}
                    className="min-w-full grid grid-cols-4 text-sm mb-1"
                  >
                    <div>{`${it.name} × ${it.quantity}`}</div>
                    <div className="text-right">{price.toFixed(2)}</div>
                    <div className="text-right">{taxAmt.toFixed(2)}</div>
                    <div className="text-right">{total.toFixed(2)}</div>
                  </div>
                )
              })}
            </div>

            {/* Footer totals */}
            <div className="mt-2 grid grid-cols-4 text-sm font-semibold border-t pt-2">
              <div>Total</div>
              <div className="text-right">€{sumNet.toFixed(2)}</div>
              <div className="text-right">€{sumTax.toFixed(2)}</div>
              <div className="text-right">€{sumTotal.toFixed(2)}</div>
            </div>

            {/* Action buttons */}
            <div className="flex space-x-2 mt-4">
              <button
                onClick={() => setOrderStatus(siteId, order.id, 'completed')}
                className="flex-1 bg-white border border-green-600 text-green-600 hover:bg-green-50 py-2 rounded-md font-semibold"
              >
                COMPLETE
              </button>
              <button
                onClick={() => setOrderStatus(siteId, order.id, 'discarded')}
                className="flex-1 bg-white border border-red-600 text-red-600 hover:bg-red-50 py-2 rounded-md font-semibold"
              >
                DISCARD
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

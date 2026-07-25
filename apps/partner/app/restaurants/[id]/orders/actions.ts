'use server'

import { revalidatePath } from 'next/cache'
import { verifyRestaurantAccess } from '@/lib/auth-helpers'
import { isValidOrderStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import {
  ORDER_ACCEPTED,
  ORDER_READY,
  ORDER_DELIVERED,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'
import { processConfirmedTabPayment } from '@repo/data/tab-payment'
import {
  isValidTransition,
  TAB_STATUSES,
  VALID_ORDER_TABS,
  TAB_ORDER_VOID_STATUSES,
  computeTabAmountDue,
  mapTabToSummary,
  type OrderTab,
  type TabSummary,
} from '@/app/sites/[id]/orders/shared'

/**
 * Restaurant-scoped siblings of `sites/[id]/orders/actions.ts`, sharing the
 * status-machine + tab-summary logic via `shared.ts`. Every action here is
 * gated by `verifyRestaurantAccess` (restaurant-keyed token-or-session gate,
 * mirrors `verifySiteAccess`) and every ownership check compares against
 * `restaurantId` (`order.restaurantId` / `tab.restaurantId`) instead of
 * `siteId`. Powers the restaurant-scoped kitchen/orders dashboard at
 * `/restaurants/[id]/orders` — used by both standalone restaurants and
 * linked venues (which also keep the site-scoped dashboard for room-service
 * orders + the dual-written dine tabs).
 */

// ─── Set Order Status ────────────────────────────────────────────────────────

export async function setRestaurantOrderStatus(
  restaurantId: string,
  orderId: string,
  status: string,
  reason?: string,
  accessKey?: string,
) {
  if (reason !== undefined && typeof reason === 'string' && reason.length > 500) {
    return { status: 'error', errors: ['Reason is too long (max 500 characters)'] }
  }

  const { error } = await verifyRestaurantAccess(restaurantId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidOrderStatus(status)) {
    return { status: 'error', errors: ['Invalid order status'] }
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, restaurantId: true },
  })

  if (!order || order.restaurantId !== restaurantId) {
    return { status: 'error', errors: ['Order not found'] }
  }

  if (!isValidTransition(order.status, status)) {
    return { status: 'error', errors: [`Cannot transition from '${order.status}' to '${status}'`] }
  }

  const data: Record<string, any> = { status }

  if (status === ORDER_ACCEPTED)  data.acceptedAt = new Date()
  if (status === ORDER_READY)     data.readyAt = new Date()
  if (status === ORDER_DELIVERED) data.deliveredAt = new Date()
  if (status === 'rejected' && reason) data.rejectReason = reason

  await prisma.order.update({ where: { id: orderId }, data })
  revalidatePath(`/restaurants/${restaurantId}/orders`)

  return { status: 'ok' }
}

// ─── Get Orders ──────────────────────────────────────────────────────────────

export async function getRestaurantOrders(
  restaurantId: string,
  tab: OrderTab = 'incoming',
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; orders?: any[] }> {

  if (!VALID_ORDER_TABS.includes(tab)) {
    return { status: 'error', errors: ['Invalid tab'] }
  }

  const { error } = await verifyRestaurantAccess(restaurantId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const statuses = TAB_STATUSES[tab]

  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      status: { in: statuses },
    },
    include: {
      seat: true,
      orderItems: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return { status: 'ok', orders }
}

// ─── Open Tabs ───────────────────────────────────────────────────────────────

/**
 * Return all open tabs (TAB_OPEN or TAB_PENDING_PAYMENT) for the given
 * restaurant. Mirrors `sites/[id]/orders/actions.ts` `getOpenTabs` — same
 * cash-amount-due computation, filtered by `restaurantId` instead of
 * `siteId`. Linked-venue dine tabs are dual-written (`siteId` set too) but
 * this dashboard is restaurant-only, so it surfaces every dine tab for the
 * restaurant regardless of whether it's also linked to a site.
 */
export async function getRestaurantOpenTabs(
  restaurantId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; tabs?: TabSummary[] }> {
  const { error } = await verifyRestaurantAccess(restaurantId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const tabs = await prisma.tableTab.findMany({
    where: {
      restaurantId,
      status: { in: [TAB_OPEN, TAB_PENDING_PAYMENT] },
    },
    include: {
      table: { select: { number: true, label: true } },
      orders: {
        where: { status: { notIn: TAB_ORDER_VOID_STATUSES } },
        include: {
          orderItems: { select: { name: true, quantity: true, totalPrice: true } },
        },
      },
    },
    orderBy: { openedAt: 'asc' },
  })

  return { status: 'ok', tabs: tabs.map(mapTabToSummary) }
}

// ─── Settle Tab (Cash) ────────────────────────────────────────────────────────

/**
 * Settle an open tab as cash. Mirrors `settleTabCash` — ownership check is
 * `tab.restaurantId === restaurantId` instead of `tab.siteId === siteId`.
 */
export async function settleRestaurantTabCash(
  restaurantId: string,
  tabId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; amountDue?: number }> {
  const { error } = await verifyRestaurantAccess(restaurantId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    include: {
      orders: {
        where: { status: { notIn: TAB_ORDER_VOID_STATUSES } },
        select: { totalPrice: true, paymentAmount: true },
      },
    },
  })

  if (!tab || tab.restaurantId !== restaurantId) {
    return { status: 'error', errors: ['Tab not found'] }
  }

  if (tab.status === TAB_PENDING_PAYMENT) {
    return {
      status: 'error',
      errors: ['An online payment is in progress for this tab. Wait for it to complete or time out before settling as cash.'],
    }
  }

  if (tab.status !== TAB_OPEN) {
    return { status: 'error', errors: ['Tab is already closed'] }
  }

  const amountDue = computeTabAmountDue(tab.orders)

  await processConfirmedTabPayment(tabId, { cash: true })

  revalidatePath(`/restaurants/${restaurantId}/orders`)
  return { status: 'ok', amountDue }
}

// ─── Discard Tab ─────────────────────────────────────────────────────────────

/**
 * Discard an open tab (walk-out / no charge). Mirrors `discardTab` —
 * ownership check is `tab.restaurantId === restaurantId`. `openTableId` is
 * still nulled unconditionally — it releases the one-open-tab-per-table
 * guard regardless of which dashboard (site or restaurant) closed the tab.
 */
export async function discardRestaurantTab(
  restaurantId: string,
  tabId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[] }> {
  const { error } = await verifyRestaurantAccess(restaurantId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const tab = await prisma.tableTab.findUnique({
    where: { id: tabId },
    include: {
      orders: {
        where: { status: { notIn: TAB_ORDER_VOID_STATUSES } },
        select: { id: true },
      },
    },
  })

  if (!tab || tab.restaurantId !== restaurantId) {
    return { status: 'error', errors: ['Tab not found'] }
  }

  if (tab.status === TAB_PENDING_PAYMENT) {
    return {
      status: 'error',
      errors: ['An online payment is in progress for this tab. Wait for it to complete or time out before discarding.'],
    }
  }

  if (tab.status !== TAB_OPEN) {
    return { status: 'error', errors: ['Tab is already closed'] }
  }

  const orderIds = tab.orders.map((o) => o.id)
  const closedAt = new Date()

  await prisma.$transaction([
    ...(orderIds.length > 0
      ? [prisma.order.updateMany({
          where: { id: { in: orderIds } },
          data: { status: 'discarded' },
        })]
      : []),
    prisma.tableTab.update({
      where: { id: tabId },
      data: {
        status: 'discarded',
        closedAt,
        openTableId: null,
      },
    }),
  ])

  revalidatePath(`/restaurants/${restaurantId}/orders`)
  return { status: 'ok' }
}

'use server'

import { revalidatePath } from 'next/cache'
import { verifySiteAccess } from '@/lib/auth-helpers'
import { isValidOrderStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
import {
  ORDER_ACCEPTED,
  ORDER_READY,
  ORDER_DELIVERED,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'
import { processConfirmedTabPayment, calculateTabTotal } from '@repo/data/tab-payment'
import {
  isValidTransition,
  TAB_STATUSES,
  VALID_ORDER_TABS,
  TAB_ORDER_VOID_STATUSES,
  computeTabAmountDue,
  mapTabToSummary,
  type OrderTab,
  type TabSummary,
  HISTORY_TAB_LIMIT,
} from './shared'

// Re-exported so existing consumers (view.tsx, gated-actions.ts) keep
// importing these types/values from './actions' without changes.
export type { OrderTab, TabSummary }

// ─── Set Order Status ────────────────────────────────────────────────────────

export async function setOrderStatus(
  siteId: string,
  orderId: string,
  status: string,
  reason?: string,
  accessKey?: string,
) {
  if (reason !== undefined && typeof reason === 'string' && reason.length > 500) {
    return { status: 'error', errors: ['Reason is too long (max 500 characters)'] }
  }

  const { error } = await verifySiteAccess(siteId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  if (!isValidOrderStatus(status)) {
    return { status: 'error', errors: ['Invalid order status'] }
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, siteId: true },
  })

  if (!order || order.siteId !== siteId) {
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
  revalidatePath(`/sites/${siteId}/orders`)

  return { status: 'ok' }
}

// ─── Get Orders ──────────────────────────────────────────────────────────────

export async function getOrders(
  siteId: string,
  tab: OrderTab = 'incoming',
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; orders?: any[] }> {

  if (!VALID_ORDER_TABS.includes(tab)) {
    return { status: 'error', errors: ['Invalid tab'] }
  }

  const { error } = await verifySiteAccess(siteId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const statuses = TAB_STATUSES[tab]

  // History is capped to the latest HISTORY_TAB_LIMIT rows (track 020 P5) —
  // it grows with site lifetime and this action is polled every 5s. Fetch
  // newest-first, then reverse so the displayed order stays oldest-first.
  const orders = await prisma.order.findMany({
    where: {
      siteId,
      status: { in: statuses },
    },
    include: {
      seat: true,
      orderItems: true,
    },
    orderBy: { createdAt: tab === 'history' ? 'desc' : 'asc' },
    ...(tab === 'history' ? { take: HISTORY_TAB_LIMIT } : {}),
  })
  if (tab === 'history') orders.reverse()

  return { status: 'ok', orders }
}

// ─── Toggle Product Sold Out ─────────────────────────────────────────────────

export async function toggleProductSoldOut(siteId: string, productId: string, soldOut: boolean, accessKey?: string) {
  const { error } = await verifySiteAccess(siteId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { siteId: true },
  })

  if (!product || product.siteId !== siteId) {
    return { status: 'error', errors: ['Product not found'] }
  }

  await prisma.product.update({
    where: { id: productId },
    data: { soldOut },
  })

  return { status: 'ok' }
}

// ─── Open Tabs ───────────────────────────────────────────────────────────────

/**
 * Return all open tabs (TAB_OPEN or TAB_PENDING_PAYMENT) for the given site.
 * For each tab, compute the cash amount due as the sum of non-voided orders'
 * totalPrice (DB values — never client-side). This is `ordersTotal` from
 * calculateTabTotal (without the service fee, which is an online-only add-on).
 */
export async function getOpenTabs(
  siteId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; tabs?: TabSummary[] }> {
  const { error } = await verifySiteAccess(siteId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const tabs = await prisma.tableTab.findMany({
    where: {
      siteId,
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
 * Settle an open tab as cash (staff collects from guest, no online payment).
 * Only TAB_OPEN tabs can be settled — if status is TAB_PENDING_PAYMENT an
 * online payment is mid-flight; attempting cash settle could double-charge.
 * Calls processConfirmedTabPayment with { cash: true } which creates a
 * PARTNER-only invoice (no platform commission) and sets status = settled_cash.
 */
export async function settleTabCash(
  siteId: string,
  tabId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; amountDue?: number }> {
  const { error } = await verifySiteAccess(siteId, accessKey)
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

  if (!tab || tab.siteId !== siteId) {
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

  // Amount due for display/receipt (ordersTotal — no service fee for cash).
  const amountDue = computeTabAmountDue(tab.orders)

  await processConfirmedTabPayment(tabId, { cash: true })

  revalidatePath(`/sites/${siteId}/orders`)
  return { status: 'ok', amountDue }
}

// ─── Discard Tab ─────────────────────────────────────────────────────────────

/**
 * Discard an open tab (walk-out / no charge).
 * Only TAB_OPEN tabs can be discarded — same guard as settleTabCash.
 * All non-voided orders are set to 'discarded'.
 * The tab is set to TAB_DISCARDED with closedAt = now() and openTableId = null.
 * openTableId MUST be nulled — it releases the one-open-tab-per-table guard
 * so a new tab can be opened on the same table immediately.
 * No invoice is created; no refund is issued.
 */
export async function discardTab(
  siteId: string,
  tabId: string,
  accessKey?: string,
): Promise<{ status: string; errors?: string[] }> {
  const { error } = await verifySiteAccess(siteId, accessKey)
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

  if (!tab || tab.siteId !== siteId) {
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

  revalidatePath(`/sites/${siteId}/orders`)
  return { status: 'ok' }
}

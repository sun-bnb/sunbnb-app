/**
 * Shared (non-'use server') kitchen-dashboard logic reused by both the
 * site-scoped (`sites/[id]/orders/actions.ts`) and restaurant-scoped
 * (`restaurants/[id]/orders/actions.ts`) order/tab actions modules.
 *
 * Pure data-shape + status-machine helpers only — no auth, no
 * `revalidatePath`, no Prisma writes. The two actions modules differ only in
 * their `where` clause (siteId vs restaurantId) and auth gate
 * (`verifySiteAccess` vs `verifyRestaurantAccess`); everything else (valid
 * status transitions, tab-summary shape/mapping, void-status filter) is
 * identical and lives here so the two modules can't drift.
 */

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

// ─── Tab Order Void Statuses ──────────────────────────────────────────────────
// Orders in these statuses are voided and excluded from cash amount calculation.
export const TAB_ORDER_VOID_STATUSES = [
  ORDER_DISCARDED,
  ORDER_REJECTED,
  'canceled',
  'refunded',
]

// ─── Status Transitions ─────────────────────────────────────────────────────

/**
 * Valid status transitions for the kitchen workflow:
 *   paid → accepted → preparing → ready → delivered → completed
 *   paid|accepted|preparing → rejected (with reason)
 *   any active status → discarded
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  paid:              [ORDER_ACCEPTED, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_COMPLETE]:  [ORDER_ACCEPTED, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_ACCEPTED]:  [ORDER_PREPARING, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_PREPARING]: [ORDER_READY, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_READY]:     [ORDER_DELIVERED, ORDER_DISCARDED],
  [ORDER_DELIVERED]: [ORDER_COMPLETED, ORDER_DISCARDED],
}

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ─── Order Tabs (kitchen dashboard filter tabs) ──────────────────────────────

export type OrderTab = 'incoming' | 'active' | 'ready' | 'history'

export const TAB_STATUSES: Record<OrderTab, string[]> = {
  incoming: [ORDER_COMPLETE],
  active:   [ORDER_ACCEPTED, ORDER_PREPARING],
  ready:    [ORDER_READY, ORDER_DELIVERED],
  history:  [ORDER_COMPLETED, ORDER_REJECTED, ORDER_DISCARDED],
}

export const VALID_ORDER_TABS: OrderTab[] = ['incoming', 'active', 'ready', 'history']

/**
 * History-tab window (track 020 P5). The kitchen tabs (incoming/active/ready)
 * are transient sets and stay unbounded, but `history` accumulates for the
 * site's LIFETIME — and the dashboard re-fetches its tab every 5 seconds, so
 * an old site re-downloaded its entire order history 17k times a day. The cap
 * keeps the LATEST rows (query desc, then reverse to preserve the existing
 * oldest-first display order); anything past it is dropped from the tail end
 * nobody scrolls to. NOT silent: the view can compare rows.length against
 * this constant to know the window is clipped.
 */
export const HISTORY_TAB_LIMIT = 200

// ─── Dine-in Tab Summary ──────────────────────────────────────────────────────

export interface TabSummary {
  id: string
  status: string
  tableNumber: number
  tableLabel: string | null
  openedAt: Date
  roundsCount: number
  /** Non-voided order items summary. */
  items: Array<{ name: string; quantity: number }>
  /** Cash amount due = ordersTotal (no service fee for cash — service fee is online-only). */
  amountDue: number
}

/**
 * Cash amount due for a tab from its non-voided orders — sum of
 * `paymentAmount ?? totalPrice` (DB values — never client-side), rounded to
 * cents. No service fee — that's an online-checkout add-on only.
 */
export function computeTabAmountDue(
  orders: Array<{ paymentAmount?: number | null; totalPrice?: number | null }>,
): number {
  return Math.round(
    orders.reduce((sum, o) => sum + (o.paymentAmount ?? o.totalPrice ?? 0), 0) * 100,
  ) / 100
}

/**
 * Map a TableTab row (with `table` + non-voided `orders` → `orderItems`
 * already loaded) into a `TabSummary`. Shared by the site- and
 * restaurant-scoped `getOpenTabs`-style queries — the Prisma include shape is
 * identical; only the `where` clause (siteId vs restaurantId) differs.
 */
export function mapTabToSummary(tab: {
  id: string
  status: string
  openedAt: Date
  table: { number: number; label: string | null }
  orders: Array<{
    paymentAmount?: number | null
    totalPrice?: number | null
    orderItems: Array<{ name: string; quantity: number; totalPrice: number }>
  }>
}): TabSummary {
  const allItems: Array<{ name: string; quantity: number }> = []
  for (const order of tab.orders) {
    for (const item of order.orderItems) {
      const existing = allItems.find((i) => i.name === item.name)
      if (existing) {
        existing.quantity += item.quantity
      } else {
        allItems.push({ name: item.name, quantity: item.quantity })
      }
    }
  }

  return {
    id: tab.id,
    status: tab.status,
    tableNumber: tab.table.number,
    tableLabel: tab.table.label,
    openedAt: tab.openedAt,
    roundsCount: tab.orders.length,
    items: allItems,
    amountDue: computeTabAmountDue(tab.orders),
  }
}

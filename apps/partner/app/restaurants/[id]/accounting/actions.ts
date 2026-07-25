'use server'

import prisma from '@repo/data/PrismaCient'
import { requireRestaurantOwnerWithFlag } from '@/lib/auth-helpers'

// ─── Dine-in tab invoice shape (mirrors sites/[id]/accounting getPaidItemsByMonth's 'tabs' field) ──

export interface RestaurantTabInvoiceLine {
  id: string
  description: string | null
  charge: number
  tax: number
  amount: number
  vatRate: number | null
  productCode: string | null
}

export interface RestaurantTabInvoiceEntry {
  id: string
  invoiceNumber: string | null
  invoicedAt: Date
  totalCharge: number
  totalTax: number
  totalAmount: number
  invoiceLines: RestaurantTabInvoiceLine[]
  tableTab: {
    id: string
    status: string
    closedAt: Date | null
    table: { number: number; label: string | null }
  } | null
}

/**
 * Dine-in tab invoices for a restaurant, scoped to a calendar month —
 * the minimal restaurant-side accounting surface (dine-in v2 Phase 6).
 * Session-only (no token path), gated by `requireRestaurantOwnerWithFlag`
 * (ownership + the 'restaurants' feature flag, mirrors every other
 * restaurant-settings action in this app).
 *
 * Query modeled on `sites/[id]/accounting/actions.ts` `getPaidItemsByMonth`'s
 * 'tabs' clause (:368-390) — PARTNER-issuer invoices linked via `tableTabId`
 * within the month window — but scoped `tableTab: { restaurantId }` instead
 * of `{ siteId }`, so it surfaces every dine tab for the restaurant
 * (standalone or site-linked) regardless of the site dashboard's own view.
 *
 * NOTE param order is (restaurantId, month, year) — deliberately NOT the
 * (siteId, year, month) order `getPaidItemsByMonth` uses; don't copy-paste
 * call sites across the two without checking.
 */
export async function getRestaurantTabInvoicesByMonth(
  restaurantId: string,
  month: number,
  year: number,
): Promise<
  | { status: 'ok'; invoices: RestaurantTabInvoiceEntry[] }
  | { status: 'error'; errors: string[] }
> {
  const { error } = await requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  if (error) return { status: 'error', errors: [error] }

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const invoices = await prisma.invoice.findMany({
    where: {
      issuerType: 'PARTNER',
      invoicedAt: { gte: start, lt: end },
      tableTabId: { not: null },
      tableTab: { restaurantId },
    },
    include: {
      invoiceLines: true,
      tableTab: {
        select: {
          id: true,
          status: true,
          closedAt: true,
          table: { select: { number: true, label: true } },
        },
      },
    },
    orderBy: { invoicedAt: 'desc' },
  })

  return { status: 'ok', invoices }
}

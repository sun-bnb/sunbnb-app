'use server'

import { auth } from '@/app/auth'
import { isFlagEnabled } from '@/app/flags'
import prisma from '@repo/data/PrismaCient'
import { calculateTabTotal } from '@repo/data/payment'
import { isValidEntityId } from '@/app/api/_lib/payment-ids'
import {
  ORDER_COMPLETE,
  TAB_OPEN,
  TAB_PENDING_PAYMENT,
} from '@repo/data/reservation-status'

// ─── placeTabOrder ───────────────────────────────────────────────────────────

export interface PlaceTabOrderItem {
  product: { id: string }
  quantity: number
  notes?: string
}

export interface PlaceTabOrderInput {
  siteId: string
  tableId: string
  anonId?: string
  notes?: string
  items: PlaceTabOrderItem[]
}

type PlaceTabOrderResult =
  | { status: 'ok'; orderId: string; tabId: string }
  | { status: 'error'; errors: string[] }

/**
 * Place an order against a dine-in tab. The tab is lazily opened on the
 * first order (find-or-create in a single transaction). Kitchen sees each
 * round immediately via ORDER_COMPLETE status; paid-ness is carried by the
 * tab, not the order status.
 *
 * QR-URL-as-credential model: any caller with the table CUID (from the QR)
 * may place orders. Authentication required only to distinguish anon vs
 * session identity for attribution.
 */
export async function placeTabOrder(
  input: PlaceTabOrderInput,
): Promise<PlaceTabOrderResult> {
  // ── Flag gate ────────────────────────────────────────────────────────────

  if (!(await isFlagEnabled('restaurants'))) {
    return { status: 'error', errors: ['feature_disabled'] }
  }

  // ── Validate required presence ───────────────────────────────────────────

  if (!input.siteId) {
    return { status: 'error', errors: ['siteId is required'] }
  }

  if (!input.tableId) {
    return { status: 'error', errors: ['tableId is required'] }
  }

  if (!input.items?.length) {
    return { status: 'error', errors: ['At least one item is required'] }
  }

  // ── Validate IDs ────────────────────────────────────────────────────────

  if (!isValidEntityId(input.siteId)) {
    return { status: 'error', errors: ['Invalid site ID'] }
  }

  if (!isValidEntityId(input.tableId)) {
    return { status: 'error', errors: ['Invalid table ID'] }
  }

  for (const item of input.items) {
    if (!isValidEntityId(item.product.id)) {
      return { status: 'error', errors: ['Invalid product ID'] }
    }
  }

  // ── Validate item counts (mirrors createOrder caps) ──────────────────────

  if (input.items.length > 50) {
    return { status: 'error', errors: ['Too many distinct items'] }
  }

  let totalQty = 0
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return { status: 'error', errors: ['Invalid item quantity'] }
    }
    totalQty += item.quantity
    if (totalQty > 200) {
      return { status: 'error', errors: ['Total quantity exceeds limit'] }
    }
  }

  // ── Site gate: exists + appSalesEnabled ─────────────────────────────────

  const site = await prisma.site.findUnique({
    where: { id: input.siteId },
    select: { userId: true, appSalesEnabled: true },
  })

  if (!site) {
    return { status: 'error', errors: ['Site not found'] }
  }

  if (!site.appSalesEnabled) {
    return { status: 'error', errors: ['Product ordering is not available for this site'] }
  }

  // ── Identity ────────────────────────────────────────────────────────────
  // Session user or anonId required. For anon callers we use the site
  // owner's userId to satisfy the Order.userId FK, exactly as createOrder.

  const session = await auth()
  let orderUserId = session?.user?.id

  if (!orderUserId) {
    if (!input.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    orderUserId = site.userId
  }

  // ── Table gate: active + table↔site match ───────────────────────────────
  // Load the table with its restaurant to verify:
  //   (a) table.status === 'active'
  //   (b) table.restaurant.siteId === input.siteId  (ownership check)

  const table = await prisma.table.findUnique({
    where: { id: input.tableId },
    select: {
      id: true,
      status: true,
      restaurant: {
        select: { id: true, siteId: true },
      },
    },
  })

  if (!table || table.status !== 'active') {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant || table.restaurant.siteId !== input.siteId) {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  const restaurantId = table.restaurant.id

  // ── Products: DB-priced, active, belong to site, not soldOut ────────────

  const productIds = input.items.map((i) => i.product.id)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, siteId: input.siteId, active: true },
  })

  const productMap = new Map(products.map((p) => [p.id, p]))

  for (const item of input.items) {
    const dbProduct = productMap.get(item.product.id)
    if (!dbProduct) {
      return { status: 'error', errors: ['One or more products are unavailable'] }
    }
    if (dbProduct.soldOut) {
      return { status: 'error', errors: [`${dbProduct.name} is currently sold out`] }
    }
  }

  // ── Calculate totals from DB prices (never trust client-supplied prices) ─

  let sumPrice = 0
  let sumTotalPrice = 0

  const orderItemsData = input.items.map((item) => {
    const product = productMap.get(item.product.id)!
    const linePrice = product.price * item.quantity
    const lineTotalPrice = product.totalPrice * item.quantity

    sumPrice += linePrice
    sumTotalPrice += lineTotalPrice

    return {
      productId: product.id,
      quantity: item.quantity,
      name: product.name,
      price: linePrice,
      tax: product.tax,
      totalPrice: lineTotalPrice,
      category: product.category ?? 'food',
      notes: item.notes?.slice(0, 200) || null,
    }
  })

  const tax = sumTotalPrice - sumPrice

  // ── Find-or-create tab + create order in ONE transaction ────────────────
  // Concurrency guard: TableTab.openTableId is unique, so a concurrent first
  // order that wins the race causes a P2002 on our tab create. On P2002 we
  // retry once by re-reading the winner's tab and attaching the order to it.

  const doTransaction = async (
    tx: typeof prisma,
    tabIdOverride?: string,
  ): Promise<{ orderId: string; tabId: string }> => {
    // Resolve the tab: use the override (retry path) or find/create.
    let resolvedTabId: string

    if (tabIdOverride) {
      resolvedTabId = tabIdOverride
    } else {
      // Check for an existing open tab on this table.
      const existingTab = await tx.tableTab.findFirst({
        where: { openTableId: input.tableId },
        select: { id: true, status: true },
      })

      if (existingTab) {
        // If the tab is awaiting payment, block new orders.
        if (existingTab.status === TAB_PENDING_PAYMENT) {
          throw new Error('TAB_PENDING_PAYMENT')
        }
        resolvedTabId = existingTab.id
      } else {
        // Create a new tab — this may throw P2002 if a concurrent first order wins.
        const newTab = await tx.tableTab.create({
          data: {
            tableId: input.tableId,
            restaurantId,
            siteId: input.siteId,
            openTableId: input.tableId,
            status: TAB_OPEN,
            anonId: input.anonId ?? null,
            userId: session?.user?.id ?? null,
          },
          select: { id: true },
        })
        resolvedTabId = newTab.id
      }
    }

    // Create the order in the same transaction.
    // orderUserId is: session.user.id for authenticated callers,
    // or site.userId for anonymous callers (satisfies FK constraint;
    // real customer is identified by anonId — same pattern as createOrder).
    const orderData: Record<string, unknown> = {
      status: ORDER_COMPLETE,
      price: sumPrice,
      tax,
      totalPrice: sumTotalPrice,
      paymentAmount: sumTotalPrice,
      anonId: input.anonId ?? null,
      notes: input.notes?.slice(0, 500) || null,
      tableId: input.tableId,
      orderItems: { create: orderItemsData },
      site: { connect: { id: input.siteId } },
      user: { connect: { id: orderUserId } },
      tab: { connect: { id: resolvedTabId } },
    }

    const newOrder = await tx.order.create({ data: orderData as any })

    return { orderId: newOrder.id, tabId: resolvedTabId }
  }

  // First attempt.
  try {
    const result = await prisma.$transaction((tx) => doTransaction(tx as typeof prisma))
    return { status: 'ok', ...result }
  } catch (err: unknown) {
    // Catch TAB_PENDING_PAYMENT sentinel thrown from within the transaction.
    if (err instanceof Error && err.message === 'TAB_PENDING_PAYMENT') {
      return { status: 'error', errors: ['Tab payment already in progress'] }
    }

    // Catch Prisma unique constraint violation on openTableId (P2002).
    const isPrismaP2002 =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'

    if (isPrismaP2002) {
      // A concurrent first order just won the race. Re-read the winner's tab
      // outside the failed transaction and retry with that id.
      const winnerTab = await prisma.tableTab.findFirst({
        where: { openTableId: input.tableId },
        select: { id: true, status: true },
      })

      if (!winnerTab) {
        return { status: 'error', errors: ['Unable to open tab — please try again'] }
      }

      if (winnerTab.status === TAB_PENDING_PAYMENT) {
        return { status: 'error', errors: ['Tab payment already in progress'] }
      }

      try {
        const result = await prisma.$transaction((tx) =>
          doTransaction(tx as typeof prisma, winnerTab.id),
        )
        return { status: 'ok', ...result }
      } catch {
        return { status: 'error', errors: ['Unable to place order — please try again'] }
      }
    }

    console.error('[placeTabOrder] unexpected error:', err)
    return { status: 'error', errors: ['Unable to place order — please try again'] }
  }
}

// ─── getTabState ─────────────────────────────────────────────────────────────

export interface TabOrderItem {
  id: string
  name: string
  quantity: number
  price: number
  totalPrice: number
  notes: string | null
}

export interface TabOrder {
  id: string
  status: string
  notes: string | null
  createdAt: Date
  items: TabOrderItem[]
}

export interface TabState {
  id: string
  status: string
  openedAt: Date
  orders: TabOrder[]
  totals: {
    ordersTotal: number
    serviceFee: number
    payableTotal: number
  }
}

type GetTabStateResult =
  | { status: 'ok'; tab: TabState | null }
  | { status: 'error'; errors: string[] }

/**
 * Public read for the dine-in tab page. No ownership check by design —
 * the QR URL (containing the table CUID) is the credential.
 */
export async function getTabState(
  siteId: string,
  tableId: string,
): Promise<GetTabStateResult> {
  if (!isValidEntityId(siteId)) {
    return { status: 'error', errors: ['Invalid site ID'] }
  }
  if (!isValidEntityId(tableId)) {
    return { status: 'error', errors: ['Invalid table ID'] }
  }

  const tab = await prisma.tableTab.findFirst({
    where: { openTableId: tableId, siteId },
    select: {
      id: true,
      status: true,
      openedAt: true,
      orders: {
        // Exclude voided orders (canceled/rejected/discarded/refunded) from the view.
        // calculateTabTotal uses the same exclusion; the list stays consistent with the bill.
        where: {
          status: { notIn: ['canceled', 'rejected', 'discarded', 'refunded'] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          notes: true,
          createdAt: true,
          orderItems: {
            select: {
              id: true,
              name: true,
              quantity: true,
              price: true,
              totalPrice: true,
              notes: true,
            },
          },
        },
      },
    },
  })

  if (!tab) {
    return { status: 'ok', tab: null }
  }

  const totalsRaw = await calculateTabTotal(tab.id)

  const tabState: TabState = {
    id: tab.id,
    status: tab.status,
    openedAt: tab.openedAt,
    orders: tab.orders.map((o) => ({
      id: o.id,
      status: o.status,
      notes: o.notes,
      createdAt: o.createdAt,
      items: o.orderItems.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
        totalPrice: i.totalPrice,
        notes: i.notes,
      })),
    })),
    totals: {
      ordersTotal: totalsRaw.ordersTotal,
      serviceFee: totalsRaw.serviceFee,
      payableTotal: totalsRaw.payableTotal,
    },
  }

  return { status: 'ok', tab: tabState }
}

// ─── getDineContext ───────────────────────────────────────────────────────────

export interface DineContext {
  site: {
    id: string
    name: string
  }
  restaurant: {
    id: string
    name: string
  }
  table: {
    id: string
    number: number
    label: string | null
  }
  products: Array<{
    id: string
    name: string
    price: number
    totalPrice: number
    tax: number
    category: string | null
    soldOut: boolean
    active: boolean
    imageUrl: string | null
  }>
}

type GetDineContextResult =
  | { status: 'ok'; context: DineContext }
  | { status: 'error'; errors: string[] }

/**
 * Landing-page context for the dine-in tab page. Returns site display info,
 * restaurant + table metadata, and the site's active products (same contract
 * as getProducts in reservations/[id]/actions.ts so the UI can reuse Menu).
 *
 * Same gates as placeTabOrder: flag, appSalesEnabled, table↔site match.
 */
export async function getDineContext(
  siteId: string,
  tableId: string,
): Promise<GetDineContextResult> {
  // ── Flag gate ────────────────────────────────────────────────────────────

  if (!(await isFlagEnabled('restaurants'))) {
    return { status: 'error', errors: ['feature_disabled'] }
  }

  // ── Validate IDs ────────────────────────────────────────────────────────

  if (!isValidEntityId(siteId)) {
    return { status: 'error', errors: ['Invalid site ID'] }
  }

  if (!isValidEntityId(tableId)) {
    return { status: 'error', errors: ['Invalid table ID'] }
  }

  // ── Site gate ────────────────────────────────────────────────────────────

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, appSalesEnabled: true },
  })

  if (!site) {
    return { status: 'error', errors: ['Site not found'] }
  }

  if (!site.appSalesEnabled) {
    return { status: 'error', errors: ['Product ordering is not available for this site'] }
  }

  // ── Table gate: active + table↔site ownership ────────────────────────────

  const table = await prisma.table.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      number: true,
      label: true,
      status: true,
      restaurant: {
        select: { id: true, name: true, siteId: true },
      },
    },
  })

  if (!table || table.status !== 'active') {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant || table.restaurant.siteId !== siteId) {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  // ── Products ─────────────────────────────────────────────────────────────

  const products = await prisma.product.findMany({
    where: { siteId, active: true },
    select: {
      id: true,
      name: true,
      price: true,
      totalPrice: true,
      tax: true,
      category: true,
      soldOut: true,
      active: true,
      imageUrl: true,
    },
    orderBy: { name: 'asc' },
  })

  return {
    status: 'ok',
    context: {
      site: {
        id: site.id,
        name: site.name,
      },
      restaurant: {
        id: table.restaurant.id,
        name: table.restaurant.name,
      },
      table: {
        id: table.id,
        number: table.number,
        label: table.label ?? null,
      },
      products,
    },
  }
}

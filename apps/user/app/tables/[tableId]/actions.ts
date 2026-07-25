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
 *
 * Restaurant-anchored (dine-in v2): the table id alone is the credential and
 * routing key — no siteId is accepted or required. Linked venues (whose
 * restaurant carries a siteId) dual-write siteId on the TableTab/Order so
 * site dashboards/accounting keep working; standalone restaurants leave it
 * null.
 */
export async function placeTabOrder(
  input: PlaceTabOrderInput,
): Promise<PlaceTabOrderResult> {
  // ── Flag gate ────────────────────────────────────────────────────────────

  if (!(await isFlagEnabled('restaurants'))) {
    return { status: 'error', errors: ['feature_disabled'] }
  }

  // ── Validate required presence ───────────────────────────────────────────

  if (!input.tableId) {
    return { status: 'error', errors: ['tableId is required'] }
  }

  if (!input.items?.length) {
    return { status: 'error', errors: ['At least one item is required'] }
  }

  // ── Validate IDs ────────────────────────────────────────────────────────

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

  // ── Table gate: exists + active + restaurant + dineInEnabled ────────────

  const table = await prisma.table.findUnique({
    where: { id: input.tableId },
    select: {
      id: true,
      status: true,
      restaurant: {
        select: { id: true, siteId: true, dineInEnabled: true, partnerAccountId: true },
      },
    },
  })

  if (!table || table.status !== 'active') {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant) {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant.dineInEnabled) {
    return { status: 'error', errors: ['Ordering is not available for this table'] }
  }

  const restaurant = table.restaurant
  const restaurantId = restaurant.id

  // ── Identity ────────────────────────────────────────────────────────────
  // Session user or anonId required. For anon callers we use the restaurant
  // owner's userId (Restaurant.partnerAccountId IS a User.id) to satisfy the
  // Order.userId FK, exactly as createOrder used site.userId.

  const session = await auth()
  let orderUserId = session?.user?.id

  if (!orderUserId) {
    if (!input.anonId) {
      return { status: 'error', errors: ['Authentication required'] }
    }
    orderUserId = restaurant.partnerAccountId
  }

  // ── Menu items: DB-priced, active, belong to restaurant, not soldOut ────

  const menuItemIds = input.items.map((i) => i.product.id)
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, restaurantId, active: true },
  })

  const menuItemMap = new Map(menuItems.map((m) => [m.id, m]))

  for (const item of input.items) {
    const dbMenuItem = menuItemMap.get(item.product.id)
    if (!dbMenuItem) {
      return { status: 'error', errors: ['One or more products are unavailable'] }
    }
    if (dbMenuItem.soldOut) {
      return { status: 'error', errors: [`${dbMenuItem.name} is currently sold out`] }
    }
  }

  // ── Calculate totals from DB prices (never trust client-supplied prices) ─

  let sumPrice = 0
  let sumTotalPrice = 0

  const orderItemsData = input.items.map((item) => {
    const menuItem = menuItemMap.get(item.product.id)!
    // Transitional guard for pre-v2 rows: totalPrice defaults to 0 until backfilled.
    const grossUnit = menuItem.totalPrice > 0 ? menuItem.totalPrice : menuItem.price
    const linePrice = menuItem.price * item.quantity
    const lineTotalPrice = grossUnit * item.quantity

    sumPrice += linePrice
    sumTotalPrice += lineTotalPrice

    return {
      productId: menuItem.id,
      quantity: item.quantity,
      name: menuItem.name,
      price: linePrice,
      tax: menuItem.tax,
      totalPrice: lineTotalPrice,
      category: menuItem.category ?? 'food',
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
        // Dual-write: siteId is set for linked venues (restaurant.siteId non-null),
        // null for standalone restaurants.
        const newTab = await tx.tableTab.create({
          data: {
            tableId: input.tableId,
            restaurantId,
            siteId: restaurant.siteId ?? null,
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
    // or restaurant.partnerAccountId for anonymous callers (satisfies FK
    // constraint; real customer is identified by anonId — same pattern as
    // createOrder). Dual-write: connect site only when the restaurant is
    // linked to one; always connect restaurant.
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
      restaurant: { connect: { id: restaurantId } },
      ...(restaurant.siteId ? { site: { connect: { id: restaurant.siteId } } } : {}),
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
 * the QR URL (containing the table CUID) is the credential. openTableId is
 * unique, so the table id alone identifies the open tab (no siteId filter
 * needed).
 */
export async function getTabState(tableId: string): Promise<GetTabStateResult> {
  if (!isValidEntityId(tableId)) {
    return { status: 'error', errors: ['Invalid table ID'] }
  }

  const tab = await prisma.tableTab.findFirst({
    where: { openTableId: tableId },
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
 * Landing-page context for the dine-in tab page. Returns restaurant + table
 * metadata and the restaurant's active MenuItem catalog, mapped to the same
 * product-shaped DTO the DineView already consumes (dine-in v1 sourced this
 * from site Product; v2 sources it from the restaurant's own MenuItem rail).
 *
 * Same gates as placeTabOrder: flag, table active, restaurant.dineInEnabled.
 * No site lookup at all — the table id is the sole credential/routing key.
 */
export async function getDineContext(tableId: string): Promise<GetDineContextResult> {
  // ── Flag gate ────────────────────────────────────────────────────────────

  if (!(await isFlagEnabled('restaurants'))) {
    return { status: 'error', errors: ['feature_disabled'] }
  }

  // ── Validate IDs ────────────────────────────────────────────────────────

  if (!isValidEntityId(tableId)) {
    return { status: 'error', errors: ['Invalid table ID'] }
  }

  // ── Table gate: active + restaurant + dineInEnabled ──────────────────────

  const table = await prisma.table.findUnique({
    where: { id: tableId },
    select: {
      id: true,
      number: true,
      label: true,
      status: true,
      restaurant: {
        select: { id: true, name: true, dineInEnabled: true },
      },
    },
  })

  if (!table || table.status !== 'active') {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant) {
    return { status: 'error', errors: ['Table not found or unavailable'] }
  }

  if (!table.restaurant.dineInEnabled) {
    return { status: 'error', errors: ['Ordering is not available for this table'] }
  }

  // ── Menu ─────────────────────────────────────────────────────────────────

  const menuItems = await prisma.menuItem.findMany({
    where: { restaurantId: table.restaurant.id, active: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  })

  const products = menuItems.map((m) => ({
    id: m.id,
    name: m.name,
    price: m.price,
    // Transitional guard for pre-v2 rows: totalPrice defaults to 0 until backfilled.
    totalPrice: m.totalPrice > 0 ? m.totalPrice : m.price,
    tax: m.tax,
    category: m.category,
    soldOut: m.soldOut,
    active: m.active,
    imageUrl: m.imageUrl,
  }))

  return {
    status: 'ok',
    context: {
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

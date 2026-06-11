'use server'

import { revalidatePath } from 'next/cache'
import { verifySiteAccess } from '@/lib/auth-helpers'
import { isValidOrderStatus } from '@/lib/validation'
import prisma from '@repo/data/PrismaCient'
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

// ─── Status Transitions ─────────────────────────────────────────────────────

/**
 * Valid status transitions for the kitchen workflow:
 *   paid → accepted → preparing → ready → delivered → completed
 *   paid|accepted|preparing → rejected (with reason)
 *   any active status → discarded
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  paid:              [ORDER_ACCEPTED, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_COMPLETE]:  [ORDER_ACCEPTED, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_ACCEPTED]:  [ORDER_PREPARING, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_PREPARING]: [ORDER_READY, ORDER_REJECTED, ORDER_DISCARDED],
  [ORDER_READY]:     [ORDER_DELIVERED, ORDER_DISCARDED],
  [ORDER_DELIVERED]: [ORDER_COMPLETED, ORDER_DISCARDED],
}

function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

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
  if (status === ORDER_REJECTED && reason) data.rejectReason = reason

  await prisma.order.update({ where: { id: orderId }, data })
  revalidatePath(`/sites/${siteId}/orders`)

  return { status: 'ok' }
}

// ─── Get Orders ──────────────────────────────────────────────────────────────

export type OrderTab = 'incoming' | 'active' | 'ready' | 'history'

const TAB_STATUSES: Record<OrderTab, string[]> = {
  incoming: [ORDER_COMPLETE],
  active:   [ORDER_ACCEPTED, ORDER_PREPARING],
  ready:    [ORDER_READY, ORDER_DELIVERED],
  history:  [ORDER_COMPLETED, ORDER_REJECTED, ORDER_DISCARDED],
}

export async function getOrders(
  siteId: string,
  tab: OrderTab = 'incoming',
  accessKey?: string,
): Promise<{ status: string; errors?: string[]; orders?: any[] }> {

  const validTabs: OrderTab[] = ['incoming', 'active', 'ready', 'history']
  if (!validTabs.includes(tab)) {
    return { status: 'error', errors: ['Invalid tab'] }
  }

  const { error } = await verifySiteAccess(siteId, accessKey)
  if (error) return { status: 'error', errors: [error] }

  const statuses = TAB_STATUSES[tab]

  const orders = await prisma.order.findMany({
    where: {
      siteId,
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

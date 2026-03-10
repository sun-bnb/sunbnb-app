'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  RESERVATION_COMPLETE,
  ORDER_COMPLETE,
} from '@repo/data/reservation-status'

export async function getInvoicesByMonth(
  accountId: string,
  year: number,
  month: number
) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const startDate = new Date(Date.UTC(year, month - 1, 1))
  const endDate = new Date(Date.UTC(year, month, 1))

  return prisma.invoice.findMany({
    where: {
      accountId: session.user.id,
      issuerType: 'PARTNER',
      invoicedAt: {
        gte: startDate,
        lt: endDate,
      },
    },
    include: {
      invoiceLines: true,
    },
    orderBy: { invoicedAt: 'desc' },
  })
}

export async function getPaidItemsByMonth(siteId: string, year: number, month: number) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // Verify the site belongs to this user
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } })
  if (!site || site.userId !== session.user.id) throw new Error('Not authorized')

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: {
        siteId,
        status: ORDER_COMPLETE,
        invoices: {
          some: {
            issuerType: 'PARTNER',
            invoicedAt: { gte: start, lt: end },
          },
        },
      },
      include: {
        invoices: {
          where: { issuerType: 'PARTNER' },
          include: { invoiceLines: true },
        },
        orderItems: true,
        seat: { select: { number: true } },
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.reservation.findMany({
      where: {
        siteId,
        status: RESERVATION_COMPLETE,
        invoices: {
          some: {
            issuerType: 'PARTNER',
            invoicedAt: { gte: start, lt: end },
          },
        },
      },
      include: {
        invoices: {
          where: { issuerType: 'PARTNER' },
          include: { invoiceLines: true },
        },
        user: { select: { email: true } },
        items: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return { orders, reservations }
}
